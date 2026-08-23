param(
    [ValidateSet("menu", "status", "install", "restore", "test", "test-fixture")]
    [string]$Action = "menu",

    [string]$CodexPath = "",

    [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $PSScriptRoot "install_windows.ps1"
. (Join-Path $PSScriptRoot "runtime-contract.ps1")

if (($Action -eq "test" -or $Action -eq "test-fixture") -and $env:CODEX_ZH_CN_TEST_FIXTURE -ne "1") {
    throw "Test actions are disabled outside the smoke harness."
}

$runtime = Get-VerifiedRuntime -ProjectRoot $projectRoot
$nodePath = $runtime.NodePath

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    New-Item -ItemType Directory -Path (Join-Path $projectRoot "runtime\expanded") -Force | Out-Null
    Expand-Archive -LiteralPath $runtime.ArchivePath -DestinationPath (Join-Path $projectRoot "runtime\expanded") -Force
}

$nodePath = Assert-VerifiedBundledNode -Runtime $runtime -NodePath $nodePath

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
