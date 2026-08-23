param()

$ErrorActionPreference = "Stop"

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
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
