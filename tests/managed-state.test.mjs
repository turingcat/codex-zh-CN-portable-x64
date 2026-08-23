import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  compareSourceIdentity,
  readManagedState,
  validateManagedState,
  writeManagedState,
} from "../scripts/lib/managed-state.mjs";

function createState(overrides = {}) {
  return {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app",
    sourceIdentity: "OpenAI.Codex_1",
    patchedApp: "C:\\Users\\u\\.codex\\zh-cn-patched\\abc\\app",
    backupRoot: "C:\\Users\\u\\.codex\\zh-cn-install-backups\\abc\\latest",
    localeStatePath:
      "C:\\Users\\u\\.codex\\zh-cn-install-backups\\abc\\latest\\locale-state.json",
    ...overrides,
  };
}

test("round-trips exactly the managed state schema with an atomic sibling file", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, "zh-cn-patched-active.json");
  const state = createState();

  assert.deepEqual(writeManagedState(statePath, state), state);
  assert.deepEqual(readManagedState(statePath), state);
  assert.equal(fs.existsSync(`${statePath}.new`), false);
});

test("requires the exact version-one keys and supported modes", () => {
  assert.deepEqual(validateManagedState(createState()), createState());
  assert.throws(() => validateManagedState({ ...createState(), unexpected: true }), /无效的托管状态/);
  assert.throws(() => validateManagedState({ ...createState(), mode: "portable-copy" }), /无效的托管状态/);
  assert.throws(() => validateManagedState({ ...createState(), patchVersion: "" }), /无效的托管状态/);
});

test("fails closed for malformed paths and unreadable state", (t) => {
  assert.throws(() => validateManagedState(createState({ patchedApp: "..\\outside" })), /无效的托管状态/);
  assert.throws(() => validateManagedState(createState({ localeStatePath: "C:\\elsewhere\\locale-state.json" })), /无效的托管状态/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-state-invalid-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, "zh-cn-patched-active.json");
  fs.writeFileSync(statePath, "{not json", "utf8");
  assert.throws(() => readManagedState(statePath), /无效的托管状态/);
});

test("marks a Store copy stale when its WindowsApps identity changes or disappears", () => {
  const state = createState();
  assert.deepEqual(compareSourceIdentity(state, "OpenAI.Codex_1"), {
    current: true,
    stale: false,
  });
  assert.deepEqual(compareSourceIdentity(state, "OpenAI.Codex_2"), {
    current: false,
    stale: true,
  });
  assert.deepEqual(compareSourceIdentity(state, null), {
    current: false,
    stale: true,
  });
});

test("restore leaves files untouched when managed state is missing or invalid", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-restore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const sentinel = path.join(root, "do-not-touch.txt");
  fs.writeFileSync(sentinel, "keep", "utf8");

  const runRestore = () =>
    spawnSync(process.execPath, ["scripts/patch-codex-zh-cn.mjs", "uninstall"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
  const missing = runRestore();
  assert.equal(missing.status, 0);
  assert.match(missing.stdout, /未找到托管状态/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");

  const statePath = path.join(home, ".codex", "zh-cn-patched-active.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{"version":1,"extra":true}\n', "utf8");
  const invalid = runRestore();
  assert.equal(invalid.status, 0);
  assert.match(invalid.stdout, /托管状态无效/);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
  assert.equal(fs.existsSync(statePath), true);
});

test("status marks Store state stale when its current WindowsApps package changed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const sourceApp = path.join(root, "WindowsApps", "OpenAI.Codex_current", "app");
  const resources = path.join(sourceApp, "resources");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), "not-localized", "utf8");
  const backupRoot = path.join(home, ".codex", "zh-cn-install-backups", "fixture", "latest");
  const statePath = path.join(home, ".codex", "zh-cn-patched-active.json");
  writeManagedState(statePath, {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: path.join(root, "WindowsApps", "OpenAI.Codex_previous", "app"),
    sourceIdentity: "OpenAI.Codex_previous",
    patchedApp: path.join(home, ".codex", "zh-cn-patched", "fixture", "app"),
    backupRoot,
    localeStatePath: path.join(backupRoot, "locale-state.json"),
  });

  const result = spawnSync(
    process.execPath,
    ["scripts/patch-codex-zh-cn.mjs", "status", "--codex-path", sourceApp, "--json"],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, HOME: home } },
  );
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 2);
  assert.equal(report.managedState, true);
  assert.equal(report.sourceIdentity, "OpenAI.Codex_previous");
  assert.equal(report.sourceCurrent, "OpenAI.Codex_current");
  assert.equal(report.stale, true);
});

test("status marks Store state stale when no current package can be located", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-status-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const backupRoot = path.join(home, ".codex", "zh-cn-install-backups", "fixture", "latest");
  writeManagedState(path.join(home, ".codex", "zh-cn-patched-active.json"), {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: path.join(root, "WindowsApps", "OpenAI.Codex_previous", "app"),
    sourceIdentity: "OpenAI.Codex_previous",
    patchedApp: path.join(home, ".codex", "zh-cn-patched", "fixture", "app"),
    backupRoot,
    localeStatePath: path.join(backupRoot, "locale-state.json"),
  });
  const result = spawnSync(process.execPath, ["scripts/patch-codex-zh-cn.mjs", "status", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, HOME: home, CODEX_DESKTOP_PATH: path.join(root, "missing") },
  });
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 2);
  assert.equal(report.sourceCurrent, null);
  assert.equal(report.stale, true);
});
