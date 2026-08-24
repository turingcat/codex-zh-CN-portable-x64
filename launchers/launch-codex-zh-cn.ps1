#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Quiet,
    [switch]$TestMode,
    [string]$TestStoreIdentity
)

$ErrorActionPreference = 'Stop'

function Show-LauncherError {
    param([Parameter(Mandatory = $true)][string]$Message)
    if ($Quiet) {
        [Console]::Error.WriteLine($Message)
        return
    }
    try {
        $shell = New-Object -ComObject WScript.Shell
        [void]$shell.Popup($Message, 0, 'Codex zh-CN', 16)
    } catch {
        [Console]::Error.WriteLine($Message)
    }
}

function Test-CanonicalWin32Path {
    param([object]$Value)
    if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { return $false }
    if ($Value -cnotmatch '^[A-Za-z]:\\' -or $Value.Contains('/')) { return $false }
    if ($Value.IndexOf(':', 2) -ge 0 -or $Value -match '[\x00-\x1f<>"|?*]') { return $false }
    $components = $Value.Substring(3).Split([char]'\')
    if ($components.Count -eq 0) { return $false }
    foreach ($component in $components) {
        if ([string]::IsNullOrEmpty($component) -or $component -ceq '.' -or $component -ceq '..') {
            return $false
        }
        if ($component -match '[. ]$' -or $component -match '~[0-9]+(?:\.|$)') { return $false }
        if ($component -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { return $false }
    }
    try {
        return [System.IO.Path]::GetFullPath($Value) -ceq $Value
    } catch {
        return $false
    }
}

function Test-SameWin32Path {
    param([string]$Left, [string]$Right)
    return [string]::Equals($Left, $Right, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-Win32PathWithin {
    param([string]$Child, [string]$Parent)
    if (-not (Test-CanonicalWin32Path $Child) -or -not (Test-CanonicalWin32Path $Parent)) {
        return $false
    }
    return $Child.StartsWith(
        $Parent.TrimEnd([char]'\') + '\',
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Get-ManagedPathKey {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $normalized = [System.IO.Path]::GetFullPath($PathValue).ToLowerInvariant()
        $hash = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalized))
        return (($hash | Select-Object -First 8 | ForEach-Object { $_.ToString('x2') }) -join '')
    } finally {
        $sha256.Dispose()
    }
}

function Read-ManagedState {
    param([Parameter(Mandatory = $true)][string]$StatePath)
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) {
        throw '未找到托管汉化状态。请重新运行 install-windows.bat。'
    }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($StatePath)
        if ($bytes.Length -eq 0 -or $bytes.Length -gt 1048576) { throw 'invalid size' }
        Add-Type -AssemblyName System.Runtime.Serialization
        $reader = [System.Runtime.Serialization.Json.JsonReaderWriterFactory]::CreateJsonReader(
            $bytes,
            [System.Xml.XmlDictionaryReaderQuotas]::Max
        )
        try {
            $document = New-Object System.Xml.XmlDocument
            $document.Load($reader)
        } finally {
            $reader.Close()
        }
    } catch {
        throw '托管汉化状态无效。请重新运行 install-windows.bat。'
    }

    $root = $document.DocumentElement
    $required = @(
        'version', 'patchVersion', 'mode', 'sourceApp',
        'sourceIdentity', 'patchedApp', 'backupRoot', 'localeStatePath'
    )
    $properties = @($root.ChildNodes | Where-Object {
        $_.NodeType -eq [System.Xml.XmlNodeType]::Element
    })
    if ($root.GetAttribute('type') -cne 'object' -or $properties.Count -ne $required.Count) {
        throw '托管汉化状态无效。请重新运行 install-windows.bat。'
    }

    $values = [ordered]@{}
    foreach ($key in $required) {
        $matches = @($properties | Where-Object { $_.LocalName -ceq $key })
        if ($matches.Count -ne 1) {
            throw '托管汉化状态无效。请重新运行 install-windows.bat。'
        }
        $node = $matches[0]
        if ($key -ceq 'version') {
            if ($node.GetAttribute('type') -cne 'number' -or $node.InnerText -cne '1') {
                throw '托管汉化状态无效。请重新运行 install-windows.bat。'
            }
            $values[$key] = [int]1
        } else {
            if ($node.GetAttribute('type') -cne 'string' -or
                [string]::IsNullOrWhiteSpace($node.InnerText) -or
                $node.InnerText -match '[\x00-\x1f]') {
                throw '托管汉化状态无效。请重新运行 install-windows.bat。'
            }
            $values[$key] = $node.InnerText
        }
    }

    $state = [pscustomobject]$values
    if ($state.patchVersion -cnotmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$' -or
        ($state.mode -cne 'in-place' -and $state.mode -cne 'store-copy') -or
        $state.sourceIdentity -match '[\\/:]' -or
        $state.sourceIdentity -ceq '.' -or $state.sourceIdentity -ceq '..' -or
        -not (Test-CanonicalWin32Path $state.sourceApp) -or
        -not (Test-CanonicalWin32Path $state.patchedApp) -or
        -not (Test-CanonicalWin32Path $state.backupRoot) -or
        -not (Test-CanonicalWin32Path $state.localeStatePath)) {
        throw '托管汉化状态无效。请重新运行 install-windows.bat。'
    }
    return $state
}

function Assert-ManagedStateRelationships {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][string]$UserProfile
    )
    if (-not (Test-CanonicalWin32Path $UserProfile)) {
        throw '用户目录路径无效，拒绝启动 Codex。'
    }
    $backupBase = Join-Path $UserProfile '.codex\zh-cn-install-backups'
    $expectedBackupRoot = Join-Path $backupBase ((Get-ManagedPathKey $State.patchedApp) + '\latest')
    $expectedLocaleStatePath = Join-Path $expectedBackupRoot 'locale-state.json'
    if (-not (Test-SameWin32Path $State.backupRoot $expectedBackupRoot) -or
        -not (Test-SameWin32Path $State.localeStatePath $expectedLocaleStatePath) -or
        -not (Test-Win32PathWithin $State.backupRoot $backupBase)) {
        throw '托管汉化状态路径布局无效。请重新运行 install-windows.bat。'
    }

    $sourceComponents = $State.sourceApp.Substring(3).Split([char]'\')
    if ($State.mode -ceq 'in-place') {
        if (-not (Test-SameWin32Path $State.patchedApp $State.sourceApp) -or
            [System.IO.Path]::GetFileName($State.sourceApp) -cne $State.sourceIdentity -or
            @($sourceComponents | Where-Object { $_ -ieq 'WindowsApps' }).Count -ne 0) {
            throw '原位安装的托管状态路径关系无效。请重新运行 install-windows.bat。'
        }
        return
    }

    $windowsAppsIndexes = @()
    for ($index = 0; $index -lt $sourceComponents.Count; $index += 1) {
        if ($sourceComponents[$index] -ieq 'WindowsApps') { $windowsAppsIndexes += $index }
    }
    if ($windowsAppsIndexes.Count -ne 1) {
        throw 'Store 安装的源路径布局无效。请重新运行 install-windows.bat。'
    }
    $windowsAppsIndex = $windowsAppsIndexes[0]
    if ($windowsAppsIndex + 2 -ne $sourceComponents.Count - 1 -or
        $sourceComponents[$windowsAppsIndex + 1] -cne $State.sourceIdentity -or
        $sourceComponents[$windowsAppsIndex + 2] -cne 'app') {
        throw 'Store 安装的源路径布局无效。请重新运行 install-windows.bat。'
    }

    $managedRoot = Join-Path $UserProfile '.codex\zh-cn-patched'
    $expectedPatchedApp = Join-Path $managedRoot ((Get-ManagedPathKey $State.sourceApp) + '\app')
    if (-not (Test-SameWin32Path $State.patchedApp $expectedPatchedApp) -or
        -not (Test-Win32PathWithin $State.patchedApp $managedRoot) -or
        @($State.patchedApp.Substring(3).Split([char]'\') |
            Where-Object { $_ -ieq 'WindowsApps' }).Count -ne 0) {
        throw 'Store 托管副本路径布局无效。请重新运行 install-windows.bat。'
    }
}

function Assert-NoReparseComponents {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    $root = [System.IO.Path]::GetPathRoot($PathValue)
    $current = $root
    foreach ($component in $PathValue.Substring($root.Length).Split([char]'\')) {
        $current = Join-Path $current $component
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw '托管 Codex 路径包含符号链接、联接点或重解析点，拒绝启动。'
        }
    }
}

function Resolve-ValidatedLaunchTarget {
    param([Parameter(Mandatory = $true)]$State)
    Assert-NoReparseComponents $State.patchedApp
    $appItem = Get-Item -LiteralPath $State.patchedApp -Force -ErrorAction Stop
    if (-not $appItem.PSIsContainer) {
        throw '托管 Codex 应用目录缺失。请重新运行 install-windows.bat。'
    }
    $resolvedApp = $appItem.FullName.TrimEnd([char]'\')
    if (-not (Test-SameWin32Path $resolvedApp $State.patchedApp)) {
        throw '托管 Codex 应用目录解析结果异常，拒绝启动。'
    }

    $executablePath = $null
    foreach ($name in @('Codex.exe', 'codex.exe')) {
        $candidate = Join-Path $State.patchedApp $name
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $executablePath = $candidate
            break
        }
    }
    if (-not $executablePath) {
        throw '托管 Codex 副本中未找到 Codex.exe。请重新运行 install-windows.bat。'
    }
    Assert-NoReparseComponents $executablePath
    $resolvedExecutable = (Get-Item -LiteralPath $executablePath -Force).FullName
    if (-not (Test-CanonicalWin32Path $resolvedExecutable) -or
        -not (Test-Win32PathWithin $resolvedExecutable $resolvedApp)) {
        throw '托管 Codex 可执行文件解析后越出应用目录，拒绝启动。'
    }
    return [pscustomobject]@{
        AppPath = $resolvedApp
        ExecutablePath = $resolvedExecutable
    }
}

function Get-CurrentStoreIdentity {
    $current = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue |
        Sort-Object -Property Version -Descending |
        Select-Object -First 1
    if ($null -eq $current -or [string]::IsNullOrWhiteSpace($current.InstallLocation)) {
        return $null
    }
    return [System.IO.Path]::GetFileName($current.InstallLocation.TrimEnd([char]'\'))
}

function Set-CodexLocaleZhCn {
    param([Parameter(Mandatory = $true)][string]$UserProfile)
    $configPath = Join-Path $UserProfile '.codex\config.toml'
    $codexHome = Split-Path -Parent $configPath
    if (-not (Test-Path -LiteralPath $codexHome -PathType Container)) {
        New-Item -ItemType Directory -Path $codexHome -Force | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false, $false)
    $content = if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $utf8NoBom.GetString([System.IO.File]::ReadAllBytes($configPath))
    } else {
        ''
    }
    $crlf = [string][char]13 + [string][char]10
    $lf = [string][char]10
    $newline = if ($content.Contains($crlf)) { $crlf } else { $lf }
    $sections = @([regex]::Matches(
        $content,
        '(?m)^[\t ]*\[([^\]\r\n]+)\][\t ]*(?:#.*)?\r?$'
    ))
    $desktopSections = @($sections | Where-Object { $_.Groups[1].Value -ceq 'desktop' })
    if ($desktopSections.Count -gt 1) {
        throw '检测到多个 [desktop] 配置段，拒绝修改语言配置。'
    }

    if ($desktopSections.Count -eq 0) {
        $block = '[desktop]' + $newline + 'localeOverride = "zh-CN"' + $newline
        if ($content.Length -eq 0) {
            $content = $block
        } elseif ($content.EndsWith($lf)) {
            $content = $content + $newline + $block
        } else {
            $content = $content + $newline + $newline + $block
        }
    } else {
        $desktop = $desktopSections[0]
        $headerStart = $desktop.Index
        $newlineIndex = $content.IndexOf($lf, $headerStart)
        $headerEnd = if ($newlineIndex -lt 0) { $content.Length } else { $newlineIndex + 1 }
        $sectionIndex = [array]::IndexOf($sections, $desktop)
        $sectionEnd = if ($sectionIndex + 1 -lt $sections.Count) {
            $sections[$sectionIndex + 1].Index
        } else {
            $content.Length
        }
        $localeMatches = @([regex]::Matches(
            $content.Substring($headerEnd, $sectionEnd - $headerEnd),
            '(?m)^[\t ]*localeOverride[\t ]*='
        ))
        if ($localeMatches.Count -gt 1) {
            throw '检测到多个 localeOverride 配置项，拒绝修改语言配置。'
        }
        if ($localeMatches.Count -eq 0) {
            $headerHasNewline = $headerEnd -gt $headerStart -and
                $content[$headerEnd - 1] -ceq [char]10
            $insertion = $(if ($headerHasNewline) { '' } else { $newline }) +
                'localeOverride = "zh-CN"' + $newline
            $content = $content.Substring(0, $headerEnd) +
                $insertion + $content.Substring($headerEnd)
        } else {
            $locale = $localeMatches[0]
            $lineStart = $headerEnd + $locale.Index
            $lineEnd = $content.IndexOf($lf, $lineStart)
            if ($lineEnd -lt 0) {
                $valueEnd = $content.Length
            } else {
                $valueEnd = $lineEnd
                if ($lineEnd -gt 0 -and $content[$lineEnd - 1] -ceq [char]13) { $valueEnd -= 1 }
            }
            $content = $content.Substring(0, $lineStart) + $locale.Value +
                ' "zh-CN"' + $content.Substring($valueEnd)
        }
    }
    [System.IO.File]::WriteAllText($configPath, $content, $utf8NoBom)
}

try {
    if (-not $TestMode -and $PSBoundParameters.ContainsKey('TestStoreIdentity')) {
        throw '测试参数不能用于正常启动。'
    }
    if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        throw '无法确定当前用户目录，拒绝启动 Codex。'
    }
    $statePath = Join-Path $env:USERPROFILE '.codex\zh-cn-patched-active.json'
    $state = Read-ManagedState $statePath
    Assert-ManagedStateRelationships -State $state -UserProfile $env:USERPROFILE
    $launch = Resolve-ValidatedLaunchTarget $state

    if ($state.mode -ceq 'store-copy') {
        $currentIdentity = if ($TestMode) { $TestStoreIdentity } else { Get-CurrentStoreIdentity }
        if ([string]::IsNullOrWhiteSpace($currentIdentity) -or
            $currentIdentity -cne $state.sourceIdentity) {
            throw 'Codex Store 安装缺失或已更新，请重新运行 install-windows.bat。'
        }
    }

    Set-CodexLocaleZhCn -UserProfile $env:USERPROFILE
    if ($TestMode) {
        Write-Output ('[launcher-test] executable={0}' -f $launch.ExecutablePath)
        exit 0
    }
    Start-Process -FilePath $launch.ExecutablePath -WorkingDirectory $launch.AppPath | Out-Null
    exit 0
} catch {
    Show-LauncherError $_.Exception.Message
    exit 1
}
