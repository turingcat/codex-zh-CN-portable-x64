import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateRelease } from "../scripts/validate-release.mjs";

test("rejects parseable non-object runtime manifests", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "release-validation-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "runtime"), { recursive: true });

  for (const [name, contents] of [
    ["null", "null"],
    ["false", "false"],
    ["zero", "0"],
    ["string", '"runtime"'],
    ["array", "[]"],
  ]) {
    await t.test(name, async () => {
      await fs.writeFile(path.join(root, "runtime", "runtime.json"), contents);

      const result = await validateRelease(root);

      assert.equal(result.ok, false);
      assert.match(
        result.errors.join("\n"),
        /Runtime manifest must be a non-null, non-array JSON object/,
      );
    });
  }
});
