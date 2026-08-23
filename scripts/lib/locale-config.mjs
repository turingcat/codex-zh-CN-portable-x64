import fs from "node:fs";
import path from "node:path";
import { isSafeManagedFileDestination } from "./managed-state.mjs";

function validateLocaleState(state) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== 1 ||
    typeof state.existed !== "boolean" ||
    typeof state.contentBase64 !== "string" ||
    (!state.existed && state.contentBase64 !== "") ||
    Buffer.from(state.contentBase64, "base64").toString("base64") !== state.contentBase64 ||
    Object.keys(state).length !== 3 ||
    !["version", "existed", "contentBase64"].every((key) => key in state)
  ) {
    throw new Error("无效的 locale 状态文件。");
  }
  return state;
}

export function readLocaleState(statePath) {
  return validateLocaleState(JSON.parse(fs.readFileSync(statePath, "utf8")));
}

function getNewline(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function desktopLocaleBlock(newline) {
  return `[desktop]${newline}localeOverride = "zh-CN"${newline}`;
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
  const newline = getNewline(content);
  const sections = [...content.matchAll(/^[\t ]*\[([^\]\r\n]+)\][\t ]*(?:#.*)?\r?$/gm)];
  const desktops = sections.filter((section) => section[1] === "desktop");
  if (desktops.length > 1) {
    throw new Error("检测到多个 [desktop] 配置段，拒绝修改语言配置。");
  }
  if (desktops.length === 0) {
    const block = desktopLocaleBlock(newline);
    content = content === ""
      ? block
      : `${content}${content.endsWith("\n") ? newline : `${newline}${newline}`}${block}`;
  } else {
    const desktop = desktops[0];
    const headerStart = desktop.index;
    const headerEnd = (() => {
      const newlineIndex = content.indexOf("\n", headerStart);
      return newlineIndex < 0 ? content.length : newlineIndex + 1;
    })();
    const sectionIndex = sections.indexOf(desktop);
    const sectionEnd = sectionIndex + 1 < sections.length
      ? sections[sectionIndex + 1].index
      : content.length;
    const localeOverrides = [
      ...content.slice(headerEnd, sectionEnd).matchAll(/^[\t ]*localeOverride[\t ]*=/gm),
    ];
    if (localeOverrides.length > 1) {
      throw new Error("检测到多个 localeOverride 配置项，拒绝修改语言配置。");
    }
    if (localeOverrides.length === 0) {
      const headerHasNewline = headerEnd > headerStart && content[headerEnd - 1] === "\n";
      const insertion = `${headerHasNewline ? "" : newline}localeOverride = "zh-CN"${newline}`;
      content = `${content.slice(0, headerEnd)}${insertion}${content.slice(headerEnd)}`;
    } else {
      const localeOverride = localeOverrides[0];
      const lineStart = headerEnd + localeOverride.index;
      const lineEnd = content.indexOf("\n", lineStart);
      const valueEnd = lineEnd < 0
        ? content.length
        : lineEnd - (content[lineEnd - 1] === "\r" ? 1 : 0);
      content = `${content.slice(0, lineStart)}${localeOverride[0]} "zh-CN"${content.slice(valueEnd)}`;
    }
  }
  fs.writeFileSync(configPath, content, "utf8");
}

export function restoreLocaleState(configPath, statePath, managedRoot = path.dirname(configPath)) {
  const state = readLocaleState(statePath);
  if (!isSafeManagedFileDestination(managedRoot, configPath)) {
    throw new Error(`locale 恢复目标包含重解析点、符号链接或逃逸安全目录: ${configPath}`);
  }
  if (state.existed) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (!isSafeManagedFileDestination(managedRoot, configPath)) {
      throw new Error(`locale 恢复目标包含重解析点、符号链接或逃逸安全目录: ${configPath}`);
    }
    fs.writeFileSync(configPath, Buffer.from(state.contentBase64, "base64"));
    return;
  }
  if (!fs.existsSync(configPath)) return;
  const current = fs.readFileSync(configPath);
  const managed = Buffer.from(desktopLocaleBlock("\n"), "utf8");
  if (!current.equals(managed)) {
    throw new Error("托管配置已被修改，拒绝删除语言配置。");
  }
  fs.unlinkSync(configPath);
}
