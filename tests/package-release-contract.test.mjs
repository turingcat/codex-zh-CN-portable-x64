import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("exposes release validation and bundled-runtime packaging scripts", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.equal(packageJson.scripts.validate, "node scripts/validate-release.mjs");
  assert.equal(
    packageJson.scripts.package,
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-release.ps1",
  );
});

test("validates first and writes the exact versioned ZIP and SHA256 sidecar", () => {
  const script = fs.readFileSync("scripts/package-release.ps1", "utf8");
  const runtimeCheck = script.indexOf("Get-VerifiedRuntime -ProjectRoot $Root");
  const validator = script.indexOf("validate-release.mjs");
  const releaseFiles = script.indexOf("release-files.mjs");
  const compress = script.indexOf("Compress-Archive");

  assert.ok(runtimeCheck >= 0);
  assert.ok(runtimeCheck < validator && validator < releaseFiles && releaseFiles < compress);
  assert.match(script, /Assert-VerifiedBundledNode/);
  assert.match(script, /codex-zh-CN-portable-x64-v\$Version\.zip/);
  assert.match(script, /Join-Path \$Root "dist"/);
  assert.match(script, /codex-zh-cn-package-[\s\S]*?NewGuid/);
  assert.match(script, /Get-FileHash -LiteralPath \$zipPath -Algorithm SHA256/);
  assert.match(script, /WriteAllText\("\$zipPath\.sha256"/);
  assert.doesNotMatch(script, /codex-zh-CN-v\$Version\.zip/);
  assert.equal(script.includes('TrimEnd("\\\\")'), false);
  assert.match(script, /TrimEnd\(\[char\]'\\'\)/);
});
