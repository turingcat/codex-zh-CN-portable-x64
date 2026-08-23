import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function write(root, relativePath) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, relativePath, "utf8");
}

test("collects deterministic release files while excluding development and generated content", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const relativePath of [
    "README.md",
    "package.json",
    "docs/windows-acceptance.md",
    "docs/superpowers/plans/internal.md",
    "launchers/start.bat",
    "resources/release.json",
    "runtime/node.zip",
    "runtime/expanded/node.exe",
    "scripts/bootstrap_windows.ps1",
    "tests/helpers/fixture.mjs",
    "dist/release.zip",
    ".git/config",
    ".github/workflows/windows.yml",
    ".superpowers/sdd/report.md",
  ]) {
    write(root, relativePath);
  }

  const result = spawnSync(process.execPath, ["scripts/release-files.mjs", root], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), [
    "README.md",
    "docs/windows-acceptance.md",
    "launchers/start.bat",
    "package.json",
    "resources/release.json",
    "runtime/node.zip",
    "scripts/bootstrap_windows.ps1",
  ]);
});
