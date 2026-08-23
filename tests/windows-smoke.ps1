param()

$ErrorActionPreference = "Stop"

function Assert-SafeSmokeFixtureTree {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FixturePath
    )

    $fixtureFull = [System.IO.Path]::GetFullPath($FixturePath)
    $tempPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char]'\') + '\'
    if (-not $fixtureFull.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $fixtureFull).StartsWith("codex-zh-cn-smoke-", [System.StringComparison]::Ordinal)) {
        throw "Smoke fixture path must be a unique codex-zh-cn-smoke-* directory under TEMP."
    }

    $pending = [System.Collections.Generic.Stack[string]]::new()
    $pending.Push($fixtureFull)
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $item = Get-Item -LiteralPath $current -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "Smoke fixture tree contains a reparse point: $current"
        }
        if (-not $item.PSIsContainer) {
            continue
        }
        foreach ($child in Get-ChildItem -LiteralPath $current -Force) {
            if ($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw "Smoke fixture tree contains a reparse point: $($child.FullName)"
            }
            if ($child.PSIsContainer) {
                $pending.Push($child.FullName)
            }
        }
    }
}

if ($env:CODEX_ZH_CN_TEST_FIXTURE -ne "1") {
    throw "Windows fixture smoke requires CODEX_ZH_CN_TEST_FIXTURE=1."
}

$root = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-zh-cn-smoke-" + [guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Path $fixture | Out-Null
    $appPath = Join-Path $fixture "app"
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\bootstrap_windows.ps1") -Action test-fixture -CodexPath $appPath -NoPause 2>&1
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }

    if ($exitCode -ne 0) {
        throw "fixture smoke failed: $exitCode"
    }
    if (($output -join "`n") -notmatch "\[smoke\] i18nGateEnabled=true") {
        throw "fixture smoke did not verify the i18n gate"
    }
    if (($output -join "`n") -notmatch "\[smoke\] patchInstalled=true") {
        throw "fixture smoke did not verify installed status"
    }
    if (($output -join "`n") -notmatch "\[smoke\] restoreComplete=true") {
        throw "fixture smoke did not complete restore verification"
    }

    $manifestPath = Join-Path $fixture "fixture-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $fixturePrefix = [System.IO.Path]::GetFullPath($fixture).TrimEnd([char]'\') + '\'
    foreach ($entry in $manifest.sha256.PSObject.Properties) {
        $candidate = [System.IO.Path]::GetFullPath((Join-Path $fixture ($entry.Name.Replace("/", "\"))))
        if (-not $candidate.StartsWith($fixturePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "fixture manifest path escaped the smoke root: $($entry.Name)"
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "restored fixture file is missing: $($entry.Name)"
        }
        $actualHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne [string]$entry.Value) {
            throw "restored fixture hash mismatch: $($entry.Name)"
        }
    }
} finally {
    if (Test-Path -LiteralPath $fixture) {
        Assert-SafeSmokeFixtureTree -FixturePath $fixture
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
