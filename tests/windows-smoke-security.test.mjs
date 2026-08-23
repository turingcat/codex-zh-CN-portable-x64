import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const smokePath = path.resolve("tests/windows-smoke.ps1");

test("smoke cleanup validates the fixture tree before recursive removal", () => {
  const script = fs.readFileSync(smokePath, "utf8");
  assert.match(script, /function Assert-SafeSmokeFixtureTree/);
  assert.match(
    script,
    /Assert-SafeSmokeFixtureTree -FixturePath \$fixture[\s\S]*?Remove-Item -LiteralPath \$fixture -Recurse -Force/,
  );
});

test("Windows smoke cleanup guard rejects a child junction", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows reparse smoke requires Windows");
    return;
  }

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "codex-zh-cn-smoke-cleanup-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-cleanup-outside-"));
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, "sentinel.txt"), "sentinel", "utf8");
  fs.symlinkSync(outside, path.join(fixture, "app"), "junction");

  const escapedScript = smokePath.replaceAll("'", "''");
  const escapedFixture = fixture.replaceAll("'", "''");
  const command = [
    "$tokens = $null",
    "$errors = $null",
    `$ast = [System.Management.Automation.Language.Parser]::ParseFile('${escapedScript}', [ref]$tokens, [ref]$errors)`,
    "$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-SafeSmokeFixtureTree' }, $true)",
    "Invoke-Expression $definition.Extent.Text",
    `Assert-SafeSmokeFixtureTree -FixturePath '${escapedFixture}'`,
  ].join("; ");
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encodedCommand], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /reparse/i);
  assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "sentinel");
});
