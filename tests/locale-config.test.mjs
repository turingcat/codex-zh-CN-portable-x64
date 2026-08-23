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
