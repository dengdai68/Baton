import { $t, normalizeLanguage } from "../../client/i18n.mjs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeUpdateChannel } from "./updates.mjs";

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
    const next = { workspaceChoices: current.workspaceChoices, closeMode: normalizeCloseMode(current.closeMode) ?? undefined, appearance: normalizeAppearance(current.appearance) ?? undefined, language: normalizeLanguage(current.language) ?? undefined, updateChannel: normalizeUpdateChannel(current.updateChannel) ?? undefined, residentService: typeof current.residentService === "boolean" ? current.residentService : undefined, ...(typeof patch === "function" ? patch(current) : patch) };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const pending = `${path}.tmp`;
    await writeFile(pending, JSON.stringify(next), { mode: 0o600 });
    await rename(pending, path);
    return next;
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
/** Application update channel; missing or unknown values mean the default stable channel. */
/** Resident service preference: true/false when chosen, null when never set (the caller applies its default). */
export async function readResidentService(path) { const value = (await readPreferenceFile(path)).residentService; return typeof value === "boolean" ? value : null; }
export async function saveResidentService(path, resident) {
  if (typeof resident !== "boolean") throw new Error($t("后台服务设置无效"));
  await writePreference(path, { residentService: resident });
}
export async function readUpdateChannel(path) { return normalizeUpdateChannel((await readPreferenceFile(path)).updateChannel) || "stable"; }
export async function saveUpdateChannel(path, channel) {
  if (!normalizeUpdateChannel(channel)) throw new Error($t("更新渠道无效"));
  await writePreference(path, { updateChannel: channel });
}

function workspaceChoices(saved) {
  const addresses = Array.isArray(saved?.addresses) ? saved.addresses.filter(value => typeof value === 'string' && value !== 'local') : [];
  return { addresses, selected: addresses.includes(saved?.selected) ? saved.selected : 'local' };
}
export async function readWorkspaceChoices(path) {
  return workspaceChoices((await readPreferenceFile(path)).workspaceChoices);
}
export async function selectWorkspace(path, origin, action = 'select') {
  const saved = await writePreference(path, current => {
    const { addresses, selected } = workspaceChoices(current.workspaceChoices);
    if (action === 'remove') {
      return { workspaceChoices: { addresses: addresses.filter(address => address !== origin), selected: selected === origin ? 'local' : selected } };
    }
    if (action !== 'select') throw new TypeError('Invalid workspace action');
    if (origin !== 'local' && !addresses.includes(origin)) addresses.push(origin);
    return { workspaceChoices: { addresses, selected: origin } };
  });
  return saved.workspaceChoices;
}
