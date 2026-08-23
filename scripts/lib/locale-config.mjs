import fs from "node:fs";
import path from "node:path";

function validateLocaleState(state) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== 1 ||
    typeof state.existed !== "boolean" ||
    typeof state.contentBase64 !== "string" ||
    Buffer.from(state.contentBase64, "base64").toString("base64") !== state.contentBase64 ||
    Object.keys(state).length !== 3 ||
    !["version", "existed", "contentBase64"].every((key) => key in state)
  ) {
    throw new Error("无效的 locale 状态文件。");
  }
  return state;
}

function readLocaleState(statePath) {
  return validateLocaleState(JSON.parse(fs.readFileSync(statePath, "utf8")));
}

export function captureLocaleState(configPath) {
  const existed = fs.existsSync(configPath);
  return {
    version: 1,
    existed,
    contentBase64: existed ? fs.readFileSync(configPath).toString("base64") : "",
  };
}

export function saveLocaleState(statePath, state) {
  const validState = validateLocaleState(state);
  if (fs.existsSync(statePath)) return readLocaleState(statePath);

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  try {
    fs.writeFileSync(statePath, `${JSON.stringify(validState, null, 2)}\n`, {
      flag: "wx",
    });
    return validState;
  } catch (error) {
    if (error.code === "EEXIST") return readLocaleState(statePath);
    throw error;
  }
}

export function applyZhCnLocale(configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const block = `[desktop]\nlocaleOverride = "zh-CN"\n`;
  if (/^\[desktop\]/m.test(content)) {
    if (/localeOverride\s*=/.test(content)) {
      content = content.replace(
        /localeOverride\s*=\s*"[^"]*"/,
        'localeOverride = "zh-CN"',
      );
    } else {
      content = content.replace(/\[desktop\]\s*\n?/, block);
    }
  } else {
    content = `${content.trimEnd()}\n\n${block}`;
  }
  fs.writeFileSync(configPath, content, "utf8");
}

export function restoreLocaleState(configPath, statePath) {
  const state = readLocaleState(statePath);
  if (state.existed) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, Buffer.from(state.contentBase64, "base64"));
    return;
  }
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
}
