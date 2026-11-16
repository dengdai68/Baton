import { $t } from "../client/i18n.mjs";
// Browser-container presentation only. Never put credentials or domain facts here.
export const PREFERENCES_KEY = "baton.presentation.v1";
export const NAVIGATION = [
  { id: "inbox", label: $t("待我处理"), group: $t("工作") },
  { id: "tasks", label: $t("任务"), group: $t("工作") },
  { id: "automations", label: $t("自动化"), group: $t("工作") },
  { id: "communication", label: $t("沟通"), group: $t("工作") },
  { id: "teams", label: $t("团队"), group: $t("组织") },
  { id: "workflows", label: $t("工作流"), group: $t("组织") },
  { id: "agents", label: $t("数字员工"), group: $t("组织") },
  { id: "roles", label: $t("角色"), group: $t("组织") },
  { id: "marketplace", label: $t("插件"), group: $t("扩展") },
  { id: "mcp-marketplace", label: "MCP", group: $t("扩展") },
  { id: "manual", label: $t("开发手册"), group: $t("扩展") },
];

// Appearance follows the Graphite design system; "system" mirrors the OS setting.
export const THEMES = [
  { id: "light", label: $t("浅色"), description: $t("白色画布与冷灰侧栏，适合大多数场景。") },
  { id: "dark", label: $t("深色"), description: $t("低亮度画布，适合暗光环境与长时间阅读。") },
  { id: "system", label: $t("跟随系统"), description: $t("随 macOS 外观自动切换浅色与深色。") },
];
const THEME_IDS = new Set(THEMES.map((theme) => theme.id));
const THEME_COLORS = { light: "#ffffff", dark: "#111215" };

export const DIRECTORY_THEMES = [
  // "vscode-light" keeps its stored id; its code palette now follows the appearance.
  { id: "vscode-light", label: $t("VS Code 图标 · 跟随外观"), description: $t("vscode-icons 彩色文件/文件夹图标，文件内容随界面外观使用浅色或深色代码配色。") },
  { id: "vscode-dark", label: $t("VS Code 图标 · 深色"), description: $t("同样的 vscode-icons 图标，选中文件的内容区始终使用深色代码配色（仅工作目录预览区）。") },
  { id: "classic", label: $t("经典"), description: $t("不加彩色图标的文字符号与原有配色，作为低装饰回退。") },
];
const DIRECTORY_THEME_IDS = new Set(DIRECTORY_THEMES.map((theme) => theme.id));

export function normalizePreferences(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) && [1, 2].includes(value.version) ? value : {};
  return {
    version: 2,
    theme: THEME_IDS.has(input.theme) ? input.theme : "light",
    hiddenViews: NAVIGATION.filter(({ id }) => ["overview", "manual"].includes(id) && input.version !== 2 ? true : Array.isArray(input.hiddenViews) && input.hiddenViews.includes(id)).map(({ id }) => id),
    showGroups: input.showGroups !== false,
    showIcons: input.showIcons !== false,
    showCounts: input.showCounts !== false,
    showUnread: input.showUnread !== false,
    directoryTheme: DIRECTORY_THEME_IDS.has(input.directoryTheme) ? input.directoryTheme : "vscode-light",
  };
}

export function readPreferences(getStorage = () => window.localStorage) {
  try { return normalizePreferences(JSON.parse(getStorage().getItem(PREFERENCES_KEY))); }
  catch { return normalizePreferences(null); }
}

export function savePreferences(value, getStorage = () => window.localStorage) {
  try { getStorage().setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(value))); return true; }
  catch { return false; }
}

export function applyPreferences(document, value) {
  const preferences = normalizePreferences(value);
  const root = document.documentElement;
  root.dataset.theme = preferences.theme;
  root.dataset.navGroups = preferences.showGroups ? "show" : "hide";
  root.dataset.navIcons = preferences.showIcons ? "show" : "hide";
  root.dataset.navCounts = preferences.showCounts ? "show" : "hide";
  root.dataset.navUnread = preferences.showUnread ? "show" : "hide";
  const view = document.defaultView;
  const dark = preferences.theme === "dark" || (preferences.theme === "system" && Boolean(view?.matchMedia?.("(prefers-color-scheme: dark)").matches));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[dark ? "dark" : "light"]);
  // The desktop host mirrors the choice so native dialogs and the next launch match.
  view?.batonDesktop?.setAppearance?.(preferences.theme)?.catch?.(() => {});
  for (const item of document.querySelectorAll(".sidebar .nav-item[data-view]")) {
    item.hidden = preferences.hiddenViews.includes(item.dataset.view);
  }
  for (const group of document.querySelectorAll("[data-navigation-group]")) {
    group.hidden = [...group.querySelectorAll(".nav-item")].every((item) => item.hidden);
  }
}
