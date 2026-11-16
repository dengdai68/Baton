import { $t, normalizeLanguage } from "../../client/i18n.mjs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const closeModes = { quit: $t("退出程序"), tray: $t("保留在菜单栏") };
// Mirrors the renderer presentation choice so native windows match it at launch.
export const appearances = { light: $t("浅色"), dark: $t("深色"), system: $t("跟随系统") };
export function normalizeCloseMode(value) { return typeof value === "string" && Object.hasOwn(closeModes, value) ? value : null; }
export function normalizeAppearance(value) { return typeof value === "string" && Object.hasOwn(appearances, value) ? value : null; }

/** Read the host preference object; missing or malformed files mean "no choice yet". */
async function readPreferenceFile(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return {}; throw error; }
}

let pendingWrite = Promise.resolve();
/** Atomically merge one validated key, serialized so concurrent saves never drop each other. */
function writePreference(path, patch) {
  const write = pendingWrite.then(async () => {
    const current = await readPreferenceFile(path);
    const next = { closeMode: normalizeCloseMode(current.closeMode) ?? undefined, appearance: normalizeAppearance(current.appearance) ?? undefined, language: normalizeLanguage(current.language) ?? undefined, ...patch };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const pending = `${path}.tmp`;
    await writeFile(pending, JSON.stringify(next), { mode: 0o600 });
    await rename(pending, path);
  });
  pendingWrite = write.catch(() => {});
  return write;
}

export async function readCloseMode(path) { return normalizeCloseMode((await readPreferenceFile(path)).closeMode); }
export async function readAppearance(path) { return normalizeAppearance((await readPreferenceFile(path)).appearance); }
export async function saveCloseMode(path, mode) {
  if (!normalizeCloseMode(mode)) throw new Error($t("关闭行为无效"));
  await writePreference(path, { closeMode: mode });
}
export async function saveAppearance(path, appearance) {
  if (!normalizeAppearance(appearance)) throw new Error($t("外观无效"));
  await writePreference(path, { appearance });
}
/** Interface language: "system" follows the macOS preferred languages. */
export async function readLanguage(path) { return normalizeLanguage((await readPreferenceFile(path)).language); }
export async function saveLanguage(path, language) {
  if (!normalizeLanguage(language)) throw new Error($t("语言无效"));
  await writePreference(path, { language });
}
