# Codex zh-CN Portable x64 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and package an offline Windows 10/11 x64 Codex Desktop Chinese localization utility that vendors Node.js v24.19.0, retains the `xqnode/codex-zh-CN` behavior, and safely enables the bundled renderer translations.

**Architecture:** Import upstream release v0.1.2 at commit `0e39c30a381c712c16e49c8e72c8eca40c3b2299`, keep its PowerShell installer and Node ASAR patch engine, and add small testable modules for i18n-gate matching, exact locale backup, and transactional core-file activation. Root batch files call a PowerShell bootstrap that verifies and expands the bundled official Node.js archive before invoking the patch engine with an absolute `node.exe` path.

**Tech Stack:** Windows batch, Windows PowerShell 5.1, Node.js v24.19.0 built-in modules, Node's `node:test`, Electron ASAR binary format, GitHub Actions `windows-latest`.

## Global Constraints

- Target Windows 10/11 x64 only; reject ARM64 and x86.
- Require an existing Microsoft Store or conventional/portable Codex Desktop installation.
- Bundle `node-v24.19.0-win-x64.zip`; expected SHA-256 is `57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`.
- Do not require Python, npm, npx, a system Node.js, or runtime network access.
- Never write to `C:\Program Files\WindowsApps`; patch a versioned user-owned copy for Store installs.
- Preserve a byte-for-byte backup before activating changes to a conventional/portable install.
- Never globally replace `false` or `!1`; patch only recognized `enable_i18n` gate-call fallbacks.
- Fail before activation when the i18n gate is absent, ambiguous, structurally unsupported, or fails post-verification.
- Preserve and restore the exact pre-patch locale configuration bytes.
- Disclose that modifying `Codex.exe` invalidates its original Authenticode signature and may be blocked by SmartScreen, WDAC, AppLocker, or enterprise policy.
- Preserve the upstream MIT license and include Node.js licensing and provenance.
- Do not add login bypasses, subscription bypasses, model-provider changes, telemetry, or automatic background patching.

## File map

- `scripts/patch-codex-zh-cn.mjs`: upstream patch CLI; coordinates target detection, ASAR changes, gate patching, status, staging, activation, and restore.
- `scripts/lib/patch-i18n-gate.mjs`: pure classification and rewrite logic for renderer gate expressions and multi-file patch plans.
- `scripts/lib/locale-config.mjs`: exact locale-state capture, `zh-CN` update, persisted state, and restoration.
- `scripts/lib/core-file-transaction.mjs`: stage, validate, activate, and roll back `app.asar` plus the Codex executable.
- `scripts/lib/managed-state.mjs`: validates managed state, persists it atomically, and compares recorded/current Store package identities.
- `scripts/bootstrap_windows.ps1`: verifies and expands the bundled runtime, rejects unsupported architecture, and invokes installer actions.
- `scripts/install_windows.ps1`: user menu and UAC orchestration; invokes the exact bundled Node executable.
- `scripts/verify-patch.mjs`: release-facing semantic verifier for ASAR, menus, gate state, integrity, locale, plug-ins, markers, and launch target.
- `runtime/runtime.json`: immutable runtime manifest used by bootstrap and release validation.
- `tests/helpers/asar-fixture.mjs`: deterministic synthetic ASAR builder for integration tests.
- `tests/*.test.mjs`: platform-neutral Node tests.
- `tests/windows-smoke.ps1`: Windows-only end-to-end fixture smoke test.
- `scripts/validate-release.mjs`: verifies runtime, licenses, entry points, and release layout.
- `scripts/package-release.ps1`: creates the versioned release ZIP after validation.

---

### Task 1: Import the audited upstream baseline and establish the test runner

**Files:**

- Create: `.gitignore`
- Create: `package.json`
- Create: `UPSTREAM_COMMIT`
- Create: `UPSTREAM-LICENSE`
- Create: `LICENSE`
- Create: `install-windows.bat`
- Create: `uninstall-codex.bat`
- Create: `launchers/Codex 汉化版.bat`
- Create: `launchers/launch-codex-zh-cn.bat`
- Create: `launchers/launch-codex-zh-cn.ps1`
- Create: `resources/bundled-plugins-zh-CN.json`
- Create: `resources/menu-hardcoded-zh-CN.json`
- Create: `resources/native-menu-zh-CN.json`
- Create: `resources/release.json`
- Create: `scripts/install_windows.ps1`
- Create: `scripts/package-release.ps1`
- Create: `scripts/patch-codex-zh-cn.mjs`
- Create: `scripts/uninstall-codex-store.ps1`
- Create: `scripts/verify-patch.mjs`
- Test: `tests/upstream-layout.test.mjs`

**Interfaces:**

- Consumes: local upstream checkout `/private/tmp/codex-zh-CN-upstream` at exact commit `0e39c30a381c712c16e49c8e72c8eca40c3b2299`.
- Produces: an unchanged runnable upstream baseline plus `npm test`/`node --test` commands for all later tasks.

- [ ] **Step 1: Write the failing baseline-layout test and test script**

```js
// tests/upstream-layout.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const required = [
  "UPSTREAM_COMMIT",
  "UPSTREAM-LICENSE",
  "install-windows.bat",
  "launchers/launch-codex-zh-cn.ps1",
  "resources/native-menu-zh-CN.json",
  "resources/menu-hardcoded-zh-CN.json",
  "resources/bundled-plugins-zh-CN.json",
  "scripts/install_windows.ps1",
  "scripts/patch-codex-zh-cn.mjs",
  "scripts/verify-patch.mjs",
];

test("vendors the audited upstream release", () => {
  for (const file of required) assert.equal(fs.existsSync(file), true, file);
  assert.equal(
    fs.readFileSync("UPSTREAM_COMMIT", "utf8").trim(),
    "0e39c30a381c712c16e49c8e72c8eca40c3b2299",
  );
});
```

```json
{
  "name": "codex-zh-cn-portable-x64",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "check": "node --check scripts/patch-codex-zh-cn.mjs && node --check scripts/verify-patch.mjs"
  }
}
```

- [ ] **Step 2: Run the test and verify it fails because the upstream files are absent**

Run: `node --test tests/upstream-layout.test.mjs`

Expected: FAIL on `UPSTREAM_COMMIT` or the first missing upstream file.

- [ ] **Step 3: Verify the source checkout and copy only the audited baseline files**

```bash
test "$(git -C /private/tmp/codex-zh-CN-upstream rev-parse HEAD)" = "0e39c30a381c712c16e49c8e72c8eca40c3b2299"
cp /private/tmp/codex-zh-CN-upstream/.gitignore .
cp /private/tmp/codex-zh-CN-upstream/LICENSE LICENSE
cp /private/tmp/codex-zh-CN-upstream/LICENSE UPSTREAM-LICENSE
cp /private/tmp/codex-zh-CN-upstream/install-windows.bat .
cp /private/tmp/codex-zh-CN-upstream/uninstall-codex.bat .
cp -R /private/tmp/codex-zh-CN-upstream/launchers .
cp -R /private/tmp/codex-zh-CN-upstream/resources .
mkdir -p scripts
cp /private/tmp/codex-zh-CN-upstream/scripts/install_windows.ps1 scripts/
cp /private/tmp/codex-zh-CN-upstream/scripts/package-release.ps1 scripts/
cp /private/tmp/codex-zh-CN-upstream/scripts/patch-codex-zh-cn.mjs scripts/
cp /private/tmp/codex-zh-CN-upstream/scripts/uninstall-codex-store.ps1 scripts/
cp /private/tmp/codex-zh-CN-upstream/scripts/verify-patch.mjs scripts/
```

Create `UPSTREAM_COMMIT` with the exact commit hash and use `apply_patch` for `package.json` and the test file.

- [ ] **Step 4: Run baseline tests and syntax checks**

Run: `npm test && npm run check`

Expected: all tests PASS; both upstream `.mjs` entry points parse successfully.

- [ ] **Step 5: Commit the baseline**

```bash
git add .gitignore package.json UPSTREAM_COMMIT UPSTREAM-LICENSE LICENSE install-windows.bat uninstall-codex.bat launchers resources scripts tests/upstream-layout.test.mjs
git commit -m "chore: import codex zh-CN upstream baseline"
```

---

### Task 2: Implement the safe pure i18n-gate matcher

**Files:**

- Create: `scripts/lib/patch-i18n-gate.mjs`
- Test: `tests/patch-i18n-gate.test.mjs`

**Interfaces:**

- Consumes: a UTF-8 `Buffer` or a list of `{ path: string, buffer: Buffer }` JavaScript entries.
- Produces: `patchI18nGateBuffer(buffer)` and `planI18nGatePatches(entries)`, each returning a structured status of `patched`, `already-enabled`, `missing`, or `ambiguous`; ambiguous plans return the original buffers.

- [ ] **Step 1: Write failing tests for recognized false and already-true forms**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  patchI18nGateBuffer,
  planI18nGatePatches,
} from "../scripts/lib/patch-i18n-gate.mjs";

test("changes only a recognized minified false fallback", () => {
  const input = Buffer.from('const enabled=n?.get(`enable_i18n`,!1);const other=!1;');
  const result = patchI18nGateBuffer(input);
  assert.equal(result.status, "patched");
  assert.equal(result.changedCount, 1);
  assert.match(result.buffer.toString(), /enable_i18n`,!0/);
  assert.match(result.buffer.toString(), /other=!1/);
});

test("accepts a recognized true fallback without rewriting", () => {
  const input = Buffer.from('flags.get("enable_i18n", true)');
  const result = patchI18nGateBuffer(input);
  assert.equal(result.status, "already-enabled");
  assert.equal(result.changedCount, 0);
  assert.equal(result.buffer.equals(input), true);
});
```

- [ ] **Step 2: Run the tests and verify the module-not-found failure**

Run: `node --test tests/patch-i18n-gate.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/patch-i18n-gate.mjs`.

- [ ] **Step 3: Implement recognized gate-call matching**

Use a gate-call expression limited to `.get(...)` or `get(...)`, exact quoted/backtick key `enable_i18n`, and the fallback tokens `false`, `true`, `!1`, or `!0`. Count every raw key occurrence separately; an occurrence not covered by a recognized match is ambiguous.

```js
const KEY_RE = /(["'`])enable_i18n\1/g;
const CALL_RE = /(?:[\w$?]+\.)?get\(\s*(["'`])enable_i18n\1\s*,\s*(false|true|!1|!0)\s*\)/g;

export function patchI18nGateBuffer(buffer) {
  const source = buffer.toString("utf8");
  const keyCount = [...source.matchAll(KEY_RE)].length;
  const matches = [...source.matchAll(CALL_RE)];
  if (keyCount === 0) return result("missing", buffer, 0, 0, 0);
  if (matches.length !== keyCount) return result("ambiguous", buffer, 0, 0, keyCount - matches.length);
  const falseCount = matches.filter((m) => m[2] === "false" || m[2] === "!1").length;
  if (falseCount === 0) return result("already-enabled", buffer, 0, matches.length, 0);
  const patched = source.replace(CALL_RE, (full, quote, fallback) => {
    const enabled = fallback === "false" ? "true" : fallback === "!1" ? "!0" : fallback;
    return full.replace(fallback, enabled);
  });
  return result("patched", Buffer.from(patched, "utf8"), falseCount, matches.length, 0);
}
```

The `result` helper must expose `{ status, buffer, changedCount, recognizedCount, ambiguousCount }` with stable field names.

- [ ] **Step 4: Add failing tests for absent, ambiguous, mixed, and multi-file behavior**

```js
test("reports missing when the key is absent", () => {
  assert.equal(patchI18nGateBuffer(Buffer.from("const x=false")).status, "missing");
});

test("reports ambiguous and keeps bytes when fallback is dynamic", () => {
  const input = Buffer.from('flags.get("enable_i18n", defaults.i18n)');
  const result = patchI18nGateBuffer(input);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.buffer.equals(input), true);
});

test("refuses every file when one file is ambiguous", () => {
  const entries = [
    { path: "webview/a.js", buffer: Buffer.from('f.get("enable_i18n",false)') },
    { path: "webview/b.js", buffer: Buffer.from('f.get("enable_i18n",value)') },
  ];
  const plan = planI18nGatePatches(entries);
  assert.equal(plan.status, "ambiguous");
  assert.deepEqual(plan.replacements, []);
});

test("patches every recognized false fallback across files", () => {
  const entries = [
    { path: "webview/a.js", buffer: Buffer.from('f.get("enable_i18n",false)') },
    { path: "webview/b.js", buffer: Buffer.from('f.get(`enable_i18n`,!1)') },
  ];
  const plan = planI18nGatePatches(entries);
  assert.equal(plan.status, "patched");
  assert.equal(plan.changedCount, 2);
  assert.equal(plan.replacements.length, 2);
});
```

- [ ] **Step 5: Implement the multi-file plan and verify all gate tests pass**

`planI18nGatePatches(entries)` must ignore JavaScript entries without the key, aggregate every entry containing it, fail the whole plan when any entry is ambiguous, return `missing` when none contain the key, and otherwise return replacement objects `{ path, buffer }` only for changed entries.

```js
export function planI18nGatePatches(entries) {
  const files = entries
    .filter(({ buffer }) => buffer.includes("enable_i18n"))
    .map(({ path, buffer }) => ({ path, ...patchI18nGateBuffer(buffer) }));
  if (files.length === 0) return planResult("missing", files, []);
  if (files.some(({ status }) => status === "ambiguous")) {
    return planResult("ambiguous", files, []);
  }
  const replacements = files
    .filter(({ status }) => status === "patched")
    .map(({ path, buffer }) => ({ path, buffer }));
  return planResult(replacements.length ? "patched" : "already-enabled", files, replacements);
}
```

Run: `node --test tests/patch-i18n-gate.test.mjs`

Expected: all gate tests PASS.

- [ ] **Step 6: Commit the matcher**

```bash
git add scripts/lib/patch-i18n-gate.mjs tests/patch-i18n-gate.test.mjs
git commit -m "feat: safely enable Codex renderer i18n"
```

---

### Task 3: Integrate gate planning into ASAR install, status, and verification

**Files:**

- Modify: `scripts/patch-codex-zh-cn.mjs:8-19, 1509-1627, 1658-1841`
- Modify: `scripts/verify-patch.mjs`
- Test: `tests/i18n-gate-integration.test.mjs`

**Interfaces:**

- Consumes: `planI18nGatePatches(entries)` from Task 2 and the upstream ASAR functions `readAsarHeader`, `walkAsarFiles`, `getAsarFileEntry`, and `replaceAsarFileContent`.
- Produces: `inspectI18nGateInAsar(asarPath)`, `patchI18nGateInAsar(asarPath)`, and status fields `i18nGateStatus`, `i18nGateChanged`, `i18nGateRecognized`, `i18nGateAmbiguous`, and `i18nGateFiles`.

- [ ] **Step 1: Write a failing multi-entry integration test**

The test should feed `planI18nGatePatches` entries named like real ASAR paths and assert the exact report consumed by the patch CLI:

```js
test("builds a fail-closed ASAR gate report", () => {
  const entries = [
    { path: "webview/assets/index-a.js", buffer: Buffer.from('s.get("enable_i18n",false)') },
    { path: ".vite/build/main-a.js", buffer: Buffer.from('const unrelated="enable_i18n"') },
  ];
  const plan = planI18nGatePatches(entries);
  assert.equal(plan.status, "ambiguous");
  assert.equal(plan.files.length, 2);
  assert.deepEqual(plan.replacements, []);
});
```

- [ ] **Step 2: Run the test and verify it fails because `files` reporting is absent**

Run: `node --test tests/i18n-gate-integration.test.mjs`

Expected: FAIL because the Task 2 plan does not yet expose the required `files` report.

- [ ] **Step 3: Add stable per-file reporting to the pure planner**

Each file report must be `{ path, status, changedCount, recognizedCount, ambiguousCount }`. Re-run the test and expect PASS.

```js
const report = ({ path, status, changedCount, recognizedCount, ambiguousCount }) => ({
  path,
  status,
  changedCount,
  recognizedCount,
  ambiguousCount,
});
```

- [ ] **Step 4: Add ASAR inspection and patch orchestration to the upstream CLI**

Import the planner and add an ASAR adapter that:

1. reads `app.asar` once;
2. collects only packed `.js` entries containing `enable_i18n`;
3. calls `planI18nGatePatches` before writing anything;
4. throws for `missing` or `ambiguous`;
5. applies every planned replacement with the existing ASAR replacement function;
6. re-inspects the completed ASAR and requires `already-enabled`.

Call it during install after upstream resource/menu patches and before executable hash synchronization. Add its report to JSON and human-readable status output.

```js
function patchI18nGateInAsar(asarPath) {
  const entries = collectI18nGateEntries(asarPath);
  const plan = planI18nGatePatches(entries);
  if (plan.status === "missing" || plan.status === "ambiguous") {
    throw new Error(`Unsupported enable_i18n gate state: ${plan.status}`);
  }
  for (const replacement of plan.replacements) {
    replaceAsarFileContent(asarPath, replacement.path, replacement.buffer);
  }
  const verified = inspectI18nGateInAsar(asarPath);
  if (verified.status !== "already-enabled") throw new Error("enable_i18n post-verification failed");
  return { ...verified, changedCount: plan.changedCount };
}
```

- [ ] **Step 5: Extend the verifier with gate postconditions**

`verify-patch.mjs <asar-path>` must exit nonzero for `missing`, `ambiguous`, or `patched` states and print `[OK] enable_i18n fallback: enabled` only for `already-enabled`.

```js
const gate = inspectI18nGateInAsar(asarPath);
if (gate.status !== "already-enabled") {
  console.error(`[X] enable_i18n fallback: ${gate.status}`);
  process.exit(1);
}
console.log("[OK] enable_i18n fallback: enabled");
```

- [ ] **Step 6: Run all Node tests and entry-point syntax checks**

Run: `npm test && npm run check`

Expected: all tests PASS and both CLI entry points parse.

- [ ] **Step 7: Commit the integration**

```bash
git add scripts/patch-codex-zh-cn.mjs scripts/verify-patch.mjs scripts/lib/patch-i18n-gate.mjs tests/i18n-gate-integration.test.mjs
git commit -m "feat: integrate i18n gate into ASAR patch flow"
```

---

### Task 4: Preserve and restore exact locale configuration

**Files:**

- Create: `scripts/lib/locale-config.mjs`
- Modify: `scripts/patch-codex-zh-cn.mjs:974-1006, 1509-1656, 1707-1841`
- Test: `tests/locale-config.test.mjs`

**Interfaces:**

- Consumes: `%USERPROFILE%\.codex\config.toml` path and a project-managed state-file path.
- Produces: `captureLocaleState(configPath)`, `saveLocaleState(statePath, state)`, `applyZhCnLocale(configPath)`, and `restoreLocaleState(configPath, statePath)`.

- [ ] **Step 1: Write failing tests for exact existing-file and absent-file restoration**

```js
test("restores exact bytes after applying zh-CN", () => {
  const original = Buffer.from('\ufeff[model]\r\nname="x"\r\n[desktop]\r\nlocaleOverride="fr-FR"\r\n');
  fs.writeFileSync(configPath, original);
  saveLocaleState(statePath, captureLocaleState(configPath));
  applyZhCnLocale(configPath);
  assert.match(fs.readFileSync(configPath, "utf8"), /localeOverride = "zh-CN"/);
  restoreLocaleState(configPath, statePath);
  assert.equal(fs.readFileSync(configPath).equals(original), true);
});

test("removes a patch-created config when none existed before", () => {
  saveLocaleState(statePath, captureLocaleState(configPath));
  applyZhCnLocale(configPath);
  assert.equal(fs.existsSync(configPath), true);
  restoreLocaleState(configPath, statePath);
  assert.equal(fs.existsSync(configPath), false);
});
```

- [ ] **Step 2: Run the tests and verify the module-not-found failure**

Run: `node --test tests/locale-config.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement state capture, one-time persistence, locale update, and restore**

Persist JSON as `{ version: 1, existed: boolean, contentBase64: string }`. `saveLocaleState` must validate and retain an existing version-1 state; when absent, it uses exclusive creation so a later install cannot overwrite the first pre-patch state. `restoreLocaleState` must validate `version === 1`, restore decoded bytes when `existed` is true, and remove only the managed config file when false.

```js
export function captureLocaleState(configPath) {
  const existed = fs.existsSync(configPath);
  return { version: 1, existed, contentBase64: existed ? fs.readFileSync(configPath).toString("base64") : "" };
}

export function saveLocaleState(statePath, state) {
  if (fs.existsSync(statePath)) return validateLocaleState(JSON.parse(fs.readFileSync(statePath, "utf8")));
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(validateLocaleState(state), null, 2)}\n`, { flag: "wx" });
}
```

- [ ] **Step 4: Replace upstream `setCodexLocale`/English reset behavior**

Before the first locale write, save state under the same managed backup root as the ASAR/executable backup. During restore, call `restoreLocaleState`; do not replace `zh-CN` with `en-US`. Report `localeBackup` and `localeRestorable` in status output.

```js
const localeStatePath = path.join(backupRoot, "locale-state.json");
saveLocaleState(localeStatePath, captureLocaleState(configPath));
applyZhCnLocale(configPath);
// restore path
restoreLocaleState(configPath, localeStatePath);
```

- [ ] **Step 5: Run locale tests and the full suite**

Run: `node --test tests/locale-config.test.mjs && npm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit exact locale rollback**

```bash
git add scripts/lib/locale-config.mjs scripts/patch-codex-zh-cn.mjs tests/locale-config.test.mjs
git commit -m "fix: restore exact pre-patch locale config"
```

---

### Task 5: Stage and atomically activate core files

**Files:**

- Create: `scripts/lib/core-file-transaction.mjs`
- Modify: `scripts/patch-codex-zh-cn.mjs:1008-1052, 1230-1317, 1509-1656`
- Test: `tests/core-file-transaction.test.mjs`

**Interfaces:**

- Consumes: `{ asarPath, exePath, stageRoot, backupRoot }` and a callback that patches staged paths.
- Produces: `prepareStagedCore(options)`, `activateStagedCore(transaction)`, and `rollbackActivatedCore(transaction)`; originals remain unchanged until validation completes.

- [ ] **Step 1: Write failing tests for pre-activation isolation and missing-stage rejection**

```js
test("patches staged copies without changing active files", () => {
  const tx = prepareStagedCore({ asarPath, exePath, stageRoot, backupRoot });
  fs.writeFileSync(tx.stagedAsarPath, "patched-asar");
  fs.writeFileSync(tx.stagedExePath, "patched-exe");
  assert.equal(fs.readFileSync(asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(exePath, "utf8"), "original-exe");
});

test("refuses activation when either staged core file is missing", () => {
  const tx = prepareStagedCore({ asarPath, exePath, stageRoot, backupRoot });
  fs.unlinkSync(tx.stagedExePath);
  assert.throws(() => activateStagedCore(tx), /staged executable is missing/);
  assert.equal(fs.readFileSync(asarPath, "utf8"), "original-asar");
});
```

- [ ] **Step 2: Run the tests and verify the module-not-found failure**

Run: `node --test tests/core-file-transaction.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement staged-copy preparation and one-time backups**

Use explicit resolved paths; reject identical active/staging paths. Copy the active pair to staging, and copy originals to backup only when the backup pair does not yet exist. Return a frozen transaction object containing all six paths.

```js
export function prepareStagedCore({ asarPath, exePath, stageRoot, backupRoot }) {
  const stagedAsarPath = path.join(stageRoot, "app.asar");
  const stagedExePath = path.join(stageRoot, path.basename(exePath));
  const backupAsarPath = path.join(backupRoot, "app.asar");
  const backupExePath = path.join(backupRoot, path.basename(exePath));
  assertDistinctPaths([asarPath, exePath, stagedAsarPath, stagedExePath]);
  ensureCompleteOrAbsentBackup(backupAsarPath, backupExePath);
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.copyFileSync(asarPath, stagedAsarPath);
  fs.copyFileSync(exePath, stagedExePath);
  return Object.freeze({ asarPath, exePath, stagedAsarPath, stagedExePath, backupAsarPath, backupExePath });
}
```

- [ ] **Step 4: Implement activation with rollback on replacement failure**

Validate both staged files first. Replace each active file through a same-directory `.zhcn-new` copy, move the active file to `.zhcn-old`, then move `.zhcn-new` into place. If either replacement fails, restore both from the one-time backup and rethrow. Remove only transaction-owned `.zhcn-new`/`.zhcn-old` files after a verified activation or rollback.

```js
export function activateStagedCore(tx) {
  validateStagedPair(tx);
  ensureOneTimeBackups(tx);
  try {
    replaceOne(tx.asarPath, tx.stagedAsarPath);
    replaceOne(tx.exePath, tx.stagedExePath);
  } catch (error) {
    restoreBackupPair(tx);
    throw error;
  } finally {
    cleanupOwnedSwapFiles(tx);
  }
}
```

- [ ] **Step 5: Add a passing activation/rollback test**

```js
test("activates both files and can roll them back", () => {
  const tx = prepareStagedCore({ asarPath, exePath, stageRoot, backupRoot });
  fs.writeFileSync(tx.stagedAsarPath, "patched-asar");
  fs.writeFileSync(tx.stagedExePath, "patched-exe");
  activateStagedCore(tx);
  assert.equal(fs.readFileSync(asarPath, "utf8"), "patched-asar");
  rollbackActivatedCore(tx);
  assert.equal(fs.readFileSync(asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(exePath, "utf8"), "original-exe");
});
```

- [ ] **Step 6: Patch and verify staged core files before activation**

Refactor install so upstream menu/resource patches, i18n-gate patches, ASAR-integrity synchronization, and `verify-patch.mjs` run against staged paths. Activate only after all checks succeed. For Store mode, the copied user-owned app remains the active target; for conventional mode, use `activateStagedCore`.

```js
const tx = prepareStagedCore({ asarPath, exePath, stageRoot, backupRoot });
patchAsarAndMenus(tx.stagedAsarPath);
patchI18nGateInAsar(tx.stagedAsarPath);
syncExeAsarIntegrity(path.dirname(tx.stagedExePath), tx.stagedAsarPath);
verifyStagedCore(tx);
if (mode === "in-place") activateStagedCore(tx);
```

- [ ] **Step 7: Run transaction tests and full regression suite**

Run: `node --test tests/core-file-transaction.test.mjs && npm test && npm run check`

Expected: all tests PASS; syntax checks are clean.

- [ ] **Step 8: Commit transactional activation**

```bash
git add scripts/lib/core-file-transaction.mjs scripts/patch-codex-zh-cn.mjs tests/core-file-transaction.test.mjs
git commit -m "feat: stage and verify Codex core patches"
```

---

### Task 6: Add the bundled-runtime manifest, bootstrap, and x64 entry points

**Files:**

- Create: `runtime/runtime.json`
- Create: `scripts/bootstrap_windows.ps1`
- Create: `status-windows.bat`
- Create: `restore-windows.bat`
- Modify: `install-windows.bat`
- Modify: `uninstall-codex.bat`
- Modify: `scripts/install_windows.ps1:1-86, 87-237, 303-446`
- Test: `tests/runtime-contract.test.mjs`

**Interfaces:**

- Consumes: `runtime/runtime.json`, bundled runtime archive, user action `menu`, `status`, `install`, or `restore`, and test-only action `test` or `test-fixture` when `CODEX_ZH_CN_TEST_FIXTURE=1`.
- Produces: an absolute verified `node.exe` path passed as `-NodePath` to `install_windows.ps1`; no `PATH` lookup.

- [ ] **Step 1: Write the failing runtime-contract test**

```js
test("pins the official x64 Node runtime and local bootstrap contract", () => {
  const manifest = JSON.parse(fs.readFileSync("runtime/runtime.json", "utf8"));
  assert.deepEqual(manifest, {
    version: "v24.19.0",
    architecture: "x64",
    archive: "node-v24.19.0-win-x64.zip",
    extractedDirectory: "node-v24.19.0-win-x64",
    executable: "node.exe",
    sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
  });
  const bootstrap = fs.readFileSync("scripts/bootstrap_windows.ps1", "utf8");
  assert.match(bootstrap, /Get-FileHash/);
  assert.match(bootstrap, /PROCESSOR_ARCHITECTURE/);
  assert.doesNotMatch(bootstrap, /Invoke-WebRequest|Start-BitsTransfer/);
});
```

- [ ] **Step 2: Run the test and verify missing manifest/bootstrap failure**

Run: `node --test tests/runtime-contract.test.mjs`

Expected: FAIL with `ENOENT` for `runtime/runtime.json`.

- [ ] **Step 3: Create the exact runtime manifest and PowerShell bootstrap**

The bootstrap must:

1. resolve project paths from `$PSScriptRoot`;
2. require `$env:PROCESSOR_ARCHITECTURE -eq 'AMD64'`;
3. parse `runtime.json`;
4. calculate SHA-256 with `Get-FileHash` before extraction;
5. expand into `runtime\expanded\` only when the expected `node.exe` is absent;
6. run `& $nodePath --version` and require `v24.19.0`;
7. invoke `install_windows.ps1 -Action $Action -NodePath $nodePath`;
8. preserve `-CodexPath`, `-NoPause`, and UAC arguments exactly.

Test-only actions must immediately reject unless `$env:CODEX_ZH_CN_TEST_FIXTURE -eq '1'`.

```powershell
param(
    [ValidateSet('menu', 'status', 'install', 'restore', 'test', 'test-fixture')]
    [string]$Action = 'menu',
    [string]$CodexPath = '',
    [switch]$NoPause
)
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $manifest.sha256) { throw "Bundled Node.js checksum mismatch" }
Expand-Archive -LiteralPath $archivePath -DestinationPath $expandedRoot -Force
$version = (& $nodePath --version).Trim()
if ($version -ne $manifest.version) { throw "Bundled Node.js version mismatch: $version" }
if ($Action -eq 'test') {
    $tests = Get-ChildItem -LiteralPath "$projectRoot\tests" -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
    & $nodePath --test @tests
    exit $LASTEXITCODE
}
if ($Action -eq 'test-fixture' -and $env:CODEX_ZH_CN_TEST_FIXTURE -ne '1') {
    throw 'test-fixture is disabled outside the smoke harness'
}
```

- [ ] **Step 4: Replace PATH-based Node detection in the installer**

Add mandatory parameter `[string]$NodePath` after elevation. `Test-NodeAvailable` must validate only that path. Every Node invocation must be `& $NodePath @argsList`. Include `-NodePath` when relaunching under UAC.

```powershell
param(
    [ValidateSet('menu', 'status', 'install', 'restore', 'test', 'test-fixture')]
    [string]$Action = 'menu',
    [string]$CodexPath = '',
    [Parameter(Mandatory = $true)][string]$NodePath,
    [switch]$NoPause
)
function Test-NodeAvailable { Test-Path -LiteralPath $NodePath -PathType Leaf }
$output = & $NodePath @argsList 2>&1
```

- [ ] **Step 5: Replace root batch files and add status/restore wrappers**

Each wrapper must use `%~dp0scripts\bootstrap_windows.ps1`, `-ExecutionPolicy Bypass`, and one fixed action. `install-windows.bat` uses action `menu`; `status-windows.bat` uses `status`; `restore-windows.bat` and `uninstall-codex.bat` use `restore`.

```bat
@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap_windows.ps1" -Action status
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
```

- [ ] **Step 6: Run platform-neutral contract tests and syntax checks**

Run: `node --test tests/runtime-contract.test.mjs && npm test && npm run check`

Expected: all Node tests PASS. Record that PowerShell execution still requires the Windows smoke task.

- [ ] **Step 7: Commit the offline bootstrap**

```bash
git add runtime/runtime.json scripts/bootstrap_windows.ps1 scripts/install_windows.ps1 install-windows.bat uninstall-codex.bat status-windows.bat restore-windows.bat tests/runtime-contract.test.mjs
git commit -m "feat: add offline x64 Node bootstrap"
```

---

### Task 7: Complete launch, update detection, status, and managed restore

**Files:**

- Modify: `launchers/launch-codex-zh-cn.ps1`
- Modify: `launchers/launch-codex-zh-cn.bat`
- Modify: `launchers/Codex 汉化版.bat`
- Modify: `scripts/patch-codex-zh-cn.mjs:1044-1507, 1629-1841`
- Modify: `scripts/install_windows.ps1:238-446`
- Modify: `scripts/verify-patch.mjs`
- Create: `scripts/lib/managed-state.mjs`
- Create: `tests/managed-state.test.mjs`

**Interfaces:**

- Consumes: managed state JSON containing source install path, source package identity, patched path, mode, backup root, locale-state path, and patch version.
- Produces: `validateManagedState(value)`, `readManagedState(path)`, `writeManagedState(path, value)`, and `compareSourceIdentity(state, currentIdentity)` from `scripts/lib/managed-state.mjs`; launcher refusal for stale Store packages; complete status fields; restore limited to project-managed files.

- [ ] **Step 1: Write a failing managed-state test**

Import `compareSourceIdentity`, `validateManagedState`, and JSON read/write helpers from `scripts/lib/managed-state.mjs`. Define state version 1 and exact keys:

```js
const state = {
  version: 1,
  patchVersion: "0.1.0",
  mode: "store-copy",
  sourceApp: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app",
  sourceIdentity: "OpenAI.Codex_1",
  patchedApp: "C:\\Users\\u\\.codex\\zh-cn-patched\\abc\\app",
  backupRoot: "C:\\Users\\u\\.codex\\zh-cn-install-backups\\abc\\latest",
  localeStatePath: "C:\\Users\\u\\.codex\\zh-cn-install-backups\\abc\\latest\\locale-state.json",
};
```

Test JSON round-trip, required keys, and that a different current `sourceIdentity` yields `stale: true` from `compareSourceIdentity(state, currentIdentity)`.

- [ ] **Step 2: Run the test and verify missing state helpers fail**

Run: `node --test tests/managed-state.test.mjs`

Expected: FAIL because managed-state functions are absent.

- [ ] **Step 3: Implement the managed-state module and integrate it with the patch engine**

`validateManagedState` requires exactly the version-1 fields shown by the test and rejects unsupported modes. `writeManagedState` writes JSON to a sibling temporary file and renames it into place. Persist `%USERPROFILE%\.codex\zh-cn-patched-active.json` only after successful activation. Status must include `managedState`, `sourceIdentity`, `sourceCurrent`, `stale`, `patchInstalled`, and all gate fields from Task 3.

```js
export function compareSourceIdentity(state, currentIdentity) {
  validateManagedState(state);
  return { stale: state.mode === "store-copy" && state.sourceIdentity !== currentIdentity };
}

export function writeManagedState(statePath, value) {
  const valid = validateManagedState(value);
  const temporary = `${statePath}.new`;
  fs.writeFileSync(temporary, `${JSON.stringify(valid, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, statePath);
}
```

- [ ] **Step 4: Make the launcher reject stale Store copies**

The PowerShell launcher reads the managed state, resolves the current Store package identity with `Get-AppxPackage -Name OpenAI.Codex`, compares it with `sourceIdentity`, and exits with a Chinese instruction to rerun `install-windows.bat` when they differ. It still writes `zh-CN` through the managed locale function before launching a current patched copy.

```powershell
$state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($state.mode -eq 'store-copy') {
    $current = Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | Select-Object -First 1
    $currentIdentity = Split-Path -Leaf $current.InstallLocation
    if ($currentIdentity -ne $state.sourceIdentity) {
        throw 'Codex 已更新，请重新运行 install-windows.bat。'
    }
}
```

- [ ] **Step 5: Make restore operate only on managed state**

Store restore removes generated launchers, active state, and only the `patchedApp` tree recorded in state; the Store source remains untouched. Conventional restore calls `rollbackActivatedCore`, restores exact locale bytes, then removes active state. Missing or invalid managed state returns a non-destructive explanatory result.

```js
if (!fs.existsSync(managedStatePath)) return { restored: false, reason: "not-managed" };
const state = readManagedState(managedStatePath);
if (state.mode === "store-copy") removeManagedPatchedTree(state.patchedApp);
else rollbackActivatedCore(transactionFromState(state));
restoreLocaleState(configPath, state.localeStatePath);
fs.unlinkSync(managedStatePath);
```

- [ ] **Step 6: Extend status and verifier output**

Human and JSON status must cover runtime, target, mode, source identity/currentness, ASAR localization, gate state/counts/files, executable integrity, locale/locale backup, plug-ins, launcher target, and rollback availability. The verifier exits nonzero when any required field is false or stale.

```js
const report = {
  runtime: runtimeReport,
  target: targetReport,
  sourceIdentity: state?.sourceIdentity ?? null,
  sourceCurrent: currentIdentity,
  stale,
  i18nGateStatus: gate.status,
  i18nGateRecognized: gate.recognizedCount,
  i18nGateAmbiguous: gate.ambiguousCount,
  localeRestorable: fs.existsSync(state?.localeStatePath ?? ""),
  rollbackAvailable: hasManagedRollback(state),
};
```

- [ ] **Step 7: Run managed-state tests and full regressions**

Run: `node --test tests/managed-state.test.mjs && npm test && npm run check`

Expected: all tests PASS.

- [ ] **Step 8: Commit managed launch and restore behavior**

```bash
git add launchers scripts/lib/managed-state.mjs scripts/patch-codex-zh-cn.mjs scripts/install_windows.ps1 scripts/verify-patch.mjs tests/managed-state.test.mjs
git commit -m "feat: manage patched launch update and restore state"
```

---

### Task 8: Vendor the official runtime and validate release provenance

**Files:**

- Create: `runtime/node-v24.19.0-win-x64.zip`
- Create: `runtime/SHASUMS256.txt`
- Create: `runtime/NODE-LICENSE.txt`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `UPSTREAM.md`
- Create: `scripts/validate-release.mjs`
- Test: `tests/release-validation.test.mjs`

**Interfaces:**

- Consumes: exact runtime manifest from Task 6 and the official Node.js v24.19.0 release files.
- Produces: `validateRelease(root)` returning `{ ok, errors, runtimeHash }`; CLI exits 0 only for a complete offline release tree.

- [ ] **Step 1: Write the failing release-validation test**

```js
test("rejects a release without bundled runtime and notices", async () => {
  const result = await validateRelease(process.cwd());
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /node-v24\.19\.0-win-x64\.zip/);
  assert.match(result.errors.join("\n"), /THIRD_PARTY_NOTICES\.md/);
});
```

- [ ] **Step 2: Run the test and verify module-not-found failure**

Run: `node --test tests/release-validation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement release validation**

Validate the four root entry points, runtime manifest/archive/hash/license, upstream commit/license, translation resources, core scripts, and README/notices. Compute SHA-256 with `node:crypto`; do not shell out. The CLI prints each error and sets exit code 1, or prints the runtime hash and `[OK] release layout` with exit code 0.

```js
export async function validateRelease(root) {
  const errors = requiredFiles
    .filter((file) => !fs.existsSync(path.join(root, file)))
    .map((file) => `Missing release file: ${file}`);
  const runtimeHash = fs.existsSync(archivePath) ? await sha256File(archivePath) : null;
  if (runtimeHash && runtimeHash !== manifest.sha256) errors.push("Bundled Node.js checksum mismatch");
  return { ok: errors.length === 0, errors, runtimeHash };
}
```

- [ ] **Step 4: Confirm the validator fails for the intended missing artifacts**

Run: `node scripts/validate-release.mjs`

Expected: exit 1 listing the runtime archive and notice files still absent.

- [ ] **Step 5: Download and independently verify official Node.js files**

```bash
curl --noproxy '*' -fL https://nodejs.org/download/release/v24.19.0/node-v24.19.0-win-x64.zip -o runtime/node-v24.19.0-win-x64.zip
curl --noproxy '*' -fL https://nodejs.org/download/release/v24.19.0/SHASUMS256.txt -o runtime/SHASUMS256.txt
curl --noproxy '*' -fL https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE -o runtime/NODE-LICENSE.txt
shasum -a 256 runtime/node-v24.19.0-win-x64.zip
```

Expected hash: `57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`.

- [ ] **Step 6: Add precise attribution and security notices**

`UPSTREAM.md` records repository URL, release v0.1.2, exact commit, imported paths, and local modifications. `THIRD_PARTY_NOTICES.md` records upstream MIT and Node.js licensing, official runtime URL/hash, offline behavior, Authenticode invalidation, and policy-blocking caveat.

```markdown
## xqnode/codex-zh-CN

- Source: https://github.com/xqnode/codex-zh-CN
- Release: v0.1.2
- Commit: 0e39c30a381c712c16e49c8e72c8eca40c3b2299
- License: MIT

## Node.js

- Runtime: node-v24.19.0-win-x64.zip
- SHA-256: 57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73
```

- [ ] **Step 7: Change the release test to require success and run it**

```js
test("validates the complete offline release tree", async () => {
  const result = await validateRelease(process.cwd());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.runtimeHash, "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73");
});
```

Run: `node --test tests/release-validation.test.mjs && node scripts/validate-release.mjs`

Expected: tests PASS and validator prints `[OK] release layout`.

- [ ] **Step 8: Commit the vendored runtime and provenance**

```bash
git add runtime THIRD_PARTY_NOTICES.md UPSTREAM.md scripts/validate-release.mjs tests/release-validation.test.mjs
git commit -m "chore: vendor verified Node x64 runtime"
```

---

### Task 9: Add Windows smoke coverage and Chinese user documentation

**Files:**

- Create: `tests/helpers/asar-fixture.mjs`
- Create: `tests/windows-smoke.ps1`
- Create: `.github/workflows/windows-smoke.yml`
- Create: `README.md`
- Create: `docs/windows-acceptance.md`
- Modify: `scripts/package-release.ps1`
- Modify: `package.json`

**Interfaces:**

- Consumes: bundled runtime/bootstrap, synthetic Codex x64 directory, and all release files.
- Produces: repeatable Windows smoke command, CI workflow, Chinese operating/risk guide, and versioned ZIP packaging command.

- [ ] **Step 1: Write the Windows smoke script before the fixture builder exists**

The script creates a temporary fake Codex directory, invokes a Node fixture builder, runs bootstrap `status` and non-launching `install` against the fixture, verifies gate/status output, runs restore, verifies original fixture hashes, and removes only its temporary directory.

```powershell
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $env:TEMP ("codex-zh-cn-smoke-" + [guid]::NewGuid())
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$root\scripts\bootstrap_windows.ps1" -Action test-fixture -CodexPath $fixture -NoPause
    if ($LASTEXITCODE -ne 0) { throw "fixture smoke failed: $LASTEXITCODE" }
} finally {
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
```

- [ ] **Step 2: Add the fixture builder and smoke-only action**

`tests/helpers/asar-fixture.mjs` builds the smallest valid ASAR containing a main bundle, a `webview/assets/index-fixture.js` gate with false fallback, Chinese-resource destination, and deterministic integrity metadata. The fixture executable contains the same integrity marker shape used by upstream. `test-fixture` is accepted only when `CODEX_ZH_CN_TEST_FIXTURE=1`; it installs with relaunch disabled and then restores.

```js
const files = new Map([
  [".vite/build/main-fixture.js", Buffer.from("const menu={label:`File`}")],
  ["webview/assets/index-fixture.js", Buffer.from('flags.get("enable_i18n",false)')],
  ["webview/assets/zh-CN-fixture.js", Buffer.from('export default {"codex.command.settings":"Codex 设置"}')],
]);
writeAsarFixture(path.join(appDir, "resources", "app.asar"), files);
writeExeIntegrityFixture(path.join(appDir, "Codex.exe"), appAsarHeaderHash);
```

- [ ] **Step 3: Add the Windows GitHub Actions workflow**

```yaml
name: windows-smoke
on:
  push:
  pull_request:
jobs:
  smoke:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Node tests with bundled runtime
        shell: powershell
        run: |
          powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap_windows.ps1 -Action test -NoPause
      - name: Windows fixture smoke
        shell: powershell
        run: .\tests\windows-smoke.ps1
```

- [ ] **Step 4: Write the Chinese README and acceptance checklist**

README sections must cover: decision/capability boundary, x64 support, extract-before-run requirement, four entry points, Store vs conventional behavior, update/reinstall flow, restore, no Python/Node/network dependency, exact runtime provenance, local-only operation, unsupported-version fail-closed behavior, Authenticode/SmartScreen/WDAC/AppLocker warning, licenses, and explicit non-affiliation with OpenAI.

`docs/windows-acceptance.md` must list exact manual steps: record original Codex version/hash/config; install; launch from generated Chinese entry point; confirm representative main UI, File/Edit menus, Settings, and plug-in names; run status; update/repatch check; restore; confirm official Codex still starts and config bytes match.

```markdown
# Codex 简体中文离线补丁（Windows x64）

## 能解决什么
## 使用前须知
## 一键安装
## 启动、检查与恢复
## Codex 更新后重新修补
## 安全与签名限制
## 运行环境与校验值
## 开源许可与来源
```

- [ ] **Step 5: Update packaging and package scripts**

Add `validate` and `package` scripts to `package.json`. `package-release.ps1` must call the bundled Node validator, create `dist\codex-zh-CN-portable-x64-v0.1.0.zip`, exclude `.git`, `dist`, test fixtures, expanded runtime cache, and design/plan documents, then print the ZIP SHA-256.

```powershell
& $NodePath "$Root\scripts\validate-release.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Release validation failed' }
Compress-Archive -Path $stagingChildren -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText("$zipPath.sha256", "$zipHash  $(Split-Path -Leaf $zipPath)`r`n")
```

- [ ] **Step 6: Run local tests and release validation**

Run: `npm test && npm run check && node scripts/validate-release.mjs`

Expected: all platform-neutral tests PASS and release validation exits 0. Do not claim the PowerShell smoke passed unless it was actually run on Windows.

- [ ] **Step 7: Commit CI, docs, and packaging**

```bash
git add tests/helpers/asar-fixture.mjs tests/windows-smoke.ps1 .github/workflows/windows-smoke.yml README.md docs/windows-acceptance.md scripts/package-release.ps1 package.json
git commit -m "docs: add Windows smoke and user release guide"
```

---

### Task 10: Build and verify the offline release artifact

**Files:**

- Create: `dist/codex-zh-CN-portable-x64-v0.1.0.zip`
- Create: `dist/codex-zh-CN-portable-x64-v0.1.0.zip.sha256`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: validated project tree and package script from Task 9.
- Produces: one distributable ZIP and checksum; generated archives remain uncommitted.

- [ ] **Step 1: Add generated runtime cache and release files to `.gitignore`**

```gitignore
runtime/expanded/
dist/*.zip
dist/*.sha256
```

- [ ] **Step 2: Run the full platform-neutral verification suite fresh**

Run: `npm test && npm run check && node scripts/validate-release.mjs`

Expected: zero failing tests, clean syntax checks, and `[OK] release layout`.

- [ ] **Step 3: Build the release ZIP**

On Windows, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-release.ps1
```

When packaging from the current macOS workspace, run the exact equivalent:

```bash
mkdir -p dist
zip -qr dist/codex-zh-CN-portable-x64-v0.1.0.zip . -x '.git/*' 'dist/*' 'tests/*' 'docs/superpowers/*' 'runtime/expanded/*'
shasum -a 256 dist/codex-zh-CN-portable-x64-v0.1.0.zip > dist/codex-zh-CN-portable-x64-v0.1.0.zip.sha256
```

Compare the archive listing against the PowerShell package manifest before accepting it.

Expected: `dist/codex-zh-CN-portable-x64-v0.1.0.zip` and matching `.sha256` file.

- [ ] **Step 4: Inspect the artifact instead of trusting the package command**

Run:

```bash
unzip -l dist/codex-zh-CN-portable-x64-v0.1.0.zip
shasum -a 256 dist/codex-zh-CN-portable-x64-v0.1.0.zip
git status --short
```

Verify the archive contains the four root entry points, bundled Node archive, runtime manifest/checksum/license, core scripts/libraries, translation resources, launchers, README, upstream license, and notices. Verify it excludes `.git`, `dist`, tests, expanded runtime, specs, and plans.

- [ ] **Step 5: Commit only source ignore rules and record verification limits**

```bash
git add .gitignore
git commit -m "chore: finalize offline release packaging"
```

The handoff must report exact local test counts, release ZIP path/hash/size, whether Windows CI actually ran, and whether a real Codex Windows visual acceptance test remains outstanding.
