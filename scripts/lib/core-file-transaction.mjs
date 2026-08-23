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
    lockPath: path.join(dir, `${name}.zhcn-lock`),
  };
}

function getTransactionSwapPaths(transaction) {
  const asar = getSwapPaths(transaction.asarPath);
  const exe = getSwapPaths(transaction.exePath);
  return [asar.newPath, asar.oldPath, exe.newPath, exe.oldPath];
}

function getTransactionLockPaths(transaction) {
  return [getSwapPaths(transaction.asarPath).lockPath, getSwapPaths(transaction.exePath).lockPath];
}

function getBackupTempPaths(transaction) {
  return [
    `${transaction.backupAsarPath}.zhcn-backup-new`,
    `${transaction.backupExePath}.zhcn-backup-new`,
  ];
}

function createOperationState() {
  return { ownedFiles: new Set(), ownedLocks: new Set() };
}

function copyExclusive(sourcePath, targetPath, state) {
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  state.ownedFiles.add(targetPath);
}

function unlinkOwnedPath(filePath, state) {
  if (!state.ownedFiles.has(filePath)) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  state.ownedFiles.delete(filePath);
}

function cleanupOwnedFiles(state) {
  const errors = [];
  for (const filePath of [...state.ownedFiles]) {
    try {
      unlinkOwnedPath(filePath, state);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) return errors[0];
  if (errors.length > 1) return new AggregateError(errors, "Could not clean transaction files.");
  return null;
}

function releaseLocks(state) {
  const errors = [];
  for (const lockPath of [...state.ownedLocks]) {
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
      state.ownedLocks.delete(lockPath);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) return errors[0];
  if (errors.length > 1) return new AggregateError(errors, "Could not release core transaction locks.");
  return null;
}

function combineErrors(errors, message) {
  const present = errors.filter(Boolean);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return new AggregateError(present, message);
}

function acquireLocks(transaction, state) {
  const lockPaths = getTransactionLockPaths(transaction);
  assertDistinctPaths([
    transaction.asarPath,
    transaction.exePath,
    transaction.stagedAsarPath,
    transaction.stagedExePath,
    transaction.backupAsarPath,
    transaction.backupExePath,
    ...getTransactionSwapPaths(transaction),
    ...lockPaths,
  ]);
  for (const lockPath of lockPaths) {
    try {
      const descriptor = fs.openSync(lockPath, "wx");
      fs.closeSync(descriptor);
      state.ownedLocks.add(lockPath);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`Core transaction lock already held: ${lockPath}`);
      }
      throw error;
    }
  }
}

function assertSwapPathsAvailable(transaction) {
  for (const swapPath of getTransactionSwapPaths(transaction)) {
    if (fs.existsSync(swapPath)) {
      throw new Error(`Core transaction swap path already exists: ${swapPath}`);
    }
  }
}

function replaceCoreFile(activePath, sourcePath, state) {
  const { newPath, oldPath } = getSwapPaths(activePath);
  copyExclusive(sourcePath, newPath, state);
  fs.renameSync(activePath, oldPath);
  state.ownedFiles.add(oldPath);
  fs.renameSync(newPath, activePath);
  state.ownedFiles.delete(newPath);
  unlinkOwnedPath(oldPath, state);
}

function resetOwnedSwapFileState(activePath, state) {
  const { newPath, oldPath } = getSwapPaths(activePath);
  unlinkOwnedPath(newPath, state);
  if (!state.ownedFiles.has(oldPath)) return;
  if (fs.existsSync(activePath)) unlinkOwnedPath(oldPath, state);
  else {
    fs.renameSync(oldPath, activePath);
    state.ownedFiles.delete(oldPath);
  }
}

function restoreBackupPair(transaction, state) {
  assertBackupPair(transaction.backupAsarPath, transaction.backupExePath, false);
  const errors = [];
  for (const [activePath, backupPath] of [
    [transaction.asarPath, transaction.backupAsarPath],
    [transaction.exePath, transaction.backupExePath],
  ]) {
    try {
      resetOwnedSwapFileState(activePath, state);
      replaceCoreFile(activePath, backupPath, state);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Could not restore the core backup pair.");
}

function prepareBackupPair(transaction) {
  const state = createOperationState();
  const [asarTempPath, exeTempPath] = getBackupTempPaths(transaction);
  assertDistinctPaths([
    transaction.asarPath,
    transaction.exePath,
    transaction.backupAsarPath,
    transaction.backupExePath,
    asarTempPath,
    exeTempPath,
  ]);
  try {
    copyExclusive(transaction.asarPath, asarTempPath, state);
    copyExclusive(transaction.exePath, exeTempPath, state);
    copyExclusive(asarTempPath, transaction.backupAsarPath, state);
    unlinkOwnedPath(asarTempPath, state);
    copyExclusive(exeTempPath, transaction.backupExePath, state);
    unlinkOwnedPath(exeTempPath, state);
  } catch (error) {
    const cleanupError = cleanupOwnedFiles(state);
    if (cleanupError) error.cleanupError = cleanupError;
    throw error;
  }
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

function finishOperation(state, cleanOwnedFiles) {
  return combineErrors(
    [cleanOwnedFiles ? cleanupOwnedFiles(state) : null, releaseLocks(state)],
    "Could not clean core transaction artifacts.",
  );
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
    prepareBackupPair(transaction);
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
  const state = createOperationState();
  let primaryError = null;
  let recoveryCompleted = false;
  let replacementStarted = false;
  try {
    acquireLocks(transaction, state);
    assertSwapPathsAvailable(transaction);
    replacementStarted = true;
    replaceCoreFile(transaction.asarPath, transaction.stagedAsarPath, state);
    replaceCoreFile(transaction.exePath, transaction.stagedExePath, state);
    recoveryCompleted = true;
  } catch (error) {
    primaryError = error;
    if (replacementStarted) {
      try {
        restoreBackupPair(transaction, state);
        recoveryCompleted = true;
      } catch (rollbackError) {
        primaryError.rollbackError = rollbackError;
      }
    }
  }
  const cleanupError = finishOperation(state, recoveryCompleted);
  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError;
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
}

export function rollbackActivatedCore(transaction) {
  validateTransaction(transaction);
  assertBackupPair(transaction.backupAsarPath, transaction.backupExePath, false);
  const state = createOperationState();
  let primaryError = null;
  let recoveryCompleted = false;
  try {
    acquireLocks(transaction, state);
    assertSwapPathsAvailable(transaction);
    restoreBackupPair(transaction, state);
    recoveryCompleted = true;
  } catch (error) {
    primaryError = error;
  }
  const cleanupError = finishOperation(state, recoveryCompleted);
  if (primaryError) {
    if (cleanupError) primaryError.cleanupError = cleanupError;
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
}
