import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const launcherPath = path.join(process.cwd(), "launchers", "launch-codex-zh-cn.ps1");

function managedKey(value) {
  return crypto
    .createHash("sha256")
    .update(path.win32.normalize(value).toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function createFixture(t, mode = "in-place") {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "codex-launcher-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const sourceIdentity = mode === "store-copy" ? "OpenAI.Codex_fixture" : "Codex";
  const sourceApp = mode === "store-copy"
    ? `C:\\Program Files\\WindowsApps\\${sourceIdentity}\\app`
    : path.join(root, sourceIdentity);
  const patchedApp = mode === "store-copy"
    ? path.join(home, ".codex", "zh-cn-patched", managedKey(sourceApp), "app")
    : sourceApp;
  const backupRoot = path.join(
    home,
    ".codex",
    "zh-cn-install-backups",
    managedKey(patchedApp),
    "latest",
  );
  const state = {
    version: 1,
    patchVersion: "0.1.0",
    mode,
    sourceApp,
    sourceIdentity,
    patchedApp,
    backupRoot,
    localeStatePath: path.join(backupRoot, "locale-state.json"),
  };
  const statePath = path.join(home, ".codex", "zh-cn-patched-active.json");
  const configPath = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(patchedApp, { recursive: true });
  fs.writeFileSync(path.join(patchedApp, "Codex.exe"), "fixture", "utf8");
  writeState(statePath, state);
  return { configPath, home, patchedApp, root, state, statePath };
}

function writeState(statePath, state, raw = JSON.stringify(state, null, 2)) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${raw}\n`, "utf8");
}

function runLauncher(fixture, extraArgs = []) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      launcherPath,
      "-Quiet",
      "-TestMode",
      ...extraArgs,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, USERPROFILE: fixture.home },
    },
  );
}

function requireWindowsPowerShell(t) {
  if (process.platform !== "win32") {
    t.skip("launcher runtime cases require Windows PowerShell; host is not Windows");
    return false;
  }
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]);
  if (probe.error?.code === "ENOENT") {
    t.skip("Windows PowerShell is not installed");
    return false;
  }
  assert.equal(probe.status, 0, probe.stderr?.toString());
  return true;
}

test("keeps BAT entry points thin and wires guarded launch ordering", () => {
  const launcher = fs.readFileSync(launcherPath, "utf8");
  for (const name of ["launch-codex-zh-cn.bat", "Codex 汉化版.bat"]) {
    const wrapper = fs.readFileSync(path.join("launchers", name), "utf8");
    assert.match(wrapper, /launch-codex-zh-cn\.ps1/);
    assert.match(wrapper, /powershell\.exe[^\r\n]*-File "%PS1%"/);
  }

  assert.doesNotMatch(launcher, /zh-cn-patched-active\.txt/);
  assert.match(launcher, /Get-AppxPackage\s+-Name\s+'OpenAI\.Codex'/);
  assert.match(launcher, /Codex Store 安装缺失或已更新/);
  assert.match(launcher, /Start-Process\s+-FilePath\s+\$launch\.ExecutablePath/);
  assert.match(launcher, /\[switch\]\$TestMode/);
  assert.ok(launcher.indexOf("Get-AppxPackage") < launcher.indexOf("Set-CodexLocaleZhCn"));
  assert.ok(launcher.indexOf("Set-CodexLocaleZhCn") < launcher.indexOf("Start-Process"));
});

test("rejects hostile managed-state schemas and Win32 path spellings", async (t) => {
  if (!requireWindowsPowerShell(t)) return;

  const schemaCases = [
    ["extra key", (state) => ({ ...state, unexpected: "x" })],
    ["wrong key case", (state) => {
      const { patchVersion, ...rest } = state;
      return { ...rest, PatchVersion: patchVersion };
    }],
    ["string version", (state) => ({ ...state, version: "1" })],
    ["wrong mode case", (state) => ({ ...state, mode: "IN-PLACE" })],
    ["empty value", (state) => ({ ...state, patchVersion: "" })],
  ];
  for (const [name, mutate] of schemaCases) {
    await t.test(name, () => {
      const fixture = createFixture(t);
      writeState(fixture.statePath, mutate(fixture.state));
      const result = runLauncher(fixture);
      assert.notEqual(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(fixture.configPath), false);
    });
  }

  await t.test("non-integer JSON number", () => {
    const fixture = createFixture(t);
    const raw = JSON.stringify(fixture.state, null, 2).replace('"version": 1', '"version": 1.0');
    writeState(fixture.statePath, fixture.state, raw);
    const result = runLauncher(fixture);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(fixture.configPath), false);
  });

  const hostilePaths = [
    "\\\\server\\share\\Codex",
    "\\\\?\\C:\\Codex",
    "C:Codex",
    "C:\\Codex:stream",
    "C:\\Apps\\.\\Codex",
    "C:\\PROGRA~1\\Codex",
    "C:\\Apps\\Codex.",
    "C:\\Apps\\Codex ",
    "C:\\Apps\\\\Codex",
    "C:/Apps/Codex",
  ];
  for (const hostilePath of hostilePaths) {
    await t.test(`path ${JSON.stringify(hostilePath)}`, () => {
      const fixture = createFixture(t);
      writeState(fixture.statePath, {
        ...fixture.state,
        sourceApp: hostilePath,
        patchedApp: hostilePath,
      });
      const result = runLauncher(fixture);
      assert.notEqual(result.status, 0, result.stderr);
      assert.equal(fs.existsSync(fixture.configPath), false);
    });
  }
});

test("checks Store freshness and reparse safety before locale writes", async (t) => {
  if (!requireWindowsPowerShell(t)) return;

  await t.test("stale Store identity leaves config untouched", () => {
    const fixture = createFixture(t, "store-copy");
    const original = Buffer.from('[desktop]\r\nlocaleOverride = "fr-FR"\r\n');
    fs.writeFileSync(fixture.configPath, original);
    const result = runLauncher(fixture, ["-TestStoreIdentity", "OpenAI.Codex_newer"]);
    assert.notEqual(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(fixture.configPath), original);
  });

  await t.test("Store app junction is rejected", () => {
    const fixture = createFixture(t, "store-copy");
    const external = path.join(fixture.root, "external-app");
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "Codex.exe"), "outside", "utf8");
    fs.rmSync(fixture.patchedApp, { recursive: true });
    fs.symlinkSync(external, fixture.patchedApp, "junction");
    const result = runLauncher(fixture, ["-TestStoreIdentity", fixture.state.sourceIdentity]);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(fixture.configPath), false);
  });

  await t.test("wrong Store managed layout is rejected", () => {
    const fixture = createFixture(t, "store-copy");
    const wrong = path.join(fixture.home, ".codex", "zh-cn-patched", "wrong", "app");
    fs.mkdirSync(wrong, { recursive: true });
    fs.writeFileSync(path.join(wrong, "Codex.exe"), "fixture", "utf8");
    writeState(fixture.statePath, { ...fixture.state, patchedApp: wrong });
    const result = runLauncher(fixture, ["-TestStoreIdentity", fixture.state.sourceIdentity]);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(fixture.configPath), false);
  });
});

test("updates only one desktop localeOverride and fails closed on duplicates", async (t) => {
  if (!requireWindowsPowerShell(t)) return;

  for (const original of [
    Buffer.from("[desktop]\n[desktop]\n"),
    Buffer.from('[desktop]\r\nlocaleOverride = "ja-JP"\r\nlocaleOverride = "fr-FR"\r\n'),
  ]) {
    await t.test("duplicate TOML structure", () => {
      const fixture = createFixture(t);
      fs.writeFileSync(fixture.configPath, original);
      const result = runLauncher(fixture);
      assert.notEqual(result.status, 0, result.stderr);
      assert.deepEqual(fs.readFileSync(fixture.configPath), original);
    });
  }

  await t.test("preserves other sections and CRLF style", () => {
    const fixture = createFixture(t);
    fs.writeFileSync(
      fixture.configPath,
      '[other]\r\nlocaleOverride = "fr-FR"\r\nkeep = true\r\n\r\n[desktop]\r\ncolor = "dark"\r\n',
      "utf8",
    );
    const result = runLauncher(fixture);
    assert.equal(result.status, 0, result.stderr);
    const content = fs.readFileSync(fixture.configPath, "utf8");
    assert.match(content, /\[other\]\r\nlocaleOverride = "fr-FR"\r\nkeep = true\r\n/);
    assert.match(content, /\[desktop\]\r\nlocaleOverride = "zh-CN"\r\ncolor = "dark"\r\n/);
    assert.equal((content.match(/^\[desktop\]$/gm) || []).length, 1);
    assert.equal((content.match(/^localeOverride = "zh-CN"\r?$/gm) || []).length, 1);
  });
});
