# Codex 简体中文离线补丁（Windows x64）

This project provides a local Chinese-language patch workflow for an existing
Codex Desktop installation. It is limited to Windows 10/11 x64 and includes a
pinned Node.js runtime, so using the completed release does not require a
preinstalled Node.js, Python, package manager, or network connection.

The source baseline is `xqnode/codex-zh-CN` v0.1.2 at commit
`0e39c30a381c712c16e49c8e72c8eca40c3b2299`; see `UPSTREAM.md`. The bundled
runtime is the official Node.js v24.19.0 Windows x64 archive, pinned to SHA-256
`57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`; see
`THIRD_PARTY_NOTICES.md` and `runtime/SHASUMS256.txt`.

Changing the patched Codex executable invalidates its original Authenticode
signature. SmartScreen, WDAC, AppLocker, and enterprise policy can therefore
block it; this project does not bypass those controls.

This is an independent, unofficial project and is not affiliated with,
endorsed by, or sponsored by OpenAI, Node.js, or xqnode. A full user guide is
intentionally outside this README foundation.
