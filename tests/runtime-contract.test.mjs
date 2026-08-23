import assert from "node:assert/strict";
import fs from "node:fs";
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
  assert.match(bootstrap, /Get-FileHash/);
  assert.match(bootstrap, /PROCESSOR_ARCHITECTURE/);
  assert.match(bootstrap, /Expand-Archive/);
  assert.match(bootstrap, /& \$nodePath --version/);
  assert.match(bootstrap, /"-NodePath", \$nodePath/);
  assert.doesNotMatch(bootstrap, /Invoke-WebRequest|Start-BitsTransfer/);
});

test("passes only the verified absolute bundled Node path to the installer", () => {
  const installer = read("scripts/install_windows.ps1");

  assert.match(installer, /\[Parameter\(Mandatory = \$true\)\]\s*\[string\]\$NodePath/);
  assert.match(installer, /Test-Path -LiteralPath \$NodePath -PathType Leaf/);
  assert.match(installer, /function ConvertTo-NativeArgument/);
  assert.match(installer, /"-NodePath", \(ConvertTo-NativeArgument \$NodePath\)/);
  assert.match(installer, /& \$NodePath @argsList/);
  assert.doesNotMatch(installer, /Get-Command node/);
  assert.doesNotMatch(installer, /& node\b/);
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
