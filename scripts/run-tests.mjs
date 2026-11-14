#!/usr/bin/env node
// Test entry point (`npm test`). Guarantees the suite never reads or writes the
// operator's real instance data: a shell spawned by the desktop client inherits
// the live instance's BATON_* locations, and bare diagnostics would land in
// the real ~/.baton data home instead of a disposable fixture.
//
// - Inherited instance-binding variables are stripped; tests that need them set
//   their own fixture values per case.
// - BATON_LOG_DIR is pinned to a fresh system-temp directory unless the
//   operator explicitly set one, so test diagnostics never touch the real home.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const testFiles = readdirSync(join(repoRoot, "tests")).filter(name => name.endsWith(".test.mjs")).map(name => join("tests", name));

const inheritedInstanceVariables = [
  "BATON_DB_PATH",
  "BATON_AUTH_DB_PATH",
  "BATON_RUN_FILES_ROOT",
  "BATON_RUNTIME_CONFIG_ROOT",
  "BATON_WORKSPACE_ROOT",
  "BATON_DESKTOP_DATA_ROOT",
  "BATON_DESKTOP_PORT",
  "BATON_ELECTRON_NODE",
  "BATON_BOOTSTRAP_TOKEN",
  "BATON_DESKTOP_CONTROL_ROOT",
  "BATON_CREDENTIALS_ROOT",
  "BATON_RUNTIME_PREVIOUS_ROOTS",
  "BATON_INSTANCE_KIND"
];
export function testEnvironment(inherited = process.env) {
  const env = { ...inherited };
  for (const name of inheritedInstanceVariables) delete env[name];
  // Git hooks export repository selectors. Leaving them set makes fixture
  // git -C commands operate on the caller's worktree/index instead.
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE", "GIT_SHALLOW_FILE"]) delete env[name];
  env.BATON_LOG_DIR ||= mkdtempSync(join(tmpdir(), "baton-test-logs-"));
  return env;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  const concurrency = process.env.BATON_TEST_CONCURRENCY;
  if (concurrency !== undefined && !/^[1-9][0-9]*$/.test(concurrency)) throw new Error("BATON_TEST_CONCURRENCY must be a positive integer");
  const result = spawnSync(process.execPath, ["--test", ...(concurrency ? [`--test-concurrency=${concurrency}`] : []), ...testFiles], { stdio: "inherit", env: testEnvironment(), cwd: repoRoot });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
