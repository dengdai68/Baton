// Browser-container presentation only. Never put credentials or domain facts here.
export const PREFERENCES_KEY = "baton.presentation.v1";
export const NAVIGATION = [
  { id: "inbox", label: "待我处理", group: "工作" },
  { id: "tasks", label: "任务", group: "工作" },
  { id: "automations", label: "自动化", group: "工作" },
  { id: "communication", label: "沟通", group: "工作" },
  { id: "teams", label: "团队", group: "组织" },
  { id: "workflows", label: "工作流", group: "组织" },
  { id: "agents", label: "数字员工", group: "组织" },
  { id: "roles", label: "角色", group: "组织" },
  { id: "marketplace", label: "插件", group: "扩展" },
  { id: "mcp-marketplace", label: "MCP", group: "扩展" },
  { id: "manual", label: "开发手册", group: "扩展" },
];

// Appearance follows the Graphite design system; "system" mirrors the OS setting.
export const THEMES = [
  { id: "light", label: "浅色", description: "白色画布与冷灰侧栏，适合大多数场景。" },
  { id: "dark", label: "深色", description: "低亮度画布，适合暗光环境与长时间阅读。" },
  { id: "system", label: "跟随系统", description: "随 macOS 外观自动切换浅色与深色。" },
];
const THEME_IDS = new Set(THEMES.map((theme) => theme.id));
const THEME_COLORS = { light: "#ffffff", dark: "#111215" };

export const DIRECTORY_THEMES = [
  // "vscode-light" keeps its stored id; its code palette now follows the appearance.
  { id: "vscode-light", label: "VS Code 图标 · 跟随外观", description: "vscode-icons 彩色文件/文件夹图标，文件内容随界面外观使用浅色或深色代码配色。" },
  { id: "vscode-dark", label: "VS Code 图标 · 深色", description: "同样的 vscode-icons 图标，选中文件的内容区始终使用深色代码配色（仅工作目录预览区）。" },
  { id: "classic", label: "经典", description: "不加彩色图标的文字符号与原有配色，作为低装饰回退。" },
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
