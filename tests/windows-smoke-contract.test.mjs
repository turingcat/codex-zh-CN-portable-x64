import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("keeps both test actions gated and runs fixture install, status, and restore with bundled Node", () => {
  const bootstrap = read("scripts/bootstrap_windows.ps1");
  const installer = read("scripts/install_windows.ps1");

  assert.match(
    bootstrap,
    /if \(\$Action -in @\("test", "test-fixture"\) -and \$env:CODEX_ZH_CN_TEST_FIXTURE -ne "1"\)/,
  );
  assert.match(bootstrap, /tests\\helpers\\asar-fixture\.mjs/);
  assert.match(bootstrap, /& \$nodePath \$fixtureBuilder/);
  assert.match(installer, /"test-fixture" \{[\s\S]*?"install"[\s\S]*?--no-relaunch/);
  assert.match(installer, /"test-fixture" \{[\s\S]*?Get-StatusReport/);
  assert.match(installer, /"test-fixture" \{[\s\S]*?"uninstall"/);
});

test("Windows smoke verifies every original fixture hash and removes only its unique temp root", () => {
  const smoke = read("tests/windows-smoke.ps1");

  assert.match(smoke, /fixture-manifest\.json/);
  assert.match(smoke, /Get-FileHash/);
  assert.match(smoke, /foreach \(\$entry in \$manifest\.sha256\.PSObject\.Properties\)/);
  assert.match(smoke, /Remove-Item -LiteralPath \$fixture -Recurse -Force/);
  assert.doesNotMatch(smoke, /Remove-Item[^\r\n]*(?:\*|\?)/);
  assert.equal(smoke.includes('TrimEnd("\\\\")'), false);
});

test("fixture bootstrap uses an explicit path-separator char", () => {
  const bootstrap = read("scripts/bootstrap_windows.ps1");

  assert.equal(bootstrap.includes('TrimEnd("\\\\")'), false);
  assert.match(bootstrap, /TrimEnd\(\[char\]'\\'\)/);
});

test("Windows CI uses bundled runtime and scopes test permission to each test step", () => {
  const workflowPath = ".github/workflows/windows-smoke.yml";
  assert.equal(fs.existsSync(workflowPath), true, `${workflowPath} must exist`);
  const workflow = read(workflowPath);

  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /bootstrap_windows\.ps1 -Action test -NoPause/);
  assert.match(
    workflow,
    /- name: Node tests with bundled runtime[\s\S]*?env:\s*\n\s+CODEX_ZH_CN_TEST_FIXTURE: "1"[\s\S]*?-Action test/,
  );
  assert.match(
    workflow,
    /- name: Windows fixture smoke[\s\S]*?env:\s*\n\s+CODEX_ZH_CN_TEST_FIXTURE: "1"[\s\S]*?run:\s*\|[\s\S]*?\.\\tests\\windows-smoke\.ps1/,
  );
  assert.equal((workflow.match(/CODEX_ZH_CN_TEST_FIXTURE/g) ?? []).length, 2);
  assert.doesNotMatch(
    workflow,
    /actions\/setup-node|npm\s+(?:ci|install)|Invoke-WebRequest|Start-BitsTransfer|curl\b/,
  );
});

test("Windows CI pins TEMP and TMP to the canonical runner temp directory in both steps", () => {
  const workflow = read(".github/workflows/windows-smoke.yml");
  const steps = workflow.split(/(?=^\s*- name:)/m).filter((step) =>
    /- name: (?:Node tests with bundled runtime|Windows fixture smoke)/.test(step),
  );

  assert.equal(steps.length, 2);
  for (const step of steps) {
    const tempAssignment = step.indexOf("$env:TEMP = $env:RUNNER_TEMP");
    const tmpAssignment = step.indexOf("$env:TMP = $env:RUNNER_TEMP");
    const bootstrapInvocation = step.indexOf("bootstrap_windows.ps1");
    const smokeInvocation = step.indexOf(".\\tests\\windows-smoke.ps1");
    const invocation = Math.max(bootstrapInvocation, smokeInvocation);

    assert.ok(tempAssignment >= 0, "TEMP must use RUNNER_TEMP");
    assert.ok(tmpAssignment >= 0, "TMP must use RUNNER_TEMP");
    assert.ok(tempAssignment < invocation, "TEMP must be set before the step command");
    assert.ok(tmpAssignment < invocation, "TMP must be set before the step command");
  }
});
