import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { batonDataHome, legacyDataRequiresMigration, migrationGuidance, desktopServiceDataRoot, desktopServiceStoragePaths, prepareBusinessDatabase } from "../server/data-home.mjs";

test("business SQLite is private while Run Files follow the work root", () => {
  const home = "/fixture-home";
  assert.equal(batonDataHome(home), "/fixture-home/.baton");
  assert.equal(desktopServiceDataRoot(home), "/fixture-home/.baton");
  const storage = desktopServiceStoragePaths({ home, env: {} });
  assert.equal(storage.databasePath, "/fixture-home/.baton/sqlite/baton.sqlite");
  assert.equal(storage.authDatabasePath, "/fixture-home/.baton/auth.sqlite");
  assert.equal(storage.runFilesRoot, "/fixture-home/.baton/workspace/records");
  assert.equal(storage.runtimeConfigRoot, "/fixture-home/.baton/runtime-configs");
  assert.equal(storage.workspaceRoot, "/fixture-home/.baton/workspace");
});

test("explicit environment overrides always win over the new defaults", () => {
  const env = {
    BATON_DB_PATH: "/override/state.sqlite",
    BATON_AUTH_DB_PATH: "/override/auth.sqlite",
    BATON_RUN_FILES_ROOT: "/override/runs",
    BATON_RUNTIME_CONFIG_ROOT: "/override/runtime",
    BATON_WORKSPACE_ROOT: "/override/workspaces"
  };
  const storage = desktopServiceStoragePaths({ home: "/fixture-home", env });
  assert.equal(storage.databasePath, "/override/state.sqlite");
  assert.equal(storage.authDatabasePath, "/override/auth.sqlite");
  assert.equal(storage.runFilesRoot, "/override/runs");
  assert.equal(storage.runtimeConfigRoot, "/override/runtime");
  assert.equal(storage.workspaceRoot, "/override/workspaces");
  const independent = desktopServiceStoragePaths({ home: "/fixture-home", env: { BATON_DB_PATH: env.BATON_DB_PATH, BATON_WORKSPACE_ROOT: env.BATON_WORKSPACE_ROOT } });
  assert.equal(independent.databasePath, env.BATON_DB_PATH);
  assert.equal(independent.runFilesRoot, "/override/workspaces/records");
});

test("managed SQLite refuses a missing main database when earlier data or sidecars exist", async t => {
  const home = await mkdtemp(join(tmpdir(), "baton-sqlite-root-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const storage = desktopServiceStoragePaths({ home, env: {} });
  await mkdir(storage.dataRoot, { recursive: true });
  const old = join(storage.dataRoot, "baton.sqlite");
  await writeFile(old, "previous SQLite bytes");
  await assert.rejects(prepareBusinessDatabase(storage), /旧位置/);
  assert.equal(await readFile(old, "utf8"), "previous SQLite bytes");
  await writeFile(storage.databasePath + "-wal", "a remaining WAL");
  await assert.rejects(prepareBusinessDatabase(storage), /主库缺失/);
  await rm(storage.databasePath + "-wal");
  await symlink(old, storage.databasePath);
  await assert.rejects(prepareBusinessDatabase(storage), /常规文件/);
  await rm(storage.databasePath);
  await writeFile(storage.databasePath, "new SQLite bytes");
  await prepareBusinessDatabase(storage);
  assert.equal(await readFile(old, "utf8"), "previous SQLite bytes");
});

test("legacy data detection blocks only a real legacy instance with an empty new location", async () => {
  const root = await mkdtemp(join(tmpdir(), "af-data-home-"));
  const legacy = join(root, "legacy"), current = join(root, "new", "baton.sqlite");
  await mkdir(legacy, { recursive: true });
  assert.equal(await legacyDataRequiresMigration({ legacyRoot: legacy, currentDatabasePath: current }), false, "empty legacy root never blocks");
  await writeFile(join(legacy, "baton.sqlite"), "metadata");
  assert.equal(await legacyDataRequiresMigration({ legacyRoot: legacy, currentDatabasePath: current }), true, "legacy database with empty new location blocks startup");
  await mkdir(join(root, "new"), { recursive: true });
  await writeFile(current, "fresh");
  assert.equal(await legacyDataRequiresMigration({ legacyRoot: legacy, currentDatabasePath: current }), false, "an existing new database means the instance already moved");
});

test("legacy detection also blocks on an authentication-only legacy instance", async () => {
  const root = await mkdtemp(join(tmpdir(), "af-data-home-auth-"));
  await writeFile(join(root, "auth.sqlite"), "auth");
  assert.equal(await legacyDataRequiresMigration({ legacyRoot: root, currentDatabasePath: join(root, "new", "baton.sqlite") }), true);
});

test("migration guidance names both locations and the one-time script without deleting anything", () => {
  const text = migrationGuidance({ legacyRoot: "/legacy", targetRoot: "/new", command: "node scripts/migrate-data-home.mjs --yes" });
  assert.match(text, /\/legacy/);
  assert.match(text, /\/new/);
  assert.match(text, /migrate-data-home\.mjs --yes/);
  assert.match(text, /绝不删除|不会被删除/);
});
