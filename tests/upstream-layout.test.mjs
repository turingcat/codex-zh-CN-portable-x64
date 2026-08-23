import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const required = [
  "UPSTREAM_COMMIT",
  "UPSTREAM-LICENSE",
  "install-windows.bat",
  "launchers/launch-codex-zh-cn.ps1",
  "resources/native-menu-zh-CN.json",
  "resources/menu-hardcoded-zh-CN.json",
  "resources/bundled-plugins-zh-CN.json",
  "scripts/install_windows.ps1",
  "scripts/patch-codex-zh-cn.mjs",
  "scripts/verify-patch.mjs",
];

test("vendors audited upstream release", () => {
  for (const file of required) {
    assert.equal(fs.existsSync(file), true, file);
  }
  assert.equal(
    fs.readFileSync("UPSTREAM_COMMIT", "utf8").trim(),
    "0e39c30a381c712c16e49c8e72c8eca40c3b2299",
  );
});
