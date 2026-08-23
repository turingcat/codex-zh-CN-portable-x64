const KEY_RE = /(["'`])enable_i18n\1/g;
const CALL_RE = /(?:[\w$?]+\.)?get\(\s*(["'`])enable_i18n\1\s*,\s*(false|true|!1|!0)\s*\)/g;

function result(status, buffer, changedCount, recognizedCount, ambiguousCount) {
  return { status, buffer, changedCount, recognizedCount, ambiguousCount };
}

export function patchI18nGateBuffer(buffer) {
  const source = buffer.toString("utf8");
  const keyCount = [...source.matchAll(KEY_RE)].length;
  const matches = [...source.matchAll(CALL_RE)];
  if (keyCount === 0) return result("missing", buffer, 0, 0, 0);
  if (matches.length !== keyCount) {
    return result("ambiguous", buffer, 0, matches.length, keyCount - matches.length);
  }
  const falseCount = matches.filter((match) => match[2] === "false" || match[2] === "!1").length;
  if (falseCount === 0) return result("already-enabled", buffer, 0, matches.length, 0);
  const patched = source.replace(CALL_RE, (full, quote, fallback) => {
    const enabled = fallback === "false" ? "true" : fallback === "!1" ? "!0" : fallback;
    return full.replace(fallback, enabled);
  });
  return result("patched", Buffer.from(patched, "utf8"), falseCount, matches.length, 0);
}

function planResult(status, files, replacements) {
  return {
    status,
    files,
    replacements,
    changedCount: files.reduce((count, file) => count + file.changedCount, 0),
    recognizedCount: files.reduce((count, file) => count + file.recognizedCount, 0),
    ambiguousCount: files.reduce((count, file) => count + file.ambiguousCount, 0),
  };
}

export function planI18nGatePatches(entries) {
  const files = entries
    .filter(({ buffer }) => buffer.includes("enable_i18n"))
    .map(({ path, buffer }) => ({ path, ...patchI18nGateBuffer(buffer) }));
  if (files.length === 0) return planResult("missing", files, []);
  if (files.some(({ status }) => status === "ambiguous")) {
    return planResult("ambiguous", files, []);
  }
  const replacements = files
    .filter(({ status }) => status === "patched")
    .map(({ path, buffer }) => ({ path, buffer }));
  return planResult(replacements.length ? "patched" : "already-enabled", files, replacements);
}
