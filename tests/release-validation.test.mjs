import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateRelease } from "../scripts/validate-release.mjs";

test("reports all missing release artifacts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "release-validation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const result = await validateRelease(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /node-v24\.19\.0-win-x64\.zip/);
  assert.match(result.errors.join("\n"), /THIRD_PARTY_NOTICES\.md/);
  assert.match(result.errors.join("\n"), /docs\/windows-acceptance\.md/);
  assert.match(result.errors.join("\n"), /package\.json/);
  assert.match(result.errors.join("\n"), /scripts\/release-files\.mjs/);
});

test("validates the complete offline release tree", async () => {
  const result = await validateRelease(process.cwd());

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(
    result.runtimeHash,
    "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
  );
});
