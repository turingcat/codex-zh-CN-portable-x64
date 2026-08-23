import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function writeAsar(asarPath) {
  const content = Buffer.from('a.get("enable_i18n",false)');
  const header = {
    files: {
      webview: {
        files: {
          "a.js": { size: content.length, offset: "0" },
        },
      },
    },
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const payloadSize = 4 + headerBytes.length + ((4 - ((4 + headerBytes.length) % 4)) % 4);
  const pickleSize = 4 + payloadSize;
  const pickle = Buffer.alloc(pickleSize);
  pickle.writeUInt32LE(payloadSize, 0);
  pickle.writeInt32LE(headerBytes.length, 4);
  headerBytes.copy(pickle, 8);
  const asarHeader = Buffer.alloc(8 + pickleSize);
  asarHeader.writeUInt32LE(4, 0);
  asarHeader.writeUInt32LE(pickleSize, 4);
  pickle.copy(asarHeader, 8);
  fs.writeFileSync(asarPath, Buffer.concat([asarHeader, content]));
}

test("status marks malformed locale backup as not restorable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "locale-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installRoot = path.join(root, "Codex");
  const resources = path.join(installRoot, "resources");
  const homeDir = path.join(root, "home");
  fs.mkdirSync(resources, { recursive: true });
  writeAsar(path.join(resources, "app.asar"));

  const backupKey = crypto
    .createHash("sha256")
    .update(path.normalize(installRoot).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const statePath = path.join(
    homeDir,
    ".codex",
    "zh-cn-install-backups",
    backupKey,
    "latest",
    "locale-state.json",
  );
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, '{"version":1,"existed":false,"contentBase64":"QQ=="}\n');

  const result = spawnSync(
    process.execPath,
    ["scripts/patch-codex-zh-cn.mjs", "status", "--codex-path", installRoot, "--json"],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, HOME: homeDir } },
  );

  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.localeBackup, true);
  assert.equal(report.localeRestorable, false);
});
