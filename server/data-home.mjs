// Private configuration owns SQLite. Run Files use the configured workspace.
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chmod, lstat, mkdir } from "node:fs/promises";
import {storageBusinessRoot, storageDatabasePath, storageDatabaseFiles} from './storage-layout.mjs';

export function batonDataHome(home = homedir()) { return join(home, ".baton"); }
export function desktopServiceDataRoot(home = homedir()) { return batonDataHome(home); }
export function defaultTaskWorkspaceRoot(home = homedir()) { return join(batonDataHome(home), "workspace"); }

export function desktopServiceStoragePaths({ home = homedir(), env = process.env } = {}) {
  const controlRoot = env.BATON_DESKTOP_CONTROL_ROOT || desktopServiceDataRoot(home);
  const workspaceRoot=env.BATON_WORKSPACE_ROOT || defaultTaskWorkspaceRoot(home);
  const dataRoot = storageBusinessRoot(workspaceRoot);
  return {
    dataRoot,
    databasePath: env.BATON_DB_PATH || storageDatabasePath(controlRoot),
    authDatabasePath: env.BATON_AUTH_DB_PATH || join(controlRoot, "auth.sqlite"),
    runFilesRoot: env.BATON_RUN_FILES_ROOT || dataRoot,
    runtimeConfigRoot: env.BATON_RUNTIME_CONFIG_ROOT || join(controlRoot, "runtime-configs"),
    workspaceRoot,controlRoot,credentialsRoot:env.BATON_CREDENTIALS_ROOT || join(controlRoot,'credentials')
  };
}

export async function prepareBusinessDatabase({controlRoot, dataRoot, databasePath}) {
  if (databasePath !== storageDatabasePath(controlRoot)) return;
  const directory = dirname(databasePath);
  await mkdir(directory, { mode: 0o700, recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) {
    throw new Error('SQLite 目录必须是当前用户的私有目录');
  }
  if (info.mode & 0o077) await chmod(directory, 0o700);
  let hasDatabase = false;
  for (const path of storageDatabaseFiles(databasePath)) {
    const file = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!file) continue;
    if (!file.isFile() || file.nlink !== 1 || (process.getuid && file.uid !== process.getuid())) {
      throw new Error('SQLite 路径必须是当前用户的常规文件');
    }
    if (path === databasePath) hasDatabase = true;
    else if (!hasDatabase) throw new Error('SQLite 主库缺失，请先检查现有日志和历史索引');
  }
  if (hasDatabase) return;
  for (const root of [dataRoot, controlRoot]) {
    for (const name of ['baton.sqlite','baton.sqlite-wal','baton.sqlite-shm']) {
      if (await present(join(root,name))) {
        throw new Error('仍有旧位置的 SQLite 数据，请退出 Baton 并将已核验的业务数据库放入配置目录的 sqlite 子目录');
      }
    }
  }
}

// Marker files that prove a previous default location holds a real instance.
const legacyMarkers = ["baton.sqlite", "auth.sqlite"];

async function present(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Hard protection against silently treating a legacy instance as a fresh one:
// when the old default root still holds a database but the new default database
// does not exist yet, startup must refuse and point at the one-time migration
// script instead of creating an empty instance. Callers skip this check
// whenever the database path was explicitly overridden.
export async function legacyDataRequiresMigration({ legacyRoot, currentDatabasePath }) {
  let legacy = false;
  for (const marker of legacyMarkers) legacy ||= await present(join(legacyRoot, marker));
  return legacy && !(await present(resolve(currentDatabasePath)));
}

export function migrationGuidance({ legacyRoot, targetRoot, command }) {
  return `检测到旧默认目录 ${legacyRoot} 中存在实例数据，而新默认目录 ${targetRoot} 尚无数据。`
    + `为保护现有实例，本次未按新实例启动。请先退出所有 Baton 实例，再运行一次性搬迁：${command}`
    + `（复制并逐项校验后把旧文件改名为备份，绝不删除旧数据；详见 README「数据目录」。）`;
}
