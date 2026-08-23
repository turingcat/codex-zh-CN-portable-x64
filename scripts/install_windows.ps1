param(
    [ValidateSet("install", "uninstall", "status", "verify", "menu", "restore", "test", "test-fixture")]
    [string]$Action = "menu",
    [string]$CodexPath = "",

    [Parameter(Mandatory = $true)]
    [string]$NodePath,
    [switch]$Interactive,
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$projectRoot = Split-Path -Parent $scriptDir
$patchScript = Join-Path $scriptDir "patch-codex-zh-cn.mjs"
$verifyScript = Join-Path $scriptDir "verify-patch.mjs"
. (Join-Path $scriptDir "runtime-contract.ps1")

function Write-Title {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   Codex Desktop 简体中文语言包" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Ok([string]$Message) {
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
    Write-Host "  [!] $Message" -ForegroundColor Yellow
}

function Write-Bad([string]$Message) {
    Write-Host "  [X] $Message" -ForegroundColor Red
}

function Write-InfoLine([string]$Message) {
    Write-Host "  [i] $Message" -ForegroundColor DarkGray
}

function Test-NodeAvailable {
    return Test-Path -LiteralPath $NodePath -PathType Leaf
}

function Test-IsAdministrator {
    $principal = New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-ElevatedInstaller {
    $elevatedHost = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $elevatedHost -PathType Leaf)) {
        throw "Unable to locate the Windows PowerShell host: $elevatedHost"
    }

    $commandParts = @(
        "& " + (ConvertTo-SingleQuotedPowerShellLiteral $PSCommandPath),
        "-Action " + (ConvertTo-SingleQuotedPowerShellLiteral $Action),
        "-NodePath " + (ConvertTo-SingleQuotedPowerShellLiteral $NodePath)
    )
    if ($CodexPath) {
        $commandParts += "-CodexPath " + (ConvertTo-SingleQuotedPowerShellLiteral $CodexPath)
    }
    if ($NoPause) {
        $commandParts += "-NoPause"
    }
    $encodedCommand = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes(($commandParts -join " ")))

    Write-Host ""
    Write-Host "  需要管理员权限，正在请求 UAC 提升..." -ForegroundColor Yellow
    Write-Host "  请在弹窗中点击「是」。" -ForegroundColor DarkGray
    Write-Host ""

    try {
        $process = Start-Process -FilePath $elevatedHost `
            -Verb RunAs `
            -WorkingDirectory $projectRoot `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedCommand) `
            -Wait -PassThru `
            -ErrorAction Stop
    } catch {
        throw "Unable to start the elevated installer: $($_.Exception.Message)"
    }

    return [int]$process.ExitCode
}

function Ensure-Administrator {
    if (Test-IsAdministrator) { return $null }
    return Invoke-ElevatedInstaller
}

function Get-StatusReport {
    param([string]$CustomCodexPath = "")

    if (-not (Test-Path $patchScript)) {
        throw "缺少补丁脚本: $patchScript"
    }
    if (-not (Test-NodeAvailable)) {
        throw "未找到 Node.js。请先安装 Node.js 后再运行。"
    }

    $argsList = @($patchScript, "status", "--json")
    $storeSourceIdentity = "__CODEX_STORE_IDENTITY_UNAVAILABLE__"
    $storePackage = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    if ($storePackage -and $storePackage.InstallLocation) {
        $storeSourceIdentity = Split-Path -Leaf $storePackage.InstallLocation
    }
    $argsList += @("--store-source-identity", $storeSourceIdentity)
    if ($CustomCodexPath) {
        $argsList += @("--codex-path", $CustomCodexPath)
    }

    $output = & $NodePath @argsList 2>&1
    $statusExitCode = $LASTEXITCODE
    if ($statusExitCode -ne 0 -and $statusExitCode -ne 2) {
        throw "环境检测失败，退出码 $statusExitCode`n$output"
    }

    $jsonLine = ($output | Where-Object { $_ -match '^\{' } | Select-Object -Last 1)
    if (-not $jsonLine) {
        throw "无法读取环境检测报告。`n$output"
    }

    $report = $jsonLine | ConvertFrom-Json
    $report | Add-Member -NotePropertyName statusExitCode -NotePropertyValue $statusExitCode -Force
    return $report
}

function Show-StatusReport {
    param($Report)

    Write-Host ""
    Write-Host "【环境检测】" -ForegroundColor Cyan
    Write-Host ""

    if ($Report.managedState) {
        Write-Ok "托管状态: $($Report.mode)"
    } elseif ($Report.managedStateError) {
        Write-Bad "托管状态无效: $($Report.managedStateError)"
    } else {
        Write-WarnLine "未找到托管状态"
    }
    Write-InfoLine "模式 / 目标: $($Report.mode) / $($Report.codexPath)"
    Write-InfoLine "Store 源记录: $($Report.sourceIdentity)"
    Write-InfoLine "Store 源当前: $($Report.sourceCurrent)"
    if ($Report.stale) {
        Write-Bad "Store 源状态: stale（已更新或不可用，请重新运行 install-windows.bat）"
    } else {
        Write-Ok "Store 源状态: current"
    }

    if ($Report.targetHealthy) {
        Write-Ok "托管目标: healthy"
    } else {
        Write-Bad "托管目标: unhealthy"
    }
    Write-InfoLine "app.asar: $($Report.asarPath)"
    Write-InfoLine "Codex EXE: $($Report.exePath)"

    $gateCounts = "changed=$($Report.i18nGateChanged), recognized=$($Report.i18nGateRecognized), ambiguous=$($Report.i18nGateAmbiguous)"
    if ($Report.i18nGateEnabled) {
        Write-Ok "i18n gate: $($Report.i18nGateStatus) ($gateCounts)"
    } else {
        Write-Bad "i18n gate: $($Report.i18nGateStatus) ($gateCounts)"
    }
    foreach ($gateFile in $Report.i18nGateFiles) {
        Write-InfoLine "i18n gate file: $($gateFile.path) [$($gateFile.status)]"
    }

    if ($Report.executableIntegrity) {
        Write-Ok "EXE-ASAR 完整性: valid"
    } else {
        Write-Bad "EXE-ASAR 完整性: invalid"
    }

    Write-InfoLine "汉化启动器: $($Report.launcherPath)"
    Write-InfoLine "汉化启动目标: $($Report.launcherTarget)"
    if (-not $Report.launcherRequired) {
        Write-InfoLine "启动器路径 / 目标包含关系: in-place 模式不要求生成启动器"
    } elseif ($Report.launcherAvailable -and $Report.launcherTargetContained -and $Report.launcherPathContained) {
        Write-Ok "启动器路径 / 目标包含关系: valid"
    } else {
        Write-Bad "启动器路径 / 目标包含关系: invalid"
    }

    if ($Report.nodeOk) {
        Write-Ok "Node.js $($Report.nodeVersion)"
    } else {
        Write-Bad "未安装 Node.js"
    }

    if ($Report.codexFound) {
        Write-Ok "Codex 安装目录: $($Report.codexPath)"
    } else {
        Write-Bad "未找到 Codex Desktop 安装目录"
    }

    if ($Report.codexRunning) {
        Write-WarnLine "Codex 正在运行（安装汉化时会自动关闭，完成后自动重启）"
    } else {
        Write-InfoLine "Codex 当前未运行（汉化完成后将自动启动）"
    }

    if ($Report.asarLocalized) {
        Write-Ok "应用资源已汉化 (app.asar)"
    } else {
        Write-WarnLine "应用资源尚未汉化"
    }

    if ($Report.localeZhCn) {
        Write-Ok "语言配置: zh-CN"
    } else {
        Write-WarnLine "语言配置: $($Report.localeOverride)"
    }
    if ($Report.localeRestorable) {
        Write-Ok "语言配置备份: valid / restorable"
    } else {
        Write-Bad "语言配置备份: invalid / not restorable"
    }

    if ($Report.pluginsTotal -gt 0) {
        if ($Report.pluginsHealthy) {
            Write-Ok "内置插件 metadata: $($Report.pluginsLocalized)/$($Report.pluginsTotal)"
        } else {
            Write-WarnLine "内置插件 metadata: $($Report.pluginsLocalized)/$($Report.pluginsTotal)"
        }
        foreach ($plugin in $Report.plugins) {
            if ($plugin.localized) {
                Write-InfoLine "$($plugin.name): $($plugin.displayName)"
            } else {
                Write-WarnLine "$($plugin.name): $($plugin.displayName)"
            }
        }
    } else {
        Write-WarnLine "尚未检测到内置插件缓存"
    }

    if ($Report.rollbackAvailable) {
        Write-Ok "托管回滚: available"
    } else {
        Write-Bad "托管回滚: unavailable"
    }

    if ($Report.asarBackup) {
        Write-InfoLine "已存在 app.asar 备份，可安全重置"
    } else {
        Write-WarnLine "尚无 app.asar 备份，首次汉化后会自动创建"
    }

    Write-Host ""
    if ($Report.patchInstalled) {
        Write-Host "  总体状态: 汉化已生效" -ForegroundColor Green
    } elseif ($Report.codexFound) {
        Write-Host "  总体状态: 尚未完全汉化" -ForegroundColor Yellow
    } else {
        Write-Host "  总体状态: 环境未就绪" -ForegroundColor Red
    }

    foreach ($message in $Report.messages) {
        Write-InfoLine $message
    }
}

function Invoke-PatchAction {
    param(
        [ValidateSet("install", "uninstall")]
        [string]$PatchAction,
        [string]$CustomCodexPath = "",
        [switch]$LaunchCodex
    )

    $argsList = @($patchScript, $PatchAction)
    if ($CustomCodexPath) {
        $argsList += @("--codex-path", $CustomCodexPath)
    }

    Write-InfoLine "安装进度将实时显示在下方，复制文件时可能需 2–5 分钟，请勿关闭窗口。"
    $patchLines = [System.Collections.Generic.List[string]]::new()
    & $NodePath @argsList 2>&1 | ForEach-Object {
        $line = "$_"
        if ($line -match '^\[progress-bar\]') {
            Write-Host $line -ForegroundColor Magenta
        } elseif ($line -match '^\[step \d+/\d+\]' -or $line -match '^\[progress\]') {
            Write-Host $line -ForegroundColor Cyan
        } elseif ($line -match '^\[ok\]' -or $line -match '^\[OK\]') {
            Write-Host $line -ForegroundColor Green
        } elseif ($line -match '^\[warn\]' -or $line -match '^\[error\]' -or $line -match '^\[X\]') {
            Write-Host $line -ForegroundColor Yellow
        } else {
            Write-Host $line
        }
        [void]$patchLines.Add($line)
    }
    if ($LASTEXITCODE -ne 0) {
        throw "操作失败，退出码 $LASTEXITCODE"
    }

    if ($PatchAction -eq "install") {
        $installedReport = Get-StatusReport -CustomCodexPath $CustomCodexPath
        Show-StatusReport -Report $installedReport
        if ([int]$installedReport.statusExitCode -ne 0 -or -not $installedReport.ok) {
            throw "安装后的托管状态验证失败，退出码 $($installedReport.statusExitCode)"
        }
    }

    if ($PatchAction -eq "install" -and $LaunchCodex) {
        $launched = $false
        foreach ($line in $patchLines) {
            if ($line -match '^\[codex-launch\]\s+(.+)$') {
                Write-Ok "已重新启动 Codex: $($Matches[1].Trim())"
                $launched = $true
                break
            }
        }
        if (-not $launched) {
            Write-InfoLine "汉化已完成；若 Codex 未自动打开，请双击与 install-windows.bat 同目录下的「Codex 汉化版.bat」启动。"
        }
    }
}

function Invoke-VerifyPatch {
    param([string]$CustomCodexPath = "")

    $report = Get-StatusReport -CustomCodexPath $CustomCodexPath
    Show-StatusReport -Report $report
    if ([int]$report.statusExitCode -ne 0 -or -not $report.ok) {
        throw "托管状态验证失败，退出码 $($report.statusExitCode)"
    }

    $asarPath = $report.asarPath
    $exePath = $report.exePath
    if (-not $asarPath -or -not $exePath) {
        throw "未找到托管 app.asar / Codex.exe 路径。"
    }

    Write-Step "【验证补丁】"
    & $NodePath $verifyScript $asarPath $exePath
    if ($LASTEXITCODE -ne 0) {
        throw "验证脚本执行失败，退出码 $LASTEXITCODE"
    }
}

function Confirm-Action {
    param([string]$Prompt)

    while ($true) {
        $answer = (Read-Host $Prompt).Trim()
        switch -Regex ($answer) {
            '^[Yy]$' { return $true }
            '^[Nn]$' { return $false }
            default { Write-WarnLine "请输入 Y 或 N。" }
        }
    }
}

function Read-MenuChoice {
    param([string]$CustomCodexPath = "")

    Write-Host ""
    Write-Host "【操作菜单】" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] 安装汉化"
    Write-Host "  [2] 恢复英文 / 重置"
    Write-Host "  [3] 验证补丁"
    Write-Host "  [4] 重新检测环境"
    if ($CustomCodexPath) {
        Write-Host "  [5] 清除自定义 Codex 路径"
    } else {
        Write-Host "  [5] 手动指定 Codex 路径"
    }
    Write-Host "  [Q] 退出"
    Write-Host ""

    while ($true) {
        $choice = (Read-Host "请选择 [1/2/3/4/5/Q]").Trim()
        switch -Regex ($choice) {
            '^[1]$' { return "install" }
            '^[2]$' { return "uninstall" }
            '^[3]$' { return "verify" }
            '^[4]$' { return "refresh" }
            '^[5]$' { return "path" }
            '^[Qq]$' { return "quit" }
            default { Write-WarnLine "请输入 1、2、3、4、5 或 Q。" }
        }
    }
}

function Start-InteractiveMenu {
    $customCodexPath = $CodexPath

    while ($true) {
        Clear-Host
        Write-Title

        if ($customCodexPath) {
            Write-InfoLine "当前指定 Codex 路径: $customCodexPath"
        }

        $report = Get-StatusReport -CustomCodexPath $customCodexPath
        Show-StatusReport -Report $report

        $choice = Read-MenuChoice -CustomCodexPath $customCodexPath
        switch ($choice) {
            "install" {
                if (-not $report.readyToInstall) {
                    Write-Bad "环境未就绪，请先解决上面的问题。"
                    if (-not $NoPause) { Read-Host "按 Enter 继续" | Out-Null }
                    continue
                }
                Write-Step "【安装汉化】"
                if ($report.codexRunning) {
                    Write-WarnLine "检测到 Codex 正在运行，将先自动关闭，汉化后再自动重启。"
                } else {
                    Write-InfoLine "Codex 未运行；汉化完成后将自动启动。"
                }
                try {
                    Write-InfoLine "正在执行汉化，请稍候…"
                    Invoke-PatchAction -PatchAction "install" -CustomCodexPath $customCodexPath -LaunchCodex
                    Write-Ok "汉化安装完成"
                } catch {
                    Write-Bad $_.Exception.Message
                }
                if (-not $NoPause) { Read-Host "按 Enter 返回菜单" | Out-Null }
            }
            "uninstall" {
                if (-not $report.codexFound) {
                    Write-Bad "未找到 Codex，无法重置。"
                    if (-not $NoPause) { Read-Host "按 Enter 继续" | Out-Null }
                    continue
                }
                if (-not (Confirm-Action "确认恢复英文并重置汉化？(Y/N)")) {
                    continue
                }
                Write-Step "【恢复英文 / 重置】"
                try {
                    Invoke-PatchAction -PatchAction "uninstall" -CustomCodexPath $customCodexPath
                    Write-Ok "已恢复英文，请手动重新启动 Codex"
                } catch {
                    Write-Bad $_.Exception.Message
                }
                if (-not $NoPause) { Read-Host "按 Enter 返回菜单" | Out-Null }
            }
            "verify" {
                Write-Step "【验证补丁】"
                try {
                    Invoke-VerifyPatch -CustomCodexPath $customCodexPath
                    Write-Ok "验证完成"
                } catch {
                    Write-Bad $_.Exception.Message
                }
                if (-not $NoPause) { Read-Host "按 Enter 返回菜单" | Out-Null }
            }
            "refresh" {
                continue
            }
            "path" {
                if ($customCodexPath) {
                    $customCodexPath = ""
                    & $NodePath @($patchScript, "clear-path") | Out-Null
                    Write-Ok "已清除自定义 Codex 路径，将自动检测。"
                } else {
                    $inputPath = (Read-Host "请输入 Codex 安装目录（或其 app 子目录）").Trim('"')
                    $asarOk = $false
                    $resolvedPath = $inputPath
                    if ($inputPath) {
                        if (Test-Path (Join-Path $inputPath "resources\app.asar")) {
                            $asarOk = $true
                        } elseif (Test-Path (Join-Path $inputPath "app\resources\app.asar")) {
                            $asarOk = $true
                            $resolvedPath = Join-Path $inputPath "app"
                        }
                    }
                    if ($asarOk) {
                        $customCodexPath = $resolvedPath
                        & $NodePath @($patchScript, "save-path", "--codex-path", $customCodexPath) | Out-Null
                        if ($LASTEXITCODE -ne 0) {
                            Write-WarnLine "路径已用于本次会话，但未能写入持久化配置"
                        } else {
                            Write-Ok "已设置 Codex 路径（已保存，下次自动识别）: $customCodexPath"
                        }
                    } else {
                        Write-Bad "路径无效，或未找到 resources\app.asar（或 app\resources\app.asar）"
                    }
                }
                if (-not $NoPause) { Read-Host "按 Enter 返回菜单" | Out-Null }
            }
            "quit" {
                Write-Host ""
                Write-Host "已退出。" -ForegroundColor DarkGray
                return
            }
        }
    }
}

if (-not (Test-Path $patchScript)) {
    throw "缺少补丁脚本: $patchScript"
}

if ($Action -in @("test", "test-fixture") -and $env:CODEX_ZH_CN_TEST_FIXTURE -ne "1") {
    throw "Test actions are disabled outside the smoke harness."
}

if ($Interactive -or $Action -in @("menu", "install", "uninstall", "restore", "verify")) {
    $elevatedExitCode = Ensure-Administrator
    if ($null -ne $elevatedExitCode) {
        exit $elevatedExitCode
    }
}

$runtime = Get-VerifiedRuntime -ProjectRoot $projectRoot
$NodePath = Assert-VerifiedBundledNode -Runtime $runtime -NodePath $NodePath

if ($Interactive -or $Action -eq "menu") {
    Start-InteractiveMenu
    exit 0
}

switch ($Action) {
    "status" {
        $report = Get-StatusReport -CustomCodexPath $CodexPath
        Show-StatusReport -Report $report
        exit ([int]$report.statusExitCode)
    }
    "verify" {
        Invoke-VerifyPatch -CustomCodexPath $CodexPath
    }
    "install" {
        Write-Step "【安装汉化】"
        Invoke-PatchAction -PatchAction "install" -CustomCodexPath $CodexPath -LaunchCodex
    }
    "uninstall" {
        Write-Step "【恢复英文 / 重置】"
        Invoke-PatchAction -PatchAction "uninstall" -CustomCodexPath $CodexPath
    }
    "restore" {
        Write-Step "【恢复英文 / 重置】"
        Invoke-PatchAction -PatchAction "uninstall" -CustomCodexPath $CodexPath
    }
    "test" {
        $tests = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot "tests") -Filter "*.test.mjs" | ForEach-Object { $_.FullName })
        & $NodePath --test @tests
        exit $LASTEXITCODE
    }
    "test-fixture" {
        if (-not $CodexPath) {
            throw "test-fixture requires -CodexPath."
        }

        & $NodePath $patchScript "install" --codex-path $CodexPath --no-relaunch
        if ($LASTEXITCODE -ne 0) {
            throw "Fixture install failed: $LASTEXITCODE"
        }

        $report = Get-StatusReport -CustomCodexPath $CodexPath
        Show-StatusReport -Report $report
        if ([int]$report.statusExitCode -ne 0 -or -not $report.i18nGateEnabled -or -not $report.patchInstalled) {
            throw "Fixture status verification failed: $($report.statusExitCode)"
        }
        Write-Host "[smoke] i18nGateEnabled=true"
        Write-Host "[smoke] patchInstalled=true"

        & $NodePath $patchScript "uninstall" --codex-path $CodexPath
        if ($LASTEXITCODE -ne 0) {
            throw "Fixture restore failed: $LASTEXITCODE"
        }
        Write-Host "[smoke] restoreComplete=true"
    }
}

if (-not $NoPause) {
    Write-Host ""
    Read-Host "按 Enter 退出"
}
