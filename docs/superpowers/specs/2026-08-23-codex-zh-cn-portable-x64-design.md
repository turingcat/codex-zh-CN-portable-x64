# Codex zh-CN Portable x64 Design

## 1. Objective

Create a new MIT-licensed project, `codex-zh-CN-portable-x64`, based on
[`xqnode/codex-zh-CN`](https://github.com/xqnode/codex-zh-CN), that lets a
Windows 10/11 x64 user localize an already-installed Codex Desktop application
by double-clicking a batch file. The release must work without a preinstalled
Python, Node.js, npm, or a network connection.

The project will preserve the upstream menu, resource, plug-in metadata,
Microsoft Store copy, ASAR editing, and executable-integrity behavior. It will
add the missing `enable_i18n` fallback patch described by the referenced
[WeChat article](https://mp.weixin.qq.com/s/sPwOsCy1FbGlG2aqcKymLw) and observed
in [openai/codex issue #24741](https://github.com/openai/codex/issues/24741) and
[issue #19239](https://github.com/openai/codex/issues/19239).

## 2. Decision and capability boundary

The upstream project is useful but not sufficient for every affected machine.
It writes `desktop.localeOverride = "zh-CN"`, supplies and amends Chinese menu
resources, patches hard-coded menu text, localizes bundled plug-in metadata,
and handles Store installations by copying the application out of the
protected `WindowsApps` directory. It does not search for or change
`enable_i18n`.

Codex builds have been reported with bundled non-English messages while the
renderer still falls back to English because `enable_i18n` defaults to false.
Consequently, the new project must satisfy both conditions:

1. Select `zh-CN` and retain the upstream Chinese resources and text patches.
2. Change only recognized `enable_i18n` false fallbacks to true, then verify the
   resulting bundle before activation.

This is an unofficial compatibility patch, not an official Codex language
pack. It cannot guarantee compatibility with future, structurally different
Codex packages.

## 3. Supported environment

- Windows 10 or Windows 11, x64 only.
- Microsoft Store Codex Desktop or a conventional/portable Codex Desktop
  directory containing `resources\app.asar` and `Codex.exe`/`codex.exe`.
- Windows PowerShell 5.1, which is part of the supported Windows installations.
- Bundled Node.js v24.19.0 win-x64 runtime from the
  [official Node.js release directory](https://nodejs.org/download/release/latest-v24.x/).
- No runtime network access.

The release does not install Codex Desktop and does not bypass Codex login,
subscription, policy, or service availability.

## 4. Distribution layout

```text
codex-zh-CN-portable-x64/
├── install-windows.bat
├── launch-codex-zh-cn.bat
├── status-windows.bat
├── restore-windows.bat
├── runtime/
│   ├── node-v24.19.0-win-x64.zip
│   ├── SHASUMS256.txt
│   └── NODE-LICENSE.txt
├── scripts/
│   ├── bootstrap_windows.ps1
│   ├── install_windows.ps1
│   ├── patch-codex-zh-cn.mjs
│   ├── verify-patch.mjs
│   ├── package-release.ps1
│   └── lib/
│       └── patch-i18n-gate.mjs
├── launchers/
├── resources/
├── tests/
├── docs/
├── LICENSE
├── UPSTREAM-LICENSE
├── THIRD_PARTY_NOTICES.md
└── README.md
```

The Node.js archive remains compressed in source and release artifacts. The
bootstrap expands it into a project-local cache on first use and always invokes
that exact `node.exe`; it does not inspect or modify the user's `PATH`.

## 5. Components and interfaces

### 5.1 Batch entry points

The four root batch files are the only user-facing entry points. Each resolves
its own directory, invokes `bootstrap_windows.ps1` with a fixed action, returns
the PowerShell exit code, and pauses only when launched interactively.

### 5.2 Runtime bootstrap

`bootstrap_windows.ps1` is responsible only for the bundled runtime:

- reject non-Windows and non-x64 environments;
- verify the bundled archive against the pinned official SHA-256 record;
- expand it to `runtime\expanded\node-v24.19.0-win-x64\` when missing;
- verify `node.exe --version` returns `v24.19.0`;
- invoke `install_windows.ps1` using the absolute local `node.exe` path.

The bootstrap never downloads packages and never calls `npm`, `npx`, or a
system-installed Node.js.

### 5.3 Installer orchestration

`install_windows.ps1` retains the upstream environment report and interactive
menu. It receives the local Node executable path from the bootstrap instead of
looking for `node` on `PATH`. It performs UAC elevation only for actions that
need access to a Store installation.

Supported actions are `status`, `install`, and `restore`. Manual Codex path
selection remains available for installations that cannot be detected.

### 5.4 Patch engine

The upstream `patch-codex-zh-cn.mjs` remains the main patch engine. Changes are
limited to:

- accepting the local runtime supplied by the bootstrap;
- integrating the isolated i18n-gate patcher;
- staging modified files before activation;
- preserving and restoring the user's original locale configuration;
- reporting i18n-gate state in status and verification output.

`scripts/lib/patch-i18n-gate.mjs` has one responsibility: inspect JavaScript
bundle bytes and return a patched buffer plus a structured result. It has no
filesystem, process, or Windows dependencies, so its matching rules can be
tested independently.

## 6. Installation data flow

1. Resolve the bundled Node.js runtime and verify its provenance and version.
2. Detect Codex Desktop or validate the user-supplied path.
3. Ask Codex and helper processes to exit, then confirm they are no longer
   holding the package files.
4. For a Store installation, copy the Store `app` directory to a versioned
   location below `%USERPROFILE%\.codex\zh-cn-patched\`. Never write to
   `WindowsApps`.
5. For a conventional/portable installation, create one untouched backup of
   `app.asar`, the executable, and the user's relevant locale configuration
   before staging changes.
6. Apply upstream native-menu, hard-coded menu, Chinese message, webview text,
   and bundled plug-in metadata patches to staged files.
7. Scan JavaScript files inside staged `app.asar` for `enable_i18n` and apply
   the rules in section 7.
8. Recalculate ASAR file integrity metadata and synchronize the ASAR header
   hash embedded in the staged Codex executable.
9. Write `localeOverride = "zh-CN"` while preserving an exact backup of the
   prior configuration bytes.
10. Run structural and semantic verification against the staged target.
11. Activate the staged target only after every required verification passes.
12. Write a source-version marker and launch the patched Codex copy.

## 7. Safe `enable_i18n` matching

The gate patch must not globally replace `false` or `!1` tokens.

For each JavaScript bundle containing the literal `enable_i18n`, the patcher
examines a bounded expression around every occurrence and classifies it as:

- recognized false fallback: `false` or `!1` in a supported gate-call form;
- recognized true fallback: `true` or `!0` in the same form;
- unrecognized/ambiguous context.

Installation behavior is deterministic:

- one or more recognized false fallbacks and no ambiguous occurrences: patch
  every recognized false fallback and verify every one became true;
- recognized true fallbacks and no false or ambiguous occurrences: report
  "already enabled" and continue;
- no `enable_i18n` occurrence: stop as an unsupported Codex build;
- any ambiguous occurrence, mixed unsupported form, or failed postcondition:
  stop before activation and keep the original installation usable.

The verification report records candidate file paths and counts, but does not
print unrelated application source or user data.

## 8. Transaction, rollback, and update behavior

Store installations leave the Microsoft Store package untouched. Restore
removes the generated launcher and active marker, deletes only the project's
versioned patched copy, and restores the exact prior locale configuration.

Conventional/portable installations are restored from the pre-patch backup of
the executable and `app.asar`; the exact prior locale configuration is restored
as well. Existing backups are never overwritten by later installs.

The launcher compares its source-version marker with the currently installed
Store package. If the Store package changed, it refuses to start the stale
copy and directs the user to rerun `install-windows.bat`. It does not silently
patch during ordinary launch.

Temporary staging directories are retained only when verification fails and
their path is printed for diagnosis. They are not activated.

## 9. Verification

An installation is considered valid only when all applicable checks pass:

- bundled Node archive hash and runtime version match the pinned release;
- `app.asar` parses and required resource entries are readable;
- Chinese native-menu resource exists in the staged ASAR;
- hard-coded menu verification finds the expected safe replacements;
- every discovered `enable_i18n` gate is recognized and has a true fallback;
- executable ASAR-integrity marker matches the staged ASAR header hash;
- `localeOverride` resolves to `zh-CN`;
- bundled plug-in metadata matches available translations;
- Store source marker or conventional backup is present;
- launcher resolves the intended patched executable.

Automated coverage includes:

- Node unit tests for false, already-true, absent, ambiguous, and multi-match
  i18n-gate fixtures;
- synthetic ASAR tests for replacement, offsets, integrity metadata, and
  unchanged-file behavior;
- configuration backup/restore tests that preserve exact bytes;
- package validation for runtime version, checksums, licenses, and required
  release files;
- a Windows x64 GitHub Actions smoke test that runs the bundled-runtime
  bootstrap and patch engine against a synthetic Codex fixture.

The current macOS workspace cannot prove visible Windows rendering. Release
acceptance therefore also requires one manual Windows x64 test using an actual
Codex Desktop installation: install, launch, confirm representative main UI
and menus are Chinese, run status, restore, and confirm the official install
still starts.

## 10. Failure handling

- Unsupported bundle structure: fail closed before activation and report the
  Codex path/version plus the unmatched gate count.
- Missing/corrupt runtime: fail before touching Codex and report the expected
  archive/version.
- Codex still running: stop before copying or replacing files.
- Insufficient permissions or disk space: stop before activation and retain the
  original install.
- Integrity or semantic verification failure: do not launch the staged target;
  report the failed check and staging path.
- Restore without a project-created backup/marker: make no deletion and explain
  that no managed patch was found.

## 11. Security, licensing, and limitations

The patch operates locally and does not upload application files or user data.
Its release includes the upstream MIT license and attribution, the Node.js
license, a third-party notice, pinned runtime provenance, and checksum data.

Changing bytes in `Codex.exe` invalidates its original Authenticode signature,
even though the internal Electron ASAR integrity value is synchronized. Windows
SmartScreen, WDAC, AppLocker, or enterprise endpoint policy may therefore block
the patched copy. The project will disclose this limitation and will not try to
bypass those controls.

Other limitations:

- future Codex versions may change bundle structure and be rejected until the
  matcher is updated;
- server-provided or newly introduced strings may remain untranslated;
- Store updates require reinstallation of the patch;
- the first release does not support ARM64 or x86;
- the project does not preserve or claim an official OpenAI signature.

## 12. Success criteria

1. On Windows 10/11 x64 with Codex installed but without Python, Node.js, npm,
   or usable internet, double-clicking `install-windows.bat` completes all
   prerequisite setup from bundled files.
2. A supported Codex package receives both the upstream localization changes
   and a verified `enable_i18n` true fallback.
3. Microsoft Store originals are never modified; conventional originals have
   a restorable byte-for-byte backup before activation.
4. Unsupported or ambiguous Codex packages fail before activation without
   leaving a partially patched active installation.
5. Status reports runtime, target, locale, menu/resource, i18n-gate, plug-in,
   integrity, update, and rollback state.
6. Restore returns managed files and locale configuration to their recorded
   pre-patch state.
7. Automated tests and package validation pass, and the absence or result of a
   real Windows Codex visual acceptance test is stated explicitly at release.
