import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  compareSourceIdentity,
  isExistingManagedPathWithin,
  readManagedState,
  validateManagedState,
  writeManagedState,
} from "../scripts/lib/managed-state.mjs";
import {
  captureLocaleState,
  saveLocaleState,
} from "../scripts/lib/locale-config.mjs";

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

function managedKey(value) {
  return crypto
    .createHash("sha256")
    .update(path.normalize(value).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function createManagedFixture(t, name = "OpenAI.Codex_current") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-layout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const sourceApp = path.join(root, "WindowsApps", name, "app");
  const patchedApp = path.join(
    home,
    ".codex",
    "zh-cn-patched",
    managedKey(sourceApp),
    "app",
  );
  const backupRoot = path.join(
    home,
    ".codex",
    "zh-cn-install-backups",
    managedKey(patchedApp),
    "latest",
  );
  return {
    backupRoot,
    home,
    patchedApp,
    root,
    sourceApp,
    statePath: path.join(home, ".codex", "zh-cn-patched-active.json"),
  };
}

function encodeAsarHeader(header) {
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const payloadSize = 4 + headerBytes.length + ((4 - ((4 + headerBytes.length) % 4)) % 4);
  const pickleSize = 4 + payloadSize;
  const pickle = Buffer.alloc(pickleSize);
  pickle.writeUInt32LE(payloadSize, 0);
  pickle.writeInt32LE(headerBytes.length, 4);
  headerBytes.copy(pickle, 8);
  const encoded = Buffer.alloc(8 + pickleSize);
  encoded.writeUInt32LE(4, 0);
  encoded.writeUInt32LE(pickleSize, 4);
  pickle.copy(encoded, 8);
  return encoded;
}

function writeInstallFixtureAsar(asarPath) {
  const files = [
    { path: "native-menu-locales/zh-CN.json", content: "{}" },
    { path: ".vite/build/main-fixture.js", content: 'a.get("enable_i18n",false);' },
  ];
  const header = { files: {} };
  const body = [];
  let offset = 0;
  for (const file of files) {
    let node = header;
    const parts = file.path.split("/");
    for (const part of parts.slice(0, -1)) {
      node.files[part] ||= { files: {} };
      node = node.files[part];
    }
    const content = Buffer.from(file.content, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    node.files[parts.at(-1)] = {
      offset: String(offset),
      size: content.length,
      integrity: { algorithm: "SHA256", hash, blockSize: 4 * 1024 * 1024, blocks: [hash] },
    };
    body.push(content);
    offset += content.length;
  }
  fs.writeFileSync(asarPath, Buffer.concat([encodeAsarHeader(header), ...body]));
}

function createInstallPublicationFixture(t, mode) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "managed-install-publish-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  fs.mkdirSync(projectRoot);
  for (const directory of ["scripts", "resources", "launchers"]) {
    fs.cpSync(path.join(process.cwd(), directory), path.join(projectRoot, directory), {
      recursive: true,
    });
  }
  const home = path.join(root, "home");
  const sourceApp =
    mode === "store-copy"
      ? path.join(root, "WindowsApps", "OpenAI.Codex_fixture", "app")
      : path.join(root, "Codex");
  const resources = path.join(sourceApp, "resources");
  const asarPath = path.join(resources, "app.asar");
  const exePath = path.join(sourceApp, "Codex.exe");
  fs.mkdirSync(resources, { recursive: true });
  writeInstallFixtureAsar(asarPath);
  fs.writeFileSync(exePath, "original-executable", "utf8");

  const configPath = path.join(home, ".codex", "config.toml");
  const pluginPath = path.join(
    home,
    ".codex",
    "plugins",
    "cache",
    "openai-bundled",
    "browser",
    "1",
    ".codex-plugin",
    "plugin.json",
  );
  const config = Buffer.from('\ufeff[desktop]\r\nlocaleOverride = "fr-FR"\r\n', "utf8");
  const plugin = Buffer.from(
    '{"name":"browser","interface":{"displayName":"Browser","shortDescription":"Original"}}\r\n',
    "utf8",
  );
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(configPath, config);
  fs.writeFileSync(pluginPath, plugin);
  const statePath = path.join(home, ".codex", "zh-cn-patched-active.json");
  fs.mkdirSync(statePath, { recursive: true });

  return {
    asar: fs.readFileSync(asarPath),
    asarPath,
    config,
    configPath,
    exe: fs.readFileSync(exePath),
    exePath,
    home,
    mode,
    patchedApp: path.join(home, ".codex", "zh-cn-patched", managedKey(sourceApp), "app"),
    plugin,
    pluginPath,
    projectRoot,
    sourceApp,
    statePath,
  };
}

function runInstallWithBlockedState(fixture) {
  return spawnSync(
    process.execPath,
    [
      path.join(fixture.projectRoot, "scripts", "patch-codex-zh-cn.mjs"),
      "install",
      "--codex-path",
      fixture.sourceApp,
      "--no-relaunch",
    ],
    {
      cwd: fixture.projectRoot,
      encoding: "utf8",
      env: { ...process.env, HOME: fixture.home },
    },
  );
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

test("publishes through an owned unique temporary file without following a pre-created link", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-state-temp-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, "zh-cn-patched-active.json");
  const sentinel = path.join(root, "sentinel");
  fs.writeFileSync(sentinel, "keep", "utf8");
  fs.symlinkSync(sentinel, `${statePath}.new`);

  writeManagedState(statePath, createState());
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
  assert.deepEqual(readManagedState(statePath), createState());
});

test("rolls back the activated attempt when managed state publication fails", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-state-publish-failure-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, "zh-cn-patched-active.json");
  fs.mkdirSync(statePath);
  const changed = path.join(root, "changed");
  fs.writeFileSync(changed, "patched", "utf8");

  assert.throws(
    () =>
      writeManagedState(statePath, createState(), {
        onFailure() {
          fs.writeFileSync(changed, "original", "utf8");
        },
      }),
    /EISDIR|EPERM|directory/i,
  );
  assert.equal(fs.readFileSync(changed, "utf8"), "original");
  assert.deepEqual(
    fs.readdirSync(root).filter((name) => name.endsWith(".new")),
    [],
  );
});

test("attaches rollback diagnostics without masking a state publication failure", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-state-rollback-diagnostic-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, "zh-cn-patched-active.json");
  fs.mkdirSync(statePath);

  let thrown;
  try {
    writeManagedState(statePath, createState(), {
      onFailure() {
        throw new Error("forced rollback failure");
      },
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown);
  assert.match(thrown.message, /EISDIR|EPERM|directory/i);
  assert.match(thrown.rollbackError?.message || "", /forced rollback failure/);
});

test("in-place install publication failure restores exact activated files", (t) => {
  const fixture = createInstallPublicationFixture(t, "in-place");

  const result = runInstallWithBlockedState(fixture);

  assert.notEqual(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stderr, /EISDIR|EPERM|directory/i);
  assert.deepEqual(fs.readFileSync(fixture.asarPath), fixture.asar);
  assert.deepEqual(fs.readFileSync(fixture.exePath), fixture.exe);
  assert.deepEqual(fs.readFileSync(fixture.configPath), fixture.config);
  assert.deepEqual(fs.readFileSync(fixture.pluginPath), fixture.plugin);
  assert.equal(fs.lstatSync(fixture.statePath).isDirectory(), true);
});

test("Store install publication failure removes copy and generated launchers", (t) => {
  const fixture = createInstallPublicationFixture(t, "store-copy");

  const result = runInstallWithBlockedState(fixture);

  assert.notEqual(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stderr, /EISDIR|EPERM|directory/i);
  assert.deepEqual(fs.readFileSync(fixture.asarPath), fixture.asar);
  assert.deepEqual(fs.readFileSync(fixture.exePath), fixture.exe);
  assert.deepEqual(fs.readFileSync(fixture.configPath), fixture.config);
  assert.deepEqual(fs.readFileSync(fixture.pluginPath), fixture.plugin);
  assert.equal(fs.existsSync(path.dirname(fixture.patchedApp)), false);
  for (const launcher of ["Codex 汉化版.bat", "launch-codex-zh-cn.bat", "launch-codex-zh-cn.ps1"]) {
    assert.equal(fs.existsSync(path.join(fixture.projectRoot, launcher)), false);
  }
  assert.equal(fs.lstatSync(fixture.statePath).isDirectory(), true);
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

test("rejects non-canonical Win32 aliases and path escape spellings", () => {
  for (const sourceApp of [
    "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\..\\app",
    "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\.. \\app",
    "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.\\app",
    "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1 \\app",
    "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1:stream\\app",
    "\\\\server\\share\\OpenAI.Codex_1\\app",
    "\\\\?\\C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app",
    "C:relative\\OpenAI.Codex_1\\app",
    "C:\\PROGRA~1\\WindowsApps\\OpenAI.Codex_1\\app",
    "C:\\Program Files\\WindowsApps\\CON\\app",
  ]) {
    assert.throws(() => validateManagedState(createState({ sourceApp })), /无效的托管状态/);
  }
});

test("rejects an existing managed target that resolves through a symlink escape", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-realpath-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, "managed");
  const outside = path.join(root, "outside");
  const safeTarget = path.join(managedRoot, "safe");
  const escapedTarget = path.join(managedRoot, "escaped");
  fs.mkdirSync(safeTarget, { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, escapedTarget, "dir");

  assert.equal(isExistingManagedPathWithin(managedRoot, safeTarget), true);
  assert.equal(isExistingManagedPathWithin(managedRoot, escapedTarget), false);
});

test("status rejects Store state that does not use the exact deterministic layout", (t) => {
  const fixture = createManagedFixture(t);
  const wrongPatchedApp = path.join(
    fixture.home,
    ".codex",
    "zh-cn-patched",
    "wrong-layout-key",
    "app",
  );
  writeManagedState(fixture.statePath, {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: fixture.sourceApp,
    sourceIdentity: "OpenAI.Codex_current",
    patchedApp: wrongPatchedApp,
    backupRoot: fixture.backupRoot,
    localeStatePath: path.join(fixture.backupRoot, "locale-state.json"),
  });

  const result = spawnSync(
    process.execPath,
    ["scripts/patch-codex-zh-cn.mjs", "status", "--store-source-identity", "OpenAI.Codex_current", "--json"],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, HOME: fixture.home } },
  );
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 2);
  assert.equal(report.managedState, false);
  assert.match(report.managedStateError, /管理目录|布局/);
});

test("status rejects a deterministic managed Store path that resolves through a symlink escape", (t) => {
  const fixture = createManagedFixture(t);
  const expectedRoot = path.dirname(fixture.patchedApp);
  const outside = path.join(fixture.root, "outside");
  fs.mkdirSync(path.join(outside, "app", "resources"), { recursive: true });
  fs.mkdirSync(path.dirname(expectedRoot), { recursive: true });
  fs.symlinkSync(outside, expectedRoot, "dir");
  writeManagedState(fixture.statePath, {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: fixture.sourceApp,
    sourceIdentity: "OpenAI.Codex_current",
    patchedApp: fixture.patchedApp,
    backupRoot: fixture.backupRoot,
    localeStatePath: path.join(fixture.backupRoot, "locale-state.json"),
  });

  const result = spawnSync(
    process.execPath,
    ["scripts/patch-codex-zh-cn.mjs", "status", "--store-source-identity", "OpenAI.Codex_current", "--json"],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, HOME: fixture.home } },
  );
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 2);
  assert.equal(report.managedState, false);
  assert.match(report.managedStateError, /解析|重解析|管理目录/);
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

test("Store restore restores exact locale and plugin bytes before removing managed state", (t) => {
  const fixture = createManagedFixture(t);
  const configPath = path.join(fixture.home, ".codex", "config.toml");
  const originalConfig = Buffer.from('\ufeff[desktop]\r\nlocaleOverride = "fr-FR"\r\n', "utf8");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, originalConfig);
  saveLocaleState(path.join(fixture.backupRoot, "locale-state.json"), captureLocaleState(configPath));
  fs.writeFileSync(configPath, '[desktop]\nlocaleOverride = "zh-CN"\n', "utf8");

  const pluginRelative = path.join("plugins", "cache", "fixture", ".codex-plugin", "plugin.json");
  const pluginPath = path.join(fixture.home, ".codex", pluginRelative);
  const pluginBackup = path.join(
    fixture.home,
    ".codex",
    ".zh-cn-backups",
    "latest",
    pluginRelative,
  );
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.mkdirSync(path.dirname(pluginBackup), { recursive: true });
  fs.writeFileSync(pluginPath, '{"displayName":"汉化"}\n', "utf8");
  fs.writeFileSync(pluginBackup, '{"displayName":"Original"}\r\n', "utf8");
  fs.mkdirSync(fixture.patchedApp, { recursive: true });
  fs.writeFileSync(path.join(fixture.patchedApp, "copy.txt"), "managed", "utf8");
  writeManagedState(fixture.statePath, {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: fixture.sourceApp,
    sourceIdentity: "OpenAI.Codex_current",
    patchedApp: fixture.patchedApp,
    backupRoot: fixture.backupRoot,
    localeStatePath: path.join(fixture.backupRoot, "locale-state.json"),
  });

  const result = spawnSync(process.execPath, ["scripts/patch-codex-zh-cn.mjs", "uninstall"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, HOME: fixture.home },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(configPath).equals(originalConfig), true);
  assert.equal(fs.readFileSync(pluginPath, "utf8"), '{"displayName":"Original"}\r\n');
  assert.equal(fs.existsSync(fixture.patchedApp), false);
  assert.equal(fs.existsSync(fixture.statePath), false);
});

test("Store restore keeps state and copy after a late failure and succeeds on retry", (t) => {
  const fixture = createManagedFixture(t);
  const configPath = path.join(fixture.home, ".codex", "config.toml");
  const originalConfig = Buffer.from('[desktop]\nlocaleOverride = "de-DE"\n', "utf8");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, originalConfig);
  saveLocaleState(path.join(fixture.backupRoot, "locale-state.json"), captureLocaleState(configPath));
  fs.writeFileSync(configPath, '[desktop]\nlocaleOverride = "zh-CN"\n', "utf8");

  const pluginBackup = path.join(
    fixture.home,
    ".codex",
    ".zh-cn-backups",
    "latest",
    "blocked",
    "plugin.json",
  );
  const blockedTarget = path.join(fixture.home, ".codex", "blocked");
  fs.mkdirSync(path.dirname(pluginBackup), { recursive: true });
  fs.writeFileSync(pluginBackup, '{"displayName":"Original"}\n', "utf8");
  fs.writeFileSync(blockedTarget, "blocks target directory", "utf8");
  fs.mkdirSync(fixture.patchedApp, { recursive: true });
  fs.writeFileSync(path.join(fixture.patchedApp, "copy.txt"), "managed", "utf8");
  writeManagedState(fixture.statePath, {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: fixture.sourceApp,
    sourceIdentity: "OpenAI.Codex_current",
    patchedApp: fixture.patchedApp,
    backupRoot: fixture.backupRoot,
    localeStatePath: path.join(fixture.backupRoot, "locale-state.json"),
  });

  const runRestore = () =>
    spawnSync(process.execPath, ["scripts/patch-codex-zh-cn.mjs", "uninstall"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: fixture.home },
    });
  const failed = runRestore();
  assert.notEqual(failed.status, 0);
  assert.equal(fs.readFileSync(configPath).equals(originalConfig), true);
  assert.equal(fs.existsSync(fixture.patchedApp), true);
  assert.equal(fs.existsSync(fixture.statePath), true);

  fs.unlinkSync(blockedTarget);
  const retried = runRestore();
  assert.equal(retried.status, 0, retried.stderr || retried.stdout);
  assert.equal(fs.readFileSync(configPath).equals(originalConfig), true);
  assert.equal(fs.readFileSync(path.join(blockedTarget, "plugin.json"), "utf8"), '{"displayName":"Original"}\n');
  assert.equal(fs.existsSync(fixture.patchedApp), false);
  assert.equal(fs.existsSync(fixture.statePath), false);
});

test("status marks Store state stale when its current WindowsApps package changed", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const sourceApp = path.join(root, "WindowsApps", "OpenAI.Codex_current", "app");
  const previousSourceApp = path.join(root, "WindowsApps", "OpenAI.Codex_previous", "app");
  const patchedApp = path.join(
    home,
    ".codex",
    "zh-cn-patched",
    managedKey(previousSourceApp),
    "app",
  );
  const resources = path.join(sourceApp, "resources");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(path.join(resources, "app.asar"), "not-localized", "utf8");
  const backupRoot = path.join(
    home,
    ".codex",
    "zh-cn-install-backups",
    managedKey(patchedApp),
    "latest",
  );
  const statePath = path.join(home, ".codex", "zh-cn-patched-active.json");
  writeManagedState(statePath, {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp: previousSourceApp,
    sourceIdentity: "OpenAI.Codex_previous",
    patchedApp,
    backupRoot,
    localeStatePath: path.join(backupRoot, "locale-state.json"),
  });

  const result = spawnSync(
    process.execPath,
    ["scripts/patch-codex-zh-cn.mjs", "status", "--codex-path", sourceApp, "--store-source-identity", "OpenAI.Codex_current", "--json"],
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
  const sourceApp = path.join(root, "WindowsApps", "OpenAI.Codex_previous", "app");
  const patchedApp = path.join(
    home,
    ".codex",
    "zh-cn-patched",
    managedKey(sourceApp),
    "app",
  );
  const backupRoot = path.join(
    home,
    ".codex",
    "zh-cn-install-backups",
    managedKey(patchedApp),
    "latest",
  );
  writeManagedState(path.join(home, ".codex", "zh-cn-patched-active.json"), {
    version: 1,
    patchVersion: "0.1.0",
    mode: "store-copy",
    sourceApp,
    sourceIdentity: "OpenAI.Codex_previous",
    patchedApp,
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
