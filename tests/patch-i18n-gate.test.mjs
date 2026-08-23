import assert from "node:assert/strict";
import test from "node:test";
import {
  patchI18nGateBuffer,
  planI18nGatePatches,
} from "../scripts/lib/patch-i18n-gate.mjs";

test("changes only a recognized minified false fallback", () => {
  const input = Buffer.from('const enabled=n?.get(`enable_i18n`,!1);const other=!1;');
  const result = patchI18nGateBuffer(input);
  assert.equal(result.status, "patched");
  assert.equal(result.changedCount, 1);
  assert.match(result.buffer.toString(), /enable_i18n`,!0/);
  assert.match(result.buffer.toString(), /other=!1/);
});

test("accepts a recognized true fallback without rewriting", () => {
  const input = Buffer.from('flags.get("enable_i18n", true)');
  const result = patchI18nGateBuffer(input);
  assert.equal(result.status, "already-enabled");
  assert.equal(result.changedCount, 0);
  assert.equal(result.buffer.equals(input), true);
});

test("reports missing when the key is absent", () => {
  assert.equal(patchI18nGateBuffer(Buffer.from("const x=false")).status, "missing");
});

test("reports ambiguous and keeps bytes when fallback is dynamic", () => {
  const input = Buffer.from('flags.get("enable_i18n", defaults.i18n)');
  const result = patchI18nGateBuffer(input);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.buffer.equals(input), true);
});

test("reports ambiguous when any raw key occurrence is not a recognized call", () => {
  const input = Buffer.from('f.get("enable_i18n", false);const key="enable_i18n";');
  const result = patchI18nGateBuffer(input);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.changedCount, 0);
  assert.equal(result.ambiguousCount, 1);
  assert.equal(result.buffer.equals(input), true);
});

test("refuses every file when one file is ambiguous", () => {
  const entries = [
    { path: "webview/a.js", buffer: Buffer.from('f.get("enable_i18n",false)') },
    { path: "webview/b.js", buffer: Buffer.from('f.get("enable_i18n",value)') },
  ];
  const plan = planI18nGatePatches(entries);
  assert.equal(plan.status, "ambiguous");
  assert.deepEqual(plan.replacements, []);
  assert.equal(plan.files.length, 2);
  assert.equal(plan.files[1].buffer.equals(entries[1].buffer), true);
});

test("patches every recognized false fallback across files", () => {
  const entries = [
    { path: "webview/a.js", buffer: Buffer.from('f.get("enable_i18n",false)') },
    { path: "webview/b.js", buffer: Buffer.from('f.get(`enable_i18n`,!1)') },
  ];
  const plan = planI18nGatePatches(entries);
  assert.equal(plan.status, "patched");
  assert.equal(plan.changedCount, 2);
  assert.equal(plan.replacements.length, 2);
  assert.match(plan.replacements[0].buffer.toString(), /enable_i18n",true/);
  assert.match(plan.replacements[1].buffer.toString(), /enable_i18n`,!0/);
});

test("ignores files without the key and reports missing when none contain it", () => {
  const plan = planI18nGatePatches([
    { path: "webview/a.js", buffer: Buffer.from("const x=false") },
  ]);
  assert.equal(plan.status, "missing");
  assert.deepEqual(plan.files, []);
  assert.deepEqual(plan.replacements, []);
});

test("reports already-enabled when all files use recognized true fallbacks", () => {
  const plan = planI18nGatePatches([
    { path: "webview/a.js", buffer: Buffer.from('f.get("enable_i18n",true)') },
    { path: "webview/b.js", buffer: Buffer.from("get(`enable_i18n`,!0)") },
  ]);
  assert.equal(plan.status, "already-enabled");
  assert.equal(plan.changedCount, 0);
  assert.deepEqual(plan.replacements, []);
});
