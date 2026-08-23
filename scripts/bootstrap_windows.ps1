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

if ($Action -in @("test", "test-fixture") -and $env:CODEX_ZH_CN_TEST_FIXTURE -ne "1") {
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

if ($Action -eq "test-fixture") {
    if (-not $CodexPath) {
        throw "test-fixture requires -CodexPath."
    }

    $fixtureRoot = Split-Path -Parent ([System.IO.Path]::GetFullPath($CodexPath))
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char]'\') + '\'
    if (-not $fixtureRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $fixtureRoot).StartsWith("codex-zh-cn-smoke-", [System.StringComparison]::Ordinal)) {
        throw "test-fixture path must be a unique codex-zh-cn-smoke-* directory under TEMP."
    }

    $fixtureHome = Join-Path $fixtureRoot "home"
    $fixtureManifest = Join-Path $fixtureRoot "fixture-manifest.json"
    $fixtureBuilder = Join-Path $projectRoot "tests\helpers\asar-fixture.mjs"
    & $nodePath $fixtureBuilder --app $CodexPath --home $fixtureHome --manifest $fixtureManifest
    if ($LASTEXITCODE -ne 0) {
        throw "Fixture builder failed: $LASTEXITCODE"
    }

    $env:HOME = $fixtureHome
    $env:USERPROFILE = $fixtureHome
    $env:APPDATA = Join-Path $fixtureHome "AppData\Roaming"
    $env:LOCALAPPDATA = Join-Path $fixtureHome "AppData\Local"
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
