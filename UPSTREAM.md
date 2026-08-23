# Upstream provenance

## xqnode/codex-zh-CN

- Repository: https://github.com/xqnode/codex-zh-CN
- Release: v0.1.2
- Commit: `0e39c30a381c712c16e49c8e72c8eca40c3b2299`
- License: MIT; the imported license is retained as `UPSTREAM-LICENSE`.

### Imported paths

The audited import includes `.gitignore`, `LICENSE`, `install-windows.bat`,
`uninstall-codex.bat`, `launchers/`, `resources/`, and these upstream scripts:
`install_windows.ps1`, `package-release.ps1`, `patch-codex-zh-cn.mjs`,
`uninstall-codex-store.ps1`, and `verify-patch.mjs`.

### Local modifications

This project adds the pinned offline Node.js runtime contract and bootstrap,
runtime/archive verification, release provenance validation, safe renderer i18n
gate handling, transactional patch/state handling, and Windows status/restore
hardening. The imported scripts have only been changed where necessary to use
that local verified runtime and those safety checks.
