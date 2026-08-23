param(
    [ValidateSet("menu", "status", "install", "restore", "test", "test-fixture")]
    [string]$Action = "menu",

    [string]$CodexPath = "",

    [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot "runtime"
$manifestPath = Join-Path $runtimeRoot "runtime.json"
$expandedRoot = Join-Path $runtimeRoot "expanded"
$installerPath = Join-Path $PSScriptRoot "install_windows.ps1"

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    throw "This bundle requires an AMD64 Windows environment."
}

if (($Action -eq "test" -or $Action -eq "test-fixture") -and $env:CODEX_ZH_CN_TEST_FIXTURE -ne "1") {
    throw "Test actions are disabled outside the smoke harness."
}

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Bundled runtime manifest is missing: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$archivePath = Join-Path $runtimeRoot $manifest.archive
$nodePath = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $expandedRoot $manifest.extractedDirectory) $manifest.executable))

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw "Bundled runtime archive is missing: $archivePath"
    }

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $manifest.sha256) {
        throw "Bundled Node.js checksum mismatch."
    }

    New-Item -ItemType Directory -Path $expandedRoot -Force | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $expandedRoot -Force
}

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Bundled Node.js executable is missing after expansion: $nodePath"
}

$version = (& $nodePath --version).Trim()
if ($version -ne $manifest.version) {
    throw "Bundled Node.js version mismatch: $version"
}

if ($Action -eq "test") {
    $tests = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot "tests") -Filter "*.test.mjs" | ForEach-Object { $_.FullName })
    & $nodePath --test @tests
    exit $LASTEXITCODE
}

$installerArgs = @("-Action", $Action, "-NodePath", $nodePath)
if ($CodexPath) {
    $installerArgs += @("-CodexPath", $CodexPath)
}
if ($NoPause) {
    $installerArgs += "-NoPause"
}

& $installerPath @installerArgs
exit $LASTEXITCODE
