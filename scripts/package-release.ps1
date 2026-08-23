param(
    [string]$Version = "",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $Root "scripts\runtime-contract.ps1")

function Assert-NoReparsePointInPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,

        [Parameter(Mandatory = $true)]
        [string]$CandidatePath
    )

    $rootFull = [System.IO.Path]::GetFullPath($RootPath).TrimEnd([char]'\')
    $rootPrefix = $rootFull + '\'
    $candidateFull = [System.IO.Path]::GetFullPath($CandidatePath)
    if (-not $candidateFull.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release path escaped project root: $CandidatePath"
    }

    $current = $candidateFull
    while ($true) {
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "Release input path contains a reparse point: $CandidatePath"
        }
        if ($current.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $parent = [System.IO.Path]::GetDirectoryName($current)
        if ([string]::IsNullOrEmpty($parent) -or $parent.Equals($current, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Release path escaped project root: $CandidatePath"
        }
        $current = $parent
    }
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    $packageJson = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = [string]$packageJson.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Release version must use MAJOR.MINOR.PATCH."
}
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $Root "dist"
}

$runtime = Get-VerifiedRuntime -ProjectRoot $Root
$NodePath = $runtime.NodePath
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    New-Item -ItemType Directory -Path (Join-Path $Root "runtime\expanded") -Force | Out-Null
    Expand-Archive -LiteralPath $runtime.ArchivePath -DestinationPath (Join-Path $Root "runtime\expanded") -Force
}
$NodePath = Assert-VerifiedBundledNode -Runtime $runtime -NodePath $NodePath

& $NodePath (Join-Path $Root "scripts\validate-release.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Release validation failed."
}

$releaseFilesJson = & $NodePath (Join-Path $Root "scripts\release-files.mjs") $Root
if ($LASTEXITCODE -ne 0) {
    throw "Release file collection failed."
}
$releaseFiles = @($releaseFilesJson | ConvertFrom-Json)
if ($releaseFiles.Count -eq 0) {
    throw "Release file collection returned no files."
}

$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-zh-cn-package-" + [guid]::NewGuid().ToString("N"))
$rootPrefix = [System.IO.Path]::GetFullPath($Root).TrimEnd([char]'\') + '\'
$zipName = "codex-zh-CN-portable-x64-v$Version.zip"
$zipPath = Join-Path $OutputDir $zipName

try {
    New-Item -ItemType Directory -Path $stageRoot | Out-Null
    foreach ($relativePath in $releaseFiles) {
        $source = [System.IO.Path]::GetFullPath((Join-Path $Root ([string]$relativePath)))
        if (-not $source.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Release path escaped the project root: $relativePath"
        }
        $sourceItem = Get-Item -LiteralPath $source -Force
        if ($sourceItem.PSIsContainer -or ($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            throw "Release input must be a regular file: $relativePath"
        }

        $target = Join-Path $stageRoot ([string]$relativePath)
        $targetDirectory = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
        }
        Assert-NoReparsePointInPath -RootPath $Root -CandidatePath $source
        Copy-Item -LiteralPath $source -Destination $target
    }

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    if (Test-Path -LiteralPath "$zipPath.sha256") {
        Remove-Item -LiteralPath "$zipPath.sha256" -Force
    }

    $stagingChildren = @(Get-ChildItem -LiteralPath $stageRoot -Force | ForEach-Object { $_.FullName })
    Compress-Archive -LiteralPath $stagingChildren -DestinationPath $zipPath -CompressionLevel Optimal

    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $sidecar = "$zipHash  $zipName`r`n"
    [System.IO.File]::WriteAllText("$zipPath.sha256", $sidecar, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[OK] $zipPath"
    Write-Host "[SHA256] $zipHash"
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}
