import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const installerPath = path.join(process.cwd(), "scripts", "install_windows.ps1");

test("PowerShell status contract retains the Node status and exits with it", () => {
  const installer = fs.readFileSync(installerPath, "utf8");

  assert.match(installer, /\$statusExitCode\s*=\s*\$LASTEXITCODE/);
  assert.match(installer, /statusExitCode/);
  assert.match(installer, /"status"\s*\{[\s\S]*exit\s+\(\[int\]\$report\.statusExitCode\)/);
  assert.match(installer, /--store-source-identity/);
  assert.match(installer, /__CODEX_STORE_IDENTITY_UNAVAILABLE__/);
});

test("PowerShell status prints managed health fields and propagates exit code two", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows status runtime case requires Windows PowerShell; host is not Windows");
    return;
  }

  const probe = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "$PSVersionTable.PSVersion.Major",
  ]);
  if (probe.error?.code === "ENOENT") {
    t.skip("Windows PowerShell is not installed");
    return;
  }
  assert.equal(probe.status, 0, probe.stderr?.toString());

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "windows-status-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nodeStubPath = path.join(root, "status-stub.mjs");
  const harnessPath = path.join(root, "status-harness.ps1");
  fs.writeFileSync(
    nodeStubPath,
    `const args = process.argv.slice(2);\nconst identityAt = args.indexOf("--store-source-identity");\nconst current = identityAt >= 0 ? args[identityAt + 1] : null;\nconsole.log(JSON.stringify({ok:false,nodeOk:true,nodeVersion:process.version,runtime:{trusted:true,healthy:true},managedState:true,managedStateError:null,mode:"store-copy",sourceIdentity:"OpenAI.Codex_previous",sourceCurrent:current,stale:true,codexFound:true,codexPath:"C:\\\\managed\\\\app",codexRunning:false,target:{app:"C:\\\\managed\\\\app",healthy:false},targetHealthy:false,asarPath:"C:\\\\managed\\\\app\\\\resources\\\\app.asar",exePath:"C:\\\\managed\\\\app\\\\Codex.exe",asarLocalized:true,i18nGateStatus:"already-enabled",i18nGateChanged:1,i18nGateRecognized:1,i18nGateAmbiguous:0,i18nGateFiles:[{path:"main.js",status:"already-enabled"}],i18nGateEnabled:true,executableIntegrity:false,localeOverride:"zh-CN",localeZhCn:true,localeBackup:true,localeRestorable:true,pluginsLocalized:1,pluginsTotal:1,pluginsHealthy:true,plugins:[],launcherPath:"C:\\\\bundle\\\\Codex 汉化版.bat",launcherTarget:"C:\\\\managed\\\\app",launcherTargetContained:true,launcherAvailable:true,rollbackAvailable:true,patchInstalled:false,readyToInstall:false,messages:[]}));\nprocess.exitCode = 2;\n`,
    "utf8",
  );
  const escapedInstaller = installerPath.replaceAll("'", "''");
  const escapedNode = process.execPath.replaceAll("'", "''");
  const escapedStub = nodeStubPath.replaceAll("'", "''");
  fs.writeFileSync(
    harnessPath,
    `$ErrorActionPreference = 'Stop'\n$tokens = $null\n$errors = $null\n$ast = [System.Management.Automation.Language.Parser]::ParseFile('${escapedInstaller}', [ref]$tokens, [ref]$errors)\nforeach ($name in @('Get-StatusReport', 'Show-StatusReport')) {\n  $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)\n  Invoke-Expression $definition.Extent.Text\n}\nfunction Test-NodeAvailable { return $true }\nfunction Get-AppxPackage { return [pscustomobject]@{ Version = [version]'2.0.0.0'; InstallLocation = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_current' } }\nfunction Write-Ok([string]$Message) { Write-Output "OK: $Message" }\nfunction Write-Bad([string]$Message) { Write-Output "BAD: $Message" }\nfunction Write-WarnLine([string]$Message) { Write-Output "WARN: $Message" }\nfunction Write-InfoLine([string]$Message) { Write-Output "INFO: $Message" }\n$patchScript = '${escapedStub}'\n$NodePath = '${escapedNode}'\n$report = Get-StatusReport\nShow-StatusReport -Report $report\nexit ([int]$report.statusExitCode)\n`,
    "utf8",
  );

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harnessPath],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2, result.stderr + result.stdout);
  assert.match(result.stdout, /OpenAI\.Codex_previous/);
  assert.match(result.stdout, /OpenAI\.Codex_current/);
  assert.match(result.stdout, /store-copy/);
  assert.match(result.stdout, /main\.js/);
  assert.match(result.stdout, /Codex\.exe/);
  assert.match(result.stdout, /zh-CN/);
  assert.match(result.stdout, /1\/1/);
  assert.match(result.stdout, /Codex 汉化版\.bat/);
});
