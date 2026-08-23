import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  activateStagedCore,
  prepareStagedCore,
  rollbackActivatedCore,
} from "../scripts/lib/core-file-transaction.mjs";

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-core-transaction-"));
  const app = path.join(root, "Codex");
  const resources = path.join(app, "resources");
  const stageRoot = path.join(root, "stage");
  const backupRoot = path.join(root, "backup");
  const asarPath = path.join(resources, "app.asar");
  const exePath = path.join(app, "Codex.exe");
  fs.mkdirSync(resources, { recursive: true });
  fs.writeFileSync(asarPath, "original-asar");
  fs.writeFileSync(exePath, "original-exe");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { asarPath, backupRoot, exePath, root, stageRoot };
}

test("patches staged copies without changing active files", (t) => {
  const fixture = createFixture(t);
  const transaction = prepareStagedCore(fixture);

  fs.writeFileSync(transaction.stagedAsarPath, "patched-asar");
  fs.writeFileSync(transaction.stagedExePath, "patched-exe");

  assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "original-exe");
  assert.equal(fs.readFileSync(transaction.backupAsarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(transaction.backupExePath, "utf8"), "original-exe");
});

test("refuses activation when either staged core file is missing", (t) => {
  const fixture = createFixture(t);
  for (const [property, message] of [
    ["stagedAsarPath", /staged app\.asar is missing/],
    ["stagedExePath", /staged executable is missing/],
  ]) {
    const transaction = prepareStagedCore(fixture);
    fs.unlinkSync(transaction[property]);

    assert.throws(() => activateStagedCore(transaction), message);
    assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "original-asar");
    assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "original-exe");
  }
});

test("activates both files and can roll them back", (t) => {
  const fixture = createFixture(t);
  const transaction = prepareStagedCore(fixture);
  fs.writeFileSync(transaction.stagedAsarPath, "patched-asar");
  fs.writeFileSync(transaction.stagedExePath, "patched-exe");

  activateStagedCore(transaction);
  assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "patched-asar");
  assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "patched-exe");

  rollbackActivatedCore(transaction);
  assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "original-exe");
});

test("fails closed when exactly one backup core file already exists", (t) => {
  const fixture = createFixture(t);
  fs.mkdirSync(fixture.backupRoot, { recursive: true });
  fs.writeFileSync(path.join(fixture.backupRoot, "app.asar"), "partial-backup");

  assert.throws(() => prepareStagedCore(fixture), /partial core backup pair/);
  assert.equal(fs.existsSync(fixture.stageRoot), false);
  assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "original-exe");
});

test("preserves the first complete backup pair on later staging", (t) => {
  const fixture = createFixture(t);
  fs.mkdirSync(fixture.backupRoot, { recursive: true });
  fs.writeFileSync(path.join(fixture.backupRoot, "app.asar"), "first-asar-backup");
  fs.writeFileSync(path.join(fixture.backupRoot, "Codex.exe"), "first-exe-backup");

  const transaction = prepareStagedCore(fixture);

  assert.equal(fs.readFileSync(transaction.backupAsarPath, "utf8"), "first-asar-backup");
  assert.equal(fs.readFileSync(transaction.backupExePath, "utf8"), "first-exe-backup");
  assert.equal(fs.readFileSync(transaction.stagedAsarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(transaction.stagedExePath, "utf8"), "original-exe");
});

test("rejects staging paths that collide with active core files", (t) => {
  const fixture = createFixture(t);

  assert.throws(
    () => prepareStagedCore({ ...fixture, stageRoot: path.dirname(fixture.asarPath) }),
    /path collision/,
  );
  assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "original-exe");
});

test("restores both active files when executable activation fails", (t) => {
  const fixture = createFixture(t);
  const transaction = prepareStagedCore(fixture);
  fs.writeFileSync(transaction.stagedAsarPath, "patched-asar");
  fs.writeFileSync(transaction.stagedExePath, "patched-exe");
  const exeNewPath = path.join(path.dirname(fixture.exePath), "Codex.exe.zhcn-new");
  const swapPaths = [
    path.join(path.dirname(fixture.asarPath), "app.asar.zhcn-new"),
    path.join(path.dirname(fixture.asarPath), "app.asar.zhcn-old"),
    exeNewPath,
    path.join(path.dirname(fixture.exePath), "Codex.exe.zhcn-old"),
  ];
  const renameSync = fs.renameSync;
  let failOnce = true;
  fs.renameSync = (from, to) => {
    if (failOnce && from === exeNewPath && to === fixture.exePath) {
      failOnce = false;
      throw new Error("forced executable activation failure");
    }
    return renameSync(from, to);
  };
  t.after(() => {
    fs.renameSync = renameSync;
  });

  assert.throws(() => activateStagedCore(transaction), /forced executable activation failure/);
  assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "original-exe");
  for (const swapPath of swapPaths) assert.equal(fs.existsSync(swapPath), false);
});

test("removes every owned backup artifact when publishing the executable backup fails", (t) => {
  const fixture = createFixture(t);
  const copyFileSync = fs.copyFileSync;
  const backupExePath = path.join(fixture.backupRoot, "Codex.exe");
  fs.copyFileSync = (from, to, flags) => {
    if (to === backupExePath) throw new Error("forced executable backup publish failure");
    return copyFileSync(from, to, flags);
  };
  t.after(() => {
    fs.copyFileSync = copyFileSync;
  });

  assert.throws(() => prepareStagedCore(fixture), /forced executable backup publish failure/);
  assert.equal(fs.existsSync(path.join(fixture.backupRoot, "app.asar")), false);
  assert.equal(fs.existsSync(backupExePath), false);
  assert.deepEqual(fs.readdirSync(fixture.backupRoot), []);
});

test("preserves rescue artifacts when rollback restoration fails", (t) => {
  const fixture = createFixture(t);
  const transaction = prepareStagedCore(fixture);
  fs.writeFileSync(transaction.stagedAsarPath, "patched-asar");
  fs.writeFileSync(transaction.stagedExePath, "patched-exe");
  const asarNewPath = path.join(path.dirname(fixture.asarPath), "app.asar.zhcn-new");
  const asarOldPath = path.join(path.dirname(fixture.asarPath), "app.asar.zhcn-old");
  const exeNewPath = path.join(path.dirname(fixture.exePath), "Codex.exe.zhcn-new");
  const renameSync = fs.renameSync;
  let asarInstallCount = 0;
  let failExecutableActivation = true;
  fs.renameSync = (from, to) => {
    if (from === asarNewPath && to === fixture.asarPath) {
      asarInstallCount += 1;
      if (asarInstallCount === 2) throw new Error("forced ASAR restore failure");
    }
    if (failExecutableActivation && from === exeNewPath && to === fixture.exePath) {
      failExecutableActivation = false;
      throw new Error("forced executable activation failure");
    }
    return renameSync(from, to);
  };
  t.after(() => {
    fs.renameSync = renameSync;
  });

  let error;
  try {
    activateStagedCore(transaction);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.match(error.message, /forced executable activation failure/);
  assert.match(error.rollbackError.message, /forced ASAR restore failure/);
  assert.equal(fs.existsSync(fixture.asarPath), false);
  assert.equal(fs.readFileSync(asarOldPath, "utf8"), "patched-asar");
});

test("rejects a concurrent transaction lock without touching active files", (t) => {
  const fixture = createFixture(t);
  const transaction = prepareStagedCore(fixture);
  const lockPath = path.join(path.dirname(fixture.asarPath), "app.asar.zhcn-lock");
  fs.writeFileSync(lockPath, "other transaction");
  const renameSync = fs.renameSync;
  let renameCount = 0;
  fs.renameSync = (...args) => {
    renameCount += 1;
    return renameSync(...args);
  };
  t.after(() => {
    fs.renameSync = renameSync;
  });

  assert.throws(() => activateStagedCore(transaction), /lock.*already held/i);
  assert.equal(renameCount, 0);
  assert.equal(fs.readFileSync(lockPath, "utf8"), "other transaction");
  assert.equal(fs.readFileSync(fixture.asarPath, "utf8"), "original-asar");
  assert.equal(fs.readFileSync(fixture.exePath, "utf8"), "original-exe");
});

test("attaches cleanup failure without masking activation failure", (t) => {
  const fixture = createFixture(t);
  const transaction = prepareStagedCore(fixture);
  const exeNewPath = path.join(path.dirname(fixture.exePath), "Codex.exe.zhcn-new");
  const asarLockPath = path.join(path.dirname(fixture.asarPath), "app.asar.zhcn-lock");
  const renameSync = fs.renameSync;
  const unlinkSync = fs.unlinkSync;
  fs.renameSync = (from, to) => {
    if (from === exeNewPath && to === fixture.exePath) {
      throw new Error("forced executable activation failure");
    }
    return renameSync(from, to);
  };
  fs.unlinkSync = (filePath) => {
    if (filePath === asarLockPath) throw new Error("forced lock cleanup failure");
    return unlinkSync(filePath);
  };
  t.after(() => {
    fs.renameSync = renameSync;
    fs.unlinkSync = unlinkSync;
  });

  let error;
  try {
    activateStagedCore(transaction);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.match(error.message, /forced executable activation failure/);
  assert.ok(error.cleanupError);
  assert.match(error.cleanupError.message, /forced lock cleanup failure/);
});
