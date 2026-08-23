import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME = {
  version: "v24.19.0",
  architecture: "x64",
  archive: "node-v24.19.0-win-x64.zip",
  extractedDirectory: "node-v24.19.0-win-x64",
  executable: "node.exe",
  sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
};

const UPSTREAM_COMMIT = "0e39c30a381c712c16e49c8e72c8eca40c3b2299";

const REQUIRED_FILES = [
  "install-windows.bat",
  "status-windows.bat",
  "restore-windows.bat",
  "uninstall-codex.bat",
  "runtime/runtime.json",
  `runtime/${RUNTIME.archive}`,
  "runtime/SHASUMS256.txt",
  "runtime/NODE-LICENSE.txt",
  "UPSTREAM_COMMIT",
  "UPSTREAM-LICENSE",
  "LICENSE",
  "UPSTREAM.md",
  "THIRD_PARTY_NOTICES.md",
  "README.md",
  "resources/native-menu-zh-CN.json",
  "resources/menu-hardcoded-zh-CN.json",
  "resources/bundled-plugins-zh-CN.json",
  "scripts/bootstrap_windows.ps1",
  "scripts/install_windows.ps1",
  "scripts/runtime-contract.ps1",
  "scripts/patch-codex-zh-cn.mjs",
  "scripts/verify-patch.mjs",
  "scripts/uninstall-codex-store.ps1",
  "scripts/package-release.ps1",
];

async function isFile(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function readUtf8(file, errors) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    errors.push(`Unable to read ${file}: ${error.message}`);
    return null;
  }
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  const handle = await fs.open(file, "r");

  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) hash.update(chunk);
  } finally {
    await handle.close();
  }

  return hash.digest("hex");
}

export async function validateRelease(root) {
  const errors = [];
  const missing = new Set();
  const files = Object.fromEntries(REQUIRED_FILES.map((file) => [file, path.join(root, file)]));

  for (const [relativePath, file] of Object.entries(files)) {
    if (!(await isFile(file))) {
      missing.add(relativePath);
      errors.push(`Missing release file: ${relativePath}`);
    }
  }

  let manifest = null;
  if (!missing.has("runtime/runtime.json")) {
    const manifestText = await readUtf8(files["runtime/runtime.json"], errors);
    if (manifestText !== null) {
      try {
        manifest = JSON.parse(manifestText);
      } catch (error) {
        errors.push(`Invalid runtime manifest: ${error.message}`);
      }
    }
  }

  if (manifest) {
    for (const [key, value] of Object.entries(RUNTIME)) {
      if (manifest[key] !== value) {
        errors.push(`Runtime manifest ${key} must be ${JSON.stringify(value)}`);
      }
    }
  }

  let runtimeHash = null;
  const archivePath = files[`runtime/${RUNTIME.archive}`];
  if (!missing.has(`runtime/${RUNTIME.archive}`)) {
    runtimeHash = await sha256File(archivePath);
    if (runtimeHash !== RUNTIME.sha256) {
      errors.push(`Bundled Node.js checksum mismatch: expected ${RUNTIME.sha256}, got ${runtimeHash}`);
    }
  }

  if (!missing.has("runtime/SHASUMS256.txt")) {
    const shasums = await readUtf8(files["runtime/SHASUMS256.txt"], errors);
    const expectedLine = `${RUNTIME.sha256}  ${RUNTIME.archive}`;
    if (shasums !== null && !shasums.split(/\r?\n/).includes(expectedLine)) {
      errors.push(`SHASUMS256.txt does not contain ${expectedLine}`);
    }
  }

  if (!missing.has("UPSTREAM_COMMIT")) {
    const commit = await readUtf8(files.UPSTREAM_COMMIT, errors);
    if (commit !== null && commit.trim() !== UPSTREAM_COMMIT) {
      errors.push(`UPSTREAM_COMMIT must be ${UPSTREAM_COMMIT}`);
    }
  }

  if (!missing.has("UPSTREAM-LICENSE") && !missing.has("LICENSE")) {
    const [upstreamLicense, localLicense] = await Promise.all([
      readUtf8(files["UPSTREAM-LICENSE"], errors),
      readUtf8(files.LICENSE, errors),
    ]);
    if (upstreamLicense !== null && localLicense !== null && upstreamLicense !== localLicense) {
      errors.push("UPSTREAM-LICENSE must match the imported upstream LICENSE");
    }
  }

  return { ok: errors.length === 0, errors, runtimeHash };
}

async function main() {
  const result = await validateRelease(process.cwd());
  if (!result.ok) {
    for (const error of result.errors) console.error(`[ERROR] ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[OK] release layout/hash ${result.runtimeHash}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
