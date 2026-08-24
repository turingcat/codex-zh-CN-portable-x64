import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("pins the official x64 Node runtime and local bootstrap contract", () => {
  const manifest = JSON.parse(read("runtime/runtime.json"));

  assert.deepEqual(manifest, {
    version: "v24.19.0",
    architecture: "x64",
    archive: "node-v24.19.0-win-x64.zip",
    extractedDirectory: "node-v24.19.0-win-x64",
    executable: "node.exe",
    sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
  });

  const bootstrap = read("scripts/bootstrap_windows.ps1");
  const runtimeContract = read("scripts/runtime-contract.ps1");
  assert.match(runtimeContract, /Get-FileHash/);
  assert.match(runtimeContract, /GetNativeSystemInfo/);
  assert.match(bootstrap, /Expand-Archive/);
  assert.match(runtimeContract, /& \$NodePath --version/);
  assert.match(bootstrap, /"-NodePath", \$nodePath/);
  assert.doesNotMatch(`${bootstrap}\n${runtimeContract}`, /Invoke-WebRequest|Start-BitsTransfer/);
});

test("passes only the verified absolute bundled Node path to the installer", () => {
  const installer = read("scripts/install_windows.ps1");

  assert.match(installer, /\[Parameter\(Mandatory = \$true\)\]\s*\[string\]\$NodePath/);
  assert.match(installer, /Get-VerifiedRuntime/);
  assert.match(installer, /Assert-VerifiedBundledNode/);
  assert.match(installer, /& \$NodePath @argsList/);
  assert.doesNotMatch(installer, /Get-Command node/);
  assert.doesNotMatch(installer, /& node\b/);
});

test("verifies the archive before trusting cached Node and anchors cache bytes to its ZIP entry", () => {
  const bootstrap = read("scripts/bootstrap_windows.ps1");
  const runtimeContract = read("scripts/runtime-contract.ps1");

  assert.match(bootstrap, /Get-VerifiedRuntime -ProjectRoot \$projectRoot/);
  assert.ok(
    bootstrap.indexOf("Get-VerifiedRuntime -ProjectRoot $projectRoot")
      < bootstrap.indexOf("if (-not (Test-Path -LiteralPath $nodePath"),
  );
  assert.match(runtimeContract, /Get-FileHash -LiteralPath \$archivePath -Algorithm SHA256/);
  assert.match(runtimeContract, /\[System\.IO\.Compression\.ZipFile\]::OpenRead/);
  assert.match(runtimeContract, /Get-ArchiveEntrySha256/);
  assert.match(runtimeContract, /Get-FileHash -LiteralPath \$NodePath -Algorithm SHA256/);
  assert.match(runtimeContract, /NodePath does not match the expected bundled runtime path/);
  assert.match(runtimeContract, /Bundled Node\.js executable hash does not match the verified archive entry/);
});

test("uses native Windows platform checks and an absolute encoded UAC relaunch", () => {
  const installer = read("scripts/install_windows.ps1");
  const runtimeContract = read("scripts/runtime-contract.ps1");

  assert.match(runtimeContract, /GetNativeSystemInfo/);
  assert.match(runtimeContract, /RtlGetVersion/);
  assert.match(runtimeContract, /wProcessorArchitecture -ne 9/);
  assert.match(runtimeContract, /InstallationType -ne "Client"/);
  assert.match(runtimeContract, /dwMajorVersion -ne 10/);
  assert.match(runtimeContract, /dwBuildNumber -lt 10240/);
  assert.match(installer, /Join-Path \$env:SystemRoot "System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/);
  assert.match(installer, /Test-Path -LiteralPath \$elevatedHost -PathType Leaf/);
  assert.match(installer, /-EncodedCommand/);
  assert.match(installer, /\[System\.Text\.Encoding\]::Unicode\.GetBytes/);
  assert.match(runtimeContract, /function ConvertTo-SingleQuotedPowerShellLiteral/);
  assert.match(runtimeContract, /\.Replace\("'", "''"\)/);
  assert.match(installer, /-Wait -PassThru/);
  assert.match(installer, /return \[int\]\$process\.ExitCode/);
  assert.doesNotMatch(installer, /ConvertTo-NativeArgument/);
  assert.doesNotMatch(installer, /-FilePath "powershell\.exe"/);
});

test("encodes hostile UAC values as one PowerShell literal when Windows PowerShell is available", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows PowerShell is unavailable on this host");
    return;
  }

  const helperPath = path.join(process.cwd(), "scripts", "runtime-contract.ps1").replaceAll("'", "''");
  const values = [
    "C:\\bundle root\\node.exe",
    "C:\\bundle\\O'Hara\\node.exe",
    "C:\\bundle\\trailing\\",
    "C:\\bundle\\semi;colon\\node.exe",
  ];

  for (const value of values) {
    const valueBase64 = Buffer.from(value, "utf8").toString("base64");
    const command = [
      `$value = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${valueBase64}'))`,
      `. '${helperPath}'`,
      "ConvertTo-SingleQuotedPowerShellLiteral $value",
    ].join("; ");
    const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-EncodedCommand", encodedCommand], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `'${value.replaceAll("'", "''")}'`);
  }
});

test("guards both test actions before any privileged Node invocation", () => {
  const bootstrap = read("scripts/bootstrap_windows.ps1");
  const installer = read("scripts/install_windows.ps1");

  assert.match(bootstrap, /\$Action -in @\("test", "test-fixture"\)/);
  assert.match(bootstrap, /\$env:CODEX_ZH_CN_TEST_FIXTURE -ne "1"/);
  assert.match(installer, /\[ValidateSet\("install", "uninstall", "status", "verify", "menu", "restore", "test", "test-fixture"\)\]/);
  assert.match(installer, /\$Action -in @\("test", "test-fixture"\)/);
  assert.match(installer, /\$env:CODEX_ZH_CN_TEST_FIXTURE -ne "1"/);
  assert.match(installer, /"test" \{[\s\S]*?& \$NodePath --test @tests/);
  assert.ok(
    installer.indexOf("$elevatedExitCode = Ensure-Administrator")
      < installer.indexOf("$runtime = Get-VerifiedRuntime -ProjectRoot $projectRoot")
      && installer.indexOf("$runtime = Get-VerifiedRuntime -ProjectRoot $projectRoot")
        < installer.indexOf("switch ($Action)"),
  );
});

test("routes root Windows entry points through fixed bootstrap actions", () => {
  const cases = [
    ["install-windows.bat", "menu"],
    ["status-windows.bat", "status"],
    ["restore-windows.bat", "restore"],
    ["uninstall-codex.bat", "restore"],
  ];

  for (const [file, action] of cases) {
    const wrapper = read(file);
    assert.match(wrapper, /%~dp0scripts\\bootstrap_windows\.ps1/);
    assert.match(wrapper, /-NoProfile -ExecutionPolicy Bypass/);
    assert.match(wrapper, new RegExp(`-Action ${action}`));
    assert.match(wrapper, /EXIT_CODE=%ERRORLEVEL%/);
    assert.match(wrapper, /if not "%EXIT_CODE%"=="0" pause/);
  }
});

test("allows Windows Server only through the explicitly gated test runtime path", () => {
 const runtimeContract = read("scripts/runtime-contract.ps1");
 const bootstrap = read("scripts/bootstrap_windows.ps1");
 const installer = read("scripts/install_windows.ps1");
 const packageScript = read("scripts/package-release.ps1");

 assert.match(
 runtimeContract,
 /function Assert-SupportedWindowsAmd64[\s\S]*?param\([\s\S]*?\[switch\]\$AllowServerForTests[\s\S]*?\$windowsVersion\.InstallationType -ne "Client"[\s\S]*?\$AllowServerForTests[\s\S]*?CODEX_ZH_CN_TEST_FIXTURE/,
 );
 assert.match(
 runtimeContract,
 /function Get-VerifiedRuntime[\s\S]*?param\([\s\S]*?\[switch\]\$AllowServerForTests[\s\S]*?Assert-SupportedWindowsAmd64 -AllowServerForTests:\$AllowServerForTests/,
 );

 const gateIndex = bootstrap.indexOf('$env:CODEX_ZH_CN_TEST_FIXTURE -ne "1"');
 const testRuntimeCall = bootstrap.indexOf(
 "Get-VerifiedRuntime -ProjectRoot $projectRoot -AllowServerForTests",
 );
 const defaultRuntimeCall = bootstrap.indexOf(
 "Get-VerifiedRuntime -ProjectRoot $projectRoot\n",
 );
 assert.ok(gateIndex >= 0, "bootstrap test-action gate is required");
 assert.ok(testRuntimeCall > gateIndex, "Server allowance must follow the test gate");
 assert.notEqual(defaultRuntimeCall, testRuntimeCall, "normal bootstrap path remains default");

 assert.doesNotMatch(packageScript, /AllowServerForTests/);
});

test("keeps the Server allowance on the gated fixture installer hop", () => {
 const bootstrap = read("scripts/bootstrap_windows.ps1");
 const installer = read("scripts/install_windows.ps1");

 assert.match(installer, /\[switch\]\$AllowServerForTests/);
 assert.match(
 installer,
 /if \(\$AllowServerForTests\) \{[\s\S]*?Get-VerifiedRuntime -ProjectRoot \$projectRoot -AllowServerForTests[\s\S]*?\} else \{[\s\S]*?Get-VerifiedRuntime -ProjectRoot \$projectRoot/,
 );
 assert.match(
 installer,
 /\$Action -in @\("test", "test-fixture"\) -and \$env:CODEX_ZH_CN_TEST_FIXTURE -ne "1"/,
 );

 const bootstrapLines = bootstrap.split(/\r?\n/);
 const gateIndex = bootstrapLines.findIndex((line) =>
 /\$env:CODEX_ZH_CN_TEST_FIXTURE -ne "1"/.test(line),
 );
 const fixtureBlockIndex = bootstrapLines.findIndex((line) =>
 /^\s*if \(\$Action -eq "test-fixture"\)\s*\{\s*$/.test(line),
 );
 const fixtureInstallerHop = bootstrapLines.findIndex(
 (line, index) => index > fixtureBlockIndex &&
 /^\s*\$installerArgs \+= "-AllowServerForTests"\s*$/.test(line),
 );
 assert.ok(gateIndex >= 0, "bootstrap test-action gate is required");
 assert.ok(fixtureBlockIndex >= 0, "fixture installer block is required");
 assert.ok(
 fixtureInstallerHop > gateIndex,
 "fixture installer allowance must follow the test gate",
 );
});
