import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runBuilder(root) {
  return spawnSync(
    process.execPath,
    [
      "tests/helpers/asar-fixture.mjs",
      "--app",
      path.join(root, "app"),
      "--home",
      path.join(root, "home"),
      "--manifest",
      path.join(root, "fixture-manifest.json"),
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

function createRoots(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-root-`));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-outside-`));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  return { root, outside };
}

function linkDirectory(target, linkPath) {
  fs.symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

test("fixture builder rejects a linked fixture root before writing outside", (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-root-link-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-root-outside-"));
  const linkedRoot = path.join(container, "codex-zh-cn-smoke-linked");
  linkDirectory(outside, linkedRoot);
  t.after(() => {
    fs.rmSync(container, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const result = runBuilder(linkedRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("fixture builder rejects a linked app directory before writing outside", (t) => {
  const { root, outside } = createRoots(t, "fixture-app-link");
  linkDirectory(outside, path.join(root, "app"));

  const result = runBuilder(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(root, "home")), false);
});

test("fixture builder rejects a dangling app link explicitly", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX dangling-link probe; Windows junction coverage runs separately");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-dangling-root-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.symlinkSync(path.join(root, "missing-outside"), path.join(root, "app"), "dir");

  const result = runBuilder(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
  assert.equal(fs.existsSync(path.join(root, "home")), false);
});

test("fixture builder rejects a linked home directory before writing outside", (t) => {
  const { root, outside } = createRoots(t, "fixture-home-link");
  linkDirectory(outside, path.join(root, "home"));

  const result = runBuilder(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(root, "app", "Codex.exe")), false);
});

test("fixture builder rejects a linked nested app directory before writing outside", (t) => {
  const { root, outside } = createRoots(t, "fixture-nested-link");
  fs.mkdirSync(path.join(root, "app"));
  linkDirectory(outside, path.join(root, "app", "resources"));

  const result = runBuilder(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(fs.existsSync(path.join(root, "app", "Codex.exe")), false);
});

test("fixture builder rejects a linked manifest before any fixture write", (t) => {
  const { root, outside } = createRoots(t, "fixture-manifest-link");
  const outsideManifest = path.join(outside, "manifest.json");
  fs.writeFileSync(outsideManifest, "sentinel", "utf8");
  try {
    fs.symlinkSync(outsideManifest, path.join(root, "fixture-manifest.json"), "file");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Windows host does not permit file symbolic links");
      return;
    }
    throw error;
  }

  const result = runBuilder(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
  assert.equal(fs.readFileSync(outsideManifest, "utf8"), "sentinel");
  assert.equal(fs.existsSync(path.join(root, "app", "Codex.exe")), false);
});

test("Windows fixture builder rejects a home junction ancestor", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows reparse smoke requires Windows");
    return;
  }
  const { root, outside } = createRoots(t, "fixture-home-junction");
  fs.mkdirSync(path.join(root, "home"));
  fs.symlinkSync(outside, path.join(root, "home", ".codex"), "junction");

  const result = runBuilder(root);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});
