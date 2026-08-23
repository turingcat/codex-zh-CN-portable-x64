import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyZhCnLocale,
  captureLocaleState,
  restoreLocaleState,
  saveLocaleState,
} from "../scripts/lib/locale-config.mjs";

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "locale-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    configPath: path.join(root, ".codex", "config.toml"),
    statePath: path.join(root, "backup", "locale-state.json"),
  };
}

test("restores exact original bytes after applying zh-CN", (t) => {
  const { configPath, statePath } = createFixture(t);
  const original = Buffer.from(
    '\ufeff[model]\r\nname = "x"\r\n[desktop]\r\nlocaleOverride = "fr-FR"\r\n',
    "utf8",
  );
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original);

  saveLocaleState(statePath, captureLocaleState(configPath));
  applyZhCnLocale(configPath);
  assert.match(fs.readFileSync(configPath, "utf8"), /localeOverride = "zh-CN"/);

  restoreLocaleState(configPath, statePath);
  assert.equal(fs.readFileSync(configPath).equals(original), true);
});

test("removes a patch-created config when none existed before", (t) => {
  const { configPath, statePath } = createFixture(t);

  saveLocaleState(statePath, captureLocaleState(configPath));
  applyZhCnLocale(configPath);
  assert.equal(fs.existsSync(configPath), true);

  restoreLocaleState(configPath, statePath);
  assert.equal(fs.existsSync(configPath), false);
});

test("refuses to delete a patch-created config changed after installation", (t) => {
  const { configPath, statePath } = createFixture(t);
  saveLocaleState(statePath, captureLocaleState(configPath));
  applyZhCnLocale(configPath);
  fs.appendFileSync(configPath, 'theme = "dark"\n');
  const changed = fs.readFileSync(configPath);

  assert.throws(
    () => restoreLocaleState(configPath, statePath),
    /托管配置已被修改/,
  );
  assert.deepEqual(fs.readFileSync(configPath), changed);
});

test("rejects a nonempty state payload for an originally absent config", (t) => {
  const { configPath, statePath } = createFixture(t);
  const current = Buffer.from('[desktop]\nlocaleOverride = "zh-CN"\n');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(configPath, current);
  fs.writeFileSync(
    statePath,
    '{"version":1,"existed":false,"contentBase64":"QQ=="}\n',
  );

  assert.throws(
    () => restoreLocaleState(configPath, statePath),
    /无效的 locale 状态文件/,
  );
  assert.deepEqual(fs.readFileSync(configPath), current);
});

test("keeps other section localeOverride while creating desktop zh-CN", (t) => {
  const { configPath } = createFixture(t);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '[other]\r\nlocaleOverride = "fr-FR"\r\n');

  applyZhCnLocale(configPath);

  const content = fs.readFileSync(configPath, "utf8");
  assert.match(content, /\[other\]\r\nlocaleOverride = "fr-FR"\r\n/);
  assert.match(content, /\[desktop\]\r\nlocaleOverride = "zh-CN"\r\n/);
});

test("refuses duplicate desktop sections without changing bytes", (t) => {
  const { configPath } = createFixture(t);
  const original = Buffer.from('[desktop]\n[desktop]\n');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original);

  assert.throws(() => applyZhCnLocale(configPath), /多个 \[desktop\] 配置段/);
  assert.deepEqual(fs.readFileSync(configPath), original);
});

test("refuses duplicate desktop localeOverride keys without changing bytes", (t) => {
  const { configPath } = createFixture(t);
  const original = Buffer.from(
    '[desktop]\nlocaleOverride = "ja-JP"\nlocaleOverride = "fr-FR"\n',
  );
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original);

  assert.throws(() => applyZhCnLocale(configPath), /多个 localeOverride 配置项/);
  assert.deepEqual(fs.readFileSync(configPath), original);
});

test("retains the first valid locale state on reinstall", (t) => {
  const { configPath, statePath } = createFixture(t);
  const original = Buffer.from("[desktop]\nlocaleOverride = \"ja-JP\"\n");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, original);
  saveLocaleState(statePath, captureLocaleState(configPath));

  fs.writeFileSync(configPath, "[desktop]\nlocaleOverride = \"zh-CN\"\n");
  saveLocaleState(statePath, captureLocaleState(configPath));

  assert.deepEqual(JSON.parse(fs.readFileSync(statePath, "utf8")), {
    version: 1,
    existed: true,
    contentBase64: original.toString("base64"),
  });
});

test("rejects an invalid existing locale state instead of overwriting it", (t) => {
  const { configPath, statePath } = createFixture(t);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{"version":2,"existed":true,"contentBase64":""}\n');

  assert.throws(
    () => saveLocaleState(statePath, captureLocaleState(configPath)),
    /无效的 locale 状态文件/,
  );
});

test("rejects an existing locale state with invalid base64 content", (t) => {
  const { configPath, statePath } = createFixture(t);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{"version":1,"existed":true,"contentBase64":"!"}\n');

  assert.throws(
    () => saveLocaleState(statePath, captureLocaleState(configPath)),
    /无效的 locale 状态文件/,
  );
});

test("restore rejects a POSIX symlink config destination", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX symlink probe; Windows reparse coverage runs in smoke");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "locale-restore-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, ".codex");
  const configPath = path.join(managedRoot, "config.toml");
  const statePath = path.join(root, "backup", "locale-state.json");
  const outside = path.join(root, "outside.toml");
  const outsideBytes = Buffer.from('[desktop]\nlocaleOverride = "zh-CN"\n');
  fs.mkdirSync(managedRoot, { recursive: true });
  fs.writeFileSync(outside, outsideBytes);
  fs.symlinkSync(outside, configPath);
  saveLocaleState(statePath, {
    version: 1,
    existed: true,
    contentBase64: Buffer.from('[desktop]\nlocaleOverride = "fr-FR"\n').toString("base64"),
  });

  assert.throws(
    () => restoreLocaleState(configPath, statePath, managedRoot),
    /重解析点|符号链接|安全目录/,
  );
  assert.deepEqual(fs.readFileSync(outside), outsideBytes);
  assert.equal(fs.lstatSync(configPath).isSymbolicLink(), true);
});

test("restore rejects a POSIX symlink parent escape", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX symlink probe; Windows reparse coverage runs in smoke");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "locale-restore-parent-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, ".codex");
  const outsideRoot = path.join(root, "outside");
  const configPath = path.join(managedRoot, "nested", "config.toml");
  const outsideConfig = path.join(outsideRoot, "config.toml");
  const statePath = path.join(root, "backup", "locale-state.json");
  const outsideBytes = Buffer.from("outside");
  fs.mkdirSync(managedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot);
  fs.writeFileSync(outsideConfig, outsideBytes);
  fs.symlinkSync(outsideRoot, path.join(managedRoot, "nested"), "dir");
  saveLocaleState(statePath, {
    version: 1,
    existed: true,
    contentBase64: Buffer.from("original").toString("base64"),
  });

  assert.throws(
    () => restoreLocaleState(configPath, statePath, managedRoot),
    /重解析点|符号链接|安全目录/,
  );
  assert.deepEqual(fs.readFileSync(outsideConfig), outsideBytes);
});

test("Windows restore smoke rejects a config parent junction", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows reparse smoke requires Windows");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "locale-restore-junction-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, ".codex");
  const outsideRoot = path.join(root, "outside");
  const configPath = path.join(managedRoot, "config.toml");
  const statePath = path.join(root, "backup", "locale-state.json");
  const outsideBytes = Buffer.from("outside");
  fs.mkdirSync(outsideRoot);
  fs.writeFileSync(path.join(outsideRoot, "config.toml"), outsideBytes);
  fs.symlinkSync(outsideRoot, managedRoot, "junction");
  saveLocaleState(statePath, {
    version: 1,
    existed: true,
    contentBase64: Buffer.from("original").toString("base64"),
  });
  assert.throws(
    () => restoreLocaleState(configPath, statePath, managedRoot),
    /重解析点|符号链接|安全目录/,
  );
  assert.deepEqual(fs.readFileSync(path.join(outsideRoot, "config.toml")), outsideBytes);
});
