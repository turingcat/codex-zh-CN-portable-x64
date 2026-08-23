import fs from "node:fs";
import path from "node:path";

function resolveRequiredPath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty path.`);
  }
  return path.resolve(value);
}

function assertDistinctPaths(paths) {
  const seen = new Set();
  for (const filePath of paths) {
    const key = path.normalize(filePath).toLowerCase();
    if (seen.has(key)) throw new Error(`Core transaction path collision: ${filePath}`);
    seen.add(key);
  }
}

function assertRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
}

function assertBackupPair(backupAsarPath, backupExePath, allowAbsent) {
  const asarExists = fs.existsSync(backupAsarPath);
  const exeExists = fs.existsSync(backupExePath);
  if (!asarExists && !exeExists && allowAbsent) return false;
  if (!asarExists || !exeExists) {
    throw new Error("Refusing to continue with a partial core backup pair.");
  }
  assertRegularFile(backupAsarPath, "backup app.asar");
  assertRegularFile(backupExePath, "backup executable");
  return true;
}

function getSwapPaths(activePath) {
  const dir = path.dirname(activePath);
  const name = path.basename(activePath);
  return {
    newPath: path.join(dir, `${name}.zhcn-new`),
    oldPath: path.join(dir, `${name}.zhcn-old`),
  };
}

function getTransactionSwapPaths(transaction) {
  const asar = getSwapPaths(transaction.asarPath);
  const exe = getSwapPaths(transaction.exePath);
  return [asar.newPath, asar.oldPath, exe.newPath, exe.oldPath];
}

function assertSwapPathsAvailable(transaction) {
  const swapPaths = getTransactionSwapPaths(transaction);
  assertDistinctPaths([
    transaction.asarPath,
    transaction.exePath,
    transaction.stagedAsarPath,
    transaction.stagedExePath,
    transaction.backupAsarPath,
    transaction.backupExePath,
    ...swapPaths,
  ]);
  for (const swapPath of swapPaths) {
    if (fs.existsSync(swapPath)) {
      throw new Error(`Core transaction swap path already exists: ${swapPath}`);
    }
  }
}

function replaceCoreFile(activePath, sourcePath) {
  const { newPath, oldPath } = getSwapPaths(activePath);
  fs.copyFileSync(sourcePath, newPath);
  fs.renameSync(activePath, oldPath);
  fs.renameSync(newPath, activePath);
  fs.unlinkSync(oldPath);
}

function cleanupOwnedSwapFiles(transaction) {
  for (const swapPath of getTransactionSwapPaths(transaction)) {
    if (fs.existsSync(swapPath)) fs.unlinkSync(swapPath);
  }
}

function resetOwnedSwapFileState(activePath) {
  const { newPath, oldPath } = getSwapPaths(activePath);
  if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
  if (!fs.existsSync(oldPath)) return;
  if (fs.existsSync(activePath)) fs.unlinkSync(oldPath);
  else fs.renameSync(oldPath, activePath);
}

function restoreBackupPair(transaction) {
  assertBackupPair(transaction.backupAsarPath, transaction.backupExePath, false);
  const errors = [];
  for (const [activePath, backupPath] of [
    [transaction.asarPath, transaction.backupAsarPath],
    [transaction.exePath, transaction.backupExePath],
  ]) {
    try {
      resetOwnedSwapFileState(activePath);
      replaceCoreFile(activePath, backupPath);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Could not restore the core backup pair.");
}

function validateTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") {
    throw new Error("A core transaction is required.");
  }
  const paths = [
    transaction.asarPath,
    transaction.exePath,
    transaction.stagedAsarPath,
    transaction.stagedExePath,
    transaction.backupAsarPath,
    transaction.backupExePath,
  ];
  if (paths.some((filePath) => typeof filePath !== "string" || !path.isAbsolute(filePath))) {
    throw new Error("Core transaction paths must be resolved absolute paths.");
  }
  assertDistinctPaths(paths);
}

export function prepareStagedCore({ asarPath, exePath, stageRoot, backupRoot }) {
  const resolvedAsarPath = resolveRequiredPath(asarPath, "asarPath");
  const resolvedExePath = resolveRequiredPath(exePath, "exePath");
  const resolvedStageRoot = resolveRequiredPath(stageRoot, "stageRoot");
  const resolvedBackupRoot = resolveRequiredPath(backupRoot, "backupRoot");
  const transaction = {
    asarPath: resolvedAsarPath,
    exePath: resolvedExePath,
    stagedAsarPath: path.join(resolvedStageRoot, "app.asar"),
    stagedExePath: path.join(resolvedStageRoot, path.basename(resolvedExePath)),
    backupAsarPath: path.join(resolvedBackupRoot, "app.asar"),
    backupExePath: path.join(resolvedBackupRoot, path.basename(resolvedExePath)),
  };

  validateTransaction(transaction);
  assertRegularFile(transaction.asarPath, "active app.asar");
  assertRegularFile(transaction.exePath, "active executable");
  const backupsExist = assertBackupPair(
    transaction.backupAsarPath,
    transaction.backupExePath,
    true,
  );
  if (!backupsExist) {
    fs.mkdirSync(resolvedBackupRoot, { recursive: true });
    fs.copyFileSync(transaction.asarPath, transaction.backupAsarPath);
    fs.copyFileSync(transaction.exePath, transaction.backupExePath);
  }
  fs.mkdirSync(resolvedStageRoot, { recursive: true });
  fs.copyFileSync(transaction.asarPath, transaction.stagedAsarPath);
  fs.copyFileSync(transaction.exePath, transaction.stagedExePath);
  return Object.freeze(transaction);
}

export function activateStagedCore(transaction) {
  validateTransaction(transaction);
  assertRegularFile(transaction.stagedAsarPath, "staged app.asar");
  assertRegularFile(transaction.stagedExePath, "staged executable");
  assertBackupPair(transaction.backupAsarPath, transaction.backupExePath, false);
  assertSwapPathsAvailable(transaction);
  try {
    replaceCoreFile(transaction.asarPath, transaction.stagedAsarPath);
    replaceCoreFile(transaction.exePath, transaction.stagedExePath);
  } catch (error) {
    try {
      restoreBackupPair(transaction);
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    cleanupOwnedSwapFiles(transaction);
  }
}

export function rollbackActivatedCore(transaction) {
  validateTransaction(transaction);
  assertSwapPathsAvailable(transaction);
  try {
    restoreBackupPair(transaction);
  } finally {
    cleanupOwnedSwapFiles(transaction);
  }
}
