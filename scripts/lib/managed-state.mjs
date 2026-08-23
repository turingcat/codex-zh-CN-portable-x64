import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STATE_KEYS = [
  "version",
  "patchVersion",
  "mode",
  "sourceApp",
  "sourceIdentity",
  "patchedApp",
  "backupRoot",
  "localeStatePath",
];
const MODES = new Set(["in-place", "store-copy"]);

function invalidState() {
  return new Error("无效的托管状态文件。");
}

function isSafeString(value) {
  return typeof value === "string" && value.length > 0 && !/[\0\r\n]/.test(value);
}

function pathApi(value) {
  return /^[a-zA-Z]:/.test(value) ? path.win32 : path;
}

function normalizedPath(value) {
  const api = pathApi(value);
  return api.normalize(value).replace(/[\\/]+$/, "");
}

function isSaneAbsolutePath(value) {
  if (!isSafeString(value)) return false;
  const api = pathApi(value);
  if (api === path.win32) {
    if (!/^[A-Za-z]:\\/.test(value) || value.includes("/") || value.indexOf(":", 2) !== -1) {
      return false;
    }
    if (path.win32.normalize(value) !== value) return false;
    return value
      .slice(3)
      .split("\\")
      .every(
        (component) =>
          component &&
          component !== "." &&
          component !== ".." &&
          !/[. ]$/.test(component) &&
          !/~\d+(?:\.|$)/i.test(component) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component),
      );
  }
  if (!api.isAbsolute(value) || path.normalize(value) !== value) return false;
  return value.split("/").every((component) => component !== "." && component !== "..");
}

function isPathWithin(parent, child) {
  const parentApi = pathApi(parent);
  const childApi = pathApi(child);
  if (parentApi !== childApi) return false;
  const relative = parentApi.relative(normalizedPath(parent), normalizedPath(child));
  return relative !== "" && !relative.startsWith("..") && !parentApi.isAbsolute(relative);
}

export function validateManagedState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidState();
  const keys = Object.keys(value).sort();
  if (
    keys.length !== STATE_KEYS.length ||
    !STATE_KEYS.every((key) => keys.includes(key)) ||
    value.version !== 1 ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.patchVersion) ||
    !MODES.has(value.mode) ||
    !isSaneAbsolutePath(value.sourceApp) ||
    !isSafeString(value.sourceIdentity) ||
    /[\\/]/.test(value.sourceIdentity) ||
    value.sourceIdentity === "." ||
    value.sourceIdentity === ".." ||
    !isSaneAbsolutePath(value.patchedApp) ||
    !isSaneAbsolutePath(value.backupRoot) ||
    !isSaneAbsolutePath(value.localeStatePath) ||
    pathApi(value.backupRoot).basename(value.localeStatePath) !== "locale-state.json" ||
    !isPathWithin(value.backupRoot, value.localeStatePath)
  ) {
    throw invalidState();
  }
  return value;
}

export function readManagedState(statePath) {
  try {
    return validateManagedState(JSON.parse(fs.readFileSync(statePath, "utf8")));
  } catch {
    throw invalidState();
  }
}

function assertDirectoryIsNotLink(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalidState();
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export function writeManagedState(statePath, value, options = {}) {
  const state = validateManagedState(value);
  if (options.onFailure !== undefined && typeof options.onFailure !== "function") {
    throw new TypeError("onFailure must be a function.");
  }
  const parent = path.dirname(statePath);
  const temporary = `${statePath}.${crypto.randomUUID()}.new`;
  let descriptor;
  let ownedIdentity;
  try {
    fs.mkdirSync(parent, { recursive: true });
    assertDirectoryIsNotLink(parent);
    descriptor = fs.openSync(temporary, "wx", 0o600);
    ownedIdentity = fs.fstatSync(descriptor);
    if (!ownedIdentity.isFile()) throw invalidState();
    fs.writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const temporaryStat = fs.lstatSync(temporary);
    if (
      !temporaryStat.isFile() ||
      temporaryStat.isSymbolicLink() ||
      !sameFileIdentity(temporaryStat, ownedIdentity)
    ) {
      throw invalidState();
    }
    fs.renameSync(temporary, statePath);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        error.cleanupError = closeError;
      }
    }
    try {
      const temporaryStat = fs.lstatSync(temporary);
      if (
        ownedIdentity &&
        temporaryStat.isFile() &&
        !temporaryStat.isSymbolicLink() &&
        sameFileIdentity(temporaryStat, ownedIdentity)
      ) {
        fs.unlinkSync(temporary);
      }
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT" && !error.cleanupError) {
        error.cleanupError = cleanupError;
      }
    }
    if (options.onFailure) {
      try {
        options.onFailure(error);
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  }
  return state;
}

export function compareSourceIdentity(state, currentIdentity) {
  validateManagedState(state);
  const current =
    state.mode !== "store-copy" ||
    (isSafeString(currentIdentity) && currentIdentity === state.sourceIdentity);
  return { current, stale: !current };
}

export function isManagedPathWithin(parent, child) {
  return isSaneAbsolutePath(parent) && isSaneAbsolutePath(child) && isPathWithin(parent, child);
}

export function isExistingManagedPathWithin(parent, child, allowEqual = false) {
  if (
    !isSaneAbsolutePath(parent) ||
    !isSaneAbsolutePath(child) ||
    (!allowEqual && !isPathWithin(parent, child))
  ) {
    return false;
  }
  try {
    const parentStat = fs.lstatSync(parent);
    const childStat = fs.lstatSync(child);
    if (
      !parentStat.isDirectory() ||
      parentStat.isSymbolicLink() ||
      childStat.isSymbolicLink()
    ) {
      return false;
    }
    const parentReal = fs.realpathSync.native(parent);
    const childReal = fs.realpathSync.native(child);
    const api = pathApi(parentReal);
    if (api !== pathApi(childReal)) return false;
    const relative = api.relative(parentReal, childReal);
    return (
      (allowEqual && relative === "") ||
      (relative !== "" && !relative.startsWith("..") && !api.isAbsolute(relative))
    );
  } catch {
    return false;
  }
}

export function isSafeManagedFileDestination(root, destination) {
  if (!isManagedPathWithin(root, destination)) return false;
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    const rootReal = fs.realpathSync.native(root);
    const api = pathApi(rootReal);
    if (api !== pathApi(destination)) return false;
    const relative = api.relative(root, destination);
    if (!relative || relative.startsWith("..") || api.isAbsolute(relative)) return false;

    const parts = relative.split(api.sep).filter(Boolean);
    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      current = api.join(current, parts[index]);
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code === "ENOENT") break;
        throw error;
      }
      if (stat.isSymbolicLink()) return false;
      const isDestination = index === parts.length - 1;
      if ((!isDestination && !stat.isDirectory()) || (isDestination && !stat.isFile())) {
        return false;
      }
      const currentReal = fs.realpathSync.native(current);
      const resolvedRelative = api.relative(rootReal, currentReal);
      if (
        !resolvedRelative ||
        resolvedRelative.startsWith("..") ||
        api.isAbsolute(resolvedRelative)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
