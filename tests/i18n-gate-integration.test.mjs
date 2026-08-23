import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  inspectI18nGateInAsar,
  patchI18nGateInAsar,
} from "../scripts/patch-codex-zh-cn.mjs";

function encodeAsarHeader(header) {
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const headerPayloadSize = 4 + headerBytes.length + ((4 - ((4 + headerBytes.length) % 4)) % 4);
  const headerPickleSize = 4 + headerPayloadSize;
  const headerPickle = Buffer.alloc(headerPickleSize);
  headerPickle.writeUInt32LE(headerPayloadSize, 0);
  headerPickle.writeInt32LE(headerBytes.length, 4);
  headerBytes.copy(headerPickle, 8);
  const asarHeader = Buffer.alloc(8 + headerPickleSize);
  asarHeader.writeUInt32LE(4, 0);
  asarHeader.writeUInt32LE(headerPickleSize, 4);
  headerPickle.copy(asarHeader, 8);
  return asarHeader;
}

function writeAsar(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-gate-asar-"));
  const body = [];
  let offset = 0;
  const header = { files: {} };
  for (const file of files) {
    let node = header;
    const parts = file.path.split("/");
    for (const part of parts.slice(0, -1)) {
      node.files[part] ||= { files: {} };
      node = node.files[part];
    }
    const buffer = Buffer.from(file.content);
    node.files[parts.at(-1)] = file.unpacked
      ? { size: buffer.length, unpacked: true }
      : {
          offset: String(offset),
          size: buffer.length,
          integrity: { algorithm: "SHA256", hash: "test", blockSize: 1, blocks: ["test"] },
        };
    if (!file.unpacked) {
      body.push(buffer);
      offset += buffer.length;
    }
  }
  const asarPath = path.join(root, "app.asar");
  fs.writeFileSync(asarPath, Buffer.concat([encodeAsarHeader(header), ...body]));
  return { asarPath, root };
}

test("patches every packed JavaScript gate and reports it enabled", (t) => {
  const fixture = writeAsar([
    { path: "webview/assets/a.js", content: 'a.get("enable_i18n",false)' },
    { path: ".vite/build/main-b.js", content: "b.get(`enable_i18n`,!1)" },
    { path: "webview/assets/readme.txt", content: 'c.get("enable_i18n",false)' },
    { path: "webview/assets/unpacked.js", content: 'd.get("enable_i18n",false)', unpacked: true },
  ]);
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const before = inspectI18nGateInAsar(fixture.asarPath);
  assert.equal(before.status, "patched");
  assert.deepEqual(before.files.map(({ path: filePath }) => filePath), [
    ".vite/build/main-b.js",
    "webview/assets/a.js",
  ]);

  const patched = patchI18nGateInAsar(fixture.asarPath);
  assert.equal(patched.status, "already-enabled");
  assert.equal(patched.changedCount, 2);
  assert.equal(patched.recognizedCount, 2);
  assert.equal(patched.ambiguousCount, 0);
  assert.equal(inspectI18nGateInAsar(fixture.asarPath).status, "already-enabled");
});

test("fails closed without changing an ambiguous ASAR gate", (t) => {
  const fixture = writeAsar([
    { path: "webview/assets/a.js", content: 'a.get("enable_i18n",false)' },
    { path: ".vite/build/main-b.js", content: 'b.get("enable_i18n",fallback)' },
  ]);
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const before = fs.readFileSync(fixture.asarPath);

  assert.throws(() => patchI18nGateInAsar(fixture.asarPath), /ambiguous/);
  assert.deepEqual(fs.readFileSync(fixture.asarPath), before);
});

test("verifier rejects a gate unless its fallback is already enabled", (t) => {
  const enabled = writeAsar([
    { path: "webview/assets/a.js", content: 'a.get("enable_i18n",true)' },
  ]);
  const missing = writeAsar([{ path: "webview/assets/a.js", content: "const x = false" }]);
  t.after(() => {
    fs.rmSync(enabled.root, { recursive: true, force: true });
    fs.rmSync(missing.root, { recursive: true, force: true });
  });

  const verified = spawnSync(process.execPath, ["scripts/verify-patch.mjs", enabled.asarPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const rejected = spawnSync(process.execPath, ["scripts/verify-patch.mjs", missing.asarPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(verified.status, 0);
  assert.match(verified.stdout, /\[OK\] enable_i18n fallback: enabled/);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /\[X\] enable_i18n fallback: missing/);
});

test("verifier rejects a stale staged executable before active core files change", (t) => {
  const staged = writeAsar([{ path: "webview/assets/a.js", content: 'a.get("enable_i18n",true)' }]);
  const activeRoot = path.join(staged.root, "active");
  const activeAsarPath = path.join(activeRoot, "resources", "app.asar");
  const activeExePath = path.join(activeRoot, "Codex.exe");
  const stagedExePath = path.join(staged.root, "Codex.exe");
  fs.mkdirSync(path.dirname(activeAsarPath), { recursive: true });
  fs.copyFileSync(staged.asarPath, activeAsarPath);
  fs.writeFileSync(activeExePath, "active-executable");
  fs.writeFileSync(
    stagedExePath,
    '{"file":"resources/app.asar","alg":"SHA256","value":"0000000000000000000000000000000000000000000000000000000000000000"}',
  );
  const beforeAsar = fs.readFileSync(activeAsarPath);
  const beforeExe = fs.readFileSync(activeExePath);
  t.after(() => fs.rmSync(staged.root, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, ["scripts/verify-patch.mjs", staged.asarPath, stagedExePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXE ASAR header hash/);
  assert.deepEqual(fs.readFileSync(activeAsarPath), beforeAsar);
  assert.deepEqual(fs.readFileSync(activeExePath), beforeExe);
});

test("status exposes stable i18n gate fields in JSON and human output", (t) => {
  const fixture = writeAsar([
    { path: "webview/assets/a.js", content: 'a.get("enable_i18n",false)' },
  ]);
  const installRoot = path.join(fixture.root, "Codex");
  const resources = path.join(installRoot, "resources");
  fs.mkdirSync(resources, { recursive: true });
  const asarPath = path.join(resources, "app.asar");
  fs.renameSync(fixture.asarPath, asarPath);
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const json = spawnSync(
    process.execPath,
    ["scripts/patch-codex-zh-cn.mjs", "status", "--codex-path", installRoot, "--json"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const human = spawnSync(
    process.execPath,
    ["scripts/patch-codex-zh-cn.mjs", "status", "--codex-path", installRoot],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(json.status, 0);
  const jsonReport = JSON.parse(json.stdout);
  assert.deepEqual(
    jsonReport.i18nGateFiles,
    [
      {
        path: "webview/assets/a.js",
        status: "patched",
        changedCount: 1,
        recognizedCount: 1,
        ambiguousCount: 0,
      },
    ],
  );
  assert.equal(jsonReport.localeBackup, false);
  assert.equal(jsonReport.localeRestorable, false);
  assert.match(json.stdout, /"i18nGateStatus":"patched"/);
  assert.match(json.stdout, /"i18nGateChanged":1/);
  assert.match(human.stdout, /\[env\] i18nGateStatus=patched/);
  assert.match(human.stdout, /\[env\] i18nGateFiles=\[\{"path":"webview\/assets\/a\.js"/);
  assert.match(human.stdout, /\[env\] localeBackup=false/);
  assert.match(human.stdout, /\[env\] localeRestorable=false/);
});
