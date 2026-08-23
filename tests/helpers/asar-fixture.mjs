import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASAR_BLOCK_SIZE = 4 * 1024 * 1024;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function asarIntegrity(buffer) {
  const blocks = [];
  if (buffer.length === 0) {
    blocks.push(sha256(buffer));
  } else {
    for (let offset = 0; offset < buffer.length; offset += ASAR_BLOCK_SIZE) {
      blocks.push(sha256(buffer.subarray(offset, offset + ASAR_BLOCK_SIZE)));
    }
  }
  return {
    algorithm: "SHA256",
    hash: sha256(buffer),
    blockSize: ASAR_BLOCK_SIZE,
    blocks,
  };
}

function encodeAsarHeader(headerString) {
  const headerBytes = Buffer.from(headerString, "utf8");
  const payloadSize = 4 + headerBytes.length + ((4 - ((4 + headerBytes.length) % 4)) % 4);
  const pickleSize = 4 + payloadSize;
  const pickle = Buffer.alloc(pickleSize);
  pickle.writeUInt32LE(payloadSize, 0);
  pickle.writeInt32LE(headerBytes.length, 4);
  headerBytes.copy(pickle, 8);

  const encoded = Buffer.alloc(8 + pickleSize);
  encoded.writeUInt32LE(4, 0);
  encoded.writeUInt32LE(pickleSize, 4);
  pickle.copy(encoded, 8);
  return encoded;
}

function writeAsarFixture(asarPath) {
  const files = new Map([
    [
      ".vite/build/main-fixture.js",
      Buffer.from(
        'const menu=[{label:`File`},{label:`关于 ${n.app.getName()}`},{label:`编辑`,id:"edit"},{label:`撤销`},{label:`最小化`}];flags.get("enable_i18n",false);',
      ),
    ],
    ["native-menu-locales/zh-CN.json", Buffer.from("{}")],
    ["webview/assets/index-fixture.js", Buffer.from('flags.get("enable_i18n",false)')],
    [
      "webview/assets/zh-CN-fixture.js",
      Buffer.from('const messages={"codex.command.settings":"Codex 设置"};export default messages;'),
    ],
  ]);
  const header = { files: {} };
  const body = [];
  let offset = 0;

  for (const [filePath, content] of files) {
    const parts = filePath.split("/");
    let node = header;
    for (const part of parts.slice(0, -1)) {
      node.files[part] ??= { files: {} };
      node = node.files[part];
    }
    node.files[parts.at(-1)] = {
      offset: String(offset),
      size: content.length,
      integrity: asarIntegrity(content),
    };
    body.push(content);
    offset += content.length;
  }

  const headerString = JSON.stringify(header);
  fs.mkdirSync(path.dirname(asarPath), { recursive: true });
  fs.writeFileSync(asarPath, Buffer.concat([encodeAsarHeader(headerString), ...body]));
  return sha256(Buffer.from(headerString, "utf8"));
}

function relativeFixturePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

export function createCodexFixture({ appPath, homePath, manifestPath }) {
  const root = path.dirname(appPath);
  const asarPath = path.join(appPath, "resources", "app.asar");
  const exePath = path.join(appPath, "Codex.exe");
  const configPath = path.join(homePath, ".codex", "config.toml");
  const pluginPath = path.join(
    homePath,
    ".codex",
    "plugins",
    "cache",
    "openai-bundled",
    "browser",
    "1",
    ".codex-plugin",
    "plugin.json",
  );

  const asarHeaderHash = writeAsarFixture(asarPath);
  const exe = Buffer.from(
    `MZ-CODEX-FIXTURE\0{"file":"resources/app.asar","alg":"SHA256","value":"${asarHeaderHash}"}\0`,
    "latin1",
  );
  const config = Buffer.from('\ufeffmodel = "fixture"\r\n', "utf8");
  const plugin = Buffer.from(
    '{"name":"browser","interface":{"displayName":"Browser","shortDescription":"Original"}}\r\n',
    "utf8",
  );

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  fs.writeFileSync(exePath, exe);
  fs.writeFileSync(configPath, config);
  fs.writeFileSync(pluginPath, plugin);

  const trackedFiles = [asarPath, exePath, configPath, pluginPath].sort((left, right) =>
    relativeFixturePath(root, left).localeCompare(relativeFixturePath(root, right)),
  );
  const manifest = {
    version: 1,
    asarHeaderHash,
    sha256: Object.fromEntries(
      trackedFiles.map((filePath) => [
        relativeFixturePath(root, filePath),
        sha256(fs.readFileSync(filePath)),
      ]),
    ),
  };

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 2; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!["--app", "--home", "--manifest"].includes(name) || !value) {
      throw new Error("Usage: asar-fixture.mjs --app PATH --home PATH --manifest PATH");
    }
    values[name] = path.resolve(value);
  }
  if (!values["--app"] || !values["--home"] || !values["--manifest"]) {
    throw new Error("Usage: asar-fixture.mjs --app PATH --home PATH --manifest PATH");
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv);
    createCodexFixture({
      appPath: args["--app"],
      homePath: args["--home"],
      manifestPath: args["--manifest"],
    });
  } catch (error) {
    console.error(`[fixture-error] ${error.message}`);
    process.exitCode = 1;
  }
}
