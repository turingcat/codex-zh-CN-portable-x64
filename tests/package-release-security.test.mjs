import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/package-release.ps1");

test("checks every source ancestor for reparse points immediately before copying", () => {
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.match(script, /function Assert-NoReparsePointInPath/);
  assert.match(
    script,
    /Assert-NoReparsePointInPath -RootPath \$Root -CandidatePath \$source[\s\S]*?Copy-Item -LiteralPath \$source/,
  );
});

test("PowerShell copy-stage guard rejects a directory junction ancestor", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows reparse smoke requires Windows");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-reparse-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "package-reparse-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside secret", "utf8");
  const linkedDirectory = path.join(root, "scripts");
  fs.symlinkSync(outside, linkedDirectory, "junction");

  const escapedScript = scriptPath.replaceAll("'", "''");
  const escapedRoot = root.replaceAll("'", "''");
  const escapedCandidate = path.join(linkedDirectory, "secret.txt").replaceAll("'", "''");
  const command = [
    "$tokens = $null",
    "$errors = $null",
    `$ast = [System.Management.Automation.Language.Parser]::ParseFile('${escapedScript}', [ref]$tokens, [ref]$errors)`,
    "$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-NoReparsePointInPath' }, $true)",
    "Invoke-Expression $definition.Extent.Text",
    `Assert-NoReparsePointInPath -RootPath '${escapedRoot}' -CandidatePath '${escapedCandidate}'`,
  ].join("; ");
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encodedCommand], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /reparse/i);
});
