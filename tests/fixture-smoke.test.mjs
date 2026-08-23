import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { inspectI18nGateInAsar } from "../scripts/patch-codex-zh-cn.mjs";

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function buildFixture(root) {
  const appPath = path.join(root, "app");
  const homePath = path.join(root, "home");
  const manifestPath = path.join(root, "fixture-manifest.json");
  const result = spawnSync(
    process.execPath,
    [
      "tests/helpers/asar-fixture.mjs",
      "--app",
      appPath,
      "--home",
      homePath,
      "--manifest",
      manifestPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return {
    appPath,
    homePath,
    manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    root,
  };
}

test("builds a deterministic Codex fixture with a patchable gate and matching EXE integrity", (t) => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), "asar-fixture-first-"));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "asar-fixture-second-"));
  t.after(() => {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  });

  const first = buildFixture(firstRoot);
  const second = buildFixture(secondRoot);
  const expectedFiles = [
    "app/Codex.exe",
    "app/resources/app.asar",
    "home/.codex/config.toml",
    "home/.codex/plugins/cache/openai-bundled/browser/1/.codex-plugin/plugin.json",
  ];

  assert.equal(first.manifest.version, 1);
  assert.deepEqual(Object.keys(first.manifest.sha256).sort(), expectedFiles);

  const asarPath = path.join(first.root, "app", "resources", "app.asar");
  assert.equal(inspectI18nGateInAsar(asarPath).status, "patched");

  const exe = fs.readFileSync(path.join(first.root, "app", "Codex.exe"), "latin1");
  assert.match(
    exe,
    new RegExp(
      `\\{"file":"resources/app\\.asar","alg":"SHA256","value":"${first.manifest.asarHeaderHash}"\\}`,
    ),
  );

  for (const relativePath of expectedFiles) {
    const firstBytes = fs.readFileSync(path.join(first.root, ...relativePath.split("/")));
    const secondBytes = fs.readFileSync(path.join(second.root, ...relativePath.split("/")));
    assert.deepEqual(firstBytes, secondBytes, relativePath);
    assert.equal(first.manifest.sha256[relativePath], sha256(firstBytes));
    assert.equal(second.manifest.sha256[relativePath], sha256(secondBytes));
  }
});

test("installs without launching, reports the enabled gate, and restores fixture bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-install-restore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const fixture = buildFixture(root);
  const environment = {
    ...process.env,
    APPDATA: path.join(fixture.homePath, "AppData", "Roaming"),
    HOME: fixture.homePath,
    LOCALAPPDATA: path.join(fixture.homePath, "AppData", "Local"),
    USERPROFILE: fixture.homePath,
  };
  const runPatch = (...args) =>
    spawnSync(process.execPath, ["scripts/patch-codex-zh-cn.mjs", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
    });

  const installed = runPatch("install", "--codex-path", fixture.appPath, "--no-relaunch");
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  assert.doesNotMatch(installed.stdout, /\[codex-launch\]/);

  const status = runPatch("status", "--codex-path", fixture.appPath, "--json");
  assert.equal(status.status, 0, status.stderr || status.stdout);
  const report = JSON.parse(status.stdout);
  assert.equal(report.i18nGateEnabled, true);
  assert.equal(report.patchInstalled, true);

  const restored = runPatch("uninstall", "--codex-path", fixture.appPath);
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);

  for (const [relativePath, expectedHash] of Object.entries(fixture.manifest.sha256)) {
    const bytes = fs.readFileSync(path.join(root, ...relativePath.split("/")));
    assert.equal(sha256(bytes), expectedHash, relativePath);
  }
  assert.equal(
    fs.existsSync(path.join(fixture.homePath, ".codex", "zh-cn-patched-active.json")),
    false,
  );
});
