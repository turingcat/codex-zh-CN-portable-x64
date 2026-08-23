#Requires -Version 5.1
<#
.SYNOPSIS
  Launch patched Codex Desktop and ensure zh-CN locale is persisted.
#>
[CmdletBinding()]
param(
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Show-LauncherError {
    param([string]$Message)

    if ($Quiet) {
        Write-Error $Message
        return
    }

    try {
        $shell = New-Object -ComObject WScript.Shell
        [void]$shell.Popup($Message, 0, 'Codex zh-CN', 16)
    } catch {
        Write-Error $Message
    }
}

function Set-CodexLocaleZhCn {
    $configPath = Join-Path -Path $env:USERPROFILE -ChildPath '.codex\config.toml'
    $codexHome = Split-Path -Parent $configPath

    if (-not (Test-Path -LiteralPath $codexHome)) {
        New-Item -ItemType Directory -Path $codexHome -Force | Out-Null
    }

    $content = ''
    if (Test-Path -LiteralPath $configPath) {
        $content = [System.IO.File]::ReadAllText($configPath)
    }

    $block = "[desktop]`r`nlocaleOverride = `"zh-CN`"`r`n"
    if ($content -match '(?m)^\[desktop\]') {
        if ($content -match 'localeOverride\s*=') {
            $content = [regex]::Replace(
                $content,
                'localeOverride\s*=\s*"[^"]*"',
                'localeOverride = "zh-CN"'
            )
        } else {
            $content = [regex]::Replace($content, '(?m)^\[desktop\]\s*\r?\n?', $block)
        }
    } elseif ($content.TrimEnd().Length -gt 0) {
        $content = $content.TrimEnd() + "`r`n`r`n" + $block
    } else {
        $content = $block
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($configPath, $content, $utf8NoBom)
}

function Get-PatchedCodexExe {
    param([Parameter(Mandatory = $true)][string]$AppDir)

    foreach ($name in @('Codex.exe', 'codex.exe')) {
        $candidate = Join-Path -Path $AppDir -ChildPath $name
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

function Test-SaneAbsolutePath {
    param([string]$PathValue)
    if ([string]::IsNullOrWhiteSpace($PathValue) -or $PathValue -match "[\x00\r\n]" -or -not [System.IO.Path]::IsPathRooted($PathValue)) { return $false }
    if (($PathValue -split '[\\/]+') -contains '..') { return $false }
    return $true
}

function Test-ManagedPath {
    param([string]$PathValue, [string]$ParentPath)
    if (-not (Test-SaneAbsolutePath $PathValue) -or -not (Test-SaneAbsolutePath $ParentPath)) { return $false }
    try {
        $fullPath = [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\', '/')
        $fullParent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd('\', '/')
        return $fullPath.StartsWith($fullParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Read-ManagedState {
    $statePath = Join-Path -Path $env:USERPROFILE -ChildPath '.codex\zh-cn-patched-active.json'
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw '未找到托管汉化状态。请重新运行 install-windows.bat。' }
    try { $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { throw '托管汉化状态无效。请重新运行 install-windows.bat。' }
    $required = @('version', 'patchVersion', 'mode', 'sourceApp', 'sourceIdentity', 'patchedApp', 'backupRoot', 'localeStatePath')
    $actual = @($state.PSObject.Properties.Name)
    if ($actual.Count -ne $required.Count -or @($actual | Where-Object { $_ -notin $required }).Count -ne 0) { throw '托管汉化状态无效。请重新运行 install-windows.bat。' }
    if ($state.version -ne 1 -or $state.mode -ne 'store-copy' -or $state.patchVersion -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$' -or $state.sourceIdentity -notmatch '^[^\\/:\r\n]+$') { throw '托管汉化状态无效。请重新运行 install-windows.bat。' }
    $managedRoot = Join-Path -Path $env:USERPROFILE -ChildPath '.codex\zh-cn-patched'
    if (-not (Test-SaneAbsolutePath $state.sourceApp) -or -not (Test-SaneAbsolutePath $state.backupRoot) -or -not (Test-ManagedPath -PathValue $state.patchedApp -ParentPath $managedRoot) -or -not (Test-ManagedPath -PathValue $state.localeStatePath -ParentPath $state.backupRoot) -or [System.IO.Path]::GetFileName($state.localeStatePath) -ne 'locale-state.json') { throw '托管汉化状态路径无效。请重新运行 install-windows.bat。' }
    return $state
}

try {
    $state = Read-ManagedState
    $current = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
    if ($null -eq $current) { throw '未检测到当前 Store 版 Codex。请重新运行 install-windows.bat。' }
    $currentIdentity = Split-Path -Leaf $current.InstallLocation
    if ($currentIdentity -ne $state.sourceIdentity) { throw 'Codex 已更新，请重新运行 install-windows.bat。' }
    $appDir = $state.patchedApp
    if (-not (Test-Path -LiteralPath $appDir -PathType Container)) { throw '托管 Codex 副本缺失。请重新运行 install-windows.bat。' }
    $exePath = Get-PatchedCodexExe -AppDir $appDir
    if (-not $exePath) { throw '托管 Codex 副本中未找到 Codex.exe。请重新运行 install-windows.bat。' }
    Set-CodexLocaleZhCn
    Start-Process -FilePath $exePath -WorkingDirectory $appDir | Out-Null
    exit 0

    $activeFile = Join-Path -Path $env:USERPROFILE -ChildPath '.codex\zh-cn-patched-active.txt'
    if (-not (Test-Path -LiteralPath $activeFile)) {
        Show-LauncherError @(
            "Patched Codex record not found.`n`nRun install-windows.bat and choose [1] Install."
        )
        exit 1
    }

    $patchedRoot = (
        Get-Content -LiteralPath $activeFile -Encoding UTF8 |
            Where-Object { $_.Trim().Length -gt 0 } |
            Select-Object -First 1
    ).Trim()

    if ([string]::IsNullOrWhiteSpace($patchedRoot) -or -not (Test-Path -LiteralPath $patchedRoot)) {
        Show-LauncherError @(
            "Patched copy folder is missing or invalid.`n`nRun install-windows.bat and choose [1] Install again."
        )
        exit 1
    }

    $appDir = Join-Path -Path $patchedRoot -ChildPath 'app'
    if (-not (Test-Path -LiteralPath $appDir)) {
        Show-LauncherError @(
            "Patched copy is missing the app folder.`n`nRun install-windows.bat and choose [1] Install again."
        )
        exit 1
    }

    $exePath = Get-PatchedCodexExe -AppDir $appDir
    if (-not $exePath) {
        Show-LauncherError @(
            "Codex.exe was not found in the patched copy.`n`nRun install-windows.bat and choose [1] Install again."
        )
        exit 1
    }

    Set-CodexLocaleZhCn

    Start-Process -FilePath $exePath -WorkingDirectory $appDir | Out-Null
    exit 0
} catch {
    Show-LauncherError ("Failed to launch Codex:`n`n{0}" -f $_.Exception.Message)
    exit 1
}
