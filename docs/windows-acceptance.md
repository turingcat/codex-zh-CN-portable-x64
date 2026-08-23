# Windows x64 手工验收清单

本清单用于真实 Windows 10/11 x64 电脑上的发行验收。合成夹具 smoke 不能替代真实 Codex UI、签名策略和更新行为检查。

## 1. 记录安装前基线

1. 完整解压发行 ZIP，确认不是从 ZIP 预览窗口运行。
2. 退出 Codex，并确认任务管理器中没有 `Codex.exe`。
3. 找到当前 Codex 应用目录，记录安装来源（Microsoft Store 或常规安装）和版本：

   ```powershell
   $CodexRoot = "C:\Path\To\Codex"
   (Get-Item -LiteralPath "$CodexRoot\Codex.exe").VersionInfo.FileVersion
   Get-FileHash -LiteralPath "$CodexRoot\resources\app.asar" -Algorithm SHA256
   Get-FileHash -LiteralPath "$CodexRoot\Codex.exe" -Algorithm SHA256
   ```

4. 逐字节备份用户配置；文件不存在时也要记录“原本不存在”：

   ```powershell
   $Evidence = Join-Path $env:TEMP ("codex-zh-cn-acceptance-" + [guid]::NewGuid().ToString("N"))
   New-Item -ItemType Directory -Path $Evidence | Out-Null
   $Config = Join-Path $env:USERPROFILE ".codex\config.toml"
   if (Test-Path -LiteralPath $Config) {
       Copy-Item -LiteralPath $Config -Destination (Join-Path $Evidence "config.before.toml")
       Get-FileHash -LiteralPath $Config -Algorithm SHA256
   }
   ```

5. 如需验证插件恢复，另外备份 `%USERPROFILE%\.codex\plugins\cache\openai-bundled\` 下将被识别的 `.codex-plugin\plugin.json`。

## 2. 安装与首次启动

1. 双击 `install-windows.bat`，选择“安装汉化”。
2. 确认安装日志同时出现：

   - `enable_i18n` 为 `already-enabled`，且 recognized 大于 0、ambiguous 等于 0；
   - `app.asar` 验证通过；
   - `Codex.exe` 与 ASAR 完整性验证通过；
   - 托管状态写入成功。

3. 常规安装从原有快捷方式启动；Microsoft Store 安装从解压目录中新生成的 `Codex 汉化版.bat` 启动。不得直接启动旧的托管副本或手工拼接路径。

## 3. UI 与状态验收

在真实 Codex 窗口逐项确认：

- 主界面的代表性导航、按钮和提示显示简体中文；不存在整页仍为英文的情况。
- 原生菜单至少确认“文件”和“编辑”，并展开检查撤销、复制、粘贴等代表性子项。
- 打开 Settings，确认设置入口、页面标题和代表性选项显示中文。
- 打开插件或工具相关界面，确认已支持的内置插件名称和简短说明显示中文。
- 输入中文、复制粘贴中文、打开已有会话，确认没有乱码、空白方框或异常截断。

随后运行 `status-windows.bat`，确认：

- 总体状态为“汉化已生效”；
- `i18nGateEnabled=true`，recognized 大于 0，ambiguous 等于 0；
- ASAR、EXE 完整性、locale、插件和 rollback 均健康；
- Store 模式的源身份为 current 而不是 stale，专用启动入口存在且目标受控。

## 4. 更新与重新修补

1. 如条件允许，先恢复，再通过 OpenAI 官方渠道更新 Codex。
2. 更新后先正常启动官方 Codex，记录新的版本、`app.asar`、`Codex.exe` 和配置基线。
3. 运行 `status-windows.bat`：旧 Store 副本必须报告 stale 或拒绝启动；常规安装若被更新覆盖，不得错误报告旧补丁仍健康。
4. 再次运行 `install-windows.bat`，重复第 2、3 节检查。
5. 如果新版本门控或 ASAR 结构不受支持，验收预期是安装失败关闭且官方文件仍可使用，不得接受“部分成功”。

## 5. 恢复与字节比对

1. 关闭 Codex，运行 `restore-windows.bat`。
2. 对本轮安装前记录的基线重新计算哈希：

   ```powershell
   Get-FileHash -LiteralPath "$CodexRoot\resources\app.asar" -Algorithm SHA256
   Get-FileHash -LiteralPath "$CodexRoot\Codex.exe" -Algorithm SHA256
   if (Test-Path -LiteralPath $Config) {
       Compare-Object ([System.IO.File]::ReadAllBytes($Config)) ([System.IO.File]::ReadAllBytes((Join-Path $Evidence "config.before.toml")))
   }
   ```

   `app.asar`、`Codex.exe` 的 SHA-256 应与同一轮安装前一致；原本存在的配置应逐字节一致，原本不存在的配置应恢复为不存在。已记录的插件 metadata 也应逐字节一致。

3. Store 模式确认托管状态和可写副本入口不再被当作活动补丁；常规安装确认原始文件已恢复。
4. 从官方开始菜单、官方快捷方式或官方应用目录启动 Codex，确认仍能正常打开。
5. 再运行 `status-windows.bat`，预期报告未安装汉化，而不是损坏或半恢复状态。

## 6. 结果记录

验收记录至少保留：Windows 版本与架构、Codex 安装来源和版本、发行 ZIP SHA-256、安装前后及恢复后的核心文件哈希、配置字节比对结果、UI 检查截图、`status-windows.bat` 输出，以及 SmartScreen、WDAC、AppLocker 或杀毒软件是否拦截。
