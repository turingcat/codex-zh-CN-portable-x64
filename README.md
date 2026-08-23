# Codex 简体中文离线补丁（Windows x64）

本项目在 `xqnode/codex-zh-CN` v0.1.2 的基础上，为已安装的 Codex Desktop 提供可恢复的简体中文补丁和完整的 Windows x64 离线运行环境。

## 能解决什么

上游项目可以替换菜单、中文资源、内置插件名称和 `localeOverride`，但不能完整解决所有“Codex 已有中文资源却仍显示英文”的情况：当 Codex 无法从远程实验服务取得 `enable_i18n` 开关时，内置回退值仍可能关闭国际化；上游脚本还要求电脑预装 Node.js。

本项目额外完成两件事：

- 只在能够唯一识别 `enable_i18n` 的 `false` 回退时将其改为 `true`，并同步 `Codex.exe` 中的 ASAR 完整性哈希。
- 随发行包内置官方 Node.js v24.19.0 Windows x64 运行时，安装、检查和恢复均不依赖系统 Node.js、Python、npm 或网络。

因此，它能解决当前已识别的 Codex Desktop 中文门控、菜单、locale 和内置插件显示问题，但不承诺兼容所有未来 Codex 版本。遇到无法唯一识别的 ASAR、门控或完整性结构时，程序会停止，不会带着猜测替换正在使用的核心文件。

## 使用前须知

- 仅支持 Windows 10/11 x64（AMD64），不支持 Windows on ARM、32 位 Windows、macOS 或 Linux。
- 必须先把发行 ZIP 完整解压到普通文件夹，再运行脚本；不要在资源管理器的 ZIP 预览窗口内直接运行。
- 先退出 Codex。安装过程会检查并尝试关闭仍在运行的 Codex 进程。
- 建议先阅读 [Windows 手工验收清单](docs/windows-acceptance.md)，并记录当前 Codex 版本、`app.asar`、`Codex.exe` 和 `%USERPROFILE%\.codex\config.toml` 的哈希或备份。
- 脚本只处理本机文件，不上传 Codex 文件、用户配置或工作内容，也不会下载依赖。

## 一键安装

1. 完整解压发行 ZIP。
2. 双击 `install-windows.bat`。
3. 在菜单中选择“安装汉化”，按提示允许 Windows UAC。
4. 安装完成后按安装类型启动：

   - 常规安装：补丁原位应用到当前 Codex，照常从开始菜单或原有快捷方式启动。
   - Microsoft Store 安装：官方 WindowsApps 包保持不变，脚本在 `%USERPROFILE%\.codex\zh-cn-patched\` 建立可写副本；请使用解压目录中生成的 `Codex 汉化版.bat` 启动。

安装会先暂存并验证 `app.asar` 与 `Codex.exe`，验证全部通过后才成对激活。首次成功安装时保存原始核心文件、locale 配置和被修改的内置插件 metadata，后续重复运行不会覆盖第一份完整备份。

## 启动、检查与恢复

发行包提供四个根目录入口：

- `install-windows.bat`：打开安装、验证、恢复和路径设置菜单。
- `status-windows.bat`：只读检查门控、ASAR/EXE 完整性、locale、插件、托管状态和 Store 副本新旧状态。
- `restore-windows.bat`：从托管备份恢复英文原版文件和配置。
- `uninstall-codex.bat`：兼容上游名称的恢复入口，行为与 `restore-windows.bat` 相同。

Microsoft Store 模式安装后，还会在解压目录生成 `Codex 汉化版.bat`、`launch-codex-zh-cn.bat` 和 `launch-codex-zh-cn.ps1`。这些入口会验证托管状态、路径边界和 Store 源版本，发现副本过期时拒绝启动并提示重新安装。

恢复时应先关闭 Codex，再运行 `restore-windows.bat`。常规安装会恢复原始 `app.asar` 和 `Codex.exe`；Store 模式会恢复配置和插件后移除托管副本状态。恢复完成后，官方 Codex 应能按原方式启动。

## Codex 更新后重新修补

Codex 更新可能替换 ASAR、EXE 或 Microsoft Store 包身份，因此补丁不会被视为永久安装：

1. 更新前如条件允许，先运行 `restore-windows.bat`。
2. 完成官方 Codex 更新并正常启动一次。
3. 运行 `status-windows.bat`。Store 副本显示 `stale`，或总体状态不是“汉化已生效”，都表示需要重新修补。
4. 重新运行 `install-windows.bat`。脚本会针对当前官方版本重新复制、匹配、验证和建立备份。
5. Store 用户继续使用新生成的 `Codex 汉化版.bat`。

如果新版本的结构无法被唯一识别，安装会失败关闭并保留当前可用文件。不要手工跳过门控、完整性或版本检查；请保留错误输出并等待项目更新。

## 安全与签名限制

补丁需要修改 `app.asar`，并同步 `Codex.exe` 内嵌的 ASAR 哈希。任何对可执行文件的修改都会使 OpenAI 原始 Authenticode 签名失效，即使修改内容只是完整性字段。

因此 Windows SmartScreen 可能显示未知发布者，企业 WDAC、AppLocker、杀毒软件或终端管理策略也可能阻止运行。Microsoft Store 模式不会改写受保护的官方包，但可写副本中的 `Codex.exe` 同样不再具有原始有效签名。本项目不绕过这些安全策略；受管电脑应先由管理员审核源码、哈希和适用策略。

## 运行环境与校验值

- 目标平台：Windows 10/11 x64（AMD64）。
- 内置运行时：Node.js v24.19.0 Windows x64。
- 官方归档：`node-v24.19.0-win-x64.zip`。
- SHA-256：`57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`。
- 官方校验清单：`runtime/SHASUMS256.txt`。
- 运行时许可：`runtime/NODE-LICENSE.txt`。

每次入口脚本运行前都会校验内置 ZIP、解压后的 `node.exe` 和版本。校验失败时不会退回系统 Node.js，也不会联网下载替代品。

## 开源许可与来源

- 上游项目：`xqnode/codex-zh-CN` v0.1.2，固定提交 `0e39c30a381c712c16e49c8e72c8eca40c3b2299`。详情见 [UPSTREAM.md](UPSTREAM.md)，上游 MIT 许可保存在 `UPSTREAM-LICENSE`。
- 本项目许可见 `LICENSE`。
- Node.js 来源、校验值和第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目是独立、非官方项目，与 OpenAI、Node.js 或 xqnode 不存在隶属、背书或赞助关系。Codex、OpenAI 及相关名称和商标归其权利人所有。
