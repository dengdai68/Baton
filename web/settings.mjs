import { $t, $tm, LANGUAGE_PREFERENCES, LOCALE_NAMES } from "../client/i18n.mjs";
import {runtimeLabel,RUNTIME_EFFORT_LEVELS} from "../client/runtime-providers.mjs";
import { DIRECTORY_THEMES, NAVIGATION, normalizePreferences, THEMES } from "./preferences.mjs";
import { createFloatingList, closeFloatingLists } from './floating-list.mjs';

export const SETTINGS_PAGES = { general: $t("常规"), appearance: $t("外观"), workspaces: $t("工作空间"), workspace: $t("工作目录"), cli: "CLI", repositories: $t("仓库访问"), runtime: $t("运行时"), devices: $t("手机连接"), updates: $t("更新"), logs: $t("运行日志") };
const escape = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

const settingsIcon = id => {
  const paths = {
    general: '<path d="M4 5h16v14H4zM4 9h16M8 5v4"/>', appearance: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 0 0 0-16"/>',
    workspace: '<path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/>', runtime: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    cli: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>', repositories: '<circle cx="7" cy="6" r="2"/><circle cx="17" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><path d="M7 8v8m10-8v2c0 4-10 0-10 6"/>',
    updates: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>', logs: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7"/>',
    devices: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'
  };
  return `<svg class="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id === 'workspaces' ? 'workspace' : id] || paths.general}</svg>`;
};

// Mirrors the provider effort vocabularies observed from the real CLIs in
// server/runtime/model-catalog.mjs; tests assert both sides stay equal. The
// catalog endpoint refines per-model availability whenever it loads.
export {RUNTIME_EFFORT_LEVELS};

const runtimeOptionLabel = value => String(value).replace(/^[a-z]/, char => char.toUpperCase());

// Effort select options for a provider/model pair. catalog is null until the
// real source loads (or after it failed); fallbacks are labelled honestly and
// never pretend per-model knowledge the platform does not have.
export function runtimeEffortOptions(provider, modelId, catalog) {
  const defaults = [{ value: "", label: $t("默认（CLI 决定）") }];
  const entry = modelId && catalog?.models ? catalog.models.find(item => item.id === modelId) : null;
  if(!modelId && ['cursor','gemini','opencode'].includes(provider))return {options:defaults,note:$t("选择模型后显示其原生思考档位。")};
  if (provider === "claude-code") {
    if (entry) {
      if (!entry.levels?.length) return { options: defaults, note: entry.note || $t("配置声明该模型不支持思考档位。") };
      return { options: [...defaults, ...entry.levels.map(id => ({ value: id, label: runtimeOptionLabel(id) }))], note: entry.note || "" };
    }
    return { options: [...defaults, ...RUNTIME_EFFORT_LEVELS["claude-code"].map(id => ({ value: id, label: runtimeOptionLabel(id) }))], note: modelId ? $t("模型不在列表中（手工输入）；档位按 Claude Code CLI 集合展示，实际支持以调用为准。") : $t("档位由 CLI 按模型实际支持解析，不支持时回退。") };
  }
  if (entry) {
    const levels = (entry.levels || []).map(level => ({ value: level.id, label: level.default ? $t("{0}（模型默认）", [runtimeOptionLabel(level.id)]) : runtimeOptionLabel(level.id) }));
    if (!levels.length) return { options: defaults, note: entry.note || $t("目录中该模型未声明可调整的思考档位。") };
    return { options: [...defaults, ...levels], note: entry.note || $t("档位来自 {0}；账号实际可用性以调用为准。", [catalog.source]) };
  }
  return { options: [...defaults, ...(RUNTIME_EFFORT_LEVELS[provider] || []).map(id => ({ value: id, label: runtimeOptionLabel(id) }))], note: modelId ? $t("模型不在目录中（手工输入）；档位按此 Runtime 集合展示，逐模型支持以调用为准。") : $t("未选择模型；逐模型档位在选择模型后精确展示。") };
}

// Host IPC rejections carry Electron's invoke prefix; show only the translated reason.
const hostErrorText = error => $tm(String(error?.message || '').replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));

export function createAppUpdateUI(panel, desktop) {
  const status = panel.querySelector('[data-app-update-status]'), version = panel.querySelector('[data-app-version]');
  const check = panel.querySelector('[data-app-update-check]'), download = panel.querySelector('[data-app-update-download]');
  const install = panel.querySelector('[data-app-update-install]'), progress = panel.querySelector('progress');
  const progressRow = panel.querySelector('[data-app-update-progress]'), percent = panel.querySelector('[data-app-update-percent]');
  const note = panel.querySelector('[data-app-update-note]'), channel = panel.querySelector('[data-app-update-channel]');
  let disposed = false, observed;
  function accept(value) {
    if (disposed) return; observed = value;
    const latest = value.version ? ` · ${value.releaseChannel === 'beta' ? $t("最新测试版 {0}", [value.version]) : $t("最新正式版 {0}", [value.version])}` : '';
    version.textContent = $t("当前版本 {0}{1}", [value.currentVersion || '—', latest]);
    status.textContent = $tm(value.message) || $t("正在读取更新状态…");
    const busy = ['checking','downloading'].includes(value.phase);
    check.disabled = busy; check.textContent = value.phase === 'checking' ? $t("正在检查…") : $t("检查更新");
    // Older hosts report no channel and cannot switch; they only ever check stable releases.
    channel.value = value.channel === 'beta' ? 'beta' : 'stable'; channel.disabled = busy || !desktop?.setAppUpdateChannel;
    download.hidden = !value.canDownload; download.disabled = busy;
    install.hidden = !value.canInstall; install.textContent = value.installMode === 'native' ? $t("重启并安装") : $t("打开安装包");
    progressRow.hidden = value.phase !== 'downloading'; progress.value = value.percent || 0;
    percent.textContent = `${Math.floor(value.percent || 0)}%`;
    note.hidden = value.phase === 'downloading';
    note.textContent = value.version && value.installMode === 'manual' ? $t("当前版本或发布包不满足原生自动安装条件；下载后手动安装。")
      : value.channel === 'beta' ? $t("启动后及运行期间自动检查正式版和测试版；不会自动下载或打断任务重启。") : $t("启动后及运行期间自动检查正式版；不会自动下载或打断任务重启。");
  }
  async function run(method, ...args) {
    if (disposed) return;
    check.disabled = download.disabled = install.disabled = channel.disabled = true;
    try { accept(await desktop[method](...args)); }
    catch (error) { if (!disposed) { if (observed) accept(observed); status.textContent = hostErrorText(error) || $t("更新操作失败，请重试"); } }
    finally { if (!disposed) install.disabled = false; }
  }
  const unsubscribe = desktop?.onAppUpdate?.(accept);
  check.onclick = () => run('checkAppUpdate'); download.onclick = () => run('downloadAppUpdate'); install.onclick = () => run('installAppUpdate');
  // A failed switch re-renders the last host state, which restores the saved channel.
  channel.onchange = () => run('setAppUpdateChannel', channel.value);
  return { async refresh() {
    if (disposed || panel.hidden) return;
    if (!desktop?.getAppUpdateState) { status.textContent = $t("请使用支持应用更新的客户端版本。"); check.disabled = true; return; }
    await run('getAppUpdateState');
  }, dispose() { disposed = true; unsubscribe?.(); } };
}

/** 本机服务: keep the local service running under the system (launchd) or with the app. */
export function createResidentServiceUI(panel, desktop) {
  const toggle = panel.querySelector('[data-resident-toggle]'), status = panel.querySelector('[data-resident-status]');
  if (!toggle || !status) return { refresh() {}, dispose() {} };
  let busy = false, disposed = false;
  const describe = (value) => value.resident
    ? (value.state === "ready" ? $t("由系统托管，正在运行（进程 {0}）", [value.pid]) : $t("由系统托管：{0}", [value.state]))
    : $t("随 Baton 运行，退出 Baton 时停止");
  async function refresh() {
    if (disposed || busy) return;
    if (!desktop?.getServiceStatus) { toggle.disabled = true; status.textContent = $t("客户端宿主接口不可用，请重新打开应用。"); return; }
    try {
      const value = await desktop.getServiceStatus();
      if (disposed) return;
      toggle.checked = Boolean(value.resident); toggle.disabled = false; status.textContent = describe(value);
    } catch (error) { if (!disposed) { toggle.disabled = true; status.textContent = $t("读取本机服务状态失败：{0}", [error.message]); } }
  }
  toggle.onchange = async () => {
    const next = toggle.checked;
    busy = true; toggle.disabled = true;
    status.textContent = next ? $t("正在交给系统托管…") : $t("正在改为随 Baton 运行…");
    try { const value = await desktop.setResidentService(next); if (!disposed) { toggle.checked = Boolean(value.resident); status.textContent = describe(value); } }
    catch (error) { if (!disposed) { toggle.checked = !next; status.textContent = error.message; } }
    finally { busy = false; if (!disposed) toggle.disabled = false; }
  };
  return { refresh, dispose() { disposed = true; } };
}

export function createClosePreferenceUI(panel, desktop) {
  const form = panel.querySelector('[data-close-form]');
  const options = [...form.querySelectorAll('[name="closeMode"]')];
  const selected = () => options.find(option => option.checked)?.value || "";
  const save = form.querySelector('[type="submit"]'), status = panel.querySelector('[data-close-status]');
  const retry = panel.querySelector('[data-close-retry]');
  let saved = null, ready = false, busy = false, disposed = false, request = 0;
  const dirty = () => ready && selected() !== (saved || "");
  const sync = () => { options.forEach(option => { option.disabled = !ready || busy; }); save.disabled = !dirty() || busy || !["quit", "tray"].includes(selected()); };
  function accept(value) {
    if (value?.platform !== "darwin" || ![null, "quit", "tray"].includes(value.closeMode)) throw new Error($t("客户端偏好不可用"));
    saved = value.closeMode; status.classList?.toggle("saved", Boolean(saved)); options.forEach(option => { option.checked = option.value === saved; }); ready = true;
  }
  async function refresh() {
    if (disposed || panel.hidden || busy || dirty()) return;
    if (!desktop) { form.hidden = true; status.textContent = $t("客户端宿主接口不可用，请重新打开应用。"); return; }
    const id = ++request; busy = true; sync(); retry.hidden = true;
    try {
      const value = await desktop.getPreferences();
      if (disposed || id !== request) return;
      accept(value); status.textContent = saved ? $t("✓ 已保存；后续关闭窗口按此设置执行。") : $t("尚未设置；首次关闭窗口时会询问，取消不会保存选择。");
    } catch {
      if (!disposed && id === request) { ready = false; status.classList?.remove("saved"); status.textContent = $t("读取客户端偏好失败，请重试。"); retry.hidden = false; }
    } finally { if (!disposed && id === request) { busy = false; sync(); } }
  }
  form.onchange = () => { sync(); if(dirty())return form.onsubmit({preventDefault(){}}); };
  save.hidden = true;
  form.onsubmit = async event => {
    event.preventDefault(); if (save.disabled) return;
    busy = true; sync(); status.classList?.remove("saved"); status.textContent = $t("正在保存…");
    try {
      const value = await desktop.setCloseMode(selected());
      if (disposed) return;
      accept(value); status.textContent = $t("✓ 已保存；后续关闭窗口按此设置执行。");
    } catch { if (!disposed) { options.forEach(option => { option.checked = option.value === saved; }); status.textContent = $t("保存失败，已恢复原设置；请重新选择。"); } }
    finally { if (!disposed) { busy = false; sync(); } }
  };
  retry.onclick = refresh;
  sync();
  return { refresh, dispose() { disposed = true; ++request; } };
}

/** Language selector: saving persists in the host and reloads the interface in that language. */
export function createLanguagePreferenceUI(panel, desktop, reload = () => globalThis.location?.reload()) {
  const form = panel.querySelector('[data-language-form]'), select = form.querySelector('[name="language"]');
  const status = panel.querySelector('[data-language-status]');
  let saved = null, busy = false, disposed = false;
  const sync = () => { select.disabled = busy || saved === null; };
  function refresh() {
    if (disposed || busy) return;
    if (!desktop?.setLanguage) { form.hidden = true; status.textContent = $t("客户端宿主接口不可用，请重新打开应用。"); return; }
    // The preload supplied the saved choice with this page; a change reloads the page.
    const value = desktop.locale;
    if (!value) { status.textContent = $t("读取客户端偏好失败，请重试。"); return; }
    saved = LANGUAGE_PREFERENCES.includes(value.language) ? value.language : "system"; select.value = saved; sync();
  }
  select.onchange = async () => {
    if (busy || select.value === saved) return;
    busy = true; sync(); status.textContent = $t("正在保存…");
    try { await desktop.setLanguage(select.value); if (!disposed) reload(); }
    catch { if (!disposed) { select.value = saved; status.textContent = $t("保存失败，已恢复原设置；请重新选择。"); busy = false; sync(); } }
  };
  sync();
  return { refresh, dispose() { disposed = true; } };
}

export function createCliInstallationUI(panel, desktop) {
  const button = panel.querySelector('[data-cli-install]'), retry = panel.querySelector('[data-cli-refresh]');
  const status = panel.querySelector('[data-cli-status]'), paths = panel.querySelector('[data-cli-paths]');
  let disposed = false, busy = false, available = false;
  function accept(value) {
    available = value.canInstall === true;
    paths.textContent = [value.commandPath, ...(value.profilePaths || [])].filter(Boolean).join('\n');
    status.innerHTML = value.cancelled ? (value.installed ? $t("已取消重新安装；现有 CLI 保持不变。") : $t("已取消，未安装。")) : value.installed ? `<span class="status-pill done">${$t("已安装")}</span> ${$t("请新开终端运行 baton help；已有终端需重新打开。")}` : escape(value.message || $t("自动安装尚未完成，可重试安装；仅写入当前用户的命令与受管 PATH 配置块。"));
    button.textContent = value.installed ? $t("重新安装 CLI") : $t("安装 CLI");
    button.hidden = !value.supported;
  }
  const sync = () => { button.disabled = busy || !available; retry.disabled = busy; };
  async function run(install = false) {
    if (disposed || busy || (!install && panel.hidden)) return;
    if (!desktop?.getCliInstallation || !desktop?.installCli) {
      button.hidden = true; retry.hidden = true;
      status.textContent = $t("客户端宿主接口不可用，请重新打开应用后安装 CLI。"); return;
    }
    busy = true; sync(); status.textContent = install ? $t("正在安装 CLI…") : $t("正在检查 CLI 安装…");
    try {
      const value = await (install ? desktop.installCli() : desktop.getCliInstallation());
      if (!disposed) accept(value);
    } catch {
      if (!disposed) { available = false; status.textContent = $t("CLI 安装检查或操作失败，请刷新后重试；不会使用 sudo 或覆盖其他命令。"); }
    } finally { if (!disposed) { busy = false; sync(); } }
  }
  button.onclick = () => { if (!button.disabled) return run(true); };
  retry.onclick = () => run(); sync();
  return { refresh: () => run(), dispose() { disposed = true; } };
}

export function createSettingsUI({ api, notify, navigate, getPreferences, updatePreferences, clearInvalid, setInvalid, onWorkspaceSaved = () => {}, openModal, closeModal, confirmDialog, onDataReset, onResetStarted = () => {}, onResetFailed = () => {} }) {
  let workspaceLocation = null;
  let root = null, repositoriesLoaded = false, workspaceLoaded = false, runtimeLoaded = false;
  let deviceRefreshTimer = null;
  let logRequest = 0, currentPage = null;
  let closePreferenceUI = null, languagePreferenceUI = null, residentServiceUI = null, cliInstallationUI = null, appUpdateUI = null;
  const refreshHostSettings = () => {
    if (currentPage === "workspaces") void residentServiceUI?.refresh();
    if (currentPage === "general") { void closePreferenceUI?.refresh(); void languagePreferenceUI?.refresh(); }
    if (currentPage === "cli") void cliInstallationUI?.refresh();
    if (currentPage === "updates") void appUpdateUI?.refresh();
  };
  function confirmDataReset() {
    openModal(`<h2>${$t("清除所有数据")}</h2><p class="modal-intro">${$t("永久删除业务数据库与整个当前工作目录")} <code>${escape(workspaceLocation || $t("请先确认工作目录"))}</code>${$t("，包括任务与沟通记录、数字员工、角色、团队、工作流、自动化、执行记录和该目录中的所有文件。")}</p><p class="settings-note">${$t("配置目录保留：登录认证、界面偏好、Runtime、插件、MCP、Git 凭据及日志不受影响。请先停止正在执行的任务和沟通。此操作无法撤销。")}</p><form id="reset-data-form"><div class="form-field"><label for="reset-current-password">${$t("当前密码")}</label><input id="reset-current-password" name="password" type="password" autocomplete="current-password" required /></div><div class="form-field"><label for="reset-confirmation">${$t("输入「清除所有数据」确认")}</label><input id="reset-confirmation" name="confirmation" autocomplete="off" required /></div><p data-reset-error role="alert"></p><div class="form-actions"><button class="ghost-button" type="button" data-cancel-reset>${$t("取消")}</button><button class="danger-button" type="submit" disabled>${$t("清除工作目录")}</button></div></form>`);
    const form = document.querySelector("#reset-data-form"), button = form.querySelector('[type="submit"]');
    form.oninput = () => { button.disabled = !form.elements.password.value || form.elements.confirmation.value !== $t("清除所有数据"); };
    form.querySelector('[data-cancel-reset]').onclick = closeModal;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      form.querySelector('[data-cancel-reset]').disabled = true;
      onResetStarted();
      form.querySelector('[data-reset-error]').textContent = $t("正在清除，请保持窗口打开…");
      try {
        const result = await api("/api/settings/reset", { method: "POST", body: JSON.stringify({ password: form.elements.password.value, confirmation: "清除所有数据" }) });
        onDataReset(result.next);
      } catch (error) {
        onResetFailed();
        form.querySelector('[data-cancel-reset]').disabled = false;
        form.elements.password.value = "";
        form.querySelector('[data-reset-error]').textContent = error.message;
        form.oninput();
      }
    };
  }

  async function loadLogs() {
    const panel = root?.querySelector('[data-settings-panel="logs"]');
    if (!panel || panel.hidden) return;
    const request = ++logRequest;
    const status = panel.querySelector('[data-log-status]');
    try {
      const result = await api("/api/settings/log-files");
      if (request !== logRequest || !panel.isConnected || panel.hidden) return;
      panel.querySelector('[data-log-directory]').textContent = result.directory;
      panel.querySelector('[data-log-file]').textContent = result.filePath;
      status.textContent = result.available ? $t("日志写入正常") : $t("日志不可写：{0} {1}", [result.error?.code || "", $tm(result.error?.message || "")]);
    } catch (error) {
      if (request === logRequest && panel.isConnected) status.textContent = $t("读取路径失败：{0}", [error.message]);
    }
  }

  async function loadRuntimes() {
    const container = root.querySelector('[data-runtime-config]');
    runtimeLoaded = true;
    container.innerHTML = `<p role="status">${$t("正在读取 Runtime 配置…")}</p>`;
    try {
      const { profiles } = await api('/api/settings/runtime-profiles');
      if (!container.isConnected) return;
      closeFloatingLists(container); container.replaceChildren();
      for (const profile of profiles) {
        const label = runtimeLabel(profile.provider);
        const row = document.createElement('div'); row.className = 'runtime-provider-row'; row.dataset.runtimeProfile = profile.id;
        const availabilityLabel = () => profile.installed ? (profile.enabled ? $t("可用") : $t("已停用")) : $t("未安装");
        row.innerHTML = `<details class="runtime-config"><summary aria-label="${$t("{0} 配置", [label])}"><span class="settings-provider-icon" aria-hidden="true">${escape(({'claude-code':'CC',codex:'CX',dsh:'DS',opencode:'OC',cursor:'CU',gemini:'GE',qwen:'QW',kimi:'KM',pi:'PI'})[profile.provider] || label.slice(0,2).toUpperCase())}</span><div><h4 aria-label="${label}">${label}<span class="settings-provider-count">${$t("{0} 位员工", [profile.employeeCount])}</span></h4><p class="field-hint" data-runtime-summary></p></div><span class="runtime-expand-icon" aria-hidden="true">⌄</span></summary></details><div class="runtime-provider-actions"><label class="runtime-availability"><input type="checkbox" role="switch" aria-label="${$t("{0} 可用", [label])}" ${profile.enabled ? 'checked' : ''} ${profile.installed ? '' : 'disabled'} /><span class="visually-hidden" data-enabled-label>${availabilityLabel()}</span></label></div><p role="status" data-row-result></p>`;
        container.append(row);
        const summary = row.querySelector('[data-runtime-summary]');
        const syncSummary = () => { summary.textContent = `${availabilityLabel()} · ${profile.model ? runtimeOptionLabel(profile.model) : $t("CLI 默认模型")} · ${profile.effort ? runtimeOptionLabel(profile.effort) : $t("默认思考等级")}`; };
        syncSummary();
        const toggle = row.querySelector('[role="switch"]'), rowResult = row.querySelector('[data-row-result]');
        const syncAvailability = () => {
          toggle.checked = profile.enabled; toggle.disabled = !profile.installed;
          row.querySelector('[data-enabled-label]').textContent = availabilityLabel(); syncSummary();
          const test = row.querySelector('[data-test-runtime]');
          if (test) test.disabled = !profile.enabled || test.form.dataset.busy === 'true';
        };
        toggle.onchange = async () => {
          toggle.disabled = true;
          try {
            Object.assign(profile, await api(`/api/settings/runtime-profiles/${encodeURIComponent(profile.id)}`, { method: 'PUT', body: JSON.stringify({ enabled: toggle.checked }) }));
            syncAvailability();
            rowResult.textContent = profile.enabled ? $t("已启用。") : $t("已停用；已开始的调用继续，新的调用需启用后重试。");
          } catch (error) {
            const current = await api('/api/settings/runtime-profiles').catch(() => null);
            Object.assign(profile, current?.profiles.find(item => item.id === profile.id));
            syncAvailability(); rowResult.textContent = error.message;
          }
          finally { toggle.disabled = !profile.installed; }
        };
        const disclosure = row.querySelector('details');
        disclosure.addEventListener('toggle', () => {
          if (!disclosure.open || disclosure.querySelector('.runtime-inline-editor')) return;
          const card = document.createElement('div'); card.className = 'runtime-inline-editor'; card.setAttribute('role', 'region'); card.setAttribute('aria-label', $t("{0} 配置", [label]));
          const value = profile;
          const modelListId = `runtime-models-${profile.id}`;
          card.innerHTML = `<form class="runtime-profile-form"><div class="form-grid">
            <div class="form-field runtime-model-field"><label for="${modelListId}-input">${$t("模型名字")}</label><div class="runtime-model-row"><div class="runtime-model-picker"><input id="${modelListId}-input" name="model" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${modelListId}" value="${escape(value.model)}" placeholder="${$t("选择或输入模型")}" autocomplete="off" spellcheck="false" /><button type="button" class="model-picker-toggle" aria-label="${$t("展开模型列表")}" aria-controls="${modelListId}">⌄</button><div id="${modelListId}" class="model-options" role="listbox" aria-label="${$t("模型列表")}" hidden></div></div><button type="button" class="model-refresh" data-refresh-models aria-label="${$t("刷新模型列表")}" title="${$t("刷新模型列表")}">↻</button></div><p class="field-hint" data-model-status>${$t("模型列表：尚未加载。")}</p></div>
            <div class="form-field runtime-effort-field"><label for="${modelListId}-effort">${$t("思考等级")}</label><select id="${modelListId}-effort" name="effort"></select><p class="field-hint" data-effort-status hidden></p></div>
            </div><div class="form-actions"><button type="button" class="ghost-button" data-cancel-runtime>${$t("取消")}</button><button class="primary-button compact" type="submit">${$t("保存配置")}</button><button type="button" class="small-button" data-test-runtime ${profile.enabled ? '' : 'disabled'}>${$t("测试连接")}</button></div>
            <p role="status" data-runtime-result style="overflow-wrap:anywhere;user-select:text"></p></form>`;
          disclosure.append(card);
          const form = card.querySelector('form'), status = card.querySelector('[data-runtime-result]');
          card.querySelector('[data-cancel-runtime]').onclick = () => { closeFloatingLists(card); disclosure.open = false; card.remove(); disclosure.querySelector('summary').focus(); };
          const modelInput = form.elements.model, effortSelect = form.elements.effort;
          const modelStatus = card.querySelector('[data-model-status]'), effortStatus = card.querySelector('[data-effort-status]');
          const modelOptions = card.querySelector('.model-options');
          let activeOption = -1;
          let modelFloating;
          function closeModels() { if(modelFloating)modelFloating.close();else modelOptions.hidden = true; modelInput.setAttribute('aria-expanded', 'false'); modelInput.removeAttribute('aria-activedescendant'); activeOption = -1; }
          function showModels(all = false) { syncModel(all); modelFloating ||= createFloatingList(card.querySelector('.runtime-model-picker'),modelOptions,{maxHeight:226,onClose:()=>{modelInput.setAttribute('aria-expanded','false');modelInput.removeAttribute('aria-activedescendant');activeOption=-1;}});modelFloating.open(); modelInput.setAttribute('aria-expanded', 'true'); }
          function chooseModel(id) { modelInput.value = id; closeModels(); modelInput.dispatchEvent(new Event('input', { bubbles: true })); closeModels(); modelInput.focus(); }
          card.querySelector('.model-picker-toggle').addEventListener('click', () => { if (modelOptions.hidden) { modelInput.focus(); showModels(true); } else closeModels(); });
          modelInput.addEventListener('click', () => showModels(true));
          modelInput.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); closeModels(); return; }
            if (event.key === 'Tab') { closeModels(); return; }
            if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
            if (event.key === 'Enter') { if (!modelOptions.hidden && activeOption >= 0) { event.preventDefault(); chooseModel(modelOptions.children[activeOption].dataset.value); } return; }
            event.preventDefault(); if (modelOptions.hidden) showModels();
            const options = [...modelOptions.querySelectorAll('[role="option"]')]; if (!options.length) return;
            activeOption = activeOption < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (activeOption + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeOption)));
            modelInput.setAttribute('aria-activedescendant', options[activeOption].id); options[activeOption].scrollIntoView({ block: 'nearest' });
          });
          card.querySelector('.runtime-model-picker').addEventListener('mouseleave', closeModels);
          disclosure.addEventListener('toggle', () => { if (!disclosure.open) closeModels(); });
          root.addEventListener('pointerdown', event => { if (!event.target.closest('.runtime-model-picker')) closeModels(); });
          card.addEventListener('focusout', event => { if (!card.querySelector('.runtime-model-picker').contains(event.relatedTarget)) closeModels(); });
          const catalog = { state: 'idle', data: null, error: '', request: 0 };
          const findModel = () => catalog.data?.models?.find(item => item.id === modelInput.value.trim()) || null;
          function syncModel(all = false) {
            if (!profile.installed) { modelStatus.hidden = false; modelStatus.textContent = $t("未安装或客户端找不到可执行文件；安装并配置 PATH 后重新打开客户端。"); return; }
            modelStatus.hidden = catalog.state !== 'failed';
            modelOptions.replaceChildren(); activeOption = -1; modelInput.removeAttribute('aria-activedescendant');
            const query = all ? "" : modelInput.value.trim().toLowerCase();
            if (catalog.state === 'ok') for (const item of catalog.data.models.filter(item => !query || `${item.id} ${item.label || ''}`.toLowerCase().includes(query))) {
              const option = document.createElement('div'); option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false'); option.id = `${modelListId}-${modelOptions.children.length}`;
              option.dataset.value = item.id; option.textContent = runtimeOptionLabel(item.id) + (item.resolvedTo ? ` → ${runtimeOptionLabel(item.resolvedTo)}` : ''); option.title = option.textContent;
              option.addEventListener('mousedown', event => event.preventDefault()); option.addEventListener('click', () => chooseModel(item.id)); modelOptions.append(option);
            }
            if (!modelOptions.children.length) { const empty = document.createElement('p'); empty.textContent = catalog.state === 'loading' ? $t("正在加载…") : catalog.state === 'failed' ? $t("加载失败，可重试或手工输入") : $t("无匹配模型，可手工输入"); modelOptions.append(empty); }
            const model = modelInput.value.trim();
            if (catalog.state === 'loading') modelStatus.textContent = $t("模型列表：正在加载…");
            else if (catalog.state === 'failed') modelStatus.textContent = $t("模型列表加载失败：{0}；仍可手工输入模型名。", [$tm(catalog.error)]);
            else if (catalog.state === 'ok' && !catalog.data.models.length) modelStatus.textContent = $t("模型列表为空（来源：{0}）；可手工输入。", [catalog.data.source]);
            else if (catalog.state === 'ok') {
              const found = findModel();
              modelStatus.textContent = $t("模型列表（{0}）：{1} 个可选，输入即筛选；也可手工输入。", [catalog.data.source, catalog.data.models.length]) + (model ? found ? $t("当前值在列表中{0}。", [found.current ? $t("，为本机当前生效模型") : '']) : $t("当前值不在列表中（手工输入），可保存；实际可用性以连接测试与真实调用为准。") : $t("留空使用 CLI 默认模型。"));
            } else modelStatus.textContent = $t("模型列表：尚未加载。");
          }
          function syncEffort(cleared = '') {
            const previous = effortSelect.value;
            const { options, note } = runtimeEffortOptions(profile.provider, modelInput.value.trim(), catalog.state === 'ok' ? catalog.data : null);
            effortSelect.replaceChildren(...options.map(option => { const element = document.createElement('option'); element.value = option.value; element.textContent = option.label; return element; }));
            if (previous && options.some(option => option.value === previous)) effortSelect.value = previous;
            else if (previous) { effortSelect.value = ''; cleared = $t("原思考等级不适用于当前模型，已清除；保存前请重新选择。"); }
            effortStatus.textContent = cleared || note;
            effortStatus.hidden = !effortStatus.textContent;
          }
          async function loadCatalog(refresh=false) {
            if (!profile.installed) { syncModel(); return; }
            // Sequence every request: a response that returns after the user
            // collapsed the section or refreshed is stale and must never
            // overwrite the newer list or touch the effort options.
            const request = ++catalog.request;
            catalog.state = 'loading'; catalog.error = ''; syncModel();
            const provider = profile.provider;
            try {
              const data = await api(`/api/settings/runtime-profiles/models?provider=${encodeURIComponent(provider)}${refresh?'&refresh=true':''}`);
              if (!form.isConnected || request !== catalog.request) return;
              catalog.data = data; catalog.state = 'ok';
            } catch (error) {
              if (!form.isConnected || request !== catalog.request) return;
              catalog.data = null; catalog.error = error.message; catalog.state = 'failed';
            }
            syncModel(); syncEffort();
          }
          void loadCatalog();
          card.querySelector('[data-refresh-models]').addEventListener('click', () => { catalog.state = 'idle'; loadCatalog(true); });
          modelInput.addEventListener('input', () => { showModels(); syncEffort(); });
          syncModel();
          syncEffort();
          // Setting a select value before its options exist silently no-ops;
          // apply the saved effort only after the option set is built.
          if (value.effort) effortSelect.value = value.effort;
          let dirty = false;
          form.addEventListener('input', () => { dirty = true; status.textContent = $t("尚未保存；请保存后测试。"); });
          const busy = value => { form.dataset.busy = String(value); form.querySelectorAll('input,select,button').forEach(control => { control.disabled = value || Boolean(!profile.enabled && control.hasAttribute('data-test-runtime')); }); };
          form.addEventListener('submit', async event => {
            event.preventDefault(); busy(true);
            const input = Object.fromEntries(['model','effort'].map(key => [key, form.elements[key].value.trim()]));
            try {
              const saved = await api(`/api/settings/runtime-profiles/${encodeURIComponent(profile.id)}`, { method: 'PUT', body: JSON.stringify(input) });
              if (!form.isConnected) return;
              Object.assign(profile, saved); syncSummary(); syncAvailability();
              dirty = false; status.textContent = profile.enabled ? $t("已保存。可测试此配置。") : $t("已保存。启用后可测试。");
            } catch (error) { if (form.isConnected) status.textContent = error.message; }
            finally { busy(false); }
          });
          card.querySelector('[data-test-runtime]')?.addEventListener('click', async () => {
            if (dirty) { status.textContent = $t("请先保存修改，再测试已保存的配置。"); return; }
            busy(true); status.textContent = $t("正在实际调用模型（最长约 90 秒）…");
            try {
              const result = await api(`/api/settings/runtime-profiles/${encodeURIComponent(profile.id)}/test`, { method: 'POST', body: '{}' });
              if (form.isConnected) status.textContent = $t("{0} · {1} 秒。日志：{2} · {3}", [result.ok ? $t("连接测试通过：已收到有效模型应答") : result.timedOut ? $t("连接测试超时") : $t("连接测试失败"), (result.durationMs / 1000).toFixed(1), result.logPath, result.testId]);
            } catch (error) { if (form.isConnected) status.textContent = $t("测试请求失败：{0}", [error.message]); }
            finally { busy(false); }
          });
        });
      }
    } catch (error) { if (container.isConnected) { runtimeLoaded = false; container.innerHTML = `<p role="alert">${escape(error.message)}</p><button class="small-button" data-retry-runtime>${$t("重新读取")}</button>`; } }
  }

  async function loadWorkspace() {
    const container = root.querySelector("[data-workspace-config]");
    workspaceLoaded = true;
    container.innerHTML = `<p role="status">${$t("正在读取配置…")}</p>`;
    try {
      const result = await api("/api/settings/workspace");
      if (!container.isConnected) return;
      if (remoteWorkspace) {
        container.innerHTML = `<div class="settings-group"><h4>${$t("存储位置")}</h4><div class="settings-box">${[[$t("工作目录"),result.workspaceRoot],[$t("配置目录"),result.configurationRoot]].map(([label,path])=>`<div class="settings-row"><strong>${label}</strong><code>${escape(path || '—')}</code></div>`).join('')}</div></div>`;
        return;
      }
      container.innerHTML = `<div class="settings-group"><h4>${$t("存储位置")}</h4><form id="workspace-settings-form"><div class="settings-box"><div class="settings-row settings-row-wrap"><div class="settings-row-text"><label for="default-workspace-root">${$t("工作目录")}</label><small>${$t("任务工作文件、沟通附件和执行资料保存在此目录。")}</small></div><div class="form-field settings-workspace-input"><input id="default-workspace-root" name="workspaceRoot" value="${escape((workspaceLocation=result.workspaceRoot) || "")}" spellcheck="false" required /><div class="field-error" role="alert"></div></div></div><div class="settings-row"><div class="settings-row-text"><strong>${$t("业务资料")}</strong><code data-business-root>${escape(result.businessRoot || '')}</code></div><button type="button" class="ghost-button" data-copy-setting="[data-business-root]">${$t("复制")}</button>${globalThis.window?.batonDesktop?.openWorkspaceDirectory ? `<button type="button" class="small-button" data-open-workspace>${$t("打开工作目录")}</button>` : ''}</div><div class="settings-row"><div class="settings-row-text"><strong>${$t("数据库")}</strong><code data-database-path>${escape(result.databasePath || '')}</code></div><button type="button" class="ghost-button" data-copy-setting="[data-database-path]">${$t("复制")}</button></div><div class="settings-row"><div class="settings-row-text"><strong>${$t("配置目录")}</strong><code data-configuration-root>${escape(result.configurationRoot || '')}</code></div><button type="button" class="ghost-button" data-copy-setting="[data-configuration-root]">${$t("复制")}</button></div></div><p class="field-hint">${$t("默认 ~/.baton/workspace，请输入绝对路径。更换目录会整理应用资料并重启本机服务；有任务或沟通执行时不能更换。已有任务的工作路径保持原位。")}</p><div class="form-actions"><span data-workspace-status role="status"></span><button class="small-button" type="submit" disabled>${$t("保存并整理目录")}</button></div></form></div>`;
      const form = container.querySelector("form");
      form.elements.workspaceRoot.addEventListener('input', () => { form.querySelector('[type="submit"]').disabled = form.elements.workspaceRoot.value.trim() === workspaceLocation; });
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); clearInvalid(form);
        const button = form.querySelector('[type="submit"]'), status = form.querySelector("[data-workspace-status]");
        button.disabled = true; status.textContent = "";
        try {
          const saved = await api("/api/settings/workspace", { method: "PUT", body: JSON.stringify({ workspaceRoot: form.elements.workspaceRoot.value.trim() }) });
          onWorkspaceSaved(saved);
          if (!form.isConnected) return;
          form.elements.workspaceRoot.value = saved.workspaceRoot;
          workspaceLocation = saved.workspaceRoot;
          status.textContent = saved.restarting ? $t("正在整理资料并重启本机服务，请勿退出应用。") : $t("当前已使用此数据目录。");
        } catch (error) { if (form.isConnected) setInvalid(form.elements.workspaceRoot, error.message); }
        finally { button.disabled = form.elements.workspaceRoot.value.trim() === workspaceLocation; }
      });
    } catch (error) {
      if (container.isConnected) container.innerHTML = `<p role="alert">${escape(error.message)}</p><button class="small-button" data-retry-workspace>${$t("重新读取")}</button>`;
    }
  }

  function syncPreferences() {
    if (!root) return;
    const preferences = getPreferences();
    root.querySelectorAll('[name="theme"]').forEach((input) => { input.checked = input.value === preferences.theme; });
    root.querySelectorAll('[name="directoryTheme"]').forEach((input) => { if (input.tagName === 'SELECT') input.value = preferences.directoryTheme; else input.checked = input.value === preferences.directoryTheme; });
    root.querySelectorAll("[data-nav-visible]").forEach((input) => { input.checked = !preferences.hiddenViews.includes(input.dataset.navVisible); });
    root.querySelectorAll("[data-display-option]").forEach((input) => { input.checked = preferences[input.dataset.displayOption]; });
  }

  function changePreferences(value) {
    const saved = updatePreferences(value);
    const status = root.querySelector("[data-preferences-status]");
    status.textContent = saved ? $t("✓ 已保存到当前客户端。") : $t("仅本次生效：当前环境无法保存偏好，刷新后可能恢复默认。");
    status.classList.toggle("error", !saved);
    status.classList.toggle("saved", saved);
    syncPreferences();
  }

  function renderProvider(card, provider) {
    const label = escape(provider.label), id = escape(provider.id);
    card.innerHTML = `<div class="repository-access-card-head"><span class="settings-provider-icon" aria-hidden="true">${id === 'github' ? 'GH' : 'GL'}</span><div class="settings-row-text"><h4>${label}<span class="settings-provider-count">${provider.configured ? $t("已配置") : $t("未配置")}</span></h4><small>HTTPS · ${escape(provider.host)}</small></div>${provider.configured ? `<div class="settings-row-controls"><button type="button" class="small-button" data-edit-git-token aria-expanded="false">${$t("替换")}</button><button type="button" class="ghost-button danger" data-remove-git-token="${id}">${$t("移除")}</button></div>` : ''}</div>
      <form class="git-credential-form" novalidate ${provider.configured ? 'hidden' : ''}><div class="form-field"><label for="git-token-${id}">${label} Token</label><div class="repository-token-row"><input id="git-token-${id}" name="token" type="password" autocomplete="new-password" spellcheck="false" placeholder="${$t("粘贴新的 Token")}" /><button type="submit" class="primary-button compact">${$t("保存 Token")}</button></div><div class="field-error" role="alert"></div><p class="field-hint">${$t("{0} 保存后不会显示原值。", [provider.id === 'github' ? $t("使用具有 Contents: Read 权限的 fine-grained personal access token。") : $t("使用具有 read_repository 权限的 personal access token。")])}</p></div></form>`;
    const form = card.querySelector("form");
    card.querySelector('[data-edit-git-token]')?.addEventListener('click', event => { form.hidden = !form.hidden; event.currentTarget.setAttribute('aria-expanded', String(!form.hidden)); if (!form.hidden) form.elements.token.focus(); else inputClear(form); });
    const busy = (disabled) => card.querySelectorAll("button").forEach((button) => { button.disabled = disabled; });
    const accept = (result) => {
      if (!card.isConnected) return;
      const updated = result.providers?.find((item) => item.id === provider.id);
      if (updated) renderProvider(card, updated);
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); clearInvalid(form);
      const input = form.elements.token;
      if (!input.value.trim()) { setInvalid(input, $t("请粘贴要保存的 Token。若要删除已有 Token，请使用移除操作。")); return; }
      busy(true);
      try {
        const result = await api(`/api/runtime/git-credentials/${encodeURIComponent(provider.id)}`, { method: "PUT", body: JSON.stringify({ token: input.value }) });
        input.value = "";
        accept(result);
        notify($t("{0} Token 已保存；原值不会回显。", [provider.label]));
      } catch (error) { busy(false); notify(error.message, true); }
    });
    card.querySelector("[data-remove-git-token]")?.addEventListener("click", async () => {
      if (!await confirmDialog({ title: $t("移除拉取 Token"), message: $t("移除 {0} 的本机拉取 Token？之后私有 HTTPS 仓库将改用本机 Git 的其他认证方式或无法拉取。", [provider.label]), confirmLabel: $t("移除 Token"), danger: true })) return;
      busy(true);
      try {
        const result = await api(`/api/runtime/git-credentials/${encodeURIComponent(provider.id)}`, { method: "DELETE", body: "{}" });
        inputClear(form); accept(result); notify($t("{0} Token 已移除。", [provider.label]));
      } catch (error) { busy(false); notify(error.message, true); }
    });
  }

  function inputClear(container) {
    container.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
  }

  async function loadRepositories() {
    const content = root.querySelector("#git-credential-config");
    repositoriesLoaded = true;
    content.innerHTML = `<div class="empty-state"><strong>${$t("正在读取本机配置")}</strong>${$t("不会回显已保存的 Token。")}</div>`;
    try {
      const configuration = await api("/api/runtime/git-credentials");
      if (!content.isConnected) return;
      content.replaceChildren();
      for (const provider of configuration.providers || []) {
        if (!["github", "gitlab"].includes(provider.id)) continue;
        const card = content.ownerDocument.createElement("section");
        card.className = "repository-access-card"; card.dataset.gitProvider = provider.id;
        content.append(card); renderProvider(card, provider);
      }
      if (!content.children.length) content.innerHTML = `<div class="empty-state"><strong>${$t("没有可配置的代码托管平台")}</strong><button class="small-button" data-retry-repositories>${$t("重新读取")}</button></div>`;
    } catch (error) {
      if (content.isConnected) content.innerHTML = `<div class="empty-state"><strong>${$t("仓库访问配置读取失败")}</strong><p>${escape(error.message)}</p><button class="small-button" data-retry-repositories>${$t("重新读取")}</button></div>`;
    }
  }

  const remoteWorkspace = Boolean(globalThis.document?.querySelector('meta[name=baton-remote-workspace]'));
  async function loadCurrentWorkspace() {
    const panel = root?.querySelector('[data-current-workspace]');
    if (!panel) return;
    try {
      const info = await api('/api/settings/current-workspace');
      if (!panel.isConnected) return;
      const devices = info.devices || [];
      const row = (title,value) => `<div class="workspace-fact"><strong>${escape(title)}</strong><span>${escape(value || '—')}</span></div>`;
      const expanded = panel.querySelector("details")?.open;
      const device = devices.find(item => item.id === info.deviceId);
      panel.innerHTML = `<div class="settings-group"><h4>${$t("当前工作空间")}</h4><div class="settings-box">
        ${row($t("名称"),info.name)}${row($t("当前机器"),device?.label)}${row($t("当前账号"),info.username)}
        ${info.origin ? row(info.local ? $t("工作空间地址") : $t("登录地址"),info.origin) : ''}${info.connectionError ? row($t("无法连接"),info.connectionError) : ''}${info.fingerprint ? `<details class="workspace-cert" ${expanded ? 'open' : ''}><summary>${$t("证书指纹")}</summary><code>${escape(info.fingerprint)}</code></details>` : ''}</div></div>
        <div class="settings-group"><h4>${$t("当前账号登录的设备")}</h4><div class="settings-box">
        ${devices.map(item => row(item.label, [item.lastAddress?.replace(/^::ffff:/i,''), item.id === info.deviceId ? $t("当前设备") : item.lastSeen ? new Date(item.lastSeen).toLocaleString() : $t("本机工作空间")].filter(Boolean).join(' · '))).join('')}</div></div>`;
    } catch (error) { if (panel.isConnected) panel.textContent = error.message; }
  }
  function mount(target, page = "general") {
    if (page === "devices" || page === "workspace") page = "workspaces";
    const host = globalThis.window?.batonDesktop;
    if (root !== target) {
      root = target;
      root.innerHTML = `<div class="settings-layout">
        <nav class="settings-nav" aria-label="${$t("设置分类")}">${[[$t("通用"),['general','appearance','workspaces']],[$t("集成"),['runtime','cli','repositories']],[$t("系统"),['updates','logs']]].map(([group,ids]) => `<div class="settings-nav-group"><span>${group}</span>${ids.map(id => `<button type="button" data-settings-page="${id}">${settingsIcon(id)}${SETTINGS_PAGES[id]}</button>`).join('')}</div>`).join('')}</nav>
        <div class="settings-content">
          <section class="settings-section" data-settings-panel="general" hidden>
            <h3>${$t("常规")}</h3><p class="settings-description">${$t("常规设置即时生效，自动保存在当前客户端。")}</p>
            <div class="settings-group"><h4>${$t("语言")}</h4><div class="settings-box"><form data-language-form class="settings-row"><div class="settings-row-text"><strong><label for="settings-language">${$t("界面语言")}</label></strong><small data-language-status>${$t("切换后界面立即重新加载；跟随系统使用 macOS 首选语言。")}</small></div><select id="settings-language" name="language" disabled>${LANGUAGE_PREFERENCES.map(value => `<option value="${value}">${value === "system" ? $t("跟随系统") : LOCALE_NAMES[value]}</option>`).join("")}</select></form></div></div>
            <div class="settings-group"><h4>${$t("窗口")}</h4><div class="settings-box"><form data-close-form class="settings-row"><div class="settings-row-text"><strong>${$t("关闭主窗口时")}</strong><small>${$t("Cmd+Q 始终退出程序。")}</small></div><fieldset class="settings-radio-group settings-segmented"><legend class="visually-hidden">${$t("关闭主窗口时")}</legend><label class="settings-radio-option"><input type="radio" name="closeMode" value="quit" disabled /><span>${$t("退出程序")}</span></label><label class="settings-radio-option"><input type="radio" name="closeMode" value="tray" disabled /><span>${$t("保留在菜单栏")}</span></label></fieldset><button class="primary-button compact" type="submit" disabled>${$t("保存")}</button></form></div><p data-close-status class="settings-status" role="status">${$t("正在读取客户端偏好…")}</p><button class="small-button" data-close-retry hidden>${$t("重试")}</button></div>

            <div class="settings-group"><h4>${$t("账号")}</h4><div class="settings-box"><div class="settings-row"><span class="settings-account-avatar" aria-hidden="true">${$t("我")}</span><div class="settings-row-text"><strong data-settings-account>${$t("本机管理员")}</strong><small>${$t("本机单管理员 · CLI 与客户端共用登录授权。")}</small></div><button type="button" class="small-button" id="logout-button">${$t("退出登录")}</button></div></div></div>
          </section>
          <section class="settings-section" data-settings-panel="appearance" aria-labelledby="appearance-title" hidden>
            <h3 id="appearance-title">${$t("外观")}</h3><p class="settings-description">${$t("外观与展示偏好保存在当前客户端，选择后立即生效。")}</p>
            <div class="settings-group"><h4>${$t("外观模式")}</h4><fieldset class="theme-options appearance-options"><legend class="visually-hidden">${$t("外观模式")}</legend>${THEMES.map(({id,label,description}) => `<label class="theme-option" title="${escape(description)}"><span class="theme-preview ${id}" aria-hidden="true"><i></i><span><b></b><em></em><em></em></span></span><span class="theme-option-label"><strong>${label}</strong><input type="radio" name="theme" value="${id}" /></span></label>`).join('')}</fieldset></div>
            <div class="settings-group"><h4>${$t("显示")}</h4><div class="settings-box"><label class="settings-row"><span class="settings-row-text"><strong>${$t("工作目录图标")}</strong><small>${$t("文件树图标与选中文件的内容配色；不影响协作和控制台。")}</small></span><select name="directoryTheme" aria-label="${$t("工作目录主题")}">${DIRECTORY_THEMES.map(theme => `<option value="${theme.id}">${escape(theme.label)}</option>`).join('')}</select></label></div></div>
            <div class="settings-group"><div class="settings-section-heading"><h4 id="navigation-title">${$t("侧栏展示")}</h4><button type="button" class="ghost-button" data-reset-navigation>${$t("恢复默认")}</button></div><p class="settings-description">${$t("设置始终显示。隐藏入口不影响已有链接、任务执行或访问权限。")}</p><div class="navigation-options">${NAVIGATION.map(({id,label}) => `<label class="settings-toggle"><span>${label}</span><input type="checkbox" role="switch" data-nav-visible="${id}" aria-label="${$t("显示{0}", [label])}" /></label>`).join('')}</div><div class="settings-box settings-navigation-details">${[['showGroups',$t("分组标题"),$t("工作 / 组织 / 扩展；空分组自动隐藏。")],['showIcons',$t("导航图标"),$t("窄窗口始终保留图标，方便识别入口。")]].map(([id,label,hint]) => `<label class="settings-row settings-toggle"><span class="settings-row-text"><strong>${label}</strong><small>${hint}</small></span><input type="checkbox" role="switch" data-display-option="${id}" aria-label="${$t("显示{0}", [label])}" /></label>`).join('')}</div></div>
            <div class="settings-group"><h4>${$t("提醒")}</h4><div class="settings-box">${[['showCounts',$t("任务待处理提醒"),$t("只显示待你回复、验收或处理的任务数；零值不显示。")],['showUnread',$t("沟通未读提醒"),$t("显示员工新回复的未读数；看到最新记录后清零。")]].map(([id,label,hint]) => `<label class="settings-row settings-toggle"><span class="settings-row-text"><strong>${label}</strong><small>${hint}</small></span><input type="checkbox" role="switch" data-display-option="${id}" aria-label="${$t("显示{0}", [label])}" /></label>`).join('')}</div></div>
            <p class="settings-save-status" data-preferences-status role="status">${$t("外观和展示偏好自动保存在当前客户端。")}</p>
          </section>
          <section class="settings-section" data-settings-panel="workspaces" hidden>
            <h3>${$t("工作空间")}</h3>
            <div data-current-workspace></div>
            <div class="settings-group" data-local-only><h4>${$t("本机服务")}</h4><div class="settings-box"><label class="settings-row settings-toggle"><span class="settings-row-text"><strong>${$t("常驻后台运行")}</strong><small data-resident-status role="status">${$t("正在读取本机服务…")}</small></span><input type="checkbox" role="switch" data-resident-toggle aria-label="${$t("常驻后台运行")}" disabled /></label></div></div>
            <div data-workspace-config></div>
            <div class="settings-group" data-local-only><h4 id="data-management-title">${$t("危险操作")}</h4><div class="settings-box settings-danger-zone"><div class="settings-row"><div class="settings-row-text"><strong>${$t("清除所有数据")}</strong><small>${$t("删除业务数据库和整个当前工作目录，保留设置与登录。")}</small></div><button type="button" class="small-button danger" data-reset-all>${$t("清除所有数据")}</button></div></div><p class="field-hint">${$t("包括当前工作目录中的所有文件和业务记录；配置目录中的账号、认证、Runtime、插件、MCP、Git 凭据、偏好和日志保留。")}</p></div>
          </section>
          <section class="settings-section" data-settings-panel="runtime" aria-labelledby="runtime-title" hidden>
            <h3 id="runtime-title">${$t("运行时")}</h3><p class="settings-description">${$t("启用的运行时可被员工选择。模型与思考等级留空时使用 CLI 默认配置，保存后用于之后的调用。")}</p><div class="repository-access-grid settings-box" data-runtime-config></div>
          </section>
          <section class="settings-section" data-settings-panel="cli" hidden>
            <h3>CLI</h3><p class="settings-description">${$t("在终端中使用 baton 配置员工、团队、工作流、插件与 MCP，创建和查询任务。")}</p>
            <div class="settings-group"><div class="settings-box"><div class="settings-row"><span class="settings-provider-icon" aria-hidden="true">${settingsIcon('cli')}</span><div class="settings-row-text"><strong>baton</strong><small data-cli-status role="status">${$t("正在检查 CLI 安装…")}</small></div><div class="settings-row-controls"><button type="button" class="ghost-button" data-cli-refresh>${$t("刷新")}</button><button type="button" class="small-button" data-cli-install disabled>${$t("安装 CLI")}</button></div></div><pre class="settings-paths" data-cli-paths></pre></div></div>
            <div class="settings-group"><h4>${$t("快速开始")}</h4><pre class="settings-code">baton help\nbaton schema agents\nbaton tasks list --json</pre></div>
          </section>
          <section class="settings-section" data-settings-panel="repositories" aria-labelledby="repositories-title" hidden>
            <h3 id="repositories-title">${$t("仓库访问")}</h3><p class="settings-description">${$t("Token 仅用于拉取私有仓库，保存后不回显。")}</p><div id="git-credential-config" class="repository-access-grid settings-box" aria-live="polite"></div>
          </section>
          <section class="settings-section" data-settings-panel="updates" hidden>
            <h3>${$t("更新")}</h3><p class="settings-description">${$t("按所选渠道检查更新；不会自动下载，也不会打断正在执行的任务。")}</p>
            <section class="settings-group settings-update-module" aria-labelledby="app-update-title"><h4 id="app-update-title">${$t("应用")}</h4><div class="settings-box"><div class="settings-row"><img src="/icons/application-ui.png" alt="" width="28" height="28"><div class="settings-row-text"><strong>Baton</strong><small><span data-app-version>${$t("正在读取当前版本…")}</span> · <a data-app-github href="https://github.com/dengdai68/Baton" target="_blank" rel="noopener noreferrer">GitHub</a></small></div><button type="button" class="small-button" data-app-update-check>${$t("检查更新")}</button></div><form class="settings-row" data-app-update-channel-form><div class="settings-row-text"><strong><label for="settings-update-channel">${$t("更新渠道")}</label></strong><small>${$t("稳定版只接收正式版；Beta 版同时接收测试版。切换后立即检查，不会降级。")}</small></div><select id="settings-update-channel" name="updateChannel" data-app-update-channel disabled><option value="stable">${$t("稳定版（正式版）")}</option><option value="beta">${$t("Beta 版（测试版）")}</option></select></form><div class="settings-row"><div class="settings-row-text"><small data-app-update-status role="status" aria-live="polite">${$t("正在读取更新状态…")}</small></div><div class="settings-row-controls"><button type="button" class="primary-button compact" data-app-update-download hidden>${$t("下载更新")}</button><button type="button" class="primary-button compact" data-app-update-install hidden>${$t("重启并安装")}</button></div></div><div class="app-update-progress-row" data-app-update-progress hidden><progress class="app-update-progress" max="100" value="0" aria-label="${$t("安装包下载进度")}"></progress><span data-app-update-percent aria-hidden="true">0%</span></div></div><p class="field-hint" data-app-update-note></p></section>
          </section>
          <section class="settings-section" data-settings-panel="logs" hidden>
            <h3>${$t("运行日志")}</h3><p class="settings-description">${$t("任务、私聊、群聊与本机服务的详细诊断写入本机文件，这里只显示路径。")}</p>
            <div class="settings-group"><div class="settings-box"><div class="settings-row"><div class="settings-row-text"><strong>${$t("日志目录")}</strong><code data-log-directory>${$t("正在读取…")}</code></div><div class="settings-row-controls"><button class="ghost-button" data-copy-setting="[data-log-directory]">${$t("复制")}</button><button class="small-button" data-logs-refresh>${$t("刷新路径")}</button></div></div><div class="settings-row"><div class="settings-row-text"><strong>${$t("当前服务日志")}</strong><code data-log-file>${$t("正在读取…")}</code></div><button class="ghost-button" data-copy-setting="[data-log-file]">${$t("复制")}</button></div></div><p class="settings-status" data-log-status role="status">${$t("正在读取…")}</p></div>
            <div class="settings-note"><strong>${$t("排查「找不到 CLI」")}</strong><p>${$t("在日志中搜索")} <code>provider.launch_diagnostic</code>${$t("，其中包含实际 PATH、目录检查与逐项建议；原始错误在同次调用的")} <code>provider.spawn_error / provider.stderr</code> ${$t("中。分享日志前请检查敏感内容。")}</p></div>
            <details class="settings-explanation"><summary>${$t("保留策略")}</summary><p>${$t("JSONL 格式，保留错误原文、堆栈、进程退出信息及脱敏诊断输出。每进程独立文件，10 MiB 分卷；旧文件按 256 MiB 总量、30 天期限清理，当前分卷保留。默认位于 ~/.baton/logs/&lt;实例标识&gt;。请在运行服务的机器上打开路径。旧版本未保存的错误无法恢复。")}</p></details>
          </section>
        </div></div>`;
      const layout = root.firstElementChild;
      api('/api/auth/session').then(account => { if (layout.isConnected && account.username) layout.querySelector('[data-settings-account]').textContent = account.username; }).catch(() => {});
      closePreferenceUI = createClosePreferenceUI(root.querySelector('[data-settings-panel="general"]'), globalThis.window?.batonDesktop);
      if (remoteWorkspace) root.querySelectorAll('[data-local-only]').forEach(section => {section.hidden=true;});
      residentServiceUI = createResidentServiceUI(root.querySelector('[data-settings-panel="workspaces"]'), globalThis.window?.batonDesktop);
      languagePreferenceUI = createLanguagePreferenceUI(root.querySelector('[data-settings-panel="general"]'), globalThis.window?.batonDesktop);
      const cliPanel = root.querySelector('[data-settings-panel="cli"]');
      cliInstallationUI = createCliInstallationUI(cliPanel, host);
      appUpdateUI = createAppUpdateUI(root.querySelector('[data-settings-panel="updates"]'), host);
      globalThis.window?.addEventListener("focus", refreshHostSettings);
      layout.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (button?.dataset.copySetting) {
          const value = layout.querySelector(button.dataset.copySetting)?.textContent?.trim();
          if (value && value !== $t("正在读取…")) void navigator.clipboard.writeText(value).then(() => notify($t("路径已复制。"))).catch(error => notify($t("复制失败：{0}", [error.message]), true));
        }
        if (button?.hasAttribute('data-open-workspace')) void host?.openWorkspaceDirectory?.().catch(error => notify(error.message, true));
        if (button?.hasAttribute("data-reset-all")) confirmDataReset();
        if (button?.dataset.settingsPage) navigate(button.dataset.settingsPage);
        if (button?.hasAttribute("data-logs-refresh")) loadLogs();
        if (button?.hasAttribute("data-retry-repositories")) loadRepositories();
        if (button?.hasAttribute("data-retry-workspace")) loadWorkspace();
        if (button?.hasAttribute("data-retry-runtime")) loadRuntimes();
        if (button?.hasAttribute("data-reset-navigation")) {
          const defaults = normalizePreferences(null);
          changePreferences({ ...getPreferences(), hiddenViews: defaults.hiddenViews, showGroups: defaults.showGroups, showIcons: defaults.showIcons, showCounts: defaults.showCounts, showUnread: defaults.showUnread });
        }
      });
      layout.addEventListener("change", (event) => {
        const input = event.target, preferences = getPreferences();
        if (input.name === "theme") changePreferences({ ...preferences, theme: input.value });
        if (input.name === "directoryTheme") changePreferences({ ...preferences, directoryTheme: input.value });
        if (input.dataset.navVisible) changePreferences({ ...preferences, hiddenViews: input.checked ? preferences.hiddenViews.filter((id) => id !== input.dataset.navVisible) : [...preferences.hiddenViews, input.dataset.navVisible] });
        if (input.dataset.displayOption) changePreferences({ ...preferences, [input.dataset.displayOption]: input.checked });
      });
    }
    syncPreferences();
    root.querySelectorAll("[data-settings-page]").forEach((button) => {
      const selected = button.dataset.settingsPage === page || (page === "workspace" && button.dataset.settingsPage === "workspaces");
      button.classList.toggle("active", selected);
      if (selected) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    root.querySelectorAll("[data-settings-panel]").forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== page; });
    if (currentPage !== page) {
      ++logRequest; currentPage = page;
      clearInterval(deviceRefreshTimer);
      if (page === "workspaces") {
        void loadCurrentWorkspace();
        deviceRefreshTimer=setInterval(()=>{if (!document.hidden) void loadCurrentWorkspace();},15000);
      }
      refreshHostSettings();
      if (page === "logs") loadLogs();
    }
    if (page === "repositories" && !repositoriesLoaded) loadRepositories();
    if (page === "workspaces" && !workspaceLoaded) loadWorkspace();
    if (page === "runtime" && !runtimeLoaded) loadRuntimes();

    root.querySelector("[data-preferences-status]").hidden = page !== "appearance";
  }

  function unmount() {
    globalThis.window?.removeEventListener("focus", refreshHostSettings);
    closePreferenceUI?.dispose(); closePreferenceUI = null; languagePreferenceUI?.dispose(); languagePreferenceUI = null; residentServiceUI?.dispose(); residentServiceUI = null;
    cliInstallationUI?.dispose(); cliInstallationUI = null;
    appUpdateUI?.dispose(); appUpdateUI = null;
    ++logRequest;
    currentPage = null;
    if (root) { closeFloatingLists(root); inputClear(root); root.replaceChildren(); }
    clearInterval(deviceRefreshTimer);
    root = null; repositoriesLoaded = false; workspaceLoaded = false; runtimeLoaded = false;
  }
  return { mount, unmount, syncPreferences };
}
