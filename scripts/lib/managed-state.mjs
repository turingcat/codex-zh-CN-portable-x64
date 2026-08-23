import fs from "node:fs";
import path from "node:path";

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
  return /^[a-zA-Z]:[\\/]|^\\\\/.test(value) ? path.win32 : path;
}

function normalizedPath(value) {
  const api = pathApi(value);
  return api.normalize(value).replace(/[\\/]+$/, "");
}

function isSaneAbsolutePath(value) {
  if (!isSafeString(value)) return false;
  const api = pathApi(value);
  if (!api.isAbsolute(value)) return false;
  return !value.split(/[\\/]+/).includes("..");
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

export function writeManagedState(statePath, value) {
  const state = validateManagedState(value);
  const temporary = `${statePath}.new`;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, statePath);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
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
