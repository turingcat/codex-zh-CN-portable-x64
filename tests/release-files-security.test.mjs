import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runCollector(root) {
  return spawnSync(process.execPath, [path.resolve("scripts/release-files.mjs"), root], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("rejects a root release file that is a symbolic link", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-root-link-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "release-root-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const outsideReadme = path.join(outside, "README.md");
  fs.writeFileSync(outsideReadme, "outside secret", "utf8");
  try {
    fs.symlinkSync(outsideReadme, path.join(root, "README.md"), "file");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.skip("Windows host does not permit file symbolic links");
      return;
    }
    throw error;
  }

  const result = runCollector(root);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse|outside/i);
});

test("rejects a dangling root release file symbolic link", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX dangling-link probe; Windows junction coverage runs separately");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-dangling-link-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.symlinkSync(path.join(root, "missing-outside.md"), path.join(root, "README.md"), "file");

  const result = runCollector(root);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse/i);
});

test("rejects a top-level release directory link before traversal", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-dir-link-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "release-dir-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(outside, "outside-secret.txt"), "outside secret", "utf8");
  fs.symlinkSync(
    outside,
    path.join(root, "scripts"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const result = runCollector(root);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /symbolic link|reparse|outside/i);
  assert.doesNotMatch(result.stdout, /outside-secret/);
});
