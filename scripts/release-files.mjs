import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_FILES = [
  "install-windows.bat",
  "status-windows.bat",
  "restore-windows.bat",
  "uninstall-codex.bat",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "UPSTREAM-LICENSE",
  "UPSTREAM.md",
  "UPSTREAM_COMMIT",
  "package.json",
];
const ROOT_DIRECTORIES = ["docs", "launchers", "resources", "runtime", "scripts"];
const EXCLUDED_PREFIXES = ["docs/superpowers/", "runtime/expanded/"];

function relativeName(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isExcluded(relativePath) {
  return EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function walk(root, directory, output) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    const relativePath = relativeName(root, filePath);
    if (isExcluded(`${relativePath}${entry.isDirectory() ? "/" : ""}`) || entry.name === ".DS_Store") {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Release input must not contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      walk(root, filePath, output);
    } else if (entry.isFile()) {
      output.push(relativePath);
    }
  }
}

export function collectReleaseFiles(rootPath) {
  const root = path.resolve(rootPath);
  const files = [];

  for (const relativePath of ROOT_FILES) {
    const filePath = path.join(root, relativePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      files.push(relativePath);
    }
  }
  for (const relativePath of ROOT_DIRECTORIES) {
    const directory = path.join(root, relativePath);
    if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) {
      walk(root, directory, files);
    }
  }

  return files.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(collectReleaseFiles(process.argv[2] ?? process.cwd())));
  } catch (error) {
    console.error(`[release-files-error] ${error.message}`);
    process.exitCode = 1;
  }
}
