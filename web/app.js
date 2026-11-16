import { $t, $tm, localizeStatic, currentLocale, intlLocale } from "../client/i18n.mjs";
import { captureConsoleReading, restoreConsoleReading, followConsoleLatest, onConsoleLatest, readConsoleTail } from './console-stream.mjs';
import { createToast } from './toast.mjs';
import {runtimeLabel,RUNTIME_IDS} from "../client/runtime-providers.mjs";
import { workflowConnections } from '/client/workflow-description.mjs';
import { createWorkflowEditor } from './workflow-editor.mjs';
import { ByteCache } from "/client/byte-cache.mjs";
import { createAutomationUI } from "./automations.mjs";
import { disposeManualGraphs, disposeWorkflowGraphs, fitManualGraph, fitWorkflowGraph, formatWorkflowGraph, resetWorkflowGraph, zoomWorkflowGraph, mountManualGraph, mountWorkflowGraph, zoomManualGraph } from "./manual-graphs.mjs";
import { insertComposerLineBreak, communicationDayLabel, imageAttachment, attachmentControls, draftAttachments, messageAttachments, outgoingMessageFeedback, outgoingAttachmentMarkup, attachmentImageError, openAttachmentImage, downloadAttachment, createCommunicationUI, formatCommunicationContent, memberMentionMarkup, employeeDetailMarkup } from "./communication.js";
import { applyPreferences, NAVIGATION, normalizePreferences, PREFERENCES_KEY, readPreferences, savePreferences } from "./preferences.mjs";
import { createSettingsUI } from "./settings.mjs";
import { createMarketplaceUI, createMcpMarketplaceUI, createEmployeeMultiSelect, extensionAvatarColor } from "./marketplace.mjs";
import { paginate, paginationMarkup } from "./pagination.mjs";
import { createFloatingList, closeFloatingList, closeFloatingLists } from './floating-list.mjs';
import { consoleContentTokens, consoleEventWindow, editDiff, isShellTool, shellCommandText, shellTokens, toolCommandSummary, toolEditInput, toolFileInput, workingDirectoryIcon } from "/client/console-projections.mjs";
import { EVENT_KIND_LABEL as KIND_LABEL, STATUS_TEXT as statusText, buildConsoleEntries, classifyEvent, collaborationRecords, displayText, formatExactTime as exactTime, formatMessageTime, formatRelativeTime as timeAgo, isTransportFrame, mentionables, providerLabel, roleExecutionStatus, taskActionLabel, taskMatchesFilter, taskNeedsAttention, workspaceAgents, workflowFocus } from "/client/console-projections.mjs";

/* Baton Console：任务空间信息架构 + 轻盈视觉系统。
   视图：overview / tasks / teams / agents / workspace（普通任务与自动化共用任务空间）。 */
function routeFromLocation() {
  const automation = location.pathname.match(/^\/automations(?:\/([^/]+))?$/);
  if (automation) return { view: "automations", automationId: automation[1] || null, runId: null };
  const settings = location.pathname.match(/^\/settings(?:\/(general|appearance|workspace|cli|repositories|runtime|updates|logs))?$/);
  if (settings) return { view: "settings", runId: null, settingsPage: settings[1] || "general" };
  const chat = location.pathname.match(/^\/communication(?:\/([^/]+))?$/);
  if (chat) return { view: "communication", runId: null, chatId: chat[1] || null };
  const match = location.pathname.match(/^\/runs\/([^/]+)$/);
  if (match) return { view: "workspace", runId: decodeURIComponent(match[1]) };
  const manualMatch = location.pathname.match(/^\/manual\/(data-model|system-architecture|task-flow)$/);
  if (manualMatch) return { view: "manual", runId: null, manualPage: manualMatch[1] };
  if (location.pathname === "/tasks/archive") return { view: "tasks", runId: null, taskArchiveView: true };
  const view = location.pathname.replace(/^\//, "") || location.hash.slice(1) || "inbox";
  return { view: ["inbox", "overview", "tasks", "teams", "workflows", "agents", "roles", "manual", "marketplace", "mcp-marketplace"].includes(view) ? view : "tasks", runId: null, manualPage: "data-model" };
}
const initialRoute = routeFromLocation();
const state = {
  automationId: initialRoute.automationId || null,
  agents: [], teams: [], tasks: [], runs: [], events: [], workflowTemplates: [], roles: [],
  workspace: null, selectedRunId: initialRoute.runId, selectedAgentId: null,
  taskChip: "all", taskSearch: { name: "", status: "all", workflow: "all" }, taskArchiveView: Boolean(initialRoute.taskArchiveView),
  currentView: initialRoute.view, manualPage: initialRoute.manualPage || "data-model",
  settingsPage: initialRoute.settingsPage || "general",
  selectedChatId: initialRoute.chatId || null,
  eventSource: null, listPages: { tasks: 1, archive: 1, teams: 1, workflows: 1, agents: 1, roles: 1 },
};
// Local interaction state is scoped to a Run; it never changes domain state.
const workspaceViews = new Map();
const consolePages = new Map();
const vendorLoads = new Map();
function loadVendor(name) {
  if (!vendorLoads.has(name)) vendorLoads.set(name, new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = `/vendor/${name}.js`; script.async = true;
    script.onload = resolve; script.onerror = () => { script.remove(); vendorLoads.delete(name); reject(new Error($t("展示组件加载失败，请刷新重试"))); };
    document.head.append(script);
  }));
  return vendorLoads.get(name);
}
let workspaceRequest = 0;
let workspaceRefreshTimer;
let consoleRenderTimer;
let collaborationBodyObserver;
let bootstrapPromise;
let bootstrapView;
let refreshRequest = 0;
let catalogPromise;
let resetRequestActive = false;
function consolePage(runId, agentId) {
  const key = `${runId}:${agentId}`;
  if (!consolePages.has(key)) consolePages.set(key, { events: [], loaded: false, loading: false, hasMore: false, nextBefore: null, request: 0, traceId: null });
  return consolePages.get(key);
}
function workspaceView(runId = state.selectedRunId) {
  if (!workspaceViews.has(runId)) workspaceViews.set(runId, { draft: "", disclosures: {}, consoleViews: new Map(), collaborationScroll: null, directory: null, directoryRequest: 0, fileRequest: 0, selectedPath: null, filePreview: null, directoryOpen: Object.create(null), directoryScroll: Object.create(null), changes: null, changesLoading: false, changesRequest: 0, diffRequest: 0, selectedDiffPath: null, diffPreview: null, tab: "collaboration" });
  return workspaceViews.get(runId);
}
function retryableDispatches(workspace = {}) {
  const run = workspace.run;
  if (!run || run.task?.archivedAt) return [];
  return (workspace.dispatches || []).filter((item) => item.status === "queued" && item.nextRetryAt && (["planning", "running", "review"].includes(run.status) || item.interactionOnly));
}
function failedRunRecovery(workspace = {}) {
  const run = workspace.run;
  if (!run || run.status !== "failed" || run.task?.archivedAt) return null;
  if (run.failure?.phase === "workspace_baseline_missing") return null;
  const nodeIds = [...new Set((workspace.traces || []).filter(trace => {
    if (trace.status !== "failed" || !["node", "instruction", "consultation"].includes(trace.type)) return false;
    const delivery = (workspace.dispatches || []).find(item => item.traceIds.includes(trace.id));
    if (run.failure?.dispatchId && delivery?.id !== run.failure.dispatchId) return false;
    return !delivery || (!delivery.interactionOnly && !delivery.escalatedAt && ["cancelled", "queued"].includes(delivery.status) && delivery.traceIds.at(-1) === trace.id);
  }).map(trace => trace.workflowNodeId))];
  return nodeIds.length ? { type: "node", nodeIds } : { type: "orchestration", nodeIds: [] };
}
function failedRunMessage(workspace = {}) {
  const failure = workspace.run?.failure;
  if (failure?.message) { const active = (workspace.traces || []).filter(trace => trace.status === "running").length; return $tm(failure.message) + (active ? $t("\n另有 {0} 名员工正在收尾，结束后可重试。", [active]) : ""); }
  return failedRunRecovery(workspace)?.type === "node"
    ? $t("已有失败的业务调用；请选择需要由原员工继续的职责。")
    : $t("本轮没有完成；请查看保留的调用记录 与协作记录。");
}
function acceptanceReview(workspace = {}, { history = false } = {}) {
  const run = workspace.run;
  if (!run || !(history ? ["awaiting_acceptance", "completed"].includes(run.status) : run.status === "awaiting_acceptance" && !run.task?.archivedAt)) return null;
  const review = run.deliveryReview && typeof run.deliveryReview === "object" && !Array.isArray(run.deliveryReview) ? run.deliveryReview : {};
  const findings = run.acceptanceRequest?.summary ? [run.acceptanceRequest.summary] : Array.isArray(review.findings)
    ? review.findings.filter((finding) => typeof finding === "string" && finding.trim()).map((finding) => finding.trim())
    : [];
  const criteria = Array.isArray(run.task?.acceptanceCriteria)
    ? run.task.acceptanceCriteria.filter((criterion) => typeof criterion === "string" && criterion.trim()).map((criterion) => criterion.trim())
    : [];
  const artifacts = workspace.artifacts || [];
  const reviewTrace = (workspace.traces || []).find((trace) => trace.id === (run.acceptanceRequest?.traceId || review.traceId)) || (workspace.traces || []).find((trace) => trace.type === "delivery_review" && trace.status === "completed");
  return {
    verified: true,
    findings,
    criteria,
    artifactCount: run.artifactCount ?? artifacts.length,
    reviewTraceId: reviewTrace?.id || null,
  };
}

const $ = (selector) => document.querySelector(selector);
const toast = createToast($('#toast'));
const $$ = (selector) => [...document.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const statusTone = status => ({ running:'running', planning:'planning', review:'planning', awaiting_human:'attention', awaiting_acceptance:'attention', blocked:'failed', failed:'failed', done:'done', completed:'done' })[status] || 'neutral';
const statusShape = status => {
  const shapes = {
    running:'<path d="M14 8a6 6 0 1 1-6-6"/><path d="M8 2a6 6 0 0 1 6 6" stroke-dasharray="2 2"/>',
    planning:'<path d="m8 2 6 6-6 6-6-6z"/>',
    awaiting_human:'<circle cx="8" cy="8" r="6"/><path d="M6.5 6a1.5 1.5 0 0 1 3 .4c0 1-1.5 1.1-1.5 2.3M8 10.8v.2"/>',
    awaiting_acceptance:'<rect x="4" y="2.5" width="8" height="11" rx="1"/><path d="m6 8 1.5 1.5L10 6.5"/>',
    failed:'<circle cx="8" cy="8" r="6"/><path d="m6 6 4 4m0-4-4 4"/>',
    blocked:'<path d="m8 2 6 11H2zM8 6v3m0 1.5v.5"/>',
    paused:'<circle cx="8" cy="8" r="6"/><path d="M6.5 5.5v5m3-5v5"/>',
    done:'<circle cx="8" cy="8" r="6"/><path d="m5 8 2 2 4-4"/>',
    cancelled:'<circle cx="8" cy="8" r="6"/><path d="M5 8h6"/>',
    backlog:'<circle cx="8" cy="8" r="6" stroke-dasharray="2 2"/>',
  };
  const key = status === 'completed' ? 'done' : status === 'review' ? 'planning' : status;
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[key] || shapes.backlog}</svg>`;
};
const pill = status => `<span class="status-pill" data-status-tone="${statusTone(status)}"><span aria-hidden="true">${statusShape(status)}</span>${esc(statusText[status] || status)}</span>`;
const roleColor = (agent) => `color-${agent?.color || "system"}`;
/** Avatar glyph: one character (Han or uppercase Latin) so every avatar size stays legible. */
const initialsOf = (agent) => (Array.from(agent?.name || agent?.initials || "?")[0] || "?").toLocaleUpperCase();
const workspaceSummary = (task = {}) => task.workspaceKind === "managed" ? $t("系统受管目录") : $t("既有工作目录");

// Frozen user requirements remain visible at human confirmation.
function acceptanceCriteriaMarkup(acceptance) {
  const standards = acceptance.criteria.length ? `<ul>${acceptance.criteria.map((criterion) => `<li>${esc(criterion)}</li>`).join("")}</ul>` : `<p>${$t("此任务没有单独记录验收标准。")}</p>`;
  return standards;
}


/* ---------- API ---------- */
async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  if (response.status === 401) { if (!resetRequestActive) location.replace(`/login?next=${encodeURIComponent(location.pathname + location.search)}`); throw new Error($t("登录已失效，请重新登录")); }
  const body = await response.json();
  // Server texts are translated once here, so every toast and composed message inherits it.
  if (!response.ok) throw new Error($tm(body.error) || $t("请求失败"));
  return body;
}
const directoryResources={tasks:['tasks','tasks'],agents:['agents','agents'],teams:['teams','teams'],roles:['roles','roles'],workflows:['workflow-templates','workflowTemplates']};
let directoryRequest=0, directoryTimer;
async function refreshDirectory({ paint = false } = {}) {
  const view=state.currentView, resource=directoryResources[view]; if(!resource)return;
  const key=view==='tasks'&&state.taskArchiveView?'archive':view;
  const requestedPage=state.listPages[key]||1;
  const query=new URLSearchParams({page:String(requestedPage)});
  if(view==='tasks') {if(!state.taskArchiveView){query.set('page','1');query.set('pageSize','100');}query.set('search',state.taskSearch.name);query.set('status',state.taskSearch.status);query.set('workflow',state.taskSearch.workflow);query.set('archived',String(state.taskArchiveView));}
  else query.set('search',$(`#${view}-search`)?.value||'');
  if(view==='agents')query.set('role',$('#agents-role-filter')?.value||'');
  const request=++directoryRequest;
  state.directoryStatus ||= {};
  const status=state.directoryStatus[key]={loading:true,error:null};
  if(paint)render();
  try {
  let result=await api(`/api/${resource[0]}?${query}`);
  if (view === 'tasks' && !state.taskArchiveView) {
    // The existing endpoint accepts one exact status. Read bounded pages before
    // applying composite client views, so counts and pagination never omit matches.
    const candidates = [...result.tasks];
    while (result.page < result.totalPages) {
      if (request !== directoryRequest || view !== state.currentView) return;
      query.set('page', String(result.page + 1));
      result = await api(`/api/tasks?${query}`);
      candidates.push(...result.tasks);
    }
    if (request !== directoryRequest || view !== state.currentView) return;
    state.taskCandidates = candidates;
    const page = paginate(candidates.filter(task => taskMatchesChip(task.status, state.taskChip || 'all')).sort((left,right) => taskGroupOrder(left.status) - taskGroupOrder(right.status)), requestedPage);
    result = { ...page, tasks: page.items };
  }
  if(request!==directoryRequest||view!==state.currentView)return;
  const items=result[resource[1]];
  state.directoryPages ||= {};state.directoryPages[key]={...result,items};state.listPages[key]=result.page;
  // References stay lightweight; full edit data belongs only to the current page.
  state[resource[1]]=items;
  if(view==='tasks')state.runs=items.flatMap(task=>task.runs||[]);
  } catch(error) {
    if(request===directoryRequest && view===state.currentView)status.error=error.message;
    throw error;
  } finally {
    if(request===directoryRequest && view===state.currentView){status.loading=false;if(paint)render();}
  }
}
function queryDirectorySoon() {++directoryRequest;clearTimeout(directoryTimer);directoryTimer=setTimeout(()=>refreshDirectory({paint:true}).catch(error=>toast(error.message,true)),180);}
async function loadCatalogReferences() {
  if(!catalogPromise){const pending=api('/api/catalog-references');catalogPromise=pending;void pending.finally(()=>{if(catalogPromise===pending)catalogPromise=null;}).catch(()=>{});}
  const result=await catalogPromise;
  state.catalogReferences=result;
  // Reference responses must not replace a directory's already loaded full objects.
  for(const [key,items] of Object.entries(result)) if(Array.isArray(items) && directoryResources[state.currentView]?.[1]!==key)state[key]=items;
  return result;
}
async function refresh({ quiet = false } = {}) {
  const request=++refreshRequest, currentView=state.currentView;
  try {
    const view = ['settings','marketplace','mcp-marketplace','manual'].includes(state.currentView) ? 'connection' : 'shell';
    if (!bootstrapPromise || bootstrapView !== view) {
      bootstrapView = view;
      const pending = api(`/api/bootstrap?view=${view}`);
      bootstrapPromise = pending;
      void pending.finally(() => { if (bootstrapPromise === pending) bootstrapPromise = null; }).catch(() => {});
    }
    const result = await bootstrapPromise;
    if(request!==refreshRequest || currentView!==state.currentView)return false;
    try {
      const previous = localStorage.getItem("baton.installation");
      if (result.installationId && previous && previous !== result.installationId) { localStorage.removeItem(PREFERENCES_KEY); presentationPreferences = readPreferences(); applyPreferences(document, presentationPreferences); }
      if (result.installationId) localStorage.setItem("baton.installation", result.installationId);
    } catch { /* Storage may be unavailable in this container. */ }
    Object.assign(state, result);
    if (view === 'shell') { state.navigationNotifications = result; state.businessReady = true; }
    const directory=refreshDirectory({paint:true});
    if(['tasks','agents','roles','communication','automations','overview'].includes(currentView))void loadCatalogReferences().then(()=>{
      if(request!==refreshRequest || currentView!==state.currentView)return;
      render();if(currentView==='automations')automationUI.refreshCatalog();
    }).catch(error=>{if(request===refreshRequest && !quiet)toast($t("关联资料读取失败：{0}", [error.message]),true);});
    await directory;
    if(request!==refreshRequest || currentView!==state.currentView)return false;
    if(state.currentView==='inbox')await refreshInbox();
    if(state.currentView==='overview')Object.assign(state,await api('/api/overview'));
    render();
    return true;
  } catch (error) {
    if(request!==refreshRequest || currentView!==state.currentView)return false;
    if(currentView==='tasks') {const key=state.taskArchiveView?'archive':'tasks';state.directoryStatus ||= {};state.directoryStatus[key]={loading:false,error:error.message};renderTasks();}
    if (!quiet) toast(error.message, true);
    return false;
  }
}
const runOfTask = (taskId) => state.runs.find((run) => run.taskId === taskId || run.task?.id === taskId);
const communicationUI = createCommunicationUI({ api, notify: toast, confirmDialog,
  renderAvatar: (agent, className = '') => `<span class="agent-card-avatar ${esc(roleColor(agent))} ${esc(className)}" aria-hidden="true">${esc(initialsOf(agent))}</span>`,
  renderConsole: (stream, result, agent) => {
    if (result.refresh) for (const cache of [consoleContentCache, promptSnapshotCache]) for (const key of cache.keys()) if (key.startsWith(result.basePath + '/')) cache.delete(key);
    renderChatStream(result.events.map(event => ({ ...event, contentBase: result.basePath })), agent, { stream, runId: null, traces: result.traces.map(trace => ({ ...trace, contentBase: result.basePath })), hasMore: result.hasMore });
  },
  onRead: () => refreshNavigation(),
  prepareContent: () => Promise.all([loadVendor("marked"), loadVendor("dompurify")]),
  renderContent: (content, mentions) => formatCommunicationContent(content, { parse: window.marked?.parse, sanitize: window.DOMPurify?.sanitize, mentions }),
  navigate: (id) => { state.selectedChatId = id; setView("communication"); }
});
let presentationPreferences = readPreferences();
applyPreferences(document, presentationPreferences);
const mcpMarketplaceUI = createMcpMarketplaceUI({api, esc, openModal, closeModal, confirmDialog, toast, actionMenu, headerActions:$('#mcp-marketplace-header-actions')});
const marketplaceUI = createMarketplaceUI({api, esc, openModal, closeModal, confirmDialog, toast, actionMenu, headerActions:$('#marketplace-header-actions')});
const settingsUI = createSettingsUI({
  api, notify: toast, clearInvalid, setInvalid,
  openModal, closeModal, confirmDialog,
  onResetStarted: () => { resetRequestActive = true; $("#modal-close").disabled = true; state.eventSource?.close(); communicationUI.unmount(); },
  onResetFailed: () => { resetRequestActive = false; $("#modal-close").disabled = false; },
  onDataReset: (next) => { location.replace(next); },
  onWorkspaceSaved: (settings) => { state.settings = settings; },
  navigate: (page) => { state.settingsPage = page; setView("settings"); },
  getPreferences: () => presentationPreferences,
  updatePreferences: (value) => {
    presentationPreferences = normalizePreferences(value);
    applyPreferences(document, presentationPreferences);
    return savePreferences(presentationPreferences);
  },
});
window.addEventListener("storage", (event) => {
  if (event.key !== PREFERENCES_KEY && event.key !== null) return;
  presentationPreferences = readPreferences();
  applyPreferences(document, presentationPreferences);
  settingsUI.syncPreferences();
});

/* ---------- 反馈 ---------- */
function openModal(content, {drawer = false} = {}) {
  const backdrop = $("#modal-backdrop");
  if (!backdrop.open || !backdrop.contains(document.activeElement)) modalReturnFocus = document.activeElement;
  modalCancel?.(); modalCancel = null;
  disposeWorkflowGraphs("details");
  closeFloatingLists($("#modal-content"));
  $("#modal-content").closest(".modal")?.classList.remove("workflow-detail-modal", "workflow-editor-modal", "team-config-modal", "role-config-modal", "employee-config-modal", "employee-detail-modal", "extension-detail-modal", "task-create-modal", "automation-create-modal", "confirm-dialog", "detail-drawer", "command-dialog");
  $("#modal-content").innerHTML = content;
  // Shared semantic grouping; Web keeps display:contents, desktop bounds body scrolling.
  const host = $("#modal-content"), container = host.querySelector(":scope > form") || host;
  $("#modal-backdrop").classList.toggle('form-modal-open',Boolean(host.querySelector('form')));
  const actions = container.querySelector(":scope > .form-actions");
  if (actions) {
    const body = document.createElement("div");
    body.className = "modal-scroll";
    const children = [...container.children].filter((child) => child !== actions && (container !== host || !child.matches("h2, .modal-intro")));
    children.forEach((child) => body.append(child));
    container.insertBefore(body, actions);
  }
  const title = host.querySelector('h2, .employee-profile-identity h3');
  if (title) { title.id = 'shared-modal-title'; backdrop.setAttribute('aria-labelledby', title.id); }
  else { backdrop.removeAttribute('aria-labelledby'); backdrop.setAttribute('aria-label', $t("详情")); }
  const formOpen = backdrop.classList.contains('form-modal-open');
  $("#modal-close").title = formOpen && !drawer ? $t("关闭") : $t("关闭（Esc）");
  $("#modal-backdrop").classList.add("open");
  // Drawers keep the directory interactive; centered dialogs retain modal focus.
  if (backdrop.open) backdrop.close();
  if (drawer) {
    host.closest('.modal').classList.add('detail-drawer');
    backdrop.show();
  } else backdrop.showModal();
  document.body.classList.toggle('modal-open', !drawer);
  $("#modal-backdrop").setAttribute("aria-hidden", "false");
  $("#modal-backdrop").scrollTop = 0;
  $("#modal-content").closest(".modal").scrollTop = 0;
  $("#modal-content").querySelector("input, textarea, select, button:not(.modal-close)")?.focus();
}
function closeModal() {
  if (resetRequestActive) return;
  disposeWorkflowGraphs("details");
  closeFloatingLists($("#modal-content"));
  $("#modal-content").closest(".modal")?.classList.remove("workflow-detail-modal", "workflow-editor-modal", "team-config-modal", "role-config-modal", "employee-config-modal", "employee-detail-modal", "extension-detail-modal", "task-create-modal", "automation-create-modal", "confirm-dialog", "detail-drawer", "command-dialog");
  $("#modal-backdrop").classList.remove("open");
  $("#modal-backdrop").classList.remove('form-modal-open');
  $("#modal-backdrop").setAttribute("aria-hidden", "true");
  $("#modal-content").replaceChildren();
  $("#modal-backdrop").close();
  document.body.classList.remove('modal-open');
  let target = modalReturnFocus;
  if (target && !target.isConnected) {
    for (const attribute of ['data-agent-detail', 'data-extension-detail', 'data-edit-role']) {
      const id = target.getAttribute(attribute);
      if (id) { target = document.querySelector(`[${attribute}="${CSS.escape(id)}"]`); break; }
    }
  }
  modalReturnFocus = null;
  if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
  else document.querySelector('.nav-item.active')?.focus({ preventScroll: true });
  const cancel = modalCancel; modalCancel = null;
  cancel?.();
}
// Promise-style in-app confirmation; short content only, no scrolling body.
// Escape, backdrop click and the close button all resolve as cancelled.
let modalCancel = null, modalReturnFocus = null;
function modalAllowsLightDismiss() {
  const backdrop = $("#modal-backdrop");
  return !backdrop.classList.contains('form-modal-open') || Boolean(backdrop.querySelector('.detail-drawer'));
}
function confirmDialog({ title, message, confirmLabel = $t("确认"), danger = false }) {
  return new Promise((resolve) => {
    openModal(`<h2>${esc(title)}</h2><p class="modal-intro confirm-dialog-message">${esc(message)}</p><div class="confirm-dialog-actions"><button class="ghost-button" type="button" data-confirm-dialog-cancel>${$t("取消")}</button><button class="${danger ? "danger-button danger-solid" : "primary-button"}" type="button" data-confirm-dialog-accept>${esc(confirmLabel)}</button></div>`);
    $("#modal-content").closest(".modal")?.classList.add("confirm-dialog");
    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      modalCancel = null;
      resolve(accepted);
    };
    modalCancel = () => finish(false);
    $("#modal-content").querySelector("[data-confirm-dialog-cancel]").addEventListener("click", () => { finish(false); closeModal(); });
    $("#modal-content").querySelector("[data-confirm-dialog-accept]").addEventListener("click", () => { finish(true); closeModal(); });
  });
}
function clearInvalidField(input) {
  const field = input.closest(".form-field");
  if (!field) return;
  field.classList.remove("invalid");
  const error = field.querySelector(".field-error");
  if (error) error.textContent = "";
}
function setInvalid(input, message) {
  const field = input.closest(".form-field");
  if (!field) return;
  field.classList.add("invalid");
  const error = field.querySelector(".field-error");
  if (error) error.textContent = message;
  field.scrollIntoView?.({ block: "nearest" });
  const events = input.matches("input, textarea") ? ["input", "change"] : ["change"];
  const clear = () => {
    for (const eventName of events) input.removeEventListener(eventName, clear);
    clearInvalidField(input);
  };
  for (const eventName of events) input.addEventListener(eventName, clear);
}
function clearInvalid(form) {
  form.querySelectorAll(".form-field.invalid").forEach((field) => {
    field.classList.remove("invalid");
    const error = field.querySelector(".field-error");
    if (error) error.textContent = "";
  });
}

/* ---------- 壳层 ---------- */
function renderShell() {
  $$('[data-header-view]').forEach(host => { host.hidden = host.dataset.headerView !== state.currentView; });
  const attentionRuns = state.runs.filter((run) => !run.task?.archivedAt && taskNeedsAttention(run.status));
  const count = state.navigationNotifications?.taskAttentionCount ?? new Set(attentionRuns.map(run => run.taskId)).size;
  // The attention count appears once, on 待我处理; 任务中心 no longer duplicates it.
  const inboxCount = $("#nav-inbox-count"); inboxCount.textContent = count; inboxCount.hidden = !count; inboxCount.setAttribute('aria-label', $t("{0} 项待你处理", [count]));
  const unread = state.navigationNotifications?.communicationUnreadCount ?? state.communicationUnreadCount ?? 0;
  $("#nav-communication-count").textContent = unread;
  $("#nav-communication-count").hidden = !unread;
  $("#nav-communication-count").setAttribute("aria-label", $t("{0} 条未读消息", [unread]));
  const names = { inbox: $t("待我处理"), overview: $t("总览"), tasks: $t("任务"), automations: $t("自动化"), teams: $t("团队"), workflows: $t("工作流"), agents: $t("数字员工"), roles: $t("角色"), manual: $t("开发手册"), workspace: $t("任务空间"), settings: $t("设置"), marketplace: $t("插件"), "mcp-marketplace": "MCP" };
  $("#breadcrumb-current").textContent = state.currentView === "communication" ? $t("沟通")
    : state.currentView === "tasks" && state.taskArchiveView ? $t("归档历史") : names[state.currentView];
  const icon = $("#topbar-icon");
  if (icon?.dataset) icon.dataset.viewIcon = state.currentView;
  renderTitleCount();
}
/** Show the active view's item count beside the titlebar title (Graphite frame). */
function renderTitleCount() {
  const count = $(".view.active")?.dataset?.titleCount, node = $("#topbar-count");
  if (!node) return;
  node.textContent = count ?? "";
  node.hidden = count === undefined || count === "";
}
/** Record a view's item count; modules may also set data-title-count on their view directly. */
function setTitleCount(view, count) {
  const host = $(`#${view}-view`);
  if (host) host.dataset.titleCount = Number.isFinite(count) ? String(count) : "";
}

let navigationRequest = null;
async function refreshNavigation() {
  if(document.visibilityState==='hidden')return;
  if (resetRequestActive || document.visibilityState === "hidden" || navigationRequest) return;
  const connectionOnly = !state.businessReady;
  navigationRequest = api(connectionOnly ? '/api/bootstrap?view=connection' : '/api/notifications');
  try { const result = await navigationRequest; if(connectionOnly)state.businessReady = result.businessReady;else state.navigationNotifications = result; renderShell(); if(state.currentView==='inbox' && !$('#modal-backdrop').open && await refreshInbox())renderInbox(); }
  catch { /* Keep the last confirmed count until the next visible poll. */ }
  finally { navigationRequest = null; }
}

function setView(view, { replace = false, taskArchiveView = state.taskArchiveView } = {}) {
  ++refreshRequest;++directoryRequest;clearTimeout(directoryTimer);
  closeFloatingLists(document);
  if(view!=='workspace' && state.currentView==='workspace'){
    $('#working-directory-panel video')?.pause();const reading=workspaceView();rememberDirectoryReading(reading);delete reading.pendingVideoPreview;
  }
  if (view !== "automations") automationUI.unmount();
  if (view !== "communication") communicationUI.unmount();
  if (view !== "settings") settingsUI.unmount();
  if (view !== "mcp-marketplace") mcpMarketplaceUI.unmount();
  if (view !== "marketplace") marketplaceUI.unmount();
  if (view !== "workspace") {
    if(state.selectedRunId){const reading=workspaceView();reading.collaborationRequest=(reading.collaborationRequest||0)+1;reading.collaborationPending=null;reading.collaborationLoading=false;}
    state.eventSource?.close(); state.eventSource = null;
    clearTimeout(workspaceRefreshTimer); clearTimeout(consoleRenderTimer);
    workspaceRefreshTimer = null; consoleRenderTimer = null;
    workspaceRequest++;
  }
  if (view !== "manual") disposeManualGraphs();
  if (view !== "workflows") disposeWorkflowGraphs("templates");
  if (view !== "workspace") disposeWorkflowGraphs("task");
  if(view!=='workspace'){consolePages.clear();consoleContentCache.clear();promptSnapshotCache.clear();}
  state.currentView = view;
  if (view === "tasks") state.taskArchiveView = Boolean(taskArchiveView);
  if(view==='tasks'){const key=state.taskArchiveView?'archive':'tasks';state.directoryStatus ||= {};state.directoryStatus[key]={loading:true,error:null};}
  const path = view === "workspace" && state.selectedRunId ? `/runs/${encodeURIComponent(state.selectedRunId)}`
    : view === "automations" ? "/automations" + (state.automationId ? "/" + encodeURIComponent(state.automationId) : "")
    : view === "communication" ? "/communication" + (state.selectedChatId ? "/" + encodeURIComponent(state.selectedChatId) : "")
    : view === "tasks" && state.taskArchiveView ? "/tasks/archive"
    : view === "settings" ? `/settings/${state.settingsPage}`
    : view === "manual" ? `/manual/${state.manualPage}` : `/${view}`;
  if (location.pathname !== path) history[replace ? "replaceState" : "pushState"]({}, "", path);
  const navFor = view === "workspace" ? (state.workspace?.run.task.kind === "automation" ? "automations" : "tasks") : view; /* 任务空间从任务中心进入，高亮任务中心 */
  $$(".nav-item").forEach((item) => {
    const active = item.dataset.view === navFor;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === `${view}-view`));
  render();
  if (view !== "workspace" && view !== "communication") refresh({ quiet: true });
  window.scrollTo({ top: 0 });
}

/* Shared action menus keep secondary actions reachable without widening rows. */
function actionMenu(content, label) {
  return content ? `<details class="action-menu"><summary aria-label="${esc(label)}" title="${esc(label)}">⋯</summary><div class="action-menu-list" role="menu">${content}</div></details>` : '';
}
document.addEventListener('toggle', event => {
  const menu = event.target;
  if (!menu.matches?.('.action-menu')) return;
  const summary = menu.querySelector('summary'), list = menu.querySelector('.action-menu-list');
  const popup = createFloatingList(summary, list, { minWidth:200, onClose:() => { menu.open = false; summary.setAttribute('aria-expanded', 'false'); } });
  summary.setAttribute('aria-expanded', String(menu.open));
  if (menu.open) { list.querySelectorAll('button').forEach(button => button.setAttribute('role','menuitem')); popup.open(); if(menu.dataset.focusIndex!==undefined){list.querySelectorAll('button:not(:disabled)')[Number(menu.dataset.focusIndex)]?.focus();delete menu.dataset.focusIndex;} } else popup.close();
}, true);
document.addEventListener('keydown', event => {
  const menu = event.target.closest('.action-menu');
  if (!menu) return;
  const items = [...menu.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
  if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:index<0?(event.key==='ArrowDown'?0:items.length-1):(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
    if(menu.open)items[next]?.focus();else{menu.dataset.focusIndex=String(next);menu.open=true;}
  }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary').focus(); }
});
document.addEventListener('click', event => { const menu = event.target.closest('.action-menu'); if (event.target.closest('.action-menu-list button')) { menu.open = false; closeFloatingLists(menu); } }, true);

function openCommandPalette() {
  const commands = [
    {label:$t("新建任务"),group:$t("快速操作"),run:()=>newTaskModal()}, {label:$t("新建自动化"),group:$t("快速操作"),run:()=>newTaskModal({automation:true})},
    {label:$t("发起沟通"),group:$t("快速操作"),run:()=>{setView('communication');communicationUI.newConversation();}},
    {label:$t("创建数字员工"),group:$t("快速操作"),run:()=>newAgentModal()}, {label:$t("创建团队"),group:$t("快速操作"),run:()=>newTeamModal()}, {label:$t("新建工作流"),group:$t("快速操作"),run:()=>workflowModal()},
    ...NAVIGATION.filter(item=>!['manual'].includes(item.id)).map(item=>({label:item.label, group:$t("跳转"), view:item.id, run:()=>setView(item.id)})),
    {label:$t("设置"),group:$t("跳转"),view:'settings',run:()=>setView('settings')}];
  commands.push({label:document.documentElement.hasAttribute('data-sidebar-collapsed')?$t("展开侧栏"):$t("收起侧栏"),group:$t("显示"),run:toggleSidebar});
  openModal(`<h2>${$t("搜索或执行命令")}</h2><div class="command-query-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="command-query" type="search" aria-label="${$t("搜索命令")}" placeholder="${$t("输入页面或操作名称…")}" autocomplete="off"></div><div id="command-results" role="listbox" aria-label="${$t("命令")}"></div><p class="field-hint"><kbd>↑</kbd><kbd>↓</kbd> ${$t("选择")} · <kbd>Enter</kbd> ${$t("打开")} · <kbd>Esc</kbd> ${$t("关闭")}</p>`);
  $('#modal-content').closest('.modal').classList.add('command-dialog');
  const input = $('#command-query'), results = $('#command-results');
  // Command labels are translated; key the shortcut hints by the same wording.
  const hints = { [$t("新建任务")]:'C', [$t("新建自动化")]:'⇧C', [$t("发起沟通")]:'M', [$t("待我处理")]:'G I', [$t("任务")]:'G T', [$t("数字员工")]:'G E', [$t("设置")]:'⌘,' };
  const hintMarkup = label => { const hint = hints[label]; return hint ? hint.split(' ').map(key => `<kbd>${esc(key)}</kbd>`).join('') : ''; };
  let matches = commands, index = 0;
  function paint() { results.innerHTML=matches.length ? matches.map((item,i)=>`${i === 0 || matches[i-1].group !== item.group ? `<p class="command-group">${esc(item.group)}</p>` : ''}<button type="button" role="option" aria-selected="${i===index}" data-command-index="${i}"><span class="command-icon ${item.view ? 'nav-icon' : ''}" ${item.view ? `data-view="${item.view}"` : ''} aria-hidden="true">${item.view ? '' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 5v14M5 12h14"/></svg>'}</span><span>${esc(item.label)}</span><small>${hintMarkup(item.label) || esc(item.group)}</small></button>`).join('') : `<p class="field-hint">${$t("没有匹配的命令")}</p>`; }
  const run = i => {const command=matches[i]; if(command){closeModal();command.run();}};
  input.oninput=()=>{matches=commands.filter(item=>item.label.toLowerCase().includes(input.value.trim().toLowerCase())); index=0; paint();};
  input.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();index=(index+(event.key==='ArrowDown'?1:-1)+matches.length)%Math.max(matches.length,1);paint();results.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});} if(event.key==='Enter'){event.preventDefault();run(index);}};
  results.onclick=event=>{const button=event.target.closest('[data-command-index]');if(button)run(Number(button.dataset.commandIndex));};
  paint(); input.focus();
}
function toggleSidebar() {
  const collapsed = document.documentElement.toggleAttribute('data-sidebar-collapsed');
  const button = $('[data-toggle-sidebar]');
  button.setAttribute('aria-label',collapsed ? $t("展开侧栏") : $t("收起侧栏"));
  button.title = $t("{0}侧栏 ⌘\\", [collapsed ? $t("展开") : $t("收起")]);
}

const inboxGroups = [['awaiting_human',$t("等待你的澄清")],['awaiting_acceptance',$t("待你验收")],['failed',$t("执行中断")],['paused',$t("已暂停")],['blocked',$t("等待恢复")]];
let inboxRequest = 0, inboxPreviewRequest = 0, inboxDetailRunning = false, inboxDetailAgain = false;
const inboxDrafts = new Map(), inboxAnswered = new Map();
function inboxVisibleGroups() { return state.inboxView === 'recent' ? [['done',$t("最近已处理")]] : inboxGroups; }
function inboxTasks() { return inboxVisibleGroups().flatMap(([status]) => state.inboxResults?.[status]?.tasks || []); }
function advanceInbox(taskId) {
  const tasks = inboxTasks(), index = tasks.findIndex(task => task.id === taskId);
  const following = index < 0 ? tasks : [...tasks.slice(index+1), ...tasks.slice(0,index)];
  state.inboxReceipt = null;
  state.inboxSelection = following[0]?.id || null;
}
function inboxFacts(task, workspace = state.inboxDetails?.[task.id]) {
  const run = workspace?.run, question = workspace?.pendingQuestions?.find(item => item.recipient?.type === 'human');
  const agent = run?.participants?.find(item => item.id === question?.sender?.id) || question?.sender;
  const failedTrace = workspace?.traces?.filter(item => item.status === 'failed').at(-1);
  const failedAgent = run?.participants?.find(item => item.id === failedTrace?.agentId);
  const error = $tm(run?.failure?.message || failedTrace?.error?.message || failedTrace?.error || '');
  const reason = $tm(run?.blockedReason || run?.pauseReason || '');
  const description = task.inboxAnsweredAt ? $t("你已回答") : ({
    awaiting_human: question ? $t("{0} 向你提问", [agent?.name || $t("任务成员")]) : $t("等待你的澄清"),
    awaiting_acceptance: $t("{0} 提交了验收", [run?.manager?.name || $t("项目经理")]),
    failed: failedAgent ? $t("{0} 执行失败", [failedAgent.name]) : $t("执行失败"),
    paused: reason || $t("任务已暂停"), blocked: reason || $t("等待恢复"), done: $t("你确认了完成"),
  })[task.status] || statusText[task.status];
  const summary = task.inboxAnsweredAt ? task.inboxAnswer : question?.content || error || run?.acceptanceRequest?.summary || reason || task.objective || '';
  return {run, question, agent, error, reason, description, summary};
}
async function refreshInbox() {
  const request = ++inboxRequest, view = state.inboxView || 'pending', groups = inboxVisibleGroups();
  state.inboxLoading = !state.inboxResults || state.inboxLoadedView !== view;
  if (state.inboxLoading) renderInbox();
  const current = () => request === inboxRequest && state.currentView === 'inbox' && (state.inboxView || 'pending') === view;
  const previous = JSON.stringify([state.inboxResults,state.inboxErrors,state.inboxDetails]);
  const results = await Promise.allSettled(groups.map(async ([status]) => [status, await api('/api/tasks?' + new URLSearchParams({status,archived:'false',page:String(status === 'done' ? 1 : state.inboxPages?.[status] || 1),pageSize:'20'}))]));
  if (!current()) return;
  const next = {}, errors = {};
  results.forEach((result,index) => { if (result.status === 'fulfilled') next[result.value[0]] = result.value[1]; else errors[groups[index][0]] = result.reason.message; });
  if (view === 'recent' && next.done) {
    // No date filter exists in the task directory: retain its latest 20 completed tasks.
    const answered = [...inboxAnswered.values()].filter(task => new Date(task.inboxAnsweredAt).toDateString() === new Date().toDateString());
    const tasks = [...answered, ...next.done.tasks.filter(task => !answered.some(item => item.id === task.id))]
      .sort((a,b) => new Date(b.inboxAnsweredAt || b.updatedAt) - new Date(a.inboxAnsweredAt || a.updatedAt)).slice(0,20);
    next.done = {...next.done,tasks,total:tasks.length,totalPages:1};
  }
  // Directory rows are already confirmed facts. Paint them before their
  // independent compact details, retaining explicit loading in the preview.
  // Cached details survive unchanged rows: a poll only refetches rows whose
  // run, run status or task update changed, so an idle inbox costs five small
  // directory queries instead of one workspace read per visible task.
  const cachedDetails = state.inboxDetails || {}, details = {}, queue = [];
  for (const task of Object.values(next).flatMap(result => result.tasks)) {
    const run = task.runs?.[0];
    if (!run) continue;
    const signature = `${run.id}:${run.status}:${task.updatedAt}`;
    const cached = cachedDetails[task.id];
    // A failed read is cached briefly instead of retried on every poll.
    if (cached && !cached.loading && cached.signature === signature && (!cached.error || Date.now() - cached.errorAt < 30000)) { details[task.id] = cached; continue; }
    details[task.id] = { loading: true, signature };
    queue.push({ task, signature });
  }
  state.inboxResults = next; state.inboxErrors = errors; state.inboxDetails = details;
  state.inboxLoading = false; state.inboxLoadedView = view;
  renderInbox();
  const changed = previous !== JSON.stringify([next,errors,details]);
  if (!current()) return changed;
  if (!queue.length) return changed;
  if (inboxDetailRunning) { inboxDetailAgain = true; return changed; }
  inboxDetailRunning = true;
  let paintQueued = false;
  const paintDetails = () => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; if (current()) renderInbox(); });
  };
  // Keep detail reads bounded to the visible pages and four concurrent requests.
  void (async () => {
    try {
      await Promise.all(Array.from({length:Math.min(4,queue.length)}, async () => {
        while (queue.length && current()) {
          const { task, signature } = queue.shift(), run = task.runs[0];
          let detail;
          try { detail = await api(`/api/runs/${encodeURIComponent(run.id)}/workspace?view=compact`); }
          catch (error) { detail = {error:error.message}; }
          if (!current()) return;
          if (state.inboxDetails[task.id]?.loading && state.inboxDetails[task.id].signature === signature) state.inboxDetails[task.id] = detail.error ? { error: detail.error, signature, errorAt: Date.now() } : { ...detail, signature };
          paintDetails();
        }
      }));
    } finally {
      inboxDetailRunning = false;
      if (inboxDetailAgain) { inboxDetailAgain = false; void refreshInbox(); }
    }
  })();
  return changed;
}
function inboxStatusIcon(status) {
  return `<span class="task-state-icon" data-status-tone="${statusTone(status)}" aria-hidden="true">${statusShape(status)}</span>`;
}
function renderInbox() {
  const host = $('#inbox-content'), focusedId = document.activeElement?.dataset.inboxSelect;
  const chips = `<div class="inbox-chips" role="group" aria-label="${$t("待办视图")}">${[['pending',$t("待处理")],['recent',$t("最近已处理")]].map(([id,label]) => `<button class="inbox-chip" data-inbox-view="${id}" aria-pressed="${(state.inboxView || 'pending') === id}">${label}</button>`).join('')}</div>`;
  const header = $('#inbox-header-actions');
  if (header.innerHTML !== chips) header.innerHTML = chips;
  if (state.inboxLoading || !state.inboxResults) { host.innerHTML = `<div class="directory-empty" role="status">${$t("正在读取事项…")}</div>`; return; }
  const tasks = inboxTasks();
  const totalCount = $('#inbox-total-count');
  if (totalCount) { totalCount.textContent = String(tasks.length); totalCount.hidden = !tasks.length; }
  setTitleCount('inbox', tasks.length);
  if (!state.inboxReceipt && !tasks.some(task => task.id === state.inboxSelection)) state.inboxSelection = tasks[0]?.id;
  const list = inboxVisibleGroups().map(([status,label]) => {
    const result = state.inboxResults[status];
    if (state.inboxErrors[status]) return `<section><h3>${inboxStatusIcon(status)}${label}</h3><p role="alert">${esc(state.inboxErrors[status])}</p><button class="small-button" data-inbox-retry>${$t("重试")}</button></section>`;
    if (!result?.tasks.length) return '';
    return `<section><h3>${inboxStatusIcon(status)}${label}<span class="inbox-group-count">${result.total}</span></h3>${result.tasks.map(task => {
      const facts = inboxFacts(task), agent = facts.agent;
      return `<button class="inbox-item ${state.inboxSelection === task.id ? 'selected' : ''}" data-inbox-select="${esc(task.id)}" aria-pressed="${state.inboxSelection === task.id}">${inboxStatusIcon(task.inboxAnsweredAt ? 'done' : task.status)}<strong>${esc(task.title)}</strong><time title="${esc(exactTime(task.inboxAnsweredAt || task.updatedAt))}">${timeAgo(task.inboxAnsweredAt || task.updatedAt)}</time><span class="inbox-item-description">${agent ? `<span class="stack-avatar ${esc(roleColor(agent))}" aria-hidden="true">${esc(initialsOf(agent))}</span>` : ''}${esc(facts.description)}</span><span class="inbox-item-summary">${esc(facts.summary)}</span></button>`;
    }).join('')}${result.totalPages > 1 ? `<div class="inbox-pagination"><button class="small-button" data-inbox-status="${status}" data-inbox-page="${result.page-1}" ${result.page === 1 ? 'disabled' : ''}>${$t("上一页")}</button><span>${result.page} / ${result.totalPages}</span><button class="small-button" data-inbox-status="${status}" data-inbox-page="${result.page+1}" ${result.page >= result.totalPages ? 'disabled' : ''}>${$t("下一页")}</button></div>` : ''}</section>`;
  }).join('');
  if (!list && !state.inboxReceipt) {
    ++inboxPreviewRequest;
    host.innerHTML = `<div class="directory-empty"><strong>${state.inboxView === 'recent' ? $t("暂无最近处理记录") : $t("暂时没有待处理事项")}</strong><span>${state.inboxView === 'recent' ? $t("完成确认或回答问题后，可在这里回看。") : $t("需要你回答、验收或恢复时，任务会出现在这里。")}</span></div>`;
    return;
  }
  // Preserve the live composer DOM during polling, including IME, focus, selection and scroll.
  if (!host.querySelector('.inbox-layout')) host.innerHTML = `<div class="inbox-layout"><div class="inbox-list"></div><section class="inbox-preview" aria-label="${$t("事项详情")}"><div id="inbox-preview-content"></div></section></div>`;
  host.querySelector('.inbox-list').innerHTML = list;
  if (focusedId) host.querySelector(`[data-inbox-select="${CSS.escape(focusedId)}"]`)?.focus({preventScroll:true});
  const task = state.inboxReceipt || tasks.find(item => item.id === state.inboxSelection);
  const key = JSON.stringify([task,state.inboxDetails?.[task?.id]]), target = $('#inbox-preview-content');
  if (task && target.dataset.key !== key) { target.dataset.key = key; void renderInboxPreview(task); }
  else if (!task) { ++inboxPreviewRequest; target.innerHTML = ''; }
}
async function renderInboxPreview(task) {
  const request = ++inboxPreviewRequest, target = $('#inbox-preview-content');
  const valid = () => request === inboxPreviewRequest && target.isConnected && state.currentView === 'inbox';
  if (target.dataset.taskId !== task.id) {
    target.dataset.taskId = task.id;
    target.innerHTML = `<div class="directory-empty" role="status" aria-busy="true">${$t("正在读取事项详情…")}</div>`;
  }
  try {
    const cached = state.inboxDetails?.[task.id];
    if (cached?.loading) {
      if (target.querySelector('[data-inbox-answer]')?.dataset.taskId === task.id) return;
      target.innerHTML = `<div class="directory-empty" role="status" aria-busy="true">${$t("正在读取事项详情…")}</div>`; return;
    }
    if (cached?.error) throw new Error(cached.error);
    const workspace = cached || (task.runs?.[0] ? await api(`/api/runs/${encodeURIComponent(task.runs[0].id)}/workspace?view=compact`) : {});
    if (!valid()) return;
    const {run,question,agent,error} = inboxFacts(task,workspace), answered = Boolean(task.inboxAnsweredAt);
    let body = '', answerMarkup = '', collaboration, answerContext, headline = task.title;
    if (run && question && !answered) {
      collaboration = await api(`/api/runs/${encodeURIComponent(run.id)}/collaboration?limit=100`);
      if (!valid()) return;
    }
    if (answered) {
      const original = task.inboxQuestion;
      body = `<div class="inbox-summary"><strong>${$t("任务内容")}</strong><p>${esc(run?.task?.objective || task.objective || $t("未记录任务内容。"))}</p></div>${task.inboxContext ? `<blockquote class="inbox-context"><strong>${$t("原始上下文")}</strong><p>${esc(task.inboxContext.content)}</p></blockquote>` : ''}<h3>${$t("原问题")}</h3><p>${esc(original?.content || $t("此处理记录未保存原问题，可在任务工作区查看。"))}</p><h3>${$t("你的回答")}</h3><p>${esc(task.inboxAnswer || '')}</p>`;
    } else if (task.status === 'awaiting_human' && question) {
      const trace = workspace.traces?.find(item => item.id === question.traceId);
      const dispatch = workspace.dispatches?.find(item => item.waitingMessageId === question.id);
      const contextId = question.startMessageId || trace?.inputMessageId || dispatch?.sourceMessageId;
      const context = collaboration?.items?.find(item => item.id === contextId);
      answerContext = context;
      const name = agent?.name || $t("任务成员"), draftKey = `${run.id}:${question.id}`;
      headline = $t("{0} 需要你的澄清", [name]);
      const workflowNode = run.task?.workflowSnapshot?.nodes?.find(item => item.id === question.workflowNodeId);
      const node = workflowNode?.title || workflowNode?.name || question.workflowNodeId || '';
      body = `<div class="inbox-breadcrumb"><span>${esc(node)}</span><time title="${esc(exactTime(question.createdAt))}">${timeAgo(question.createdAt)}</time></div><blockquote class="inbox-context"><strong>${$t("上下文{0}", [context?.from ? ` · ${$t("{0} 的交接", [esc(context.from)])}` : ''])}</strong><p>${esc(context?.content || $t("当前分页中没有该问题的原始上文，请打开任务工作区查看完整记录。"))}</p></blockquote><div class="inbox-question"><span class="agent-card-avatar ${esc(roleColor(agent))}" aria-hidden="true">${esc(initialsOf(agent))}</span><div><strong>${esc(name)}</strong><span class="field-hint"> ${$t("向你提问")}</span><p>${esc(question.content)}</p></div></div>`;
      answerMarkup = `<form class="inbox-answer" data-inbox-answer data-run-id="${esc(run.id)}" data-question-id="${esc(question.id)}" data-task-id="${esc(task.id)}"><label class="sr-only" for="inbox-answer-text">${$t("回答 {0} 的问题", [esc(name)])}</label><textarea id="inbox-answer-text" name="content" rows="3" required placeholder="${$t("输入回答，发送后 {0} 会继续执行", [esc(name.split(' · ')[0])])}">${esc(inboxDrafts.get(draftKey) || '')}</textarea><div class="inbox-answer-actions"><span class="field-hint">${$t("Enter 发送 · Shift + Enter 换行")}</span><button type="submit" class="primary-button">${$t("发送回答")}</button></div><p role="alert" data-inbox-answer-error hidden></p></form>`;
    } else if (task.status === 'awaiting_acceptance') {
      const acceptance = acceptanceReview(workspace);
      let files = '', fileError = '';
      if (run?.artifactCount) {
        try { const artifacts = await api(`/api/runs/${encodeURIComponent(run.id)}/artifacts?limit=20`); files = (artifacts.items || []).filter(item=>item.name).map(item=>`<button class="inbox-file-chip" data-inbox-artifact="${esc(item.id)}" data-run-id="${esc(run.id)}" title="${$t("查看已保存的交付快照")}"><span class="file-kind">${esc((item.name.split('.').at(-1) || 'FILE').slice(0,4).toUpperCase())}</span>${esc(item.name)}</button>`).join(''); if(artifacts.hasMore)files += `<button class="text-action" data-open-run="${esc(run.id)}">${$t("在任务工作区查看其余记录")}</button>`; }
        catch(error) { fileError = `<p role="alert">${$t("交付文件读取失败：{0}", [esc(error.message)])}</p>`; }
      }
      body = `<div class="inbox-summary"><strong>${$t("经理总结")}</strong><p>${esc(run?.acceptanceRequest?.summary || $t("请核对交付文件与原任务要求。"))}</p></div><h3>${$t("{0} 项交付文件", [run?.artifactCount ?? 0])}</h3><div class="inbox-files">${files}${fileError}</div><details class="inbox-criteria"><summary>${$t("验收标准")}</summary>${acceptanceCriteriaMarkup(acceptance || {criteria:[]})}</details>${run ? `<div class="inbox-review-actions">${acceptance?.verified ? `<button class="primary-button" data-inbox-confirm="${esc(run.id)}">${$t("确认完成")}</button>` : ''}<button class="ghost-button" data-open-run="${esc(run.id)}">${$t("继续咨询")}</button></div>` : ''}`;
    } else if (task.status === 'failed') {
      body = `<h3>${$t("执行中断")}</h3><pre class="inbox-error">${esc(error || $t("没有记录错误原文，请查看任务控制台。"))}</pre>${run ? `<button class="primary-button" data-open-run="${esc(run.id)}">${$t("查看恢复选项")}</button>` : ''}`;
    } else if (['paused','blocked'].includes(task.status)) {
      const timeline = run ? await api(`/api/runs/${encodeURIComponent(run.id)}/timeline`) : {};
      const reason = timeline.events?.filter(item => ['run.paused','run.blocked'].includes(item.type)).at(-1)?.data?.reason;
      body = `<h3>${task.status === 'paused' ? $t("暂停原因") : $t("等待恢复")}</h3><p>${esc($tm(reason) || inboxFacts(task,workspace).reason || $t("请查看任务中的暂停或阻塞记录。"))}</p>${run ? `<button class="primary-button" data-open-run="${esc(run.id)}">${$t("查看并继续")}</button>` : ''}`;
    } else body = `<div class="inbox-summary"><strong>${$t("任务内容")}</strong><p>${esc(run?.task?.objective || task.objective || $t("未记录任务内容。"))}</p></div><h3>${$t("处理结果")}</h3><p>${esc(run?.acceptanceRequest?.summary || run?.summary || $t("你已确认任务完成。"))}</p>`;
    if (!valid()) return;
    const activeDraft = target.querySelector('#inbox-answer-text');
    if (task.status === 'awaiting_human' && !answered && activeDraft && target.querySelector('[data-question-id]')?.dataset.questionId === question?.id) return;
    target.innerHTML = `<div class="inbox-preview-reading">${pill(answered ? 'done' : task.status)}<div class="inbox-task-heading"><h2>${esc(task.title)}</h2>${run ? `<button class="text-action" data-open-run="${esc(run.id)}">${$t("打开任务工作区")}</button>` : `<button class="text-action" data-goto="tasks">${$t("前往任务中心")}</button>`}</div>${headline !== task.title ? `<h3>${esc(headline)}</h3>` : ''}${body}</div>${answerMarkup}`;
    const form = target.querySelector('[data-inbox-answer]');
    if (form) {
      const input = form.querySelector('textarea'), key = `${run.id}:${question.id}`;
      form.inboxQuestion = question; form.inboxContext = answerContext;
      input.oninput = () => inboxDrafts.set(key,input.value);
      input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); form.requestSubmit(form.querySelector('[type=submit]')); } };
      form.onsubmit = sendInboxAnswer;
    }
  } catch (error) { if (valid()) { delete target.dataset.key; target.innerHTML = `<p role="alert">${esc(error.message)}</p><button class="small-button" data-inbox-retry>${$t("重试")}</button>`; } }
}
async function sendInboxAnswer(event) {
  event.preventDefault();
  const form = event.currentTarget, input = form.querySelector('textarea'), content = input.value.trim();
  if (!content || form.dataset.sending) return;
  const {runId,questionId,taskId} = form.dataset, task = inboxTasks().find(item => item.id === taskId);
  const question = form.inboxQuestion || state.inboxDetails?.[taskId]?.pendingQuestions?.find(item => item.id === questionId);
  form.dataset.sending = 'true'; input.readOnly = true; form.querySelectorAll('button').forEach(button => button.disabled = true);
  const errorBox = form.querySelector('[data-inbox-answer-error]'); errorBox.hidden = true;
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}/messages`, {method:'POST',body:JSON.stringify({recipientAgentId:null,replyToMessageId:questionId,content,attachmentIds:[]})});
    inboxDrafts.delete(`${runId}:${questionId}`);
    if (task) inboxAnswered.set(taskId,{...task,inboxAnsweredAt:new Date().toISOString(),inboxAnswer:content,inboxQuestion:question,inboxContext:form.inboxContext});
    toast($t("回答已发送"));
    if (state.currentView !== 'inbox' || state.inboxSelection !== taskId || state.inboxView === 'recent') return;
    advanceInbox(taskId);
    await refreshInbox();
    if (state.currentView !== 'inbox') return;
    renderInbox();
  } catch (error) { if (form.isConnected) { errorBox.textContent = error.message; errorBox.hidden = false; } }
  finally { delete form.dataset.sending; input.readOnly = false; form.querySelectorAll('button').forEach(button => button.disabled = false); }
}

/* ---------- 总览 ---------- */
function renderOverview() {
  const active = state.runs.filter((run) => taskMatchesFilter(run.status, "active"));
  const attention = state.runs.filter((run) => taskNeedsAttention(run.status));
  const counts=state.overviewCounts || {runs:{},tasks:{},artifacts:0};
  const attentionCount=Object.entries(counts.runs).filter(([status])=>taskNeedsAttention(status)).reduce((n,[,count])=>n+count,0);
  const awaitingAcceptance=counts.runs.awaiting_acceptance || 0;
  const attentionSummary = awaitingAcceptance
    ? $t("含 {0} 个待你验收", [`<b>${awaitingAcceptance}</b>`])
    : attentionCount ? $t("有 {0} 个需要你处理", [`<b>${attentionCount}</b>`]) : $t("没有等待你的决策");
  const stats = [
    { label: $t("执行中 Run"), value: Object.entries(counts.runs).filter(([status])=>taskMatchesFilter(status,"active")).reduce((n,[,count])=>n+count,0), sub: attentionSummary },
    { label: $t("已完成任务"), value: counts.tasks.done || 0, sub: $t("共 {0} 个任务", [Object.values(counts.tasks).reduce((n,count)=>n+count,0)]) },
    { label: $t("文件产物"), value: counts.artifacts, sub: $t("已接纳的 Run 内快照") },
    { label: $t("可用数字员工"), value: state.agents.filter((agent) => agent.status === "active").length, sub: $t("可按需要编辑、停用或删除") },
  ];
  $("#stats-grid").innerHTML = stats.map((stat) => `
    <div class="stat-card"><div class="stat-top"><span>${stat.label}</span></div>
    <div class="stat-value">${stat.value}</div><div class="stat-sub">${stat.sub}</div></div>`).join("");

  const current = attention[0] || active[0];
  const currentNeedsAttention = current && taskNeedsAttention(current.status);
  $("#active-run-panel").innerHTML = `
    <div class="panel-header"><div><div class="panel-kicker">${currentNeedsAttention ? "NEEDS YOUR ACTION" : "ACTIVE RUN"}</div><h3 class="panel-title">${currentNeedsAttention ? $t("需要你处理") : $t("当前进行")}</h3></div>
    ${current ? `<button class="panel-link" data-open-run="${current.id}">${currentNeedsAttention ? taskActionLabel(current.status) : $t("进入任务空间")} →</button>` : ""}</div>
    ${current ? `<div class="run-card">
        <div class="run-card-top"><span class="run-name">${esc(current.task?.title || $t("执行中"))}</span>${pill(current.status)}</div>
        <p class="run-objective">${esc(current.task?.objective || "")}</p>
        <div class="run-meta"><span>${$t("{0} · {1} 条 Trace · {2} 个文件", [statusText[current.status] || current.status, current.traceCount || 0, current.artifactCount || 0])}</span><span>${esc(current.id)}</span></div>
      </div>` : `<div class="empty-state"><strong>${$t("没有进行中或待处理任务")}</strong>${$t("创建一个任务，Baton 会自动组建流程并开始交付。")}<br /><button class="primary-button compact" data-goto="tasks">${$t("去任务中心创建")}</button></div>`}`;

  const latest = state.events.slice(-6).reverse();
  $("#activity-panel").innerHTML = `
    <div class="panel-header"><div><div class="panel-kicker">SIGNAL</div><h3 class="panel-title">${$t("团队信号")}</h3></div></div>
    <div class="activity-list">${latest.length ? latest.map((event) => `
      <div class="activity-row">
        <div class="activity-avatar ${roleColor(event.actor)}">${esc((event.actor?.name || "B").slice(0, 1))}</div>
        <div class="activity-copy"><p><strong>${esc(event.actor?.name || "Baton")}</strong> · ${esc(runtimeAuditText(event).slice(0, 56))}${runtimeAuditText(event).length > 56 ? "…" : ""}</p>
        <time>${timeAgo(event.timestamp)} · ${KIND_LABEL[classifyEvent(event)] || esc(event.type)}</time></div>
      </div>`).join("") : `<div class="empty-state" style="margin:0"><strong>${$t("暂无记录")}</strong>${$t("执行事件会出现在这里。")}</div>`}</div>`;

  const team = state.teams[0];
  $("#team-panel").innerHTML = `
    <div class="panel-header"><div><div class="panel-kicker">TEAM</div><h3 class="panel-title">${esc(team?.name || $t("团队"))}</h3></div>
    <button class="panel-link" data-goto="teams">${$t("全部团队")} →</button></div>
    <div class="panel-body">
      ${(team?.members || []).map((agent) => `
        <div class="member-row">
          <div class="member-avatar ${roleColor(agent)}">${esc(initialsOf(agent))}</div>
          <div><span class="member-name">${esc(agent.name)}</span><span class="member-role">${agent.type === "human" || agent.id === "human_operator" ? $t("本机人类") : providerLabel(agent)}</span></div>
          <span class="member-status">${agent.type === "human" || agent.id === "human_operator" ? $t("人类成员") : `● ${agent.status === "active" ? $t("可用") : $t("停用@@status")}`}</span>
        </div>`).join("") || `<div class="directory-empty" role="status"><strong>${$t("还没有团队")}</strong>${$t("先创建业务数字员工，再组合成团队。")}</div>`}
      ${team ? `<div class="sysrole-note">${$t("团队用于批量选人；任务与群聊独立保存员工。")}</div>` : ""}
    </div>`;

  $("#task-panel").innerHTML = `
    <div class="panel-header"><div><div class="panel-kicker">TASKS</div><h3 class="panel-title">${$t("最近任务")}</h3></div>
    <button class="panel-link" data-goto="tasks">${$t("任务中心")} →</button></div>
    <div class="panel-body">
      ${[...state.tasks].sort((left, right) => Number(taskNeedsAttention(right.status)) - Number(taskNeedsAttention(left.status))).slice(0, 3).map((task) => `
        <button class="task-row" data-open-task="${task.id}" title="${$t("打开该任务的任务空间")}">
          <span class="task-priority ${taskNeedsAttention(task.status) ? "high" : ""}"></span>
          <span class="task-row-copy"><span class="task-row-title">${esc(task.title)}</span><span class="task-row-meta">${workspaceSummary(task)} · ${timeAgo(task.updatedAt)}</span></span>
          ${pill(task.status)}
        </button>`).join("") || `<div class="empty-state" style="margin:0"><strong>${$t("还没有任务")}</strong>${$t("从「新建任务」开始。")}</div>`}
    </div>`;
}

/* ---------- 任务中心 ---------- */
function taskMatchesChip(status, chip) {
  if (chip === 'attention') return taskNeedsAttention(status);
  if (chip === 'active') return ['planning', 'running', 'review'].includes(status);
  if (chip === 'done') return ['done', 'completed'].includes(status);
  return chip === 'all' || status === chip;
}

function taskGroupOrder(status) {
  if (status === 'paused') return 2;
  if (taskNeedsAttention(status)) return 0;
  if (['planning','running','review'].includes(status)) return 1;
  return status === 'backlog' ? 3 : 4;
}

function taskRowStatus(task, run) {
  const labels = { awaiting_human:$t("等待你的澄清"), awaiting_acceptance:$t("待你验收"), failed:$t("错误中断"), blocked:$t("错误中断"), backlog:$t("尚未开始"), done:$t("你已确认完成"), completed:$t("你已确认完成") };
  const label = labels[task.status] || statusText[task.status] || task.status;
  // Directory Run summaries may contain only IDs/status. Never invent details.
  const detail = task.status === 'awaiting_acceptance' && Number.isInteger(run?.artifactCount) ? $t("{0} 个文件", [run.artifactCount])
    : ['failed', 'blocked'].includes(task.status) ? $tm(run?.failure?.message) : '';
  return `<span>${esc(label)}</span>${detail ? `<span class="task-step-detail"> · ${esc(detail)}</span>` : ''}`;
}

function renderTasks() {
  closeFloatingLists($("#tasks-table"));
  const archiveView = state.taskArchiveView;
  const pageKey = archiveView ? "archive" : "tasks", loading = state.directoryStatus?.[pageKey];
  const directoryReady = Boolean(state.directoryPages?.[pageKey]);
  const candidates = state.taskCandidates || state.tasks.filter(task => !task.archivedAt);
  $("#tasks-heading").innerHTML = archiveView
    ? `<div><h2>${$t("归档历史")}</h2><p>${$t("归档的任务保留完整记录，可以恢复到任务中心或删除。")}</p></div>`
    : `<div><h2>${$t("任务")}<span class="tb-count">${candidates.length}</span></h2><p>${$t("创建任务、跟进协作与交接，并在这里确认交付。需要你处理的事项始终排在最前。")}</p></div>`;
  // Keep the form mounted so live refreshes preserve input, selection and focus.
  const mountSearch = !$("#task-search-form");
  if (mountSearch) {
    const search = state.taskSearch || {};
    $("#task-filter-bar").innerHTML = `<form id="task-search-form" class="task-search-form" role="search" aria-label="${$t("搜索任务")}">
      <div class="task-chips" role="group" aria-label="${$t("任务快捷视图")}"></div>
      <label class="task-search-name"><span class="sr-only">${$t("任务名称")}</span><input type="search" name="name" placeholder="${$t("筛选任务名称")}" value="${esc(search.name || "")}" /><kbd aria-hidden="true">/</kbd></label>
      <div class="task-filter-control"><button type="button" class="ghost-button" data-task-filters aria-expanded="false" aria-controls="task-filter-panel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>${$t("筛选")}</button>
        <div id="task-filter-panel" class="task-filter-panel" hidden>
          <label>${$t("任务状态")}<select name="status"><option value="all">${$t("全部状态")}</option>${["backlog", "planning", "running", "awaiting_human", "review", "awaiting_acceptance", "paused", "blocked", "failed", "done", "cancelled"].map(id => `<option value="${id}" ${search.status === id ? 'selected' : ''}>${statusText[id]}</option>`).join('')}</select></label>
          <label>${$t("工作流@@field")}<select name="workflow"><option value="all">${$t("全部工作流")}</option></select></label>
        </div>
      </div>
    </form>`;
  }
  const chips = [['all',$t("全部")], ['attention',$t("待我处理")], ['active',$t("进行中")], ['backlog',$t("草稿")], ['done',$t("已完成")]];
  const chipMarkup = chips.map(([id,label]) => `<button type="button" class="task-chip" data-task-chip="${id}" aria-pressed="${!archiveView && (state.taskChip || 'all') === id}">${label} <span class="task-chip-count">${!directoryReady && loading ? '—' : candidates.filter(task => taskMatchesChip(task.status,id)).length}</span></button>`).join('')
    + `<button type="button" class="task-chip" data-task-center-page="${archiveView ? 'current' : 'archive'}" aria-pressed="${Boolean(archiveView)}">${archiveView ? $t("返回任务") : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/></svg> ${$t("归档")}`}</button>`;
  const chipHost = $('#task-search-form .task-chips');
  if (chipHost.innerHTML !== chipMarkup) {
    const focusedChip = $('#task-search-form .task-chip:focus')?.dataset.taskChip;
    chipHost.innerHTML = chipMarkup;
    if (focusedChip) $(`[data-task-chip="${focusedChip}"]`)?.focus();
  }
  const workflowSelect = $("#task-search-form select[name=workflow]");
  const workflowNames = new Map([...(state.catalogReferences?.workflowTemplates||state.workflowTemplates),...(state.catalogReferences?.taskWorkflows||[])].map(item => [item.id, item.name]));
  for (const task of state.tasks) if (task.workflowTemplateId && !workflowNames.has(task.workflowTemplateId)) {
    workflowNames.set(task.workflowTemplateId, task.workflowSnapshot?.name || task.workflowTemplateId);
  }
  const workflowOptions = `<option value="all">${$t("全部工作流")}</option>${[...workflowNames].map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join("")}`;
  if (workflowSelect.innerHTML !== workflowOptions) {
    const selection = mountSearch ? state.taskSearch.workflow : workflowSelect.value;
    workflowSelect.innerHTML = workflowOptions;
    workflowSelect.value = workflowNames.has(selection) ? selection : "all";
  }
  const actionMarkup = `<div class="task-layout-switch" role="group" aria-label="${$t("任务布局")}"><button type="button" class="small-button" data-task-layout="list" aria-label="${$t("列表")}" title="${$t("列表")}" aria-pressed="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg></button><button type="button" class="small-button" data-task-layout="board" aria-label="${$t("看板")}" title="${$t("看板")}" aria-pressed="false"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="12" rx="1"/></svg></button></div><button type="button" class="primary-button" data-action="new-task"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>${$t("新建任务")}</button>`;
  const actionHost = $('#task-header-actions');
  if (!actionHost.innerHTML) actionHost.innerHTML = actionMarkup;
  const page = state.directoryPages?.[pageKey] || paginate([],1);
  if(!directoryReady && loading) {
    setTitleCount('tasks',NaN);
    $('#tasks-table').innerHTML=loading.error ? `<div class="directory-empty" role="alert"><strong>${$t("任务读取失败")}</strong>${esc(loading.error)}<button class="small-button" data-retry-directory>${$t("重试")}</button></div>` : `<div class="directory-empty is-loading" role="status" aria-busy="true"><strong>${$t("正在读取任务")}</strong>${$t("任务状态与列表正在加载。")}</div>`;
    return;
  }
  state.listPages[pageKey] = page.page;
  setTitleCount('tasks', archiveView ? page.total : candidates.length);
 const layout = state.taskLayout || 'list';
 $$('.task-layout-switch button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.taskLayout===layout)));
 if (!page.items.length) {
   $('#tasks-table').innerHTML = `<div class="directory-empty" role="status"><strong>${$t("没有匹配的任务")}</strong>${archiveView ? $t("请调整筛选条件，或清空任务名称查看归档任务。") : $t("请调整筛选条件，或清空任务名称查看全部任务。")}</div>`;
   return;
 }
 if(!archiveView && layout==='board') {
   const groups=[[$t("草稿"),'backlog',task=>task.status==='backlog'],[$t("进行中"),'running',task=>['planning','running','review','paused'].includes(task.status)],[$t("待我处理"),'awaiting_human',task=>task.status!=='paused'&&taskNeedsAttention(task.status)],[$t("已完成"),'done',task=>['done','completed','cancelled'].includes(task.status)]];
   $('#tasks-table').innerHTML=`<div class="task-board">${groups.map(([label,status,match])=>`<section><h3>${inboxStatusIcon(status)}${label} <small>${page.items.filter(match).length}</small></h3>${page.items.filter(match).map(task=>{
     const members = (task.memberAgentIds || []).slice(0,4).map(id => task.memberSnapshots?.find(agent => agent.id === id) || (state.catalogReferences?.agents || state.agents || []).find(agent => agent.id === id)).filter(Boolean);
     return `<article class="board-task" data-board-task="${esc(task.id)}"><span class="task-workflow">${esc(task.workflowSnapshot?.name || $t("默认协作"))}</span><h4><button class="text-action" ${task.status==='backlog'?`data-edit-task="${esc(task.id)}"`:`data-open-task="${esc(task.id)}"`}>${esc(task.title)}</button></h4><div class="board-task-footer">${['backlog','done','completed'].includes(task.status) ? `<span class="task-row-members">${members.map(agent => `<span class="stack-avatar ${esc(roleColor(agent))}" title="${esc(agent.name)}">${esc(initialsOf(agent))}</span>`).join('')}</span>` : `<span class="board-task-status" data-status-tone="${statusTone(task.status)}">${inboxStatusIcon(task.status)}${esc(statusText[task.status] || task.status)}</span>`}<time title="${esc(exactTime(task.updatedAt))}">${timeAgo(task.updatedAt)}</time></div></article>`;
   }).join('') || `<p class="field-hint">${$t("本页暂无任务")}</p>`}</section>`).join('')}</div>${paginationMarkup(page,pageKey)}`;
   return;
 }
 if (!archiveView) {
   const groups = [
     ['attention',$t("待我处理"),'awaiting_human',task => task.status !== 'paused' && taskNeedsAttention(task.status)],
     ['active',$t("进行中"),'running',task => ['planning','running','review'].includes(task.status)],
     ['paused',$t("已暂停"),'paused',task => task.status === 'paused'],
     ['backlog',$t("草稿"),'backlog',task => task.status === 'backlog'],
     ['done',$t("已完成"),'done',task => ['done','completed','cancelled'].includes(task.status)],
   ];
   $('#tasks-table').innerHTML = `<div class="task-list">${groups.map(([id,label,status,match]) => {
     const tasks = page.items.filter(match);
     if (!tasks.length) return '';
     return `<section class="task-list-group" aria-label="${label}" data-task-group="${id}"><h3 class="task-group-heading"><span class="task-state-icon" data-status-tone="${statusTone(status)}" aria-hidden="true">${statusShape(status)}</span>${label}<span class="task-group-count">${tasks.length}</span>${id === 'attention' ? `<span class="task-group-hint">${$t("回答澄清、验收交付或处理中断")}</span>` : ''}</h3>${tasks.map(task => {
       const run = runOfTask(task.id), editable = task.status === 'backlog' && !run;
       const title = `<button class="task-title-link" ${editable ? `data-edit-task="${esc(task.id)}"` : `data-open-task="${esc(task.id)}"`} title="${esc(task.title)}">${esc(task.title)}</button>`;
       const menu = `${editable ? `<button class="small-button" data-edit-task="${esc(task.id)}">${$t("编辑")}</button>` : ''}${task.status === 'done' ? `<button class="small-button" data-archive-task="${esc(task.id)}">${$t("归档")}</button>` : ''}${task.deletionBlockedBy === null ? `<button class="small-button danger" data-delete-task="${esc(task.id)}">${$t("删除任务")}</button>` : ''}`;
       const next = task.status === 'backlog' ? `<button class="small-button" data-run-task="${esc(task.id)}">${$t("启动")}</button>` : task.status === 'done' ? `<button class="small-button" data-archive-task="${esc(task.id)}">${$t("归档")}</button>` : run ? `<button class="small-button" data-open-task="${esc(task.id)}">${taskActionLabel(task.status)}</button>` : '';
       const members = (task.memberAgentIds || []).slice(0,5).map(id => task.memberSnapshots?.find(agent => agent.id === id) || (state.catalogReferences?.agents || state.agents || []).find(agent => agent.id === id)).filter(Boolean);
       return `<article class="task-row" data-task-id="${esc(task.id)}"><span class="task-state-icon" data-status-tone="${statusTone(task.status)}" title="${esc(statusText[task.status] || task.status)}" aria-hidden="true">${statusShape(task.status)}</span><div class="task-row-title">${title}<span class="task-workflow">${esc(task.workflowSnapshot?.name || task.workflowTemplateId || '—')}</span></div><div class="task-row-step" data-status-tone="${statusTone(task.status)}">${taskRowStatus(task,run)}</div><div class="task-row-members">${members.map(agent => `<span class="stack-avatar ${esc(roleColor(agent))}" title="${esc(agent.name)}">${esc(initialsOf(agent))}</span>`).join('')}</div><time class="task-row-time" title="${esc(exactTime(task.updatedAt))}">${timeAgo(task.updatedAt)}</time><div class="task-row-actions" data-status-tone="${statusTone(task.status)}">${next}${task.deletionBlockedBy === 'active_inquiries' ? `<span class="task-deletion-notice" title="${$t("请等待当前答疑完成后重试删除。")}">${$t("答疑进行中")}</span>` : ''}${actionMenu(menu,$t("任务更多操作"))}</div></article>`;
     }).join('')}</section>`;
   }).join('')}</div>${paginationMarkup(page,pageKey)}`;
   return;
 }
 $("#tasks-table").innerHTML = `<table class="table task-inventory"><colgroup><col class="col-task" /><col class="col-workflow" /><col class="col-status" /><col class="col-updated" /><col class="col-actions" /></colgroup><thead><tr>
      <th>${$t("任务名称")}</th><th>${$t("工作流@@field")}</th><th>${$t("状态")}</th><th>${archiveView ? $t("归档时间") : $t("更新@@time")}</th><th style="text-align:right">${$t("操作")}</th>
    </tr></thead><tbody>
    ${page.items.map((task) => {
      const run = runOfTask(task.id);
      const editable = task.status === 'backlog' && !run;
      const canDelete = task.deletionBlockedBy === null;
      const openAction = task.status === "backlog"
        ? `<button class="small-button" data-run-task="${task.id}">${$t("启动")}</button>` : "";
      const editAction = editable ? `<button class="small-button" data-edit-task="${task.id}">${$t("编辑")}</button>` : '';
      const deleteAction = canDelete ? `<button class="small-button danger" data-delete-task="${task.id}">${$t("删除任务")}</button>` : "";
      const deletionNotice = task.deletionBlockedBy === "active_inquiries" ? `<span class="task-deletion-notice" title="${$t("请等待当前答疑完成后重试删除。")}">${$t("答疑进行中")}</span>` : "";
      const secondary = archiveView
        ? `<button class="small-button" data-unarchive-task="${task.id}">${$t("恢复任务")}</button>${deleteAction}`
        : `${task.status === "done" ? `<button class="small-button" data-archive-task="${task.id}">${$t("归档")}</button>` : ""}${deleteAction}`;
      const nextAction = openAction || (run ? `<button class="small-button" data-open-task="${task.id}">${taskActionLabel(task.status)}</button>` : '');
      const action = `${nextAction}${deletionNotice}${actionMenu(`${editAction}${secondary}`, $t("任务更多操作"))}`;
      return `<tr>
        <td>${run ? `<button class="table-title task-title-link" data-open-task="${task.id}" title="${esc(task.title)}">${esc(task.title)}</button>` : editable ? `<button class="table-title task-title-link" data-edit-task="${task.id}" title="${esc(task.title)}">${esc(task.title)}</button>` : `<span class="table-title">${esc(task.title)}</span>`}</td>
        <td class="task-workflow">${esc(task.workflowSnapshot?.name || task.workflowTemplateId || "—")}</td>
        <td>${pill(task.status)}</td>
        <td class="task-updated" title="${esc(archiveView ? exactTime(task.archivedAt) : exactTime(task.updatedAt))}">${archiveView ? exactTime(task.archivedAt) : timeAgo(task.updatedAt)}</td>
        <td><div class="table-actions">${action}</div></td>
      </tr>`;
    }).join("")}</tbody></table>${paginationMarkup(page, pageKey)}`;
}

function renderListPager(key, page) {
  const grid = $(`#${key}-grid`);
  let pager = grid?.nextElementSibling;
  if (!pager?.matches(`[data-list-pager="${key}"]`)) {
    pager = document.createElement("div"); pager.dataset.listPager = key; grid.after(pager);
  }
  pager.innerHTML = paginationMarkup(page, key);
}

/* ---------- 团队 ---------- */
function renderTeams() {
  closeFloatingLists($("#teams-grid"));
  const query = ($("#teams-search")?.value || "").trim().toLocaleLowerCase();
  const rows = state.teams.filter(team => `${team.name} ${team.mission || ""}`.toLocaleLowerCase().includes(query));
  const page = state.directoryPages?.teams || paginate([],1); state.listPages.teams = page.page;
  setTitleCount('teams', page.total);
  $("#teams-grid").innerHTML = page.items.map((team) => `
    <article class="team-directory-row">
      <span class="agent-card-avatar ${roleColor({ color: extensionAvatarColor(team.name) })}" aria-hidden="true">${esc(Array.from(team.name)[0] || '')}</span>
      <div class="team-row-copy"><h3><button type="button" class="team-row-open" title="${esc(team.name)}" data-edit-team="${esc(team.id)}" aria-label="${$t("编辑团队 {0}", [esc(team.name)])}">${esc(team.name)}</button></h3><p title="${esc(team.mission || '')}">${esc(team.mission || $t("（未填写使命）"))}</p></div>
      <div class="team-row-members"><div class="team-member-stack" aria-hidden="true">${team.members.slice(0, 5).map((agent) => `<span class="stack-avatar ${roleColor(agent)}" title="${esc(agent.name)}">${esc(initialsOf(agent))}</span>`).join("")}${team.members.length > 5 ? `<span class="stack-avatar team-member-overflow">+${team.members.length - 5}</span>` : ''}</div><p title="${esc(team.members.map(agent => agent.name).join(', '))}">${esc(team.members.map(agent => agent.name).join(', ') || $t("暂无成员"))}</p></div>
      <span class="team-row-status" data-status="${team.status === 'active' ? 'active' : 'disabled'}">${team.status === 'active' ? $t("启用@@status") : $t("停用@@status")}</span>
      <div class="team-row-actions"><button class="small-button" data-chat-team="${esc(team.id)}">${$t("群聊")}</button>${actionMenu(`<button class="small-button" data-edit-team="${esc(team.id)}">${$t("编辑团队")}</button><button class="small-button" data-new-team-task="${esc(team.id)}"${team.status==='active'?'':` ${$t("disabled title=\"请先启用团队\"")}`}>${$t("用此团队新建任务")}</button><button class="small-button danger" data-delete-team="${esc(team.id)}">${$t("删除团队")}</button>`, $t("团队更多操作"))}</div>
    </article>`).join("") || (query ? `<div class="directory-empty" role="status"><strong>${$t("没有匹配的团队")}</strong>${$t("请调整搜索条件。")}</div>` : `<div class="directory-empty" role="status"><strong>${$t("还没有团队")}</strong>${$t("点击右上角「创建团队」添加。")}</div>`);
  renderListPager("teams", page);
}

/* ---------- 工作流管理 ---------- */
function renderWorkflows() {
  disposeWorkflowGraphs("templates");
  const host = $("#workflows-grid");
  closeFloatingLists(host);
  const query = ($("#workflows-search")?.value || "").trim().toLocaleLowerCase();
  const page = state.directoryPages?.workflows || paginate([],1); state.listPages.workflows = page.page;
  setTitleCount('workflows', page.total);
  host.innerHTML = page.items.map((template) => {
    const referenceCount = template.referenceCount || 0;
    const connections = workflowConnections(template);
    const conditionCount = template.nodes.filter(node => node.type === 'condition').length;
    const usage = $t("{0} 个节点{1}{2}", [template.nodes.length, conditionCount ? ` · ${$t("{0} 个条件", [conditionCount])}` : '', referenceCount ? ` · ${$t("被 {0} 个任务使用", [referenceCount])}` : ` · ${$t("未被使用")}`]);
    const updatedAt = template.updatedAt || template.createdAt;
    const updated = updatedAt ? $t("{0}更新", [new Date(updatedAt).toLocaleDateString(intlLocale(), { month: 'long', day: 'numeric' })]) : $t("未记录更新时间");
    const deleteAction = !referenceCount ? `<button class="small-button danger" data-delete-workflow="${esc(template.id)}">${$t("删除")}</button>` : "";
    return `
    <article class="workflow-directory-card">
      <header><h3><button class="workflow-title-button" title="${esc(template.name)}" data-edit-workflow="${esc(template.id)}" aria-label="${$t("编辑工作流：{0}", [esc(template.name)])}">${esc(template.name)}</button></h3>${template.system ? `<span class="workflow-builtin">${$t("内置")}</span>` : ''}${actionMenu(`<button class="small-button" data-workflow-details="${esc(template.id)}">${$t("查看详情")}</button><button class="small-button" data-edit-workflow="${esc(template.id)}">${$t("编辑")}</button>${deleteAction}`, $t("工作流更多操作"))}</header>
      <p class="workflow-card-description">${esc(template.description || $t("尚未填写说明"))}</p>
      <div class="flow-mini" aria-label="${$t("节点预览；完整分支请查看详情")}">${template.nodes.map((node, index) => `${index ? `<span class="flow-mini-link" data-connected="${connections.some(edge => edge.source === template.nodes[index - 1].id && edge.target === node.id)}" aria-hidden="true"></span>` : ''}<span class="flow-mini-node" data-type="${node.type === 'condition' ? 'condition' : 'process'}" title="${esc(node.title)}">${node.type === 'condition' ? '<span aria-hidden="true">◇ </span>' : ''}${esc(node.title)}</span>`).join('')}</div>
      <footer><span class="workflow-card-usage" aria-label="${esc(usage)}"><span>${$t("{0} 个节点{1}", [template.nodes.length, conditionCount ? ` · ${$t("{0} 个条件", [conditionCount])}` : ''])}</span><span>${referenceCount ? $t("被 {0} 个任务使用", [referenceCount]) : $t("未被使用")}</span></span><time${updatedAt ? ` datetime="${esc(updatedAt)}" title="${esc(exactTime(updatedAt))}"` : ''}>${esc(updated)}</time></footer>
   </article>`;
  }).join("") || (query ? `<div class="directory-empty" role="status"><strong>${$t("没有匹配的工作流")}</strong>${$t("请调整搜索条件。")}</div>` : `<div class="directory-empty" role="status"><strong>${$t("还没有工作流")}</strong>${$t("创建一个工作流，再把它用于新任务。")}</div>`);
  renderListPager("workflows", page);
}

function workflowDetails(template, { frozen = false } = {}) {
  openModal(`<h2>${esc(template.name)}</h2><p class="modal-intro">${esc(template.description || $t("工作流定义团队的职责与预期交接；项目经理根据实际交付推进协作。"))}</p>
    ${frozen ? `<p class="field-hint">${$t("本任务创建时的工作流快照 · 只读")}</p>` : workflowDiagramCanvas("details", template.id, $t("职责交接总览"), "workflow-template-viewport")}
    <div class="workflow-detail-body"><nav class="workflow-detail-nav" aria-label="${$t("工作流节点")}">${template.nodes.map((node, index) => `<button type="button" data-detail-node="${esc(node.id)}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${esc(node.title)}</strong></div></button>`).join("")}</nav><section id="workflow-node-detail" aria-live="polite"></section></div>
    <div class="form-actions"><button class="ghost-button" data-close-modal>${$t("关闭")}</button>${frozen ? "" : `<button class="primary-button" data-edit-workflow="${esc(template.id)}">${$t("编辑工作流")}</button>`}</div>`);
  const content = $("#modal-content");
  content.closest(".modal")?.classList.add("workflow-detail-modal");
  const showNode = (id) => {
    const node = template.nodes.find((item) => item.id === id);
    if (!node) return;
    content.querySelectorAll("[data-detail-node]").forEach((button) => button.setAttribute("aria-current", String(button.dataset.detailNode === id)));
    const outgoing=workflowConnections(template).filter(edge=>edge.source===node.id);
    const names = (ids) => (ids || []).map((value) => template.nodes.find((item) => item.id === value)?.title || value).join("、");
    $("#workflow-node-detail").innerHTML = `<h3>${esc(node.title)}</h3><dl>
      <dt>${$t("节点类型")}</dt><dd>${node.type==='condition'?$t("条件节点"):$t("流程节点")}</dd><dt>${$t("节点说明")}</dt><dd>${esc(node.description || $t("未填写"))}</dd><dt>${$t("人员需求")}</dt><dd>${esc(node.staffingGuidance || node.ownerRole || $t("根据交付定义选择"))}</dd>
      <dt>${$t("职责与交付目标")}</dt><dd>${esc(node.deliverable || $t("尚未填写交付目标，请编辑补充。"))}</dd>
      <dt>${$t("前置交接")}</dt><dd>${esc(names(node.dependsOn) || $t("起始职责，无前置依赖"))}</dd>
      <dt>${$t("接收上下文")}</dt><dd>${esc(names(node.handoffFrom?.length ? node.handoffFrom : node.dependsOn) || $t("任务需求与团队共享上下文"))}</dd>
      <dt>${$t("工作目录")}</dt><dd class="path-mono">${esc((node.artifactPaths || []).join("\n") || $t("按节点交付要求组织文件"))}</dd>
      <dt>${node.type==='condition'?$t("条件分支"):$t("后续协作")}</dt><dd>${outgoing.length ? outgoing.map(edge=>`<div class="workflow-detail-handoff"><strong>${esc(names([edge.target]))}</strong>${edge.condition ? `<p>${$t("条件：{0}", [esc(edge.condition)])}</p>` : ''}${edge.description ? `<p>${esc(edge.description)}</p>` : ''}</div>`).join('') : $t("由项目经理安排下一步")}</dd></dl>
      <p class="field-hint">${$t("接收方依据自己的目标检查交接是否充分；有疑问可咨询任意相关成员，必要时向人类澄清。箭头不是不可回退的状态锁。")}</p>`;
  };
  content.querySelectorAll("[data-detail-node]").forEach((button) => button.addEventListener("click", () => showNode(button.dataset.detailNode)));
  showNode(template.nodes[0]?.id);
  if (!frozen) mountWorkflowDiagram("details", template.id, template);
}

/* ---------- 数字员工 ---------- */
function renderAgents() {
  closeFloatingLists($("#agents-grid"));
  const header=$('#agents-header-actions');
  if(header && !header.querySelector('.employee-layout-switch'))header.insertAdjacentHTML('afterbegin',`<div class="employee-layout-switch" role="group" aria-label="${$t("员工展示方式")}"><button type="button" class="small-button" data-employee-layout="grid" aria-label="${$t("卡片视图")}" title="${$t("卡片视图")}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button><button type="button" class="small-button" data-employee-layout="list" aria-label="${$t("列表视图")}" title="${$t("列表视图")}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 5h13M8 12h13M8 19h13M3 5h1m-1 7h1m-1 7h1"/></svg></button></div>`);
  header?.querySelectorAll('[data-employee-layout]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.employeeLayout===(state.employeeLayout || 'grid'))));
  $('#agents-grid').classList.toggle('employee-list-layout',state.employeeLayout==='list');
  const toolbar=$('#agents-view .directory-toolbar');
  if(toolbar && !toolbar.querySelector('.employee-directory-summary'))toolbar.insertAdjacentHTML('beforeend','<span class="employee-directory-summary"></span>');
  if(toolbar){const employees=state.catalogReferences?.agents;toolbar.querySelector('.employee-directory-summary').textContent=employees?$t("{0} 位可用 · {1} 位已停用", [employees.filter(agent=>agent.status==='active').length, employees.filter(agent=>agent.status==='inactive').length]):'';}
  const query = ($("#agents-search").value || "").trim().toLowerCase();
  const roleSelect = $("#agents-role-filter"), selectedRole = roleSelect.value;
  roleSelect.innerHTML = `<option value="">${$t("全部角色")}</option>${state.roles.map(role=>`<option value="${esc(role.id)}">${esc(role.name)}</option>`).join('')}`;
  roleSelect.value = state.roles.some(role=>role.id===selectedRole) ? selectedRole : '';
  const filtered = state.agents.filter(agent => (!roleSelect.value || agent.roleIds?.includes(roleSelect.value)) && `${agent.name} ${agent.description || ""} ${(agent.capabilities || []).join(" ")}`.toLowerCase().includes(query));
  const page = state.directoryPages?.agents || paginate([],1); state.listPages.agents = page.page;
  setTitleCount('agents', page.total);
  const cardIcon = paths => `<svg class="employee-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const listHead = state.employeeLayout === 'list' ? `<div class="employee-list-head" aria-hidden="true"><span></span><span>${$t("姓名")}</span><span>${$t("角色")}</span><span>${$t("运行时")}</span><span>${$t("状态")}</span><span>${$t("操作")}</span></div>` : '';
  $("#agents-grid").innerHTML = listHead + page.items.map((agent) => {
    const roles = (agent.roleIds || []).map(id => state.roles.find(role => role.id === id)?.name || $t("（角色不存在）")).join("、");
    const runtime = `${providerLabel(agent)}${agent.runtime?.model ? " · " + agent.runtime.model : ""}${agent.runtime?.profile ? " · profile: " + agent.runtime.profile : ""}`;
    const pluginCount = new Set([...(agent.runtime?.extensionSelection?.pluginIds || []), ...(agent.inheritedExtensionSelection?.pluginIds || [])]).size;
    const mcpCount = new Set([...(agent.runtime?.extensionSelection?.mcpIds || []), ...(agent.inheritedExtensionSelection?.mcpIds || [])]).size;
    return `
    <div class="agent-card employee-card${agent.status === 'active' ? '' : ' is-disabled'}">
      <div class="agent-card-top">
        <div class="agent-card-avatar ${roleColor(agent)}">${esc(initialsOf(agent))}</div>
        <div class="agent-card-identity"><h3><button class="text-action" data-agent-detail="${agent.id}" title="${esc(agent.name)}">${esc(agent.name)}</button></h3><div class="role" title="${esc(roles || $t("未绑定角色"))}">${roles ? $t("角色：{0}", [esc(roles)]) : $t("未绑定角色")}</div></div>
        <div class="employee-card-badges">${agent.status === "active" ? "" : `<span class="agent-status" data-status="inactive">${$t("已停用")}</span>`}</div>
      </div>
      <p title="${esc([agent.description, ...(agent.capabilities || [])].filter(Boolean).join('\n'))}">${esc(agent.description || $t("（未填写简介）"))}</p>
      <div class="employee-card-footer">
        <div class="agent-runtime employee-runtime-summary"><span title="${esc(runtime)}">${cardIcon('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>')}<span>${esc(runtime)}</span></span>${pluginCount ? `<span title="${$t("插件 {0}", [pluginCount])}" aria-label="${$t("插件 {0}", [pluginCount])}">${cardIcon('<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8m6 9v4"/>')}${pluginCount}</span>` : ''}${mcpCount ? `<span title="MCP ${mcpCount}" aria-label="MCP ${mcpCount}">${cardIcon('<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M9 6h6M7.5 9l3 6m6-6-3 6"/>')}${mcpCount}</span>` : ''}</div>
        <div class="directory-card-actions">${agent.status==='active'?`<button class="small-button primary" data-chat-agent="${agent.id}">${$t("{0}对话", [cardIcon('<path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>')])}</button>`:`<button class="small-button primary" data-agent-status="${esc(agent.id)}" data-status="active">${$t("启用")}</button>`}${actionMenu(`<button class="small-button" data-edit-agent="${agent.id}">${$t("编辑")}</button><button class="small-button" data-clone-agent="${agent.id}">${$t("复制为新员工")}</button><button class="small-button" data-agent-status="${esc(agent.id)}" data-status="${agent.status==='active'?'inactive':'active'}">${agent.status==='active'?$t("停用"):$t("启用")}</button><button class="small-button danger" data-delete-agent="${agent.id}">${$t("删除")}</button>`, $t("员工更多操作"))}</div>
      </div>
    </div>`;
  }).join("") || (query || roleSelect.value ? `<div class="directory-empty" role="status"><strong>${$t("没有匹配的数字员工")}</strong>${$t("请调整搜索条件。")}</div>` : `<div class="directory-empty" role="status"><strong>${$t("还没有数字员工")}</strong>${$t("点击右上角「创建数字员工」添加。")}</div>`);
  renderListPager("agents", page);
}

/* ---------- 角色 ---------- */
function renderRoles() {
  const query = ($("#roles-search").value || "").trim().toLowerCase();
  const filtered = state.roles.filter(role => `${role.name} ${role.prompt || ""}`.toLowerCase().includes(query));
  const page = state.directoryPages?.roles || paginate([],1); state.listPages.roles = page.page;
  setTitleCount('roles', page.total);
  $("#roles-grid").innerHTML = page.items.map(role => {
    const employees = (state.catalogReferences?.agents || []).filter(agent=>agent.roleIds?.includes(role.id));
    const timestamp = role.updatedAt || role.createdAt;
    return `<article class="role-directory-row"><button type="button" class="role-row-open" data-edit-role="${esc(role.id)}" aria-label="${$t("编辑角色 {0}", [esc(role.name)])}">
      <span class="agent-card-avatar color-system" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M6 16v-1a3 3 0 0 1 6 0v1m3-7h3m-3 4h3"/></svg></span>
      <span class="agent-card-identity" title="${esc(role.name)}"><strong>${esc(role.name)}</strong></span>
      <span class="role-row-prompt" title="${esc(role.prompt)}">${esc(role.prompt)}</span>
      <span class="directory-avatar-stack" aria-label="${esc(employees.length ? $t("绑定员工：{0}", [employees.map(agent=>agent.name).join('、')]) : $t("未绑定员工"))}">${employees.slice(0,5).map(agent=>`<span class="agent-card-avatar ${esc(roleColor(agent))}" title="${esc(agent.name)}">${esc(initialsOf(agent))}</span>`).join('')}${employees.length>5?`<span class="directory-avatar-overflow">+${employees.length-5}</span>`:''}</span>
      <time title="${esc((role.updatedAt?`${$t("更新于")} `:`${$t("创建于")} `)+exactTime(timestamp))}">${timestamp ? timeAgo(timestamp) : '—'}</time>
    </button>${actionMenu(`<button class="small-button" data-edit-role="${esc(role.id)}">${$t("编辑")}</button><button class="small-button" data-clone-role="${esc(role.id)}">${$t("复制角色")}</button><button class="small-button danger" data-delete-role="${esc(role.id)}">${$t("删除")}</button>`, $t("角色更多操作"))}</article>`;
  }).join("");
  $("#roles-grid").hidden = !page.items.length;
  $("#roles-empty").hidden = Boolean(page.items.length);
  $("#roles-empty").innerHTML = query ? `<strong>${$t("没有匹配的角色")}</strong>${$t("请调整搜索条件。")}` : `<strong>${$t("还没有角色")}</strong>${$t("创建角色后，可在员工中绑定。")}`;
  renderListPager("roles", page);
}

function roleModal(existing = null, {draft = null} = {}) {
  const initial=existing || draft;
  const employees=(state.catalogReferences?.agents || []).filter(agent=>agent.roleIds?.includes(existing?.id));
  openModal(`
    <header class="directory-detail-header"><h2>${existing ? $t("编辑角色") : $t("创建角色")}</h2><button type="button" class="ghost-button" data-close-modal aria-label="${$t("关闭角色编辑")}">×</button></header>
    <form id="role-form" novalidate>
      <div class="form-field full"><label>${$t("名称")} <b>*</b></label><input name="name" maxlength="80" value="${esc(initial?.name || "")}" placeholder="${$t("例如：事实核查员")}" /><div class="field-error"></div></div>
      <div class="form-field full"><label>${$t("共用系统提示词")} <b>*</b> <span class="role-prompt-count" aria-live="polite"></span></label><textarea name="prompt" rows="12" placeholder="${$t("绑定此角色的员工，在沟通与任务执行中都会把这段文字并入应用系统指令")}">${esc(initial?.prompt || "")}</textarea><div class="field-error"></div></div>
      <div id="role-market-selection"></div>
      <section class="role-usage-note"><strong><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v6m0-9v.01"/></svg>${employees.length ? $t("{0} 位员工绑定此角色", [employees.length]) : $t("尚无员工绑定此角色")}</strong>${employees.length?`<div class="directory-person-chips">${employees.map(agent=>`<span><span class="agent-card-avatar ${esc(roleColor(agent))}">${esc(initialsOf(agent))}</span>${esc(agent.name)}</span>`).join('')}</div>`:''}<p>${$t("员工继承角色的提示词、插件和 MCP。修改只影响新任务与后续沟通，已冻结的任务记录保持不变。")}</p></section>
      <div class="form-actions">
        ${existing?`<button type="button" class="ghost-button danger role-delete" data-delete-role="${esc(existing.id)}">${$t("删除角色")}</button>`:''}
        <button type="button" class="ghost-button" data-close-modal>${$t("取消")}</button>
        <button type="submit" class="primary-button">${existing ? $t("保存修改") : $t("创建角色")}</button>
      </div>
    </form>`, {drawer:true});
  const form = $("#role-form");
  form.closest('.modal').classList.add('role-config-modal','detail-drawer');
  const updateCount=()=>{form.querySelector('.role-prompt-count').textContent=$t("{0} 字", [Array.from(form.prompt.value).length]);};
  form.prompt.addEventListener('input',updateCount);updateCount();
  const extensions=marketplaceUI.select($("#role-market-selection"),initial || {},null);
  form.querySelectorAll(".form-field").forEach((field, index) => {
    const input = field.querySelector("input,textarea"), label = field.querySelector("label");
    if (input && label && !label.htmlFor) { input.id ||= `role-field-${index}`; label.htmlFor = input.id; }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearInvalid(form);
    let valid = true;
    if (!form.name.value.trim()) { setInvalid(form.name, $t("请填写角色名称。")); valid = false; }
    if (!form.prompt.value.trim()) { setInvalid(form.prompt, $t("请填写共用系统提示词。")); valid = false; }
    if (!valid) return;
    try {
      await api(existing ? `/api/roles/${existing.id}` : "/api/roles", { method: existing ? "PUT" : "POST", body: JSON.stringify({ name: form.name.value, prompt: form.prompt.value, extensionSelection:extensions.value() }) });
      closeModal();
      toast(existing ? $t("角色「{0}」已更新。", [form.name.value.trim()]) : $t("角色「{0}」已创建。", [form.name.value.trim()]));
      await refresh();
    } catch (error) { toast(error.message, true); }
  });
}

const newRoleModal = () => roleModal();

/* ---------- 开发手册：当前实现的可检查系统图 ---------- */
const manualPages = {
  "data-model": {
    label: $t("数据模型 ER 图"),
    title: $t("数据模型与文件边界"),
    intro: $t("关系以当前 Store 的 node-less Run 模型为准。SQLite 只保存状态与索引；Trace、结果与 Artifact 内容始终是 Run 文件。"),
  },
  "system-architecture": {
    label: $t("系统架构图"),
    title: $t("系统模块、调用方向与边界"),
    intro: $t("这是当前单机 Node.js 实现，而不是未来生产拓扑。实线表示同步调用或数据流，虚线表示事件推送；模型 Provider 永远不能直接写领域状态。"),
  },
  "task-flow": {
    label: $t("任务流转图"),
    title: $t("任务如何被项目经理驱动"),
    intro: $t("工作流定义职责与交接参考；项目经理每轮依据 Trace、产物、消息、决策和缺陷选择下一次协作，任何角色都可被重新选择。"),
  },
};

function diagramCanvas(key, title) {
  return `<section class="diagram-panel panel">
    <div class="diagram-panel-head">
      <div><div class="panel-kicker">INTERACTIVE DIAGRAM</div><h3>${esc(title)}</h3></div>
      <div class="diagram-controls" aria-label="${$t("图表缩放控制")}">
        <button class="diagram-control" type="button" data-diagram-action="zoom-out" data-diagram-key="${key}" aria-label="${$t("缩小")}">−</button>
        <span class="diagram-scale" data-diagram-scale="${key}">—</span>
        <button class="diagram-control" type="button" data-diagram-action="zoom-in" data-diagram-key="${key}" aria-label="${$t("放大")}">＋</button>
        <button class="diagram-fit" type="button" data-diagram-action="fit" data-diagram-key="${key}">${$t("适应画布")}</button>
      </div>
    </div>
    <div class="diagram-viewport" tabindex="0" aria-label="${$t("{0}；滚轮缩放，左键拖动画布，按加号或减号缩放，按零适应画布，并可使用下方小地图定位", [esc(title)])}">
      <div class="diagram-graph" data-diagram-graph="${key}"></div>
    </div>
    <div class="diagram-panel-foot"><p class="diagram-gesture">${$t("滚轮缩放 · 左键拖动画布 · ＋/− 缩放 · 0 适应画布 · 小地图定位")}</p>
      <div class="diagram-minimap" data-diagram-minimap="${key}" aria-label="${$t("关系图小地图")}"></div>
    </div>
  </section>`;
}

function workflowDiagramCanvas(scope, key, title, className = "workflow-diagram-viewport") {
  const id = `${scope}:${key}`;
  return `<section class="workflow-diagram" aria-label="${esc(title)}">
    <div class="workflow-diagram-head"><div><span>WORKFLOW MAP</span><strong>${esc(title)}</strong></div><div class="workflow-zoom-controls" role="group" aria-label="${$t("工作流缩放")}"><button type="button" class="small-button" disabled data-workflow-view="zoom-out" data-scope="${esc(scope)}" data-key="${esc(key)}" aria-label="${$t("缩小工作流")}">−</button><button type="button" class="small-button" disabled data-workflow-view="reset" data-scope="${esc(scope)}" data-key="${esc(key)}" data-workflow-scale="${esc(id)}" aria-label="${$t("工作流恢复 100%")}">100%</button><button type="button" class="small-button" disabled data-workflow-view="zoom-in" data-scope="${esc(scope)}" data-key="${esc(key)}" aria-label="${$t("放大工作流")}">＋</button><button type="button" class="small-button" disabled data-workflow-view="fit" data-scope="${esc(scope)}" data-key="${esc(key)}">${$t("适应画布")}</button><button type="button" class="small-button" disabled data-workflow-view="format" data-scope="${esc(scope)}" data-key="${esc(key)}">${$t("整理布局")}</button></div>
    </div>
    <div class="diagram-viewport ${esc(className)}" tabindex="0" aria-label="${$t("{0}；滚轮缩放，拖动平移；+/-缩放，0恢复100%。", [esc(title)])}">
      <div class="diagram-graph" data-workflow-diagram-graph="${esc(id)}"></div>
    </div>
    <div class="workflow-diagram-foot"><p class="workflow-diagram-note">${$t("箭头表示职责之间的预期交接；项目经理可依据 Trace 与产物重新选择任意职责。")}</p></div>
  </section>`;
}

async function mountWorkflowDiagram(scope, key, workflow, options = {}) {
  const id = `${scope}:${key}`;
  const container = $(`[data-workflow-diagram-graph="${id}"]`);
  if (!container || container.dataset.mounting) return;
  container.dataset.mounting = "true";
  try {
    await Promise.all([loadVendor("x6"), loadVendor("elk")]);
    if (!container.isConnected) return;
    mountWorkflowGraph(scope,key,container,null,workflow,options,scale=>{const label=$(`[data-workflow-scale="${CSS.escape(id)}"]`);if(label)label.textContent=Math.round(scale*100)+'%';container.dataset.scale=String(scale);});
  } catch (error) { if (container.isConnected) container.textContent = error.message; }
}

function svgFrame(label, body, viewBox = "0 0 1600 980") {
  return `<svg class="architecture-svg" viewBox="${viewBox}" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="diagram-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L9,4 L0,8 z" /></marker></defs>${body}
  </svg>`;
}

function dataModelSvg() {
  return svgFrame($t("Baton 当前数据模型 ER 图"), `
    <text class="svg-caption" x="50" y="48">${$t("领域 metadata（SQLite 快照）")}</text>
    <rect class="diagram-boundary" x="36" y="64" width="1518" height="765" rx="24" />
    <g class="diagram-edge"><path d="M422 211 L304 211" marker-end="url(#diagram-arrow)" /><text x="334" y="197">memberAgentIds[]</text>
      <path d="M700 211 L970 211" marker-end="url(#diagram-arrow)" /><text x="785" y="197">workflowSnapshot</text>
      <path d="M1175 120 L1175 88 L188 88 L188 120" marker-end="url(#diagram-arrow)" /><text x="440" y="80">${$t("memberSnapshots · managerSnapshot（不保存团队关联）")}</text>
      <path d="M1175 315 L1175 411" marker-end="url(#diagram-arrow)" /><text x="1190" y="368">taskId · 1:N</text>
      <path d="M1175 315 L1222 648" marker-end="url(#diagram-arrow)" /><text x="1200" y="500">nodeAssignments</text>
      <path d="M1072 532 L250 650" marker-end="url(#diagram-arrow)" /><text x="590" y="574">1:N · node / manager / consultation / reflection</text>
      <path d="M1090 568 L500 650" marker-end="url(#diagram-arrow)" /><text x="762" y="633">1:N · conversationId</text>
      <path d="M1175 594 L808 650" marker-end="url(#diagram-arrow)" /><text x="958" y="634">1:N · traceId</text>
      <path d="M1295 594 L1360 650" marker-end="url(#diagram-arrow)" /><text x="1323" y="633">1:N</text>
      <path d="M330 745 L1250 745" marker-end="url(#diagram-arrow)" /><text x="752" y="732">Trace.outputArtifactIds[] · Artifact.traceId</text>
      <path d="M1370 806 L1370 882" marker-end="url(#diagram-arrow)" /><text x="1382" y="856">storagePath</text></g>
    <g class="diagram-node agent"><rect x="72" y="120" width="232" height="180" rx="16" /><text class="node-title" x="92" y="153">Agent</text><text class="node-field" x="92" y="182">id · name · status · kind</text><text class="node-field" x="92" y="205">runtime · roleIds[]</text><text class="node-field" x="92" y="228">skills / plugins / MCP paths</text><text class="node-note" x="92" y="270">${$t("提示词与能力定义员工工作方式")}</text></g>
    <g class="diagram-node"><rect x="422" y="120" width="278" height="205" rx="16" /><text class="node-title" x="442" y="153">Team</text><text class="node-field" x="442" y="182">id · name · mission · status</text><text class="node-field" x="442" y="205">memberAgentIds[]</text><text class="node-note" x="442" y="258">${$t("数字员工集合；可无项目经理")}</text><text class="node-note" x="442" y="280">${$t("仅在选人时展开员工")}</text></g>
    <g class="diagram-node workflow"><rect x="700" y="120" width="270" height="205" rx="16" /><text class="node-title" x="720" y="153">WorkflowTemplate</text><text class="node-field" x="720" y="182">id · name · system · nodes[]</text><text class="node-field" x="720" y="205">dependsOn / handoffFrom</text><text class="node-field" x="720" y="228">deliverable · artifactPaths[]</text><text class="node-note" x="720" y="270">repositoryPath: repos/&lt;repo&gt;</text></g>
    <g class="diagram-node task"><rect x="970" y="120" width="410" height="195" rx="16" /><text class="node-title" x="990" y="153">Task</text><text class="node-field" x="990" y="182">id · objective · workspacePath · status</text><text class="node-field" x="990" y="205">memberAgentIds[] · workflowTemplateId</text><text class="node-field" x="990" y="228">workflowSnapshot · nodeAssignments{}</text><text class="node-note" x="990" y="270">${$t("冻结成员与工作流定义")}</text></g>
    <g class="diagram-node run"><rect x="970" y="411" width="410" height="183" rx="16" /><text class="node-title" x="990" y="444">Run</text><text class="node-field" x="990" y="473">id · taskId · status · nodeStates{}</text><text class="node-field" x="990" y="496">manager · reflectionAgent</text><text class="node-field" x="990" y="519">waitingNode / waitingAgent / conversation</text><text class="node-note" x="990" y="557">${$t("一次真实交付的状态权威")}</text></g>
    <g class="diagram-node trace"><rect x="72" y="650" width="258" height="155" rx="16" /><text class="node-title" x="92" y="683">Trace</text><text class="node-field" x="92" y="712">runId · workflowNodeId · agentId</text><text class="node-field" x="92" y="735">type · status · tracePath</text><text class="node-note" x="92" y="770">${$t("每次 Claude Code 调用一条")}</text></g>
    <g class="diagram-node message"><rect x="390" y="650" width="254" height="155" rx="16" /><text class="node-title" x="410" y="683">Message</text><text class="node-field" x="410" y="712">runId · conversationId · nodeId</text><text class="node-field" x="410" y="735">sender · recipient · kind</text><text class="node-note" x="410" y="770">${$t("协作内容；不同于 Event")}</text></g>
    <g class="diagram-node decision"><rect x="704" y="650" width="208" height="155" rx="16" /><text class="node-title" x="724" y="683">Decision</text><text class="node-field" x="724" y="712">runId · traceId</text><text class="node-field" x="724" y="735">impact · affectedNodeIds[]</text><text class="node-note" x="724" y="770">${$t("已确认的关键决策")}</text></g>
    <g class="diagram-node artifact"><rect x="1240" y="650" width="260" height="155" rx="16" /><text class="node-title" x="1260" y="683">Artifact</text><text class="node-field" x="1260" y="712">runId · traceId · ownerAgentId</text><text class="node-field" x="1260" y="735">hash · bytes · version</text><text class="node-note" x="1260" y="770">${$t("metadata，不保存文件内容")}</text></g>
    <text class="svg-caption" x="1070" y="872">${$t("Run 文件目录（真实文件，不入 SQLite）")}</text>
    <g class="diagram-node storage"><rect x="1110" y="882" width="390" height="74" rx="16" /><text class="node-title" x="1130" y="912">runs/&lt;runId&gt;/traces/&lt;traceId&gt;/</text><text class="node-field" x="1130" y="936">events.ndjson · agent-result.json · output/ · workspace/</text></g>
  `);
}

function systemArchitectureSvg() {
  return svgFrame($t("Baton 当前系统架构图"), `
    <rect class="diagram-boundary soft" x="46" y="72" width="400" height="800" rx="25" /><text class="svg-caption" x="72" y="110">${$t("本机浏览器边界")}</text>
    <rect class="diagram-boundary" x="490" y="72" width="698" height="800" rx="25" /><text class="svg-caption" x="516" y="110">${$t("Baton Node.js 进程边界")}</text>
    <rect class="diagram-boundary storage-boundary" x="1230" y="72" width="324" height="800" rx="25" /><text class="svg-caption" x="1254" y="110">${$t("本机持久化边界")}</text>
    <g class="diagram-edge"><path d="M400 250 L555 250" marker-end="url(#diagram-arrow)" /><text x="438" y="235">HTTP /api</text><path class="dashed" d="M555 292 L400 292" marker-end="url(#diagram-arrow)" /><text x="438" y="315">SSE run-event</text>
      <path d="M765 326 L765 410" marker-end="url(#diagram-arrow)" /><text x="780" y="370">${$t("命令 / 只读聚合")}</text><path d="M946 326 L946 410" marker-end="url(#diagram-arrow)" /><text x="960" y="370">${$t("启动 / 恢复 Run")}</text>
      <path d="M830 550 L830 634" marker-end="url(#diagram-arrow)" /><text x="845" y="596">Provider invocation</text><path class="dashed" d="M870 634 L870 550" marker-end="url(#diagram-arrow)" /><text x="884" y="596">${$t("规范化流式事件")}</text>
      <path d="M1060 498 L1275 498" marker-end="url(#diagram-arrow)" /><text x="1110" y="484">SQLite metadata</text><path d="M1060 715 L1275 715" marker-end="url(#diagram-arrow)" /><text x="1110" y="700">${$t("trace / artifact 文件")}</text>
      <path d="M830 744 L830 796" marker-end="url(#diagram-arrow)" /><text x="845" y="782">Claude Code CLI</text></g>
    <g class="diagram-node ui"><rect x="92" y="180" width="308" height="154" rx="18" /><text class="node-title" x="116" y="216">web/ Console</text><text class="node-field" x="116" y="246">${$t("路由、渲染、用户命令")}</text><text class="node-field" x="116" y="269">${$t("任务空间 / SSE / 文件预览")}</text><text class="node-note" x="116" y="302">${$t("不拥有领域状态，不直接调用 Provider")}</text></g>
    <g class="diagram-node http"><rect x="555" y="180" width="430" height="146" rx="18" /><text class="node-title" x="579" y="216">server/index.mjs · HTTP transport</text><text class="node-field" x="579" y="246">${$t("API 路由、静态文件、SSE、错误边界")}</text><text class="node-note" x="579" y="280">${$t("只转换协议；不放编排策略或提示词")}</text></g>
    <g class="diagram-node store"><rect x="555" y="410" width="350" height="140" rx="18" /><text class="node-title" x="579" y="446">server/store.mjs · Domain Store</text><text class="node-field" x="579" y="476">${$t("状态机、ID、校验、Event、metadata")}</text><text class="node-note" x="579" y="510">${$t("唯一可变更 Task / Run / Trace 状态的模块")}</text></g>
    <g class="diagram-node orchestration"><rect x="945" y="410" width="198" height="140" rx="18" /><text class="node-title" x="968" y="446">Orchestrator</text><text class="node-field" x="968" y="476">${$t("候选节点、推进、循环")}</text><text class="node-field" x="968" y="499">${$t("校验 node_result")}</text><text class="node-note" x="968" y="526">${$t("只通过 Store 写状态")}</text></g>
    <g class="diagram-node runtime"><rect x="650" y="634" width="350" height="110" rx="18" /><text class="node-title" x="674" y="670">server/runtime/ · Local Runtime</text><text class="node-field" x="674" y="700">${$t("Claude Code JSONL → 标准化 Provider Event")}</text><text class="node-note" x="674" y="726">${$t("无 Store 写权限；仅任务工作目录")}</text></g>
    <g class="diagram-node provider"><rect x="650" y="796" width="350" height="56" rx="18" /><text class="node-title" x="674" y="830">${$t("Claude Code CLI · 用户授权 bypass 模式")}</text></g>
    <g class="diagram-node persistence"><rect x="1275" y="410" width="230" height="112" rx="18" /><text class="node-title" x="1298" y="446">SQLite</text><text class="node-field" x="1298" y="475">Agent / Team / Task / Run</text><text class="node-note" x="1298" y="501">${$t("只保存 metadata 与状态")}</text></g>
    <g class="diagram-node files"><rect x="1275" y="634" width="230" height="112" rx="18" /><text class="node-title" x="1298" y="670">Run Files</text><text class="node-field" x="1298" y="699">${$t("Trace、结果、Artifact 快照")}</text><text class="node-note" x="1298" y="725">${$t("受限读取与预览")}</text></g>
    <g class="diagram-callout"><rect x="92" y="430" width="308" height="172" rx="18" /><text class="node-title" x="116" y="465">${$t("边界规则")}</text><text class="node-field" x="116" y="496">• ${$t("UI 不写 Store")}</text><text class="node-field" x="116" y="522">• ${$t("Runtime 不决定领域状态")}</text><text class="node-field" x="116" y="548">• ${$t("SQLite 不保存 Trace / 文件内容")}</text><text class="node-field" x="116" y="574">• ${$t("外部发布、删除、凭证仍受限")}</text></g>
  `);
}

function taskFlowSvg() {
  return svgFrame($t("Baton 任务执行与协作流程图"), `
    <text class="svg-caption" x="60" y="48">${$t("正常推进：项目经理在依赖护栏内选择候选节点")}</text>
    <g class="diagram-edge"><path d="M240 150 L350 150" marker-end="url(#diagram-arrow)" /><path d="M595 150 L700 150" marker-end="url(#diagram-arrow)" /><path d="M960 150 L1060 150" marker-end="url(#diagram-arrow)" /><path d="M1310 150 L1400 150" marker-end="url(#diagram-arrow)" />
      <path d="M1488 215 L1488 300 L1060 300" marker-end="url(#diagram-arrow)" /><text x="1230" y="286">${$t("下一候选节点")}</text>
      <path d="M1185 215 L1185 355" marker-end="url(#diagram-arrow)" /><text x="1198" y="292">node_result</text>
      <path d="M1060 422 L882 422" marker-end="url(#diagram-arrow)" /><text x="923" y="408">${$t("Agent 咨询")}</text><path d="M700 422 L530 422" marker-end="url(#diagram-arrow)" /><text x="584" y="408">${$t("答复后重入队")}</text>
      <path d="M1185 488 L1185 570" marker-end="url(#diagram-arrow)" /><text x="1198" y="532">needsHuman</text><path d="M1185 660 L1185 745 L965 745" marker-end="url(#diagram-arrow)" /><text x="1050" y="731">${$t("人类回答后恢复原节点")}</text>
      <path d="M1375 422 L1455 422 L1455 530" marker-end="url(#diagram-arrow)" /><text x="1391" y="408">${$t("错误")}</text><path d="M1455 630 L1455 745 L965 745" marker-end="url(#diagram-arrow)" /><text x="1322" y="731">${$t("保留失败 Trace，仅重排该节点")}</text>
      <path d="M965 422 L965 815" marker-end="url(#diagram-arrow)" /><text x="980" y="626">${$t("验收 Artifact / Message")}</text>
      <path d="M965 882 L1140 882" marker-end="url(#diagram-arrow)" /><path d="M1385 882 L1470 882" marker-end="url(#diagram-arrow)" /><path d="M1265 948 L1265 970 L965 970" marker-end="url(#diagram-arrow)" /><text x="1100" y="958">${$t("rework：从指定节点回队")}</text></g>
    <g class="diagram-node task"><rect x="60" y="96" width="180" height="108" rx="18" /><text class="node-title" x="82" y="132">${$t("创建 Task")}</text><text class="node-field" x="82" y="160">${$t("工作流快照 + 节点分配")}</text><text class="node-note" x="82" y="183">${$t("状态：backlog")}</text></g>
    <g class="diagram-node run"><rect x="350" y="96" width="245" height="108" rx="18" /><text class="node-title" x="372" y="132">${$t("创建 Run")}</text><text class="node-field" x="372" y="160">${$t("复制项目经理、反思 Agent")}</text><text class="node-note" x="372" y="183">planning → running</text></g>
    <g class="diagram-node orchestration"><rect x="700" y="96" width="260" height="108" rx="18" /><text class="node-title" x="722" y="132">${$t("计算合格候选集")}</text><text class="node-field" x="722" y="160">${$t("依赖满足、节点非 completed")}</text><text class="node-note" x="722" y="183">${$t("工作流只限制“不能开始什么”")}</text></g>
    <g class="diagram-node manager"><rect x="1060" y="96" width="250" height="108" rx="18" /><text class="node-title" x="1082" y="132">${$t("项目经理 Trace")}</text><text class="node-field" x="1082" y="160">managerDecision.nextNodeId</text><text class="node-note" x="1082" y="183">${$t("只能选候选集合里的节点")}</text></g>
    <g class="diagram-node agent"><rect x="1400" y="96" width="150" height="108" rx="18" /><text class="node-title" x="1422" y="132">${$t("业务 Agent")}</text><text class="node-field" x="1422" y="160">${$t("真实 Claude Code")}</text><text class="node-note" x="1422" y="183">${$t("一条 Trace")}</text></g>
    <g class="diagram-node consultation"><rect x="700" y="355" width="182" height="132" rx="18" /><text class="node-title" x="722" y="391">${$t("角色协作")}</text><text class="node-field" x="722" y="420">Message</text><text class="node-field" x="722" y="443">conversationId</text><text class="node-note" x="722" y="466">${$t("等待被咨询 Agent")}</text></g>
    <g class="diagram-node queue"><rect x="350" y="355" width="180" height="132" rx="18" /><text class="node-title" x="372" y="391">${$t("节点重新入队")}</text><text class="node-field" x="372" y="420">nodeStates[node] = queued</text><text class="node-note" x="372" y="453">${$t("新调用必创建新 Trace")}</text></g>
    <g class="diagram-node result"><rect x="1060" y="355" width="250" height="132" rx="18" /><text class="node-title" x="1082" y="391">${$t("Orchestrator 验收")}</text><text class="node-field" x="1082" y="420">${$t("校验结构化 node_result")}</text><text class="node-field" x="1082" y="443">${$t("捕获真实文件与仓库变更")}</text><text class="node-note" x="1082" y="466">${$t("接受后节点 completed")}</text></g>
    <g class="diagram-node human"><rect x="1060" y="570" width="250" height="90" rx="18" /><text class="node-title" x="1082" y="606">${$t("等待人类澄清")}</text><text class="node-field" x="1082" y="634">${$t("Human Channel 只显示需人处理的消息")}</text></g>
    <g class="diagram-node retry"><rect x="1355" y="530" width="195" height="100" rx="18" /><text class="node-title" x="1377" y="566">${$t("项目经理巡检")}</text><text class="node-field" x="1377" y="595">${$t("五分钟检查无活跃角色")}</text><text class="node-note" x="1377" y="615">${$t("事件审计，不混入澄清")}</text></g>
    <g class="diagram-node outputs"><rect x="755" y="815" width="210" height="132" rx="18" /><text class="node-title" x="777" y="851">${$t("交付与协作反馈")}</text><text class="node-field" x="777" y="880">Artifact / Message</text><text class="node-field" x="777" y="903">${$t("问题与结果 → 协作消息")}</text><text class="node-note" x="777" y="926">${$t("说明问题 → 处理 → 反馈")}</text></g>
    <g class="diagram-node reflection"><rect x="1140" y="828" width="245" height="108" rx="18" /><text class="node-title" x="1162" y="864">${$t("独立交付反思")}</text><text class="node-field" x="1162" y="892">${$t("pass 或 rework + restartFromNodeId")}</text><text class="node-note" x="1162" y="916">${$t("无开放缺陷才可进入")}</text></g>
    <g class="diagram-node completed"><rect x="1470" y="828" width="100" height="108" rx="18" /><text class="node-title" x="1490" y="874">${$t("完成")}</text><text class="node-note" x="1490" y="902">Run completed</text></g>
  `, "0 0 1620 1010");
}

function manualDetails(key) {
  const content = {
    "data-model": [
      [$t("员工历史与可见性"), $t("每个员工以稳定 Agent ID 查询自己的私聊、可见群聊与参与任务；临时项目经理映射 sourceAgentId。群消息 visibleToAgentIds 冻结可见成员，@ 只决定谁回复。旧群记录仅按已保存证据开放，不替新成员补造历史权限。")],
      [$t("长期沟通"), $t("员工私聊按 Agent 唯一，团队群聊按 Team 唯一；消息、投递和操作事件长期保存，不随任务删除。Provider 会话与 Run 隔离；模型上下文长度不等于完整历史保留期限。")],
      [$t("状态权威"), $t("Task / Run 整体状态与 Trace metadata 由 Store 校验并写入 SQLite；currentFocus 由项目经理判断并持久化，节点是职责定义而非永久完成状态。Event 是追加事实，Message 是协作内容。")],
      [$t("关联方式"), $t("Artifact、Decision 都以 runId / traceId 关联一次真实调用；Message 以 conversationId 关联一次协作或澄清。")],
      [$t("文件边界"), $t("Artifact 的 storagePath 指向 Run Files；数据库不保存内容。代码仅在任务目录的 repos/<子目录> Git 仓库中工作。")],
      [$t("员工与任务快照"), $t("员工包含名称、执行类型、能力说明、系统提示词和 Runtime 连接选择。研发员工绑定一个 Git 仓库；Task 冻结团队、工作流与仓库来源，Run 启动前检出仓库，研发从绑定仓库执行。工作流管理列表只展示摘要，详情解释节点职责和交接。")],
      [$t("会话与投递"), $t("Dispatch 保证排队、领取、等待与重试；不是 Step 或 NodeExecution。同一 Run 的同一成员续接自己的 Provider 会话，不与其他成员共享私有模型上下文。")],
    ],
    "system-architecture": [
      [$t("只读历史工具"), $t("Store 内 history 模块提供完整分页、中文关键词搜索、全部 Trace 与交付读取，SQLite 搜索索引可重建。每次 CLI 调用通过私有 Unix socket + MCP 标注员工，不暴露管理员 Cookie；历史查询不共享模型会话、不更改任务状态。")],
      [$t("沟通执行"), $t("三个入口打开同一会话；communication-store 是 Store 内部命令，communication 服务驱动独立本机 CLI。群聊有 @ 定向回复，无 @ 全部活跃数字成员回复，没有默认经理。失败等待人类重试，不阻塞其他成员；可取消待回复而不删除消息。")],
      [$t("写入边界"), $t("web 只通过 HTTP 发命令；index 只做传输；Store 是唯一能改变领域状态的模块；Orchestrator 不直改内部数组。")],
      [$t("运行边界"), $t("Runtime 启动本机 Claude Code（默认）或 Codex，并标准化 JSONL 事件。最终 node_result 必须被 Orchestrator 验证后才能成为交付事实。Provider 登录和模型可用性由本机配置决定。")],
      [$t("登录与执行"), $t("客户端自带本机服务，仅监听随机 loopback 端口；页面、API 和 SSE 均需单管理员登录。数字员工以本机用户权限执行，平台不设置任务级操作权限。")],
      [$t("插件与 MCP"), $t("一个员工可绑定多个插件来源仓库，分别启停并逐插件选择；来源、版本和选择持久化。更新创建新检出，历史任务保持原版本；拒绝同时启用同名插件。当前仅支持仓库内插件，不自动安装外部包。MCP 接受多服务 JSON，私有文件保存。Claude 配置不传给 Codex。")],
      [$t("当前限制"), $t("这是单机单用户平台，不是多租户系统。SQLite、共享本机文件与 bypass 执行不提供租户隔离或完整审批。插件会执行代码，只有可信来源才能启用。")],
    ],
    "task-flow": [
      [$t("按需找回历史"), $t("沟通和任务中均可使用 8 个内置历史工具。先搜索，再按 recordId 读取原文；hasMore 时继续分页或分段。历史内容是证据，不是当前指令或发布授权。归档记录仍可读，物理删除后不再返回。")],
      [$t("协作不是固定串行"), $t("项目经理每次从所有职责定义中依据当前事实作出结构化选择；它负责流程，不替业务角色完成交付。")],
      [$t("澄清与回路"), $t("业务问题优先点对点咨询相应角色；只有团队无法回答的产品取舍、验收标准或外部事实才等待人类。发现问题后通过协作消息交接处理和反馈结果。")],
      [$t("恢复与暂停"), $t("Provider、工具或结构化输出错误封存失败 Trace 并重试原 Dispatch；十秒巡检非失败、非人类等待的空闲任务。人类可暂停全部执行并手动继续，也可终止；等待澄清不会被巡检强行跳过。")],
      [$t("完成与后续咨询"), $t("经理提交人类验收后进入 awaiting_acceptance，只有人类确认才 completed。未归档仍能咨询，停止状态下答疑不恢复开发；普通新指令进入队列，不打断正在执行的成员。归档后只读。")],
    ],
  };
  return content[key].map(([title, text]) => `<article class="manual-detail"><h4>${esc(title)}</h4><p>${esc(text)}</p></article>`).join("");
}

function bindDiagramInteractions() {
  $$('[data-diagram-viewport]').forEach((viewport) => {
    if (viewport.dataset.bound) return;
    viewport.dataset.bound = "true";
    const key = viewport.dataset.diagramViewport;
    let pointer = null;
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      updateDiagram(key, event.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });
    viewport.addEventListener("pointerdown", (event) => {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("dragging");
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const view = state.diagramViews[key] || { scale: 1, x: 0, y: 0 };
      state.diagramViews[key] = { ...view, x: view.x + event.clientX - pointer.x, y: view.y + event.clientY - pointer.y };
      pointer = { ...pointer, x: event.clientX, y: event.clientY };
      applyDiagram(key);
    });
    const release = (event) => { if (!pointer || pointer.id !== event.pointerId) return; pointer = null; viewport.classList.remove("dragging"); };
    viewport.addEventListener("pointerup", release); viewport.addEventListener("pointercancel", release);
  });
}

function applyDiagram(key) {
  const view = state.diagramViews[key] || { scale: 1, x: 0, y: 0 };
  const canvas = $(`[data-diagram-canvas="${key}"]`), label = $(`[data-diagram-scale="${key}"]`);
  if (canvas) canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  if (label) label.textContent = `${Math.round(view.scale * 100)}%`;
}
function updateDiagram(key, factor) {
  const view = state.diagramViews[key] || { scale: 1, x: 0, y: 0 };
  state.diagramViews[key] = { ...view, scale: Math.max(.55, Math.min(1.9, view.scale * factor)) };
  applyDiagram(key);
}
function resetDiagram(key) { state.diagramViews[key] = { scale: 1, x: 0, y: 0 }; applyDiagram(key); }

async function renderManual() {
  const page = manualPages[state.manualPage] || manualPages["data-model"];
  disposeManualGraphs();
  $("#manual-content").innerHTML = `
    <nav class="manual-tabs" aria-label="${$t("开发手册章节")}">${Object.entries(manualPages).map(([key, item]) => `<button class="manual-tab ${key === state.manualPage ? "active" : ""}" type="button" data-manual-page="${key}" aria-current="${key === state.manualPage ? "page" : "false"}">${esc(item.label)}</button>`).join("")}</nav>
    <section class="manual-intro"><div><div class="panel-kicker">${esc(page.label)}</div><h3>${esc(page.title)}</h3><p>${esc(page.intro)}</p></div><a href="${state.manualPage === "data-model" ? "/manual/system-architecture" : state.manualPage === "system-architecture" ? "/manual/task-flow" : "/manual/data-model"}" data-manual-next>${$t("继续阅读")} →</a></section>
    ${diagramCanvas(state.manualPage, page.title)}
    <section class="manual-details">${manualDetails(state.manualPage)}</section>`;
  const key = state.manualPage;
  const container = $(`[data-diagram-graph="${key}"]`);
  try { await loadVendor("x6"); } catch (error) { if (container.isConnected) container.textContent = error.message; return; }
  if (!container.isConnected) return;
  mountManualGraph(key, container, $(`[data-diagram-minimap="${key}"]`), (scale) => {
    const label = $(`[data-diagram-scale="${key}"]`); if (label) label.textContent = `${Math.round(scale * 100)}%`;
  });
}

/* ---------- 任务空间 ---------- */
function latestExecutedAgentId(agents, traces) {
  const ids=new Set(agents.map(agent=>agent.id));
  const latest=traces.reduce((found,trace)=>{
    if(!ids.has(trace.agentId))return found;
    const timestamp=Date.parse(trace.startedAt || trace.createdAt)||0;
    return !found || timestamp>=(Date.parse(found.startedAt || found.createdAt)||0)?trace:found;
  },null);
  return latest?.agentId || null;
}

function workspaceDirectoryDetails(task) {
  const absolute = task.workspacePath || "";
  const taskRoot = (task.taskWorkspacePath || "").replace(/\/+$/, "");
  const relative = taskRoot && absolute.startsWith(`${taskRoot}/`)
    ? `…/${absolute.slice(taskRoot.length + 1)}`
    : absolute.replace(/\/+$/, "").split("/").at(-1) || ".";
  return `<h5>${$t("工作目录")}</h5><div class="workspace-path"><span title="${esc(absolute)}">${esc(relative)}</span><button class="text-action" data-copy="${esc(absolute)}">${$t("复制")}</button><button class="text-action" data-open-workspace-directory>${$t("打开")}</button></div>`;
}

async function showEmployeeDetail(member, {drawer = false} = {}) {
  await Promise.all([loadVendor("marked"),loadVendor("dompurify")]).catch(() => {});
  const profileMarkup=employee=>employeeDetailMarkup(employee,{renderContent:markdownContent,renderAvatar:agent=>`<span class="agent-card-avatar ${esc(roleColor(agent))}">${esc(initialsOf(agent))}</span>`});
  openModal(drawer ? `<header class="directory-detail-header"><h2>${$t("员工详情")}</h2><button type="button" class="small-button" data-profile-chat>${$t("对话")}</button><button type="button" class="small-button" data-edit-agent="${esc(member.id)}">${$t("编辑")}</button><button type="button" class="ghost-button" data-close-modal aria-label="${$t("关闭员工详情")}">×</button></header><div class="directory-detail-body"><div data-employee-profile>${profileMarkup(member)}</div><section class="employee-profile-section" data-employee-runtime><h4>${$t("运行配置")}</h4><p class="field-hint" role="status">${$t("正在读取…")}</p></section><section class="employee-profile-section" data-employee-tools><h4>${$t("工具")}</h4><p class="field-hint" role="status">${$t("正在读取…")}</p></section></div>` : `${profileMarkup(member)}<div class="form-actions"><button class="ghost-button" data-close-modal>${$t("关闭")}</button></div>`, {drawer});
  $('#modal-content').closest('.modal').classList.add('employee-detail-modal');
  if(!drawer)return;
  $('#modal-content').closest('.modal').classList.add('detail-drawer');
  const host=$('[data-employee-profile]'),runtimeHost=$('[data-employee-runtime]'),toolsHost=$('[data-employee-tools]');
  $('[data-profile-chat]').onclick=()=>{closeModal();communicationUI.open('agent',member.id);};
  const tools=['pluginIds','mcpIds'].flatMap((key,index)=>[...new Set([...(member.runtime?.extensionSelection?.[key] || []),...(member.inheritedExtensionSelection?.[key] || [])])].map(id=>({id,kind:index?'MCP':$t("插件"),path:index?'mcp-marketplace':'marketplace'})));
  const [profiles,roles,extensions]=await Promise.all([
    api('/api/settings/runtime-profiles').then(result=>result.profiles).catch(()=>null),
    Promise.allSettled((member.roleIds || []).map(id=>api(`/api/roles/${encodeURIComponent(id)}`).then(result=>result.role))),
    Promise.allSettled(tools.map(tool=>api(`/api/runtime/${tool.path}/${encodeURIComponent(tool.id)}`)))
  ]);
  if(!host.isConnected)return;
  host.innerHTML=profileMarkup({...member,roles:roles.map((result,index)=>result.status==='fulfilled'?result.value:{name:state.roles.find(role=>role.id===member.roleIds[index])?.name || $t("角色"),prompt:$t("角色提示词读取失败")})});
  const profile=profiles?.find(profile=>profile.id===member.runtime?.profileId);
  runtimeHost.innerHTML=`<h4>${$t("运行配置")}</h4>${profile?`<dl class="employee-runtime-details"><dt>${$t("运行时")}</dt><dd>${esc(runtimeLabel(profile.provider))}</dd><dt>${$t("模型")}</dt><dd>${esc(profile.model || $t("CLI 默认模型"))}</dd><dt>${$t("思考等级")}</dt><dd>${esc(profile.effort || $t("默认"))}</dd></dl>`:`<p class="field-hint" role="${profiles?'status':'alert'}">${profiles?$t("当前 Runtime 配置不可用"):$t("运行配置读取失败，请重新打开详情。")}</p>`}`;
  toolsHost.innerHTML=`<h4>${$t("工具")}</h4>${tools.length?`<div class="directory-person-chips">${tools.map((tool,index)=>`<span><span class="agent-card-avatar color-${extensionAvatarColor(tool.id)}">${esc((extensions[index].status==='fulfilled'?extensions[index].value.name:tool.kind).slice(0,1))}</span>${esc(extensions[index].status==='fulfilled'?extensions[index].value.name:tool.id)}<small>${esc(tool.kind)}${extensions[index].status==='rejected'?` · ${$t("读取失败")}`:''}</small></span>`).join('')}</div>`:`<p class="field-hint">${$t("未选择插件或 MCP。")}</p>`}`;
}

function taskDescriptionMarkup(task, view) {
  const characters = Array.from(task.objective || "");
  const long = characters.length > 100;
  const expanded = Boolean(view.descriptionExpanded);
  const text = long && !expanded ? `${characters.slice(0, 100).join("")}…` : characters.join("");
  return `<h5>${$t("任务描述")}</h5><div id="task-description-content" class="workspace-brief"><p>${esc(text)}</p></div>${long ? `<button class="text-action" data-toggle-task-description aria-expanded="${expanded}" aria-controls="task-description-content">${expanded ? $t("收起") : $t("展开")}</button>` : ""}`;
}

function workspaceDetailsMarkup(workspace, { agents, currentFocusNode, view, artifactCount }) {
  const { run, traces = [] } = workspace;
  const focus = workflowFocus(run, traces);
  // Read the latest delivery attempt per node; manager/consultation turns do
  // not establish a node handoff. A completed Trace is a recorded handoff,
  // never a platform judgment of workflow completion.
  const nodeTraces = new Map();
  for (const trace of traces) {
    if (!trace.workflowNodeId || trace.agentId === run.manager?.id || (trace.type && trace.type !== "node")) continue;
    const previous = nodeTraces.get(trace.workflowNodeId);
    if (!previous || (Date.parse(trace.startedAt) || 0) >= (Date.parse(previous.startedAt) || 0)) nodeTraces.set(trace.workflowNodeId, trace);
  }
  const focusRows = (run.task.workflowSnapshot.nodes || []).map(node => {
    const trace = nodeTraces.get(node.id);
    const current = run.currentFocus?.nodeId === node.id;
    const waiting = ["waiting_human", "waiting_agent"].includes(focus[node.id]);
    const status = trace?.status === "failed" ? "failed" : trace?.status === "running" ? "running" : waiting ? "waiting" : current ? "current" : trace?.status === "completed" ? "done" : trace ? "recorded" : "pending";
    const label = { failed: $t("交付失败"), running: $t("执行中"), waiting: focus[node.id] === "waiting_human" ? $t("等待澄清") : $t("等待答复"), current: $t("当前焦点"), done: $t("已交接"), recorded: trace?.status === "cancelled" ? $t("已取消") : $t("已记录"), pending: $t("未派工") }[status];
    const executor = trace && (agents.find(agent => agent.id === trace.agentId)?.name || trace.agent?.name || trace.agentId);
    const icon = status === "done" ? '<circle cx="8" cy="8" r="6"/><path d="m5 8 2 2 4-4"/>' : status === "failed" ? '<circle cx="8" cy="8" r="6"/><path d="M8 4.5v4M8 11h.01"/>' : ["running", "current", "waiting"].includes(status) ? '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2" fill="currentColor"/>' : '<circle cx="8" cy="8" r="6"/>';
    return `<li class="workflow-focus-row" data-focus-state="${status}"${current ? ' aria-current="step"' : ""}><svg class="workflow-focus-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">${icon}</svg><span class="workflow-focus-title">${esc(node.title)}</span><small${executor ? ` title="${esc(`${executor} · ${label}`)}"` : ""}>${esc(executor ? `${executor} · ${label}` : status === "pending" ? "—" : label)}</small></li>`;
  }).join("");
  return `<aside id="workspace-details" class="workspace-details" aria-label="${$t("任务详情")}" ${view.detailsOpen ? "" : "hidden"}>
      <h4>${$t("概要")}</h4>
      <dl class="workspace-properties">
        <div><dt>${$t("状态")}</dt><dd>${pill(run.status)}</dd></div>
        <div><dt>${$t("经理")}</dt><dd>${esc(run.manager?.name || "—")}</dd></div>
        <div><dt>${$t("开始")}</dt><dd><time title="${esc((run.startedAt || run.createdAt ? exactTime(run.startedAt || run.createdAt) : "—"))}">${esc((run.startedAt || run.createdAt ? exactTime(run.startedAt || run.createdAt) : "—"))}</time></dd></div>
        <div><dt>${$t("工作流@@field")}</dt><dd><button class="text-action task-workflow-link" data-task-workflow-details>${esc(run.task.workflowSnapshot.name || $t("当前工作流"))} ↗</button></dd></div>
        <div><dt>${$t("当前执行")}</dt><dd>${esc((workspace.traces || []).filter(trace=>trace.status==="running").map(trace=>agents.find(agent=>agent.id===trace.agentId)?.name || trace.agentId).join("、") || $t("暂无执行成员"))}</dd></div>
        <div><dt>${$t("数字员工")}</dt><dd>${$t("{0} 位", [agents.length])}</dd></div>
        <div><dt>${$t("文件")}</dt><dd><button class="text-action" data-ws-tab="directory">${$t("打开工作目录 ↗")}</button><small> · ${$t("{0} 项交付快照", [artifactCount])}</small></dd></div>
        ${run.task.kind === 'automation' ? `<div><dt>${$t("任务来源")}</dt><dd>${$t("自动化 · 配置 v{0}", [esc(run.task.automationVersion)])}</dd></div>${run.confirmedBy ? `<div><dt>${$t("完成方式")}</dt><dd>${run.confirmedBy === 'automation' ? $t("自动确认") : $t("手动确认")} · ${exactTime(run.confirmedAt)}</dd></div>` : run.status === 'awaiting_acceptance' ? `<div><dt>${$t("验收安排")}</dt><dd>${$t("下一轮开始前自动确认，也可提前确认完成。")}</dd></div>` : ''}` : ''}
      </dl>
      <details class="workspace-workflow-focus" data-workspace-disclosure="workflow-focus" ${view.disclosures?.["workflow-focus"] === false ? "" : "open"}><summary>${$t("协作焦点")}</summary><ol class="workflow-focus-list">${focusRows || `<li class="workflow-focus-empty">${$t("暂无工作流节点")}</li>`}</ol><p class="workflow-focus-note">${$t("依据交接记录与经理当前焦点呈现，不代表平台判定完成度。")}</p></details>
      <section class="task-member-section"><header><h5>${$t("成员")}<span>${agents.length}</span></h5>${!run.task.archivedAt && !["completed","cancelled"].includes(run.status) ? `<button class="text-action member-console-icon" data-edit-task-members aria-label="${$t("编辑任务成员")}" title="${$t("添加或移除成员")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>` : ''}</header><div class="task-member-list">${agents.map(agent=>`<div class="task-member-row"><button class="text-action task-member-identity" data-task-member-detail="${esc(agent.id)}" title="${esc(agent.name)}"><span class="role-avatar ${roleColor(agent)}">${esc(initialsOf(agent))}${agent.id===run.manager.id ? `<span class="task-manager-star avatar-manager-mark" aria-label="${$t("本次经理")}">★</span>` : ''}${roleExecutionStatus(run,workspace.traces,agent.id).active?`<span class="member-running-dot" role="status" aria-label="${$t("正在运行")}" title="${$t("正在运行")}"></span>`:''}</span><span>${esc(agent.name)}</span></button>${roleExecutionStatus(run,workspace.traces,agent.id).state === "error" ? `<small class="task-member-error">${$t("执行失败")}</small>` : (workspace.pendingQuestions || []).some(question => question.sender?.id === agent.id && question.recipient?.type === "human") ? `<small class="task-member-waiting">${$t("待回答")}</small>` : ''}<button class="text-action member-console-icon" data-task-member-console="${esc(agent.id)}" aria-label="${$t("查看 {0} 的控制台", [esc(agent.name)])}" aria-pressed="${view.tab==='console'&&state.selectedAgentId===agent.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/></svg></button></div>`).join('')}</div></section>
      <section class="workspace-context">${taskDescriptionMarkup(run.task, view)}</section>
      <section class="workspace-directory-details" id="workspace-directory-details">${workspaceDirectoryDetails(run.task)}</section>
    </aside>`;
}

// Preserve the console subtree across summary updates; replacing its parent
// destroys selection and hydrated log bodies even when the events did not change.
function updateWorkspaceMarkup(box, markup, preserveConsole) {
  if (!preserveConsole) { box.innerHTML = markup; return; }
  const template = document.createElement("template"); template.innerHTML = markup;
  const reconcile = (parent, incoming) => {
    let cursor = parent.firstChild;
    for (const fresh of [...incoming.childNodes]) {
      let kept = null;
      if (fresh.nodeType === 1 && (fresh.id === "console-panel" || fresh.querySelector("#console-panel"))) {
        kept = [...parent.children].find(child => fresh.id ? child.id === fresh.id : child.className === fresh.className);
        if (kept?.id === "console-panel") {
          for (const selector of [".role-nav", ".console-heading"]) {
            const old = kept.querySelector(selector), next = fresh.querySelector(selector);
            if (old && next && old.outerHTML !== next.outerHTML) old.replaceWith(next);
          }
        } else if (kept) reconcile(kept, fresh);
      }
      const node = kept || (cursor?.nodeType === fresh.nodeType && cursor.isEqualNode(fresh) ? cursor : fresh);
      if (node !== cursor) parent.insertBefore(node, cursor);
      cursor = node.nextSibling;
    }
    while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
  };
  reconcile(box, template.content);
}

function renderWorkspace() {
  const box = $("#run-workspace");
  const workspace = state.workspace?.run?.id === state.selectedRunId ? state.workspace : null;
  if (!workspace) {
    disposeWorkflowGraphs("task");
    box.innerHTML = state.selectedRunId ? `<div class="empty-state" role="status"><strong>${state.workspaceError ? $t("任务加载失败") : $t("正在加载任务…")}</strong>${esc(state.workspaceError || $t("正在读取协作记录与当前状态"))}${state.workspaceError ? `<button class="small-button" data-reload-workspace>${$t("重试")}</button>` : ""}</div>` : `<div class="empty-state"><strong>${$t("还没有选择任务")}</strong>${$t("请从任务中心进入一个任务。")}</div>`;
    return;
  }
  const { run, artifacts, messages, events, traces = [] } = workspace;
  const view = workspaceView(run.id);
  view.detailsByTab ||= {};
  view.detailsOpen = view.detailsByTab[view.tab] ?? (view.tab === "collaboration" && !window.matchMedia("(max-width: 1180px)").matches);
  const oldStream = box.querySelector("#trace-stream");
  if (box.dataset.runId === run.id) {
    rememberDirectoryReading(view);
    rememberDiffReading(view);
    for (const details of box.querySelectorAll("[data-workspace-disclosure]")) view.disclosures[details.dataset.workspaceDisclosure] = details.open;
    if (oldStream?.clientHeight) view.consoleViews.set(box.dataset.agentId, {
      ...captureConsoleReading(oldStream),
      open: [...oldStream.querySelectorAll("details[open][data-console-key]")].map((item) => item.dataset.consoleKey),
      closed: [...oldStream.querySelectorAll("details[data-default-open]:not([open])")].map((item) => item.dataset.consoleKey),
    });
  }
  const draftFocused = document.activeElement?.id === "instruction-text" && box.dataset.runId === run.id;
  const draftSelection = draftFocused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd, document.activeElement.selectionDirection] : null;
  const draftScrollTop = draftFocused ? document.activeElement.scrollTop : 0;
  const humanScroll = box.dataset.runId === run.id ? box.querySelector(".human-message-list") : null;
  const humanScrollState = humanScroll?.clientHeight ? { top: humanScroll.scrollTop, following: humanScroll.scrollHeight - humanScroll.scrollTop - humanScroll.clientHeight < 48 } : null;
  if (humanScrollState) view.collaborationScroll = humanScrollState;
  if (view.jumpLatest) { view.consoleViews.delete(state.selectedAgentId); view.collaborationScroll = null; }
  const focus = workflowFocus(run, traces);
  const agents = workspaceAgents(workspace, state.agents);
  const tab = view.tab;
  const consoleAgents = tab === 'console' ? workspaceAgents(workspace, state.agents, { includeDeleted: true }) : agents;
  if (!consoleAgents.some((agent) => agent.id === state.selectedAgentId)) state.selectedAgentId = tab === 'console' ? latestExecutedAgentId(agents,traces) : null;
  const selected = consoleAgents.find((agent) => agent.id === state.selectedAgentId);
  const artifactCount = Number.isInteger(run.artifactCount) ? run.artifactCount : null;
  const currentFocusNode = run.currentFocus?.nodeId ? run.task.workflowSnapshot.nodes.find((node) => node.id === run.currentFocus.nodeId) : null;
  const activeStatus = ["planning", "running", "awaiting_human", "review"].includes(run.status);
  const scheduledRetries = retryableDispatches(workspace);
  const failedRecovery = failedRunRecovery(workspace);
  const failureMessage = run.status === "failed" ? failedRunMessage(workspace) : null;
  const acceptance = acceptanceReview(workspace);

  updateWorkspaceMarkup(box, `
    <div class="workspace-summary">
      <div class="workspace-title">
        <button class="workspace-back" data-back-to-tasks aria-label="${run.task.kind === 'automation' ? $t("返回触发记录") : $t("返回任务列表")}" title="${run.task.kind === 'automation' ? $t("返回触发记录") : $t("返回任务列表")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button>
        <span class="workspace-crumb">${$t("任务")} /</span><h3 title="${esc(run.task.title)}">${esc(run.task.title)}</h3>
        ${run.task.kind === "automation" && run.status === "awaiting_acceptance" ? `<span class="status-pill awaiting_acceptance">${$t("待验收")}</span>` : pill(run.status)}
      </div>
      <div class="workspace-summary-meta">
        ${acceptance?.verified ? `<button class="primary-button compact" data-open-completion-confirm="${esc(run.id)}">${$t("确认完成")}</button>` : ""}
        ${scheduledRetries.length ? `<button class="small-button amber" data-retry-scheduled="${run.id}" title="${$t("立即启动等待退避的调用；失败 Trace 与原投递会保留。")}">${$t("立即重试 {0} 项调用", [scheduledRetries.length])}</button>` : ""}
        ${failedRecovery?.type === "orchestration" ? `<button class="small-button amber" data-retry-orchestration="${run.id}" ${traces.some(trace=>trace.status==="running") ? "disabled" : ""} title="${$t("重新准备运行环境，继续原失败投递或待执行队列。")}">${$t("修复后重新尝试")}</button>` : ""}
        ${failedRecovery?.type === "node" ? failedRecovery.nodeIds.map((nodeId) => {
          const node = run.task.workflowSnapshot.nodes.find((item) => item.id === nodeId);
          return `<button class="small-button amber" data-retry-failed-node="${run.id}" ${traces.some(trace=>trace.status==="running") ? "disabled" : ""} data-workflow-node-id="${esc(nodeId)}" title="${$t("由原员工继续失败投递；原会话、历史调用记录 与产物会保留。")}">${$t("从「{0}」恢复", [esc(node?.title || nodeId)])}</button>`;
        }).join("") : ""}
        ${activeStatus ? `<button class="ghost-button" data-pause-run="${run.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="3.2" height="14" rx="1"/><rect x="13.8" y="5" width="3.2" height="14" rx="1"/></svg>${$t("暂停")}</button>` : run.status === "paused" ? `<button class="primary-button" data-resume-run="${run.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>${$t("继续执行")}</button>` : ""}
        ${actionMenu(`${!run.task.archivedAt && !["completed", "cancelled"].includes(run.status) ? `<button data-edit-task-members>${$t("编辑成员")}</button>` : ''}<button data-open-workspace-directory>${$t("打开工作目录")}</button>${activeStatus || ["paused", "awaiting_acceptance", "failed"].includes(run.status) ? `<button class="danger-button" data-terminate-run="${run.id}">${$t("终止执行")}</button>` : ''}`, $t("更多任务操作"))}
        <button class="text-action workspace-details-toggle" data-toggle-task-details aria-expanded="${Boolean(view.detailsOpen)}" aria-controls="workspace-details" aria-label="${$t("任务详情")}" title="${$t("任务详情（⌘I）")}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button>
      </div>
    </div>
    <div class="ws-tabs workspace-mode-tabs" role="tablist" aria-label="${$t("任务工作区")}">
      <button id="collaboration-mode" class="ws-tab ${tab === "collaboration" ? "active" : ""}" data-ws-tab="collaboration" role="tab" aria-controls="collaboration-panel" aria-selected="${tab === "collaboration"}">${$t("协作{0}", [workspace.pendingQuestions?.some((item) => item.recipient.type === "human") ? `<span class="collaboration-unread" aria-label="${$t("{0} 条待你回复", [workspace.pendingQuestions.filter((item) => item.recipient.type === "human").length])}">${workspace.pendingQuestions.filter((item) => item.recipient.type === "human").length}</span>` : ""])}</button>
      <button id="directory-mode" class="ws-tab ${["directory", "diff"].includes(tab) ? "active" : ""}" data-ws-tab="directory" role="tab" aria-controls="working-directory-panel working-diff-panel" aria-selected="${["directory", "diff"].includes(tab)}">${$t("文件{0}", [artifactCount===null?'':`<span class="tab-count" title="${$t("{0} 项已记录交付快照", [artifactCount])}">${artifactCount}</span>`])}</button>
      <button id="console-mode" class="ws-tab ${tab === "console" ? "active" : ""}" data-ws-tab="console" role="tab" aria-controls="console-panel" aria-selected="${tab === "console"}">${$t("控制台")}</button>
    </div>
    <div class="workspace-body ${view.detailsOpen ? "details-open" : ""}">
    <div class="workspace-main">
    ${failureMessage && tab === "collaboration" ? `<div class="workspace-failure" role="alert"><strong>${$t("本轮未完成")}</strong><span>${esc(failureMessage)}</span><small>${run.failure?.phase === "workspace_baseline_missing" ? $t("历史执行、调用记录和交付文件 保留供核对；此 Run 无法安全重试。") : failedRecovery ? $t("修复原因后可重试原员工的失败投递；原会话、历史调用记录、产物和消息都会保留。") : $t("任务已归档，不能重新启动。")}</small>${run.failure?.phase === "workspace_baseline_missing" ? (run.task.kind === 'automation' ? `<button class="small-button" data-goto="automations">${$t("查看自动化配置")}</button>` : `<button class="small-button" data-action="new-task">${$t("新建任务")}</button>`) : ""}${failedRecovery ? `<div class="workspace-failure-actions">${scheduledRetries.length ? `<button class="small-button amber" data-retry-scheduled="${run.id}">${$t("重试")}</button>` : ""}${failedRecovery.type === "orchestration" ? `<button class="small-button amber" data-retry-orchestration="${run.id}" ${traces.some(trace=>trace.status==="running") ? "disabled" : ""}>${$t("修复后重新尝试")}</button>` : ""}${failedRecovery.type === "node" ? `<button class="small-button amber" data-retry-failed-node="${run.id}" ${traces.some(trace=>trace.status==="running") ? "disabled" : ""} data-workflow-node-id="${esc(failedRecovery.nodeIds[0])}">${$t("从失败节点恢复")}</button>` : ""}<button class="small-button" data-ws-tab="console">${$t("查看控制台日志")}</button></div>` : ""}</div>` : ""}
    <div class="workspace-grid" id="console-panel" role="tabpanel" aria-labelledby="console-mode" ${tab !== "console" ? "hidden" : ""}>
      <nav class="role-nav" aria-label="${$t("角色与执行")}">
        <div class="console-members-heading">${$t("成员")} <span>${agents.length}</span></div><div class="role-list">
          ${agents.map((agent) => {
            const execution = roleExecutionStatus(run, traces, agent.id);
            return `<button class="role-card ${agent.id === selected?.id ? "selected" : ""}" data-execution-state="${execution.state}" data-select-agent="${agent.id}" aria-pressed="${agent.id === selected?.id}" aria-label="${$t("查看 {0} 的控制台，{1}", [esc(agent.name), esc(execution.label)])}">
              <span class="role-avatar ${roleColor(agent)}">${esc(initialsOf(agent))}</span>
              <span><strong title="${esc(agent.name)}">${esc(agent.name)}</strong><small>${providerLabel(agent)} · ${esc(execution.label)}</small></span>
              <span class="role-console-affordance">${execution.active ? `<span class="member-running-dot" aria-label="${$t("正在执行")}"></span>` : ""}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/></svg></span>
            </button>`;
          }).join("")}
        </div>
      </nav>
      <div class="console-main">
        ${selected ? `<div class="console-heading"><div><strong>${esc(selected.name)}</strong><span>${$t("{0}{1} · {2} 次执行", [providerLabel(selected), selected.runtime?.model ? ` · ${esc(selected.runtime.model)}` : "", traces.filter((trace) => trace.agentId === selected.id).length])}</span></div><button class="small-button" data-console-latest>${$t("↓ 回到最新")}</button></div>
        ` : `<div class="chat-empty">${$t("请选择一位员工查看控制台。")}</div>`}
        <div id="tab-console">
          <div class="chat-stream" id="trace-stream" aria-live="polite" tabindex="0" aria-label="${$t("控制台")}"></div>
        </div>
      </div>
    </div>
    <section id="working-directory-panel" class="working-directory-panel" role="tabpanel" aria-labelledby="directory-mode" ${tab !== "directory" ? "hidden" : ""}></section>
    <section id="working-diff-panel" class="working-diff-panel" role="tabpanel" aria-labelledby="directory-mode" ${tab !== "diff" ? "hidden" : ""}></section>
    <section class="collaboration-panel" id="collaboration-panel" role="tabpanel" aria-labelledby="collaboration-mode" ${tab !== "collaboration" ? "hidden" : ""}></section>
    </div>
    ${view.detailsOpen ? `<button class="workspace-details-backdrop" data-close-task-details aria-label="${$t("关闭任务详情")}"></button>` + workspaceDetailsMarkup(workspace, { agents, currentFocusNode, view, artifactCount: artifactCount ?? '—' }) : ""}
    </div>`, tab === "console" && box.dataset.runId === run.id && box.dataset.agentId === selected?.id && !box.querySelector("#console-panel")?.hidden);
  box.dataset.runId = run.id;
  box.dataset.agentId = selected?.id || "";

  if (tab === "console") renderConsolePage();
  if (tab === "directory") renderWorkingDirectory(run.id);
  if (tab === "diff") { renderWorkingChanges(run.id); if (!view.changes && !view.changesLoading) void loadWorkingChanges(run.id); }
  if (tab === "collaboration") renderCollaboration(workspace, agents);
  const stream = $("#trace-stream");
  const consoleView = view.consoleViews.get(selected?.id);
  if (consoleView) {
    for (const details of stream.querySelectorAll("details[data-console-key]")) details.open = consoleView.open.includes(details.dataset.consoleKey) || (details.dataset.defaultOpen !== undefined && !(consoleView.closed || []).includes(details.dataset.consoleKey));
    restoreConsoleReading(stream, consoleView);
  }
  const followConsole = !consoleView || consoleView.following || view.jumpLatest;
  view.jumpLatest = false;
  requestAnimationFrame(() => {
    if (stream.isConnected && tab === "console" && followConsole) followConsoleLatest(stream);
  });
  if (draftFocused && $("#instruction-text")) {
    $("#instruction-text").focus({ preventScroll: true });
    $("#instruction-text").setSelectionRange(...draftSelection);
    $("#instruction-text").scrollTop = draftScrollTop;
  }
  disposeWorkflowGraphs("task");
  if (tab === "directory" && !view.directory && !view.directoryLoading && !view.directoryError) loadWorkingDirectory(run.id);
  if (tab === "console" && selected) { const page = consolePage(run.id, selected.id); if (!page.loaded && !page.loading && !page.error) loadConsolePage(run.id, selected.id); }
}

// The console shows the redacted snapshot of the exact prompt each Trace was
// dispatched with, as a per-invocation entry inside the timeline: browsing
// older invocations keeps every entry bound to its own Trace. Records predating
// the capability (or whose snapshot save failed) say so instead of
// fabricating content.
function tracePromptMarkup(trace, runId, agent = null) {
  const label = $t("本次提示词 · {0}", [trace.workflowNodeId || trace.type || $t("调用")]);
  const provider = trace.agent?.runtime?.provider || agent?.runtime?.provider;
  const sessionLabel = $t("{0} 会话 ID", [runtimeLabel(provider)]);
  const session = `<div class="console-session-id"><span>${esc(sessionLabel)}</span><code>${esc(trace.providerSessionId || $t("未记录"))}</code></div>`;
  const body = trace.promptRef
    ? `<div class="prompt-snapshot-body" data-prompt-snapshot="${esc(trace.id)}" data-content-run="${esc(runId)}"${trace.contentBase ? ` data-content-url="${esc(trace.contentBase)}/traces/${esc(trace.id)}/prompt"` : ""}><span class="muted">${$t("正在读取提示词快照…")}</span></div>${session}`
    : `<p class="tool-audit-note">${$t("该次调用未保存提示词快照。")}</p>${session}`;
  return `<div class="log-row log-row-trace-prompt"><div class="log-meta"><time class="log-time">${esc(exactTime(trace.startedAt))}</time><span class="log-level system">TRACE</span></div><div class="log-body"><details data-console-key="prompt:${esc(trace.id)}" data-turn-message-id="${esc(trace.inputMessageId || trace.id)}" class="prompt-snapshot"><summary><span class="console-tool-chevron">▶</span><strong>${esc(label)}</strong><small>${$t("本次调用提示词 · 已脱敏")}</small></summary>${body}</details></div></div>`;
}

function tracePromptFallbackMarkup(traceId) {
  return `<div class="log-row log-row-trace-prompt"><div class="log-meta"><span class="log-level system">TRACE</span></div><div class="log-body"><p class="tool-audit-note">${$t("调用的 Trace 记录不在当前读取范围内，其提示词快照不可定位。")}</p></div></div>`;
}

function renderConsolePage({ prepend = false } = {}) {
  if (state.currentView !== "workspace" || workspaceView().tab !== "console") return;
  const stream = $("#trace-stream"), agent = workspaceAgents(state.workspace, state.agents, { includeDeleted: true }).find((item) => item.id === state.selectedAgentId);
  if (!stream || !agent) return;
  const page = consolePage(state.selectedRunId, agent.id);
  if (stream.dataset.readingAgent !== agent.id) { followConsoleLatest(stream); stream.dataset.readingAgent = agent.id; }
  onConsoleLatest(stream, () => { if (page.browsingHistory && !page.traceId) void loadConsolePage(state.selectedRunId, agent.id, { reset: true, traceId: null }); });
  const reading = captureConsoleReading(stream);
  const open = new Set([...stream.querySelectorAll("details[open][data-console-key]")].map((item) => item.dataset.consoleKey));
  const closed = new Set([...stream.querySelectorAll("details[data-default-open]:not([open])")].map((item) => item.dataset.consoleKey));
  renderChatStream(page.events, agent, { traceId: page.traceId, hasMore: page.hasMore });
  const controls = document.createElement("div"); controls.className = "console-history-controls";
  controls.innerHTML = `${page.hasMore ? `<button class="small-button" data-console-older>${$t("加载更早记录")}</button>` : ""}${page.traceId ? `<button class="small-button" data-console-reset>${$t("查看该角色全部执行")}</button>` : ""}${page.loading && !page.silent ? `<span role="status">${$t("正在加载记录…")}</span>` : ""}${page.error ? `<span role="alert">${esc(page.error)}</span><button class="small-button" data-console-retry>${$t("重试")}</button>` : ""}`;
  for (const button of controls.querySelectorAll("button")) button.disabled = page.loading;
  const oldControls = stream.querySelector(".console-history-controls");
  if (!oldControls) stream.prepend(controls);
  else if (oldControls.outerHTML !== controls.outerHTML) oldControls.replaceWith(controls);
  for (const details of stream.querySelectorAll("details[data-console-key]")) details.open = open.has(details.dataset.consoleKey) || (details.dataset.defaultOpen !== undefined && !closed.has(details.dataset.consoleKey));
  restoreConsoleReading(stream, reading, { prepend, latest: page.forceLatest });
  page.forceLatest = false;
}

async function openCollaborationTurn(traceId, startMessageId) {
  const runId = state.selectedRunId;
  const trace = state.workspace.traces.find(item => item.id === traceId) || (await api(`/api/runs/${runId}/traces/${traceId}`)).trace;
  if(trace&&!state.workspace.traces.some(item=>item.id===trace.id))state.workspace.traces.push(trace);
  if (!trace) return toast($t("来源 Trace 在当前 Run 中不可读取。"), true);
  state.selectedAgentId = trace.agentId;
  workspaceView().jumpLatest = false; workspaceView().tab = "console";
  renderWorkspace();
  await loadConsolePage(runId, trace.agentId, { reset: true, traceId });
  if (state.selectedRunId !== runId || state.selectedAgentId !== trace.agentId) return;
  const key = startMessageId || trace.inputMessageId || trace.id;
  const prompt = document.querySelector(`[data-turn-message-id="${CSS.escape(key)}"]`);
  if (!prompt) return toast($t("本轮提示词定位失败，请重试。"), true);
  prompt.open = true;
  if (prompt.closest(".console-execution")) prompt.closest(".console-execution").open = true;
  consolePage(runId, trace.agentId).browsingHistory = true;
  await hydratePromptSnapshots([...prompt.querySelectorAll("[data-prompt-snapshot]")]);
  prompt.scrollIntoView({ block: "start" });
  // A deliberate jump to history stops following the tail. Otherwise a prompt
  // near the end still reads as "latest" and later body growth pulls it away.
  const stream = prompt.closest("#trace-stream");
  if (stream) restoreConsoleReading(stream, { ...captureConsoleReading(stream), following: false });
  prompt.querySelector("summary")?.focus({ preventScroll: true });
}

async function loadConsolePage(runId, agentId, { older = false, reset = false, traceId } = {}) {
  if(state.currentView!=='workspace' || state.selectedRunId!==runId || workspaceView(runId).tab!=='console')return;
  const page = consolePage(runId, agentId);
  if (page.loading && !reset) return;
  if (reset) { page.loaded = false; page.forceLatest = !traceId; page.browsingHistory = false; page.liveEvents = null; }
  if (older) { page.liveEvents ||= [...page.events]; page.browsingHistory = true; }
  if (traceId !== undefined) page.traceId = traceId;
  const request = ++page.request;
  const arriving = new Map(); page.loadingEvents = arriving;
  const query = new URLSearchParams({ agentId, limit: "50" });
  if (older && page.nextBefore) query.set("before", page.nextBefore);
  if (page.traceId) query.set("traceId", page.traceId);
  page.silent = page.loaded && !older && !reset;
  page.loadingMode = reset ? 'reset' : older ? 'older' : 'tail';
  page.loading = true; page.error = null;
  if (state.selectedRunId === runId && state.selectedAgentId === agentId) renderConsolePage();
  try {
    const fetchPage = before => { const params = new URLSearchParams(query); if (before) params.set('before', before); return api(`/api/runs/${encodeURIComponent(runId)}/console?${params}`); };
    const result = older ? await fetchPage() : await readConsoleTail(reset ? [] : page.liveEvents || page.events, fetchPage);
    if (request !== page.request) return;
    if(state.currentView==='workspace' && state.workspace?.run.id===runId && state.selectedRunId===runId)state.workspace.traces=[...new Map([...state.workspace.traces,...(result.traces||[])].map(item=>[item.id,item])).values()].slice(-300);
    const received = [...new Map([...result.events, ...(older ? [] : arriving.values())].map(event => [event.id, event])).values()];
    if (!older && page.browsingHistory && !page.traceId) { page.liveEvents = consoleEventWindow(page.liveEvents || [], received).events; return; }
    const window = consoleEventWindow(reset ? [] : page.events, received, { older });
    page.events = window.events;
    if (!page.loaded || older || reset || window.reset) { page.hasMore = result.hasMore; page.nextBefore = result.nextBefore; }
    if (window.trimmedBefore) { page.hasMore = true; page.nextBefore = page.events[0].id; }
    page.loaded = true;
  } catch (error) { if (request === page.request) page.error = error.message; }
  finally { if (request === page.request) { page.loading = false; page.loadingMode = null; page.loadingEvents = null; if (state.selectedRunId === runId && state.selectedAgentId === agentId) renderConsolePage({ prepend: older }); } }
}

function isCurrentRuntimeAudit(event) {
  return event?.type === "runtime.event" && event.data?.auditVersion === 2;
}

function runtimeAuditText(event) {
  if (event?.type === "runtime.event" && !isCurrentRuntimeAudit(event)) return $t("历史运行记录已按当前审计边界隐藏原始内容。");
  if (event?.type === "trace.failed" && event.data?.auditVersion !== 2) return $t("历史调用记录 失败原因已按当前审计边界隐藏原始内容。");
  return $tm(displayText(event)) || $t("收到运行时事件");
}

function historicalAuditEntry(entry) {
  const event = entry?.type === "event" ? entry.event : null;
  return event?.type === "runtime.event" && !isCurrentRuntimeAudit(event) ? event : null;
}

function summarizeHistoricalAuditEntries(entries) {
  const summarized = [];
  for (const entry of entries) {
    const event = historicalAuditEntry(entry);
    if (!event) { summarized.push(entry); continue; }
    const previous = summarized.at(-1);
    if (previous?.type === "historical-audit-summary") {
      previous.count += 1;
      previous.lastTimestamp = event.timestamp;
      continue;
    }
    summarized.push({ type: "historical-audit-summary", count: 1, firstTimestamp: event.timestamp, lastTimestamp: event.timestamp });
  }
  return summarized;
}

function renderHistoricalAuditSummary(summary) {
  const first = exactTime(summary.firstTimestamp);
  const last = exactTime(summary.lastTimestamp);
  const time = first === last ? first : `${first} — ${last}`;
  return `<div class="log-row log-row-historical-audit"><div class="log-meta"><time class="log-time">${esc(time)}</time><span class="log-level">HISTORICAL</span></div><div class="log-body"><div class="historical-audit-summary"><strong>${$t("已隐藏 {0} 条历史运行明细", [summary.count])}</strong><span>${$t("这些记录产生于当前审计边界前；原始内容不会在控制台回显。")}</span></div></div></div>`;
}

function renderToolCall(entry, { compact = false } = {}) {
  const event = entry.event;
  const result = entry.result;
  const current = isCurrentRuntimeAudit(event);
  const toolName = current ? event.data?.toolName || result?.data?.toolName || $t("本机工具") : $t("历史工具调用");
  const resultType = String(result?.data?.providerEventType || result?.data?.presentation || "");
  const status = /error|failed/i.test(resultType) || ["failed", "error"].includes(result?.data?.status) || event.data?.status === "failed" || event.data?.status === "error"
    ? "failed" : result || event.data?.status === "completed" ? "completed" : "running";
  const rightStatus = status === "running" ? `<span class="console-tool-running" title="${$t("运行中")}"></span><span class="console-tool-lines">${$t("运行中")}</span>`
    : status === "failed" ? `<span class="console-tool-failed">${$t("失败")}</span>`
    : `<span class="console-tool-lines">${$t("已完成")}</span>`;
  const hasContent = Boolean(event.data?.contentRef || result?.data?.contentRef);
  const direct = toolName === "StructuredOutput" && hasContent;
  const tag = direct ? "div" : "details", heading = direct ? "div" : "summary";
  // Edit invocations open by default so the real diff is visible without a
  // click; data-default-open lets refresh logic respect a manual collapse.
  const defaultOpen = !direct && toolName === "Edit";
  const summary = current && event.data?.contentRef && (isShellTool(toolName) || ["read", "write"].includes(toolName.toLowerCase()))
    ? `<code class="console-tool-summary" data-console-summary="${esc(event.id)}" data-content-run="${esc(event.runId)}"${event.contentBase ? ` data-content-url="${esc(event.contentBase)}/console-content/${esc(event.id)}"` : ""}></code>` : "";
  const body = current && toolName.toLowerCase() === "read" && status === "completed"
    ? '<p class="tool-audit-note">Done</p>'
    : `${consoleContentMarkup(event)}${result ? consoleContentMarkup(result) : ""}`;
  const call = `<${tag} data-console-key="tool:${esc(event.id)}" data-tool-name="${esc(toolName)}"${defaultOpen ? " data-default-open open" : ""} class="console-tool-call ${direct ? "structured-output" : ""} ${status === "running" ? "pending" : ""} ${status === "failed" ? "failed" : ""}"><${heading}${direct ? ' class="console-tool-heading"' : ""}>${direct ? "" : '<span class="console-tool-chevron">▶</span>'}<strong>${esc(toolName)}</strong>${summary}${rightStatus}</${heading}><div class="console-tool-body">${body}${!hasContent ? `<p class="tool-audit-note">${$t("此记录当时仅保存工具名称、状态与关联；参数和输出未保存。")}</p>` : ""}</div></${tag}>`;
  if (compact) return `<div class="console-tool-group-item">${call}</div>`;
  const time = exactTime(event.timestamp);
  return `<div class="log-row log-row-tool"><div class="log-meta"><time class="log-time">${esc(time)}</time><span class="log-level tool">TOOL</span></div><div class="log-body">${call}</div></div>`;
}

function renderToolEntry(entry) {
  return renderToolCall(entry);
}

function renderToolGroup(group) {
  const toolName = isCurrentRuntimeAudit(group.tools[0].event) ? group.toolName : $t("历史工具调用");
  const time = exactTime(group.timestamp);
  const defaultOpen = isShellTool(toolName) || ["read", "write"].includes(toolName.toLowerCase());
  return `<div class="log-row log-row-tool-group"><div class="log-meta"><time class="log-time">${esc(time)}</time><span class="log-level tool">TOOL ×${group.tools.length}</span></div><div class="log-body"><details data-console-key="group:${esc(group.tools[0].event.id)}"${defaultOpen ? " data-default-open open" : ""} class="console-tool-group"><summary><span class="console-tool-chevron">▶</span><span class="console-tool-symbol">›</span><strong>${esc(toolName)}</strong><span class="tool-group-count">×${group.tools.length}</span><code class="console-tool-preview">${$t("状态摘要")}</code></summary><div class="console-tool-group-body">${group.tools.map((entry) => renderToolCall(entry, { compact: true })).join("")}</div></details></div></div>`;
}

function consoleSessionMarkup(event, trace, agent) {
  const created = event.type === 'session.created', resumed = event.type === 'session.resumed';
  const initialized = event.type === 'runtime.event' && event.data?.auditVersion === 2 && (event.data.providerEventType === 'thread.started' || (event.data.providerEventType === 'system' && event.data.subtype === 'init'));
  if (!created && !resumed && !initialized) return '';
  if (trace && (trace.id !== event.data?.traceId || trace.agentId !== event.actor?.id)) return '';
  const provider = trace?.agent?.runtime?.provider || agent?.runtime?.provider;
  if (!RUNTIME_IDS.includes(provider)) return '';
  const label = runtimeLabel(provider);
  let id = trace?.providerSessionId || (provider === 'claude-code' || resumed ? event.data?.sessionId : null);
  // Codex allocates its native thread ID only on thread.started. Its initial
  // platform placeholder must never be presented as a resumable provider ID.
  if (provider === 'codex' && created && (!trace?.providerSessionId || (trace.sessionMode !== 'resume' && trace.providerSessionId === event.data?.sessionId))) id = null;
  if (!id) return `<small class="console-session-id">${$t("{0} 会话 ID：{1}", [label, created ? $t("等待 Provider 初始化") : $t("未记录")])}</small>`;
  return `<div class="console-session-id"><span>${$t("{0} 会话 ID", [label])}</span><code>${esc(id)}</code></div>`;
}

function renderChatEvent(event, trace, agent) {
  const kind = event.type === "trace.failed" ? "error" : classifyEvent(event);
  const time = exactTime(event.timestamp);
  const text = runtimeAuditText(event);
  const providerType = event.data?.providerEventType || "system";
  const legacyRuntime = event.type === "runtime.event" && !isCurrentRuntimeAudit(event);
  const recordType = legacyRuntime ? "HISTORICAL EVENT" : event.data?.presentation === "thinking" ? "THINKING" : providerType === "assistant" ? "TEXT" : providerType === "user" ? "USER EVENT" : providerType === "stderr" ? "STDERR" : (KIND_LABEL[kind] || providerType).toUpperCase();
  const meta = `<time class="log-time">${esc(time)}</time><span class="log-level ${kind}">${esc(recordType)}</span>`;
  let body = "";
  if (legacyRuntime) {
    body = `<div class="log-message">${esc(text)}</div>`;
  } else if (kind === "tool") {
    return renderToolEntry({ type: "tool", event, result: null });
  } else if (event.data?.contentRef) {
    body = consoleContentMarkup(event);
  } else if (event.type === "runtime.event" && providerType === "assistant") {
    body = `<div class="log-message">${esc(text)}</div><small class="tool-audit-note">${$t("此记录当时未保存正文或思考内容，仅有状态摘要。")}</small>`;
  } else if (kind === "deliver") {
    body = `<div class="log-message deliver">✓ ${esc(text)}</div>`;
  } else if (kind === "thinking") {
    body = `<div class="log-message">${esc(text)}</div>`;
  } else if (kind === "error") {
    body = `<div class="log-message error">${esc(text)}</div>`;
  } else {
    body = `<div class="log-message">${esc(text)}</div>`;
  }
  return `<div class="log-row"><div class="log-meta">${meta}</div><div class="log-body">${body}${consoleSessionMarkup(event, trace, agent)}</div></div>`;
}

/* 初次进入跟随最新；后续由 Run 的本地阅读状态决定是否跟随。 */
function updateConsoleRows(stream, rows, identity, traceById = new Map()) {
  if (stream.dataset.consoleIdentity !== identity) { stream.replaceChildren(); stream.dataset.consoleIdentity = identity; }
  // An empty console is a plain centered state, not an execution card.
  if (!rows.length) {
    if (stream.dataset.consoleEmpty !== "1") {
      stream.querySelectorAll(':scope > .console-execution').forEach(node => node.remove());
      stream.insertAdjacentHTML("beforeend", `<div class="directory-empty console-empty-state" role="status"><strong>${$t("尚无执行内容")}</strong><span>${$t("正文、思考、工具调用和异常将在这里显示。")}</span></div>`);
      stream.dataset.consoleEmpty = "1";
    }
    return;
  }
  if (stream.dataset.consoleEmpty === "1") { stream.querySelector(':scope > .console-empty-state')?.remove(); delete stream.dataset.consoleEmpty; }
  const existing = new Map([...stream.querySelectorAll('[data-console-row]')].map(node => [node.dataset.consoleRow, node]));
  const existingGroups = new Map([...stream.children].filter(node => node.dataset.consoleExecution).map(node => [node.dataset.consoleExecution, node]));
  const groups = [], occurrences = new Map();
  for (const row of rows) {
    // Keep chronological order, even if two invocations interleave. A later
    // contiguous segment gets its own card, not a reordered or synthetic Trace.
    let group = groups.at(-1);
    if (!group || group.traceId !== row.traceId) {
      const id = row.traceId || 'unlinked', occurrence = occurrences.get(id) || 0;
      occurrences.set(id, occurrence + 1);
      group = {key:`${id}:${occurrence}`, traceId:row.traceId, rows:[]}; groups.push(group);
    }
    group.rows.push(row);
  }
  let previousGroup = stream.querySelector('.console-history-controls');
  for (const group of groups) {
    let card = existingGroups.get(group.key);
    if (!card) {
      card = document.createElement('details'); card.className = 'console-execution';
      card.dataset.consoleExecution = group.key; card.dataset.consoleKey = `execution:${group.key}`;
      card.dataset.defaultOpen = ''; card.open = true;
      card.innerHTML = '<summary class="console-execution-heading"></summary><div class="console-execution-rows"></div>';
    }
    const trace = traceById.get(group.traceId), start = trace?.startedAt || trace?.createdAt;
    const status = trace?.status ? ({running:$t("执行中"),completed:$t("已结束"),failed:$t("失败"),cancelled:$t("已取消")}[trace.status] || trace.status) : '';
    const header = `<span class="console-tool-chevron">▶</span><strong>${group.traceId ? $t("执行") : $t("记录")}</strong>${trace?.workflowNodeId ? `<span class="console-execution-node">${esc(state.workspace?.run?.task.workflowSnapshot?.nodes?.find(node=>node.id===trace.workflowNodeId)?.title || trace.workflowNodeId)}</span>` : ''}${start ? `<time title="${esc(exactTime(start))}">${esc(exactTime(start))}</time>` : ''}<small>${$t("当前已加载 {0} 条", [group.rows.filter(row=>!row.prompt && row.key !== 'empty').length])}</small>${status ? `<span class="console-execution-status" data-status="${esc(trace.status)}">${esc(status)}</span>` : ''}`;
    const heading = card.querySelector(':scope > summary');
    if (heading.innerHTML !== header) heading.innerHTML = header;
    if (card !== (previousGroup ? previousGroup.nextSibling : stream.firstChild)) stream.insertBefore(card, previousGroup ? previousGroup.nextSibling : stream.firstChild);
    previousGroup = card; existingGroups.delete(group.key);
    const container = card.querySelector(':scope > .console-execution-rows');
    let previous = null;
    for (const row of group.rows) {
      let node = existing.get(row.key);
      if (!node || node.consoleSource !== row.html) {
        const template = document.createElement('template'); template.innerHTML = row.html;
        const fresh = template.content.firstElementChild;
        // Log metadata keeps the full timestamp as an accessible tooltip while
        // the row uses the design's right-aligned clock and a small type glyph.
        const meta = fresh.querySelector(':scope > .log-meta'), body = fresh.querySelector(':scope > .log-body');
        if (meta && body) {
          const time = meta.querySelector('time'), level = meta.querySelector('.log-level');
          if (time) { time.title = time.textContent; time.textContent = time.textContent.split(' ').at(-1); fresh.append(time); }
          if (level) { const kind = level.textContent; level.title = kind; level.setAttribute('aria-label',kind); level.textContent = level.classList.contains('tool') ? '⌘' : level.classList.contains('error') ? '!' : level.classList.contains('thinking') ? '◌' : '·'; }
        }
        if (node) {
          for (const content of node.querySelectorAll('[data-console-content], [data-console-summary], [data-prompt-snapshot]')) {
            const attr = content.hasAttribute('data-console-content') ? 'data-console-content' : content.hasAttribute('data-console-summary') ? 'data-console-summary' : 'data-prompt-snapshot';
            const replacement = [...fresh.querySelectorAll(`[${attr}]`)].find(item => item.getAttribute(attr) === content.getAttribute(attr) && item.dataset.contentRun === content.dataset.contentRun);
            if (replacement) replacement.replaceWith(content);
          }
          for (const details of fresh.querySelectorAll('details[data-console-key]')) {
            const old = [...node.querySelectorAll('details[data-console-key]')].find(item => item.dataset.consoleKey === details.dataset.consoleKey);
            if (old) details.open = old.open;
          }
          node.replaceWith(fresh);
        }
        node = fresh; node.dataset.consoleRow = row.key; node.consoleSource = row.html;
      }
      if (node !== (previous ? previous.nextSibling : container.firstChild)) container.insertBefore(node, previous ? previous.nextSibling : container.firstChild);
      previous = node; existing.delete(row.key);
    }
  }
  for (const node of existing.values()) node.remove();
  for (const node of existingGroups.values()) node.remove();
}

function renderChatStream(events, agent, { traceId = null, hasMore = false, stream = $("#trace-stream"), runId = state.selectedRunId, traces = null } = {}) {
  if (!stream) return;
  // Collaboration content has its own view; echoing message.sent here repeats
  // the Provider's final TEXT as a second, misleading "system" response.
  const list = events.filter((event) => event.actor?.id === agent.id && event.type !== "message.sent" && !isTransportFrame(event)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const entries = summarizeHistoricalAuditEntries(buildConsoleEntries(list));
  const workspaceTraces = traces || (state.workspace?.run?.id === runId ? state.workspace.traces || [] : []);
  const traceById = new Map(workspaceTraces.map((trace) => [trace.id, trace]));
  const entryTraceId = (entry) => entry.type === "tool-group" ? entry.tools[0].event.data?.traceId : entry.event?.data?.traceId || null;
  const timestamp = (value) => { const time = Date.parse(value); return Number.isFinite(time) ? time : null; };
  const entryTime = (entry) => timestamp(entry.event?.timestamp || entry.timestamp || entry.firstTimestamp);
  // Page boundaries come from the raw member page, including hidden transport
  // frames. A prompt is an ordinary timestamped entry, not a header for a
  // partially loaded invocation. Reveal it only when history reaches its time.
  const pageTimes = events.filter((event) => event.actor?.id === agent.id).map((event) => timestamp(event.timestamp)).filter((time) => time !== null);
  const windowStart = pageTimes.length ? Math.min(...pageTimes) : null;
  const encountered = new Map();
  const rows = [];
  for (const entry of entries) {
    const currentTraceId = entryTraceId(entry);
    if (currentTraceId && !encountered.has(currentTraceId)) encountered.set(currentTraceId, entryTime(entry));
    const firstEvent = entry.type === "tool-group" ? entry.tools[0].event : entry.event;
    const callId = firstEvent?.data?.toolUseId || firstEvent?.data?.toolResultId;
    const key = callId ? `tool:${currentTraceId}:${callId}` : firstEvent?.id || `historical:${currentTraceId}:${entryTime(entry)}`;
    rows.push({ key, traceId: currentTraceId, time: entryTime(entry), html: entry.type === "historical-audit-summary" ? renderHistoricalAuditSummary(entry) : entry.type === "tool" ? renderToolEntry(entry) : entry.type === "tool-group" ? renderToolGroup(entry) : renderChatEvent(entry.event, traceById.get(currentTraceId), agent) });
  }
  const candidates = new Set([...encountered.keys(), ...workspaceTraces.filter((trace) => trace.agentId === agent.id).map((trace) => trace.id)]);
  for (const id of candidates) {
    if (traceId && id !== traceId) continue;
    const trace = traceById.get(id);
    const time = timestamp(trace?.startedAt) ?? encountered.get(id) ?? null;
    if (!traceId && hasMore && (time === null || (windowStart !== null && time < windowStart))) continue;
    rows.push({ key: `prompt:${id}`, traceId: id, time, prompt: true, html: trace ? tracePromptMarkup(trace, runId, agent) : tracePromptFallbackMarkup(id) });
  }
  rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || Number(Boolean(b.prompt)) - Number(Boolean(a.prompt)));
  updateConsoleRows(stream, rows, `${runId}:${agent.id}:${traceId || ""}`, traceById);
  queueMicrotask(() => observeConsoleContent(stream));
}

const consoleContentCache = new ByteCache({maxBytes:8*1024*1024,maxEntries:200});
function consoleContentMarkup(event) {
  if (!event?.data?.contentRef) return "";
  const body = `<div class="execution-content" data-console-content="${esc(event.id)}" data-content-run="${esc(event.runId)}"${event.contentBase ? ` data-content-url="${esc(event.contentBase)}/console-content/${esc(event.id)}"` : ""}><span class="muted">${$t("正在读取执行内容…")}</span></div>`;
  return body;
}

const markdownReady = () => typeof window.marked?.parse === "function" && typeof window.DOMPurify?.sanitize === "function";
let markdownUpgradeScheduled = false;
// Console bodies and collaboration records render Markdown once the vendored
// parser is in; until then (or if loading fails) the escaped plain text stays.
function ensureMarkdownVendors() {
  if (markdownReady() || markdownUpgradeScheduled) return;
  markdownUpgradeScheduled = true;
  Promise.all([loadVendor("marked"), loadVendor("dompurify")]).then(() => {
    markdownUpgradeScheduled = false;
    for (const node of document.querySelectorAll("[data-console-content]")) if (node.querySelector('[data-execution-kind="text"]') && !node.querySelector(".console-markdown")) delete node.dataset.contentLoading;
    if (state.currentView === "workspace" && state.workspace?.run) renderWorkspace();
  }).catch(() => { markdownUpgradeScheduled = false; });
}
function markdownContent(text) {
  return formatCommunicationContent(text, { parse: window.marked?.parse, sanitize: window.DOMPurify?.sanitize });
}

// Shell tool input/output is terminal content, never Markdown: the command
// keeps its real line breaks and light Shell coloring; output stays verbatim.
function shellFieldMarkup(kind, field, toolName) {
  const note = field.redacted || field.truncated ? `<small>${field.redacted ? `${$t("已脱敏")} ` : ""}${field.truncated ? $t("内容过长，已截断") : ""}</small>` : "";
  if (kind === "input") {
    const command = shellCommandText(toolName, field.text);
    const text = command ?? String(field.text ?? "");
    const html = shellTokens(text).map((token) => token.kind === "plain" ? esc(token.text) : `<span class="shell-token-${token.kind}">${esc(token.text)}</span>`).join("");
    return `<section data-execution-kind="${kind}"><small>${command ? $t("命令") : $t("输入 · 原始内容")} · Shell</small><pre class="shell-code shell-command" tabindex="0"><code>${html}</code></pre>${command ? "" : `<small>${$t("命令参数不可解析，如实显示原始已脱敏输入。")}</small>`}${note}</section>`;
  }
  return `<section data-execution-kind="${kind}"><small>${$t("输出 · Shell")}</small><pre class="shell-code shell-output" tabindex="0"><code>${esc(String(field.text ?? ""))}</code></pre>${note}</section>`;
}

function fileToolFieldMarkup(kind, field, toolName) {
  if (kind !== "input") return null;
  const input = toolFileInput(toolName, field.text);
  if (!input) return null;
  if (toolName.toLowerCase() === "read") return "";
  if (input.content === null) return null;
  const note = field.redacted || field.truncated ? `<small>${field.redacted ? `${$t("已脱敏")} ` : ""}${field.truncated ? $t("内容过长，已截断") : ""}</small>` : "";
  return `<section data-execution-kind="input"><small>${$t("写入内容")}</small><pre class="execution-text"><code>${esc(input.content)}</code></pre>${note}</section>`;
}

// Git-style diff for a real Edit invocation. Every line comes from the
// already-redacted input; nothing is invented or re-aligned silently.
function editDiffMarkup(edit) {
  const diff = editDiff(edit.oldText, edit.newText);
  if (!diff) return "";
  const signs = { add: "+", del: "-", context: " " };
  const path = edit.filePath || $t("未记录路径");
  const lines = [
    `<span class="diff-line diff-meta">--- a/${esc(path)}</span>`,
    `<span class="diff-line diff-meta">+++ b/${esc(path)}</span>`,
    ...diff.lines.map((line) => `<span class="diff-line diff-${line.type}">${signs[line.type]}${esc(line.text) || " "}</span>`),
  ];
  return `<pre class="edit-diff" tabindex="0"><code>${lines.join("")}</code></pre>${diff.aligned ? "" : `<small>${$t("变更行较多，已按删除后新增顺序如实排列")}</small>`}`;
}

// Read heavy bodies only when visible and all enclosing disclosures are open.
function consoleContentVisible(node) {
  const communication = state.currentView === 'communication' && node.closest?.('[data-communication-console]')?.dataset.open === 'true';
  if (!node.isConnected || (!communication && (state.currentView !== "workspace" || workspaceView().tab !== "console"))) return false;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    // A summary is visible even when its own tool is closed. Outer groups
    // still gate their descendants; bodies and prompt snapshots remain lazy.
    if (node.dataset?.consoleSummary && parent === node.parentElement?.parentElement && parent.dataset?.toolName) continue;
    if (parent.tagName === "DETAILS" && !parent.open) return false;
  }
  return true;
}
let consoleContentObserver;
function observeConsoleContent(stream = $("#trace-stream")) {
  consoleContentObserver?.disconnect();
  if (!stream || (state.currentView === 'workspace' && workspaceView().tab !== "console")) return;
  consoleContentObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter(entry => entry.isIntersecting && consoleContentVisible(entry.target)).map(entry => entry.target);
    for (const node of visible) consoleContentObserver.unobserve(node);
    void hydrateConsoleContent(visible.filter(node => node.dataset.consoleContent || node.dataset.consoleSummary));
    void hydratePromptSnapshots(visible.filter(node => node.dataset.promptSnapshot));
  }, { root: stream, rootMargin: "200px" });
  for (const node of stream.querySelectorAll("[data-console-content], [data-console-summary], [data-prompt-snapshot]")) {
    if (!node.dataset.contentLoading && consoleContentVisible(node)) consoleContentObserver.observe(node);
  }
}

async function hydrateConsoleContent(nodes = []) {
  // Four workers bound per-page reads; promises also deduplicate live refreshes.
  async function worker() {
    while (nodes.length) {
      const node = nodes.shift();
      if (!consoleContentVisible(node) || node.dataset.contentLoading) continue;
      node.dataset.contentLoading = "1";
      const eventId = node.dataset.consoleSummary || node.dataset.consoleContent;
      const url = node.dataset.contentUrl || `/api/runs/${encodeURIComponent(node.dataset.contentRun)}/console-content/${encodeURIComponent(eventId)}`;
      const key = url;
      if (!consoleContentCache.has(key)) {
        consoleContentCache.set(key, api(url).then(value => ({ value }), () => ({ error: $t("执行内容不可读取或校验失败；刷新后可重试。") })));
        if (consoleContentCache.size > 1000) consoleContentCache.delete(consoleContentCache.keys().next().value);
      }
      const result = await consoleContentCache.get(key);
      if (!node.isConnected) continue;
      const stream = node.closest('#trace-stream, [data-communication-stream]');
      const reading = stream && captureConsoleReading(stream);
      const toolDetails = node.closest("[data-tool-name]");
      const toolName = toolDetails?.dataset.toolName || "";
      if (node.dataset.consoleSummary) {
        const summary = !result.error && toolCommandSummary(toolName, result.value.fields?.input?.text);
        node.textContent = result.error ? result.error : summary || "";
        node.title = node.textContent;
        continue;
      }
      const labels = { text: $t("正文"), thinking: $t("思考 · Provider 公开内容"), input: $t("输入"), output: $t("输出") };
      const shell = isShellTool(toolName);
      node.innerHTML = result.error ? `<p role="alert">${esc(result.error)}</p>` : Object.entries(result.value.fields || {}).filter(([kind]) => labels[kind]).map(([kind, field]) => {
        if (kind === "thinking") {
          const text = String(field.text ?? ""), available = Boolean(text.trim());
          const note = available && (field.redacted || field.truncated) ? `<small>${field.redacted ? `${$t("敏感片段已隐藏")} ` : ""}${field.truncated ? $t("内容过长，已截断") : ""}</small>` : "";
          return `<section data-execution-kind="thinking"><small>${labels.thinking}</small>${available ? `<pre class="execution-text"><code>${esc(text)}</code></pre>` : `<p class="tool-audit-note">${$t("此条记录未保存可显示的思考正文。")}</p>`}${note}</section>`;
        }
        const edit = kind === "input" ? toolEditInput(toolName, field.text) : null;
        if (edit) return `<section data-execution-kind="${kind}"><small>${$t("{0} · 变更差异", [labels[kind]])}</small>${editDiffMarkup(edit)}${field.redacted || field.truncated ? `<small>${field.redacted ? `${$t("已脱敏")} ` : ""}${field.truncated ? $t("内容过长，已截断") : ""}</small>` : ""}</section>`;
        if (shell && (kind === "input" || kind === "output")) return shellFieldMarkup(kind, field, toolName);
        const file = fileToolFieldMarkup(kind, field, toolName);
        if (file !== null) return file;
        if (kind === "text") {
          const note = field.redacted || field.truncated ? `<small>${field.redacted ? `${$t("已脱敏")} ` : ""}${field.truncated ? $t("内容过长，已截断") : ""}</small>` : "";
          if (markdownReady()) return `<section data-execution-kind="${kind}"><small>${labels[kind]} · Markdown</small><div class="console-markdown">${markdownContent(field.text)}</div>${note}</section>`;
          ensureMarkdownVendors();
          return `<section data-execution-kind="${kind}"><small>${labels[kind]}</small><pre class="execution-text"><code>${esc(field.text)}</code></pre>${note}</section>`;
        }
        const formatted = consoleContentTokens(field.text, { json: kind === "input" || kind === "output", truncated: field.truncated });
        const html = formatted.tokens.map(token => token.kind === "plain" ? esc(token.text) : `<span class="hljs-${token.kind}">${esc(token.text)}</span>`).join("");
        const content = `<pre class="execution-text${formatted.json ? " execution-json" : ""}"><code>${html}</code></pre>${field.redacted || field.truncated ? `<small>${field.redacted ? `${$t("已脱敏")} ` : ""}${field.truncated ? $t("内容过长，已截断") : ""}</small>` : ""}`;
        return `<section data-execution-kind="${kind}"><small>${labels[kind]}${formatted.json ? " · JSON" : ""}</small>${content}</section>`;
      }).join("");
      // Older immutable audits may contain arguments in both native phases.
      // Hide only an identical public input within this exact tool call; keep
      // distinct/changed arguments and every independently identified call.
      if (toolDetails) {
        const seen = new Set();
        for (const section of toolDetails.querySelectorAll('[data-execution-kind="input"]')) {
          const input = section.querySelector('pre')?.textContent;
          if (input === undefined) continue;
          if (seen.has(input)) section.hidden = true;
          else { seen.add(input); section.hidden = false; }
        }
      }
      if (reading) restoreConsoleReading(stream, reading);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
}

const promptSnapshotCache = new ByteCache({maxBytes:4*1024*1024,maxEntries:50});
async function hydratePromptSnapshots(nodes = []) {
  for (const node of nodes) {
    if (!consoleContentVisible(node) || node.dataset.contentLoading) continue;
    node.dataset.contentLoading = "1";
    const url = node.dataset.contentUrl || `/api/runs/${encodeURIComponent(node.dataset.contentRun)}/traces/${encodeURIComponent(node.dataset.promptSnapshot)}/prompt`;
    const key = url;
    if (!promptSnapshotCache.has(key)) {
      promptSnapshotCache.set(key, api(url).then((value) => ({ value }), (error) => ({ error: $t("{0}；刷新后可重试。", [error?.message || $t("提示词快照不可读取或完整性校验失败")]) })));
      if (promptSnapshotCache.size > 200) promptSnapshotCache.delete(promptSnapshotCache.keys().next().value);
    }
    const result = await promptSnapshotCache.get(key);
    if (!node.isConnected) continue;
    const prompt = result.value?.prompt || {};
    node.innerHTML = result.error
      ? `<p role="alert">${esc(result.error)}</p>`
      : `<pre class="prompt-snapshot-text">${esc(prompt.text || "")}</pre>${prompt.truncated ? `<small>${$t("快照已截断。")}</small>` : ""}`;
  }
}


function rememberDirectoryReading(view) {
  const host = $("#working-directory-panel");
  if (!host || host.hidden) return;
  const media=host.querySelector('.working-video-preview'),video=media?.querySelector('video');
  if(video){
    if(video.readyState>=1)view.videoReading={path:media.dataset.videoPath,version:media.dataset.videoVersion,time:video.currentTime,volume:video.volume,muted:video.muted,rate:video.playbackRate,playing:!video.paused && view.tab==='directory'};
    view.pendingVideoPreview=view.tab==='directory'?media:null;
    if(view.tab!=='directory')video.pause();
  }
  host.querySelectorAll("details[data-directory-path]").forEach((item) => { view.directoryOpen[item.dataset.directoryPath] = item.open; });
  view.directoryScroll.tree = host.querySelector(".artifact-files")?.scrollTop || 0;
  const reader = host.querySelector(".markdown-preview, .artifact-preview");
  if (reader && view.previewPath) view.directoryScroll[view.previewPath] = reader.scrollTop;
}

function directoryNodeIcon(entry, theme) {
    if (theme === "classic") return entry.type === "directory" ? `<span class="file-icon" aria-hidden="true">▱</span>` : `<span class="file-icon" aria-hidden="true">▫</span>`;
    const icon = workingDirectoryIcon(entry.name, entry.type);
    return entry.type === "directory"
      ? `<img class="file-icon-svg directory-icon-closed" src="/icons/vscode/${icon.closed}.svg" alt="" aria-hidden="true" loading="lazy" /><img class="file-icon-svg directory-icon-open" src="/icons/vscode/${icon.open}.svg" alt="" aria-hidden="true" loading="lazy" />`
      : `<img class="file-icon-svg" src="/icons/vscode/${icon.closed}.svg" alt="" aria-hidden="true" loading="lazy" />`;
}

// One explorer for both current files and CHANGE. Only selection, disclosure
// state and the optional change badge differ; hierarchy and icons stay shared.
function workingFileTree(entries = [], view, theme, changes = false) {
  const selected = changes ? view.selectedDiffPath : view.selectedPath;
  const open = (changes ? view.diffTreeOpen : view.directoryOpen) || {};
  const folderAttribute = changes ? "data-diff-directory" : "data-directory-path";
  const fileAttribute = changes ? "data-select-diff" : "data-select-working-file";
  const badge = entry => changes && entry.change ? `<span class="source-status-${esc(entry.change.status)}" aria-label="${esc({ A: $t("新增"), M: $t("修改"), D: $t("删除") }[entry.change.status] || $t("更改"))}">${esc(entry.change.status)}</span>` : "";
  return `<ul class="artifact-tree-list">${[...entries].sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name)).map(entry => entry.type === "directory"
    ? `<li><details class="explorer-folder" ${folderAttribute}="${esc(entry.path)}" ${(changes ? open[entry.path] !== false : open[entry.path] === true) ? "open" : ""}><summary><span class="folder-chevron" aria-hidden="true">›</span>${directoryNodeIcon(entry, theme)}${esc(entry.name)}${entry.change ? `<button class="text-action source-change-marker" data-select-diff="${esc(entry.path)}" aria-label="${$t("查看 {0} 的仓库提交变化", [esc(entry.path)])}" title="${$t("查看仓库提交变化")}">${badge(entry)}</button>` : ""}</summary>${changes || entry.children ? workingFileTree(entry.children, view, theme, changes) : directoryPageMarkup(entry.path,view,theme)}</details></li>`
    : `<li><button class="artifact-tree-file ${selected === entry.path ? "selected" : ""}" ${fileAttribute}="${esc(entry.path)}" title="${esc(entry.path)}"><strong>${directoryNodeIcon(entry, theme)}${esc(entry.name)}</strong>${badge(entry)}</button></li>`).join("")}</ul>`;
}

function directoryPageMarkup(path,view,theme) {
  const page=path?view.directoryPages?.[path]:view.directory;
  const entries=page?.entries || [];
  return `${workingFileTree(entries,view,theme)}${page?.loading?`<span class="directory-loading" role="status" aria-label="${$t("正在读取目录")}"></span>`:page?.error?`<button class="text-action" data-load-directory="${esc(path)}">${$t("重试")}</button>`:''}${page?.nextOffset!=null?`<button class="text-action" data-load-more-directory="${esc(path)}" ${page.loading?'disabled':''}>${$t("加载更多")}</button>`:''}`;
}

function workingRefreshMarkup(view) {
  const changes = view.tab === 'diff', busy = changes ? view.changesLoading : view.directoryLoading;
  return `<button type="button" class="diff-icon-button workspace-refresh" ${changes ? 'data-refresh-changes' : 'data-refresh-directory'} aria-label="${changes ? $t("刷新更改") : $t("刷新当前文件")}" title="${changes ? $t("刷新更改") : $t("刷新当前文件")}" ${busy ? 'disabled aria-busy="true"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 7l-2.3-2.3"/></svg></button>`;
}

function syncWorkingRefresh(runId) {
  if (state.selectedRunId !== runId) return;
  const view = workspaceView(runId), button = $('.file-source-switch .workspace-refresh');
  if (!button) return;
  const busy = view.tab === 'diff' ? view.changesLoading : view.directoryLoading;
  button.disabled = Boolean(busy);
  button.setAttribute('aria-busy', String(Boolean(busy)));
}

function workingFileSources(view) {
  return `<nav class="file-source-switch" aria-label="${$t("文件来源")}"><button class="text-action" data-ws-tab="directory" aria-pressed="${view.tab === "directory"}">${$t("当前文件")}</button><button class="text-action" data-ws-tab="diff" aria-pressed="${view.tab === "diff"}">${$t("变更")}</button>${workingRefreshMarkup(view)}</nav>`;
}

function renderWorkingDirectory(runId) {
  if (state.selectedRunId !== runId) return;
  const host = $("#working-directory-panel"), view = workspaceView(runId);
  if (!host) return;
  rememberDirectoryReading(view);
  syncWorkingRefresh(runId);
  const preview = view.filePreview;
  // The directory theme is a local display preference scoped strictly to this
  // panel: icons plus the selected file's content colors, nothing else.
  const theme = presentationPreferences.directoryTheme || "vscode-light";
  host.dataset.directoryTheme = theme;
  let content = `<div class="artifact-placeholder">${$t("选择文件查看内容")}</div>`;
  if (preview) {
    if (preview.error || preview.loading) content = preview.error ? `<div class="artifact-placeholder" role="alert">${esc(preview.error)}</div>` : `<div class="artifact-placeholder"><span class="directory-loading" role="status" aria-label="${$t("正在读取文件")}"></span></div>`;
    else if (preview.image) content = `<img class="artifact-image-preview" src="/api/runs/${encodeURIComponent(runId)}/working-directory/content?raw=1&path=${encodeURIComponent(view.selectedPath)}" alt="${esc(view.selectedPath)}" />`;
    else if (preview.video) content = `<div class="working-video-preview" data-video-path="${esc(view.selectedPath)}" data-video-version="${esc(preview.modifiedAt)}"><video controls playsinline preload="metadata" aria-label="${esc(view.selectedPath)}" src="/api/runs/${encodeURIComponent(runId)}/working-directory/content?media=1&path=${encodeURIComponent(view.selectedPath)}"></video><p class="field-hint" data-video-error role="alert" hidden>${$t("此视频无法播放，可能是文件已变化或编码不受支持。请下载后使用本地播放器查看。")}</p></div>`;
    else if (preview.content == null) content = `<div class="artifact-placeholder">${$t("二进制文件不支持文本预览")}</div>`;
    else if (/\.md$/i.test(view.selectedPath) && window.marked && window.DOMPurify) content = `<article class="markdown-preview">${window.DOMPurify.sanitize(window.marked.parse(preview.content))}</article>`;
    else content = `<pre class="artifact-preview code-preview hljs"><code>${preview.highlightedHtml || esc(preview.content)}</code></pre>`;
  }
  const existingVideo=view.pendingVideoPreview || (view.previewPath===view.selectedPath?host.querySelector('.working-video-preview'):null);
  host.innerHTML = `${view.directoryError ? `<p role="alert">${esc(view.directoryError)}</p>` : ""}${Object.entries(view.directoryPages || {}).filter(([,page])=>page.error).map(([path,page])=>`<p role="alert">${esc(path)}：${esc(page.error)}</p>`).join("")}
    <div class="artifact-layout"><div class="artifact-files">${workingFileSources(view)}<section class="artifact-root">${directoryPageMarkup('',view,theme)}</section></div><div class="artifact-viewer document"><div class="artifact-viewer-head"><div class="working-file-identity"><strong>${esc(view.selectedPath || $t("文件预览"))}</strong><small>${$t("当前工作文件 {0}", [preview?.modifiedAt ? "· " + esc(preview.modifiedAt) : ""])}</small></div><div class="directory-actions"><button class="ghost-button icon-only" data-copy="${esc(view.selectedPath || '')}" ${!view.selectedPath ? "disabled" : ""} aria-label="${$t("复制路径")}" title="${$t("复制路径")}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg></button><button class="secondary-button small" data-download-working-file ${!view.selectedPath || view.downloadingPath ? "disabled" : ""} ${view.downloadingPath ? 'aria-busy="true"' : ""}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>${view.downloadingPath ? $t("下载中…") : $t("下载")}</button></div></div>${content}</div></div>`;
  host.querySelector(".artifact-files").scrollTop = view.directoryScroll.tree || 0;
  const reader = host.querySelector(".markdown-preview, .artifact-preview");
  const video=host.querySelector('.working-video-preview');
  if(video && existingVideo && existingVideo.dataset.videoVersion===video.dataset.videoVersion && existingVideo.querySelector('video').getAttribute('src')===video.querySelector('video').getAttribute('src')){video.replaceWith(existingVideo);}
  else if(video)video.querySelector('video').addEventListener('error',()=>{video.querySelector('[data-video-error]').hidden=false;});
  if (reader) reader.scrollTop = view.directoryScroll[view.selectedPath] || 0;
  delete view.pendingVideoPreview;
  const player=host.querySelector('.working-video-preview video'),saved=view.videoReading;
  if(player && saved?.path===view.selectedPath && saved.version===preview?.modifiedAt){
    const restore=()=>{player.volume=saved.volume;player.muted=saved.muted;player.playbackRate=saved.rate;if(Number.isFinite(player.duration))player.currentTime=Math.min(saved.time,player.duration);if(saved.playing)void player.play().catch(()=>{});};
    if(player.readyState>=1)restore();else player.addEventListener('loadedmetadata',restore,{once:true});
  }
  view.previewPath = view.selectedPath;
}

async function loadWorkingDirectory(runId,{path='',more=false}={}) {
  const view=workspaceView(runId);
  if(!path && !more){rememberDirectoryReading(view);++view.directoryRequest;view.directoryPages=Object.create(null);view.directory=null;}
  if(!path)view.directoryError=null;
  view.directoryPages ||= Object.create(null);
  const page=path?(view.directoryPages[path] ||= {entries:[]}):(view.directory ||= {entries:[]});
  if(page.loading)return;
  const request=view.directoryRequest;
  page.loading=true;page.error=null;if(!path)view.directoryLoading=true;renderWorkingDirectory(runId);
  try{
    const data=await api(`/api/runs/${encodeURIComponent(runId)}/working-directory?path=${encodeURIComponent(path)}&offset=${more?page.nextOffset || 0:0}`);
    if(request!==view.directoryRequest)return;
    page.entries=more?[...new Map([...page.entries,...data.entries].map(entry=>[entry.path,entry])).values()]:data.entries;page.nextOffset=data.nextOffset;
    for(const entry of page.entries)if(entry.type==='directory' && view.directoryOpen[entry.path] && !view.directoryPages[entry.path])void loadWorkingDirectory(runId,{path:entry.path});
  }catch(error){if(request===view.directoryRequest){page.error=error.message;if(!path)view.directoryError=error.message;}}
  finally{if(request===view.directoryRequest){page.loading=false;if(!path)view.directoryLoading=false;renderWorkingDirectory(runId);}}
  if(!path && view.selectedPath && request===view.directoryRequest)await loadWorkingFile(runId,view.selectedPath);
}

async function downloadWorkingFile(runId) {
  const view = workspaceView(runId), path = view.selectedPath;
  if (!path || view.downloadingPath) return;
  view.downloadingPath = path; renderWorkingDirectory(runId);
  let url, link;
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/working-directory/content?download=1&path=${encodeURIComponent(path)}`);
    if (!response.ok) { const body = await response.json(); throw new Error($tm(body.error) || $t("文件下载失败")); }
    url = URL.createObjectURL(await response.blob());
    link = document.createElement("a"); link.href = url; link.download = path.split("/").at(-1);
    document.body.append(link); link.click();
  } catch (error) { toast($t("下载失败：{0}", [error.message]), true); }
  finally {
    link?.remove();
    // Give the browser download handler time to take ownership of the Blob.
    if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    view.downloadingPath = null; renderWorkingDirectory(runId);
  }
}

async function loadWorkingFile(runId, path) {
  const view = workspaceView(runId), request = ++view.fileRequest;
  view.selectedPath = path; view.filePreview = { loading: true }; renderWorkingDirectory(runId);
  try { const [data] = await Promise.all([api(`/api/runs/${encodeURIComponent(runId)}/working-directory/content?path=${encodeURIComponent(path)}`), /\.md$/i.test(path) ? Promise.all([loadVendor("marked"), loadVendor("dompurify")]) : Promise.resolve()]); if (request === view.fileRequest) view.filePreview = data; }
  catch (error) { if (request === view.fileRequest) view.filePreview = { error: error.message }; }
  if (request === view.fileRequest) renderWorkingDirectory(runId);
}

function workingDiffMarkup(preview, layout = "unified") {
  if (!preview) return `<div class="artifact-placeholder">${$t("选择文件查看修改内容")}</div>`;
  if (preview.loading || preview.error) return `<div class="artifact-placeholder"${preview.error ? ' role="alert"' : ''}>${esc(preview.error || $t("正在读取 CHANGE…"))}</div>`;
  if (preview.binary || preview.tooLarge) return `<div class="artifact-placeholder">${preview.binary ? $t("二进制文件已更改，暂不支持文本 CHANGE。") : $t("文件较大，请在本机 Git 中查看 CHANGE。")}</div>`;
  if (!preview.patch) return `<div class="artifact-placeholder">${$t("当前内容与比较版本一致，没有文本改动。")}</div>`;
  let oldLine = 0, newLine = 0, inHunk = false;
  const rows = [], deleted = [], added = [];
  const sideCell = (item, kind) => item ? `<td class="source-line-number source-diff-${kind}">${item.number}</td><td class="source-diff-${kind}"><code>${esc(item.text)}</code></td>` : '<td class="source-line-number"></td><td class="source-diff-empty"></td>';
  const flush = () => {
    for (let i = 0; i < Math.max(deleted.length, added.length); i++) rows.push(`<tr>${sideCell(deleted[i], 'del')}${sideCell(added[i], 'add')}</tr>`);
    deleted.length = 0; added.length = 0;
  };
  for (const line of preview.patch.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flush(); inHunk = true; oldLine = Number(hunk[1]); newLine = Number(hunk[2]);
      rows.push(`<tr class="source-diff-hunk"><td colspan="${layout === 'split' ? 4 : 3}">${esc(line)}</td></tr>`); continue;
    }
    if ((!inHunk && /^(diff |index |--- |\+\+\+ |new file mode|deleted file mode)/.test(line)) || !line) continue;
    const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : line.startsWith(' ') ? 'context' : 'note';
    const left = ['del','context'].includes(kind) ? oldLine++ : '';
    const right = ['add','context'].includes(kind) ? newLine++ : '';
    if (layout === 'split') {
      if (kind === 'del') { deleted.push({number:left,text:line.slice(1)}); continue; }
      if (kind === 'add') { added.push({number:right,text:line.slice(1)}); continue; }
      if (kind === 'note') { flush(); rows.push(`<tr class="source-diff-note"><td colspan="4">${esc(line)}</td></tr>`); continue; }
      flush(); rows.push(`<tr>${sideCell({number:left,text:line.slice(1)},'context')}${sideCell({number:right,text:line.slice(1)},'context')}</tr>`);
    } else rows.push(`<tr class="source-diff-${kind}"><td class="source-line-number">${left}</td><td class="source-line-number">${right}</td><td><code>${esc(line)}</code></td></tr>`);
  }
  flush();
  return `<div class="source-diff-reader" tabindex="0" aria-label="${$t("文件修改差异")}"><table class="source-diff-table ${layout === 'split' ? 'source-diff-split' : ''}">${layout === 'split' ? `<colgroup><col class="diff-number-col"><col><col class="diff-number-col"><col></colgroup><thead><tr><th colspan="2">${$t("修改前")}</th><th colspan="2">${$t("当前文件")}</th></tr></thead>` : ''}<tbody>${rows.join('')}</tbody></table></div>`;
}

function workingChangesTree(repo, view, theme) {
    const root = { path: '', children: new Map() };
    for (const change of repo.changes) {
      const parts = change.path.split("/");
      let node = root;
      for (const [index, name] of parts.entries()) {
        const path = node.path ? node.path + "/" + name : name;
        if (!node.children.has(name)) node.children.set(name, { name, path, type: index === parts.length - 1 && !change.submodule ? "file" : "directory", children: new Map() });
        node = node.children.get(name);
      }
      node.change = change;
    }
    const entries = node => ({ ...node, children: [...node.children.values()].map(entries) });
    return workingFileTree([...root.children.values()].map(entries), view, theme, true);
}

function rememberDiffReading(view) {
  const host = $("#working-diff-panel");
  if (!host || host.hidden) return;
  view.diffTreeOpen ||= Object.create(null);
  host.querySelectorAll('[data-diff-directory]').forEach(item => { view.diffTreeOpen[item.dataset.diffDirectory] = item.open; });
  view.diffTreeScroll = host.querySelector('.artifact-files')?.scrollTop || 0;
}

function renderWorkingChanges(runId) {
  if (state.selectedRunId !== runId) return;
  const host = $("#working-diff-panel"), view = workspaceView(runId);
  if (!host) return;
  if (host.querySelector('.artifact-files')) rememberDiffReading(view);
  const treeScroll = view.diffTreeScroll || 0;
  const theme = presentationPreferences.directoryTheme || "vscode-light";
  host.dataset.directoryTheme = theme;
  const rawRepositories = view.changes?.repositories || [];
  const repositories = rawRepositories;
  syncWorkingRefresh(runId);
  host.innerHTML = `${view.changesError ? `<p role="alert">${esc(view.changesError)}</p>` : ""}${repositories.filter(repo=>repo.error).map(repo=>`<p role="alert">${esc(repo.path || $t("工作目录"))}：${esc(repo.error)}</p>`).join("")}<div class="artifact-layout"><div class="artifact-files source-control-files">${workingFileSources(view)}<section class="artifact-root">${workingChangesTree({changes:repositories.flatMap(repo=>repo.changes)},view,theme) || `<div class="directory-empty" role="status">${view.changesLoading?$t("正在读取文件变更…"):view.changesError?$t("读取失败，请使用上方刷新重试。"):$t("暂无文件变更")}</div>`}</section></div><div class="artifact-viewer document"><div class="artifact-viewer-head"><div class="working-file-identity"><strong>${esc(view.selectedDiffPath || $t("修改内容"))}</strong><small>${view.diffPreview?.submodule ? $t("HEAD → 当前子模块提交") : $t("{0} → 当前文件", [esc(view.diffPreview?.baseLabel || $t("比较版本"))])}</small></div><div class="diff-view-controls"><div role="group" aria-label="${$t("CHANGE 布局")}"><button class="diff-icon-button" data-diff-layout="unified" aria-pressed="${view.diffLayout !== 'split'}" aria-label="${$t("行内")}" title="${$t("行内")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h8"/></svg></button><button class="diff-icon-button" data-diff-layout="split" aria-pressed="${view.diffLayout === 'split'}" aria-label="${$t("左右对比")}" title="${$t("左右对比")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6 9h3M15 9h3M6 14h3M15 14h3"/></svg></button></div><div role="group" aria-label="${$t("CHANGE 范围")}"><button class="diff-icon-button" data-diff-scope="changes" aria-pressed="${!view.diffFull}" aria-label="${$t("仅差异")}" title="${$t("仅差异")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h6M7 4v6M4 17h6M14 7h6M14 17h6"/><path d="M14 12h6" opacity=".4"/></svg><span>${$t("仅差异")}</span></button><button class="diff-icon-button" data-diff-scope="full" aria-pressed="${Boolean(view.diffFull)}" aria-label="${$t("完整文件")}" title="${$t("完整文件")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 12h8M8 16h8"/></svg><span>${$t("完整文件")}</span></button></div></div></div>${workingDiffMarkup(view.diffPreview, view.diffLayout)}</div></div>`;
  host.querySelector(".artifact-files").scrollTop = treeScroll;
}

async function loadWorkingChanges(runId) {
  const view = workspaceView(runId), request = ++view.changesRequest;
  view.changesLoading = true; view.changesError = null; renderWorkingChanges(runId);
  try {
    const data = await api(`/api/runs/${encodeURIComponent(runId)}/working-directory/changes`);
    if (request !== view.changesRequest) return;
    view.changes = data;
    const paths = data.repositories.flatMap(repo => repo.changes.map(change => change.path));
    if (view.selectedDiffPath && !paths.includes(view.selectedDiffPath)) { ++view.diffRequest; view.selectedDiffPath = null; view.diffPreview = null; }
  } catch (error) { if (request === view.changesRequest) view.changesError = error.message; }
  finally { if (request === view.changesRequest) { view.changesLoading = false; renderWorkingChanges(runId); } }
  if (view.selectedDiffPath && request === view.changesRequest) await loadWorkingDiff(runId, view.selectedDiffPath);
}

async function loadWorkingDiff(runId, path) {
  const view = workspaceView(runId), request = ++view.diffRequest;
  view.selectedDiffPath = path; view.diffPreview = { loading: true }; renderWorkingChanges(runId);
  try {
    const data = await api(`/api/runs/${encodeURIComponent(runId)}/working-directory/diff?path=${encodeURIComponent(path)}${view.diffFull ? "&full=1" : ""}`);
    if (request === view.diffRequest) view.diffPreview = data;
  } catch (error) { if (request === view.diffRequest) view.diffPreview = { error: error.message }; }
  if (request === view.diffRequest) renderWorkingChanges(runId);
}

function collaborationMessageMarkup(content, mentions = []) {
  // Same parse/sanitize/fallback path as the communication view; when the
  // vendored Markdown runtime is not loaded yet the honest escaped text shows
  // first and is upgraded in place once loading finishes.
  if (!markdownReady()) { ensureMarkdownVendors(); return memberMentionMarkup(`<p class="collaboration-plain">${esc(content)}</p>`, mentions); }
  return memberMentionMarkup(`<div class="communication-markdown collaboration-markdown">${markdownContent(content)}</div>`, mentions);
}

function refreshCollaborationBodies(dock) {
  collaborationBodyObserver?.disconnect();
  const update = content => {
    const body = content.parentElement, button = body.querySelector("[data-expand-collaboration-body]");
    const height = parseFloat(getComputedStyle(content).lineHeight) * 10;
    content.style.setProperty("--collaboration-collapse-height", `${height}px`);
    button.hidden = content.scrollHeight <= height + 1;
  };
  collaborationBodyObserver = new ResizeObserver(entries => entries.forEach(entry => update(entry.target)));
  for (const content of dock.querySelectorAll(".collaboration-body-content")) {
    update(content); collaborationBodyObserver.observe(content);
  }
}

function bindTaskAttachments(dock, view, workspace, agents, messagingBlocked) {
  const filesInput = dock.querySelector('[data-task-file]'), imagesInput = dock.querySelector('[data-task-image-file]');
  if (filesInput) {
    dock.querySelector('[data-task-attach]').onclick = () => filesInput.click();
    dock.querySelector('[data-task-attach-image]').onclick = () => imagesInput.click();
    filesInput.onchange = imagesInput.onchange = event => {
      if (view.sending || messagingBlocked) return;
      for (const file of event.target.files) {
        if (view.attachments.length >= 10) { toast($t("每条消息最多 10 个附件"), true); break; }
        if (file.size > 20*1024*1024) { toast($t("「{0}」超过单文件 20 MiB 上限", [file.name]), true); continue; }
        view.attachments.push({id:crypto.randomUUID(),file,uploaded:null,previewURL:imageAttachment(file.name) ? URL.createObjectURL(file) : null});
      }
      renderCollaboration(workspace, agents);
    };
  }
  dock.addEventListener('error', attachmentImageError, true);
  dock.onclick = async event => {
    const image = event.target.closest('[data-chat-image]');
    if (image) { openAttachmentImage(image); return; }
    const remove = event.target.closest('[data-remove-task-attachment]');
    if (remove && !view.sending && !messagingBlocked) {
      const item = view.attachments.find(item => item.id === remove.dataset.removeTaskAttachment);
      if (item?.previewURL) { URL.revokeObjectURL(item.previewURL); item.previewURL=null; }
      view.attachments = view.attachments.filter(item => item.id !== remove.dataset.removeTaskAttachment);
      renderCollaboration(workspace, agents); $("#instruction-text")?.focus({preventScroll:true}); return;
    }
    const link = event.target.closest('[data-attachment-download]');
    if (link) { event.preventDefault(); try { await downloadAttachment(link); } catch (error) { toast(error.message, true); } }
  };
}

function confirmTaskOutgoing(view, entry, {message, record} = {}) {
  if(message)entry.message=message;
  if(record)entry.record=record;
  entry.status='confirmed';
  if(entry.settled)return;
  entry.settled=true;
  view.attachments=(view.attachments || []).filter(item=>!entry.attachments.includes(item));
  for(const item of entry.attachments)if(item.previewURL){URL.revokeObjectURL(item.previewURL);item.previewURL=null;}
  if(view.draft===entry.draft && (view.draftRevision || 0)===entry.draftRevision)view.draft='';
  if(view.sendRequest?.id===entry.id)view.sendRequest=null;
}

function renderCollaboration(workspace, agents) {
  const { run } = workspace, dock = $("#collaboration-panel"), view = workspaceView(run.id);
  const previousInput = dock.querySelector('#instruction-text');
  const draftReading = previousInput && previousInput.value === view.draft ? {
    focused: document.activeElement === previousInput, top: previousInput.scrollTop,
    selection: [previousInput.selectionStart, previousInput.selectionEnd, previousInput.selectionDirection],
  } : null;
  const previousList = dock.querySelector('.human-message-list');
  if(view.collaborationRestore){view.collaborationScroll=view.collaborationRestore;view.collaborationRestore=null;view.jumpLatest=false;}
  else if (previousList?.clientHeight) view.collaborationScroll = {
    top: previousList.scrollTop,
    following: previousList.scrollHeight - previousList.scrollTop - previousList.clientHeight < 48,
  };
  const reading = view.jumpLatest ? null : view.collaborationScroll;
  const prepending = view.collaborationPrependReading;
  view.collaborationPrependReading = null;
  view.disclosures ||= {};
  view.attachments ||= [];
  view.outbox ||= new Map();
  const records = [...(view.collaborationItems || [])];
  const savedById=new Map(records.map(item=>[item.id,item])), savedByRequest=new Map(records.filter(item=>item.clientRequestId).map(item=>[item.clientRequestId,item]));
  for(const [id,entry] of view.outbox){
    const saved=savedByRequest.get(id) || savedById.get(entry.message?.id);
    if(saved){confirmTaskOutgoing(view,entry,{record:saved});view.outbox.delete(id);continue;}
    if(entry.message)records.push(...collaborationRecords({run,messages:[entry.message]}));
    else if(entry.record)records.push(entry.record);
    else records.push({id:entry.id,timestamp:entry.createdAt,senderType:'human',from:$t("你"),to:entry.recipientName,title:entry.replyToMessageId?$t("回复"):$t("消息"),content:entry.content,tone:'info',statusCode:'local',outgoing:entry});
  }
  const questions = (workspace.pendingQuestions || []).filter(message => message.recipient.type === "human");
  const awaitingReply=[...view.outbox.values()].find(entry=>entry.status!=='confirmed' && entry.replyToMessageId===view.replyToMessageId);
  if (view.replyToMessageId === undefined || (view.replyToMessageId && !questions.some(item => item.id === view.replyToMessageId) && !awaitingReply)) view.replyToMessageId = questions[0]?.id || "";
  const replyQuestion=questions.find(item=>item.id===view.replyToMessageId) || awaitingReply?.replyQuestion;
  records.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const autonomous = run.task.kind === "automation";
  const messagingBlocked = Boolean(autonomous || run.task.archivedAt || run.status === "failed");
  const visibleRecords = records;
  const body = (content, key) => {
    const expanded = Boolean(view.disclosures["body:" + key]), id = "collaboration-body-" + encodeURIComponent(key);
    return `<div class="collaboration-body ${expanded ? "is-expanded" : ""}" data-collaboration-body="${esc(key)}"><div class="collaboration-body-content" id="${esc(id)}">${collaborationMessageMarkup(content, agents.map(agent => agent.name))}</div><button type="button" class="text-action collaboration-expand" data-expand-collaboration-body aria-expanded="${expanded}" aria-controls="${esc(id)}" hidden>${expanded ? $t("收起") : $t("展开全文")}</button></div>`;
  };
  dock.innerHTML = `
    <div class="collaboration-toolbar"><button class="small-button" data-collaboration-latest>${$t("↓ 最新")}</button></div>

    <div class="human-message-list">
      ${view.collaborationError ? `<div class="collaboration-read-error" role="alert">${esc(view.collaborationError)}<button type="button" class="text-action" data-retry-collaboration ${view.collaborationLoading ? 'disabled' : ''}>${$t("重试")}</button></div>` : ''}
      ${view.collaborationHasMore ? `<div class="collaboration-history-loader"><button class="small-button" data-collaboration-older ${view.collaborationLoading ? 'disabled aria-busy="true"' : ''}>${view.collaborationLoading ? $t("正在加载…") : $t("加载更早协作记录")}</button></div>` : ""}
      ${records.length ? visibleRecords.map((item, index) => {
        // Sender identity is saved with the Message. Frozen participants also
        // cover historical members missing from the compact latest Trace page.
        const sender = item.senderId && (run.participants?.find(agent => agent.id === item.senderId || agent.sourceAgentId === item.senderId)
          || agents.find(agent => agent.id === item.senderId)) || { name: item.from };
        const day = new Date(item.timestamp).toDateString();
        const divider = !index || new Date(visibleRecords[index - 1].timestamp).toDateString() !== day ? `<div class="communication-day-divider"><time datetime="${esc(item.timestamp)}">${esc(communicationDayLabel(item.timestamp))}</time></div>` : "";
        return `${divider}<article class="collaboration-row ${item.senderType === "human" ? "from-human" : ""} ${item.canReply ? "needs-answer" : ""}" data-collaboration-record="${esc(item.id)}"${item.outgoing ? ` data-outgoing-state="${esc(item.outgoing.status)}"` : ''} data-tone="${esc(item.tone)}" data-sender-color="${esc(sender.color || 'system')}" data-record-status="${esc(item.statusCode)}">
        ${item.senderType === "human" ? "" : `<span class="agent-card-avatar collaboration-avatar ${esc(roleColor(sender))}" aria-hidden="true">${esc(initialsOf(sender))}</span>`}<div class="collaboration-message-main">
        <header><strong>${esc(item.from)}</strong><span class="collaboration-kind">${esc($tm(item.title))}${item.to ? ` <span aria-label="${$t("交给")}">→</span> ${esc(item.to)}` : ""}</span><time datetime="${esc(item.timestamp)}" title="${esc(exactTime(item.timestamp))}">${esc(formatMessageTime(item.timestamp))}</time>${item.status ? `<span class="collaboration-status">${esc($tm(item.status))}</span>` : ""}</header>
        <div class="collaboration-content">
          ${item.canReply ? `<div class="collaboration-question-heading">${$t("需要你回答")}</div>` : ""}${body(item.content, item.id)}${item.outgoing ? outgoingAttachmentMarkup(item.outgoing) : messageAttachments(item.attachments || [], run.id, "runs")}
          ${item.reason ? `<p>${esc($tm(item.reason))}</p>` : ""}
          ${item.canReply ? `<button class="small-button primary" data-answer-message="${esc(item.replyId)}">${$t("回复此问题")}</button>` : ""}
          ${item.traceId || item.executionTraceId ? `<button class="text-action trace-link" data-open-collaboration-trace="${esc(item.traceId || item.executionTraceId)}" data-start-message-id="${esc(item.startMessageId)}" title="${$t("定位本轮对话开始时的提示词")}">${$t("本轮控制台 ↗")}</button>` : ""}
        </div>${outgoingMessageFeedback(item.outgoing,'task')}</div></article>`; }).join("") : view.collaborationError ? '' : !view.collaborationItems || view.collaborationLoading ? `<div class="human-empty" role="status">${$t("正在读取协作记录…")}</div>` : `<div class="human-empty"><strong>${$t("暂无协作消息")}</strong><p>${$t("角色之间的沟通会按时间出现在这里；执行细节请查看控制台。")}</p></div>`}
    </div>
    ${autonomous ? '' : `<form class="instruction-form" id="instruction-form">
      <input type="hidden" name="replyToMessageId" value="${esc(view.replyToMessageId || '')}">
      <label class="sr-only" for="instruction-text">${$t("消息内容")}</label><div class="message-composer-card">
      ${view.replyToMessageId ? `<div class="reply-context"><span title="${esc(replyQuestion?.content || '')}">${$t("回复")} <strong>${esc(replyQuestion?.sender.name || '')}</strong>：${esc(replyQuestion?.content || '')}</span><button type="button" class="text-action" data-clear-reply aria-label="${$t("取消当前回复")}">×</button></div>` : ''}
      <div class="mention-wrap"><div class="message-composer-input"><div class="communication-draft-attachments" data-task-attachments>${draftAttachments(view.attachments, "task", view.sending || messagingBlocked)}</div><textarea id="instruction-text" name="content" rows="2" placeholder="${$t("输入消息…")}"></textarea></div><div class="mention-list" id="mention-list"></div></div>
      <input type="file" multiple data-task-file hidden><input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" data-task-image-file hidden>
      <div class="communication-composer-actions">${attachmentControls("task", messagingBlocked || view.sending)}<button type="button" class="composer-icon-button" data-task-mention aria-label="${$t("提及成员")}" title="${$t("提及成员")}" ${messagingBlocked || view.sending ? "disabled" : ""}>@</button><span class="composer-hint">${$t("Enter 发送 · Shift + Enter 换行")}</span><button class="primary-button" type="submit" data-send-instruction ${messagingBlocked || view.sending ? 'disabled' : ''}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>${$t("发送")}</button></div></div>
      <p class="directive-note">${run.task.archivedAt ? $t("任务已归档，协作记录只读。") : run.status === "failed" ? $t("任务因错误中断，请先点击重试继续失败员工；当前不能发送消息或 @ 其他成员。") : questions.length ? $t("请先回复待澄清的问题。") : ["completed", "cancelled", "paused"].includes(run.status) ? $t("可继续咨询；仅答疑，不恢复业务流程。") : $t("新指令入队，不打断当前成员。")}</p>
    </form>`}`;
  $("#instruction-form")?.addEventListener("submit", sendInstruction);
  $("#reply-question")?.addEventListener("change", event => { view.replyToMessageId = event.target.value; });
  if ($("#instruction-text")) { $("#instruction-text").value = view.draft; $("#instruction-text").disabled = messagingBlocked; $("#instruction-text").addEventListener('input',()=>{view.draftRevision=(view.draftRevision || 0)+1;view.sendRequest=null;}); }
  bindTaskAttachments(dock, view, workspace, agents, messagingBlocked);
  dock.querySelectorAll('[data-recover-task-message]').forEach(button=>button.onclick=()=>{
    const entry=view.outbox.get(button.dataset.recoverTaskMessage);if(!entry || view.sending)return;
    if(view.draft && view.draft!==entry.content){toast($t("输入框已有新草稿，请先保存或清空，再恢复这条消息。"),true);return;}
    if(view.attachments.some(item=>!entry.attachments.includes(item))){toast($t("输入框已有新附件，请先保存或移除，再恢复这条消息。"),true);return;}
    view.draft=entry.content;view.draftRevision=(view.draftRevision || 0)+1;view.replyToMessageId=entry.replyToMessageId || '';
    entry.draft=view.draft;entry.draftRevision=view.draftRevision;
    entry.attachments.forEach(item=>{if(!item.previewURL && imageAttachment(item.file.name))item.previewURL=URL.createObjectURL(item.file);});
    view.attachments=[...entry.attachments];view.sendRequest={id:entry.id,signature:entry.signature};
    renderCollaboration(workspace,agents);$('#instruction-text')?.focus({preventScroll:true});
  });
  refreshCollaborationBodies(dock);
  // Sending also renders this panel directly, outside renderWorkspace. Restore
  // reading state here so every replacement of the list follows the same rule.
  const messageList = dock.querySelector('.human-message-list');
  const readingRevision=view.collaborationReadingRevision || 0;
  const readingIntent=()=>{view.collaborationReadingRevision=(view.collaborationReadingRevision || 0)+1;view.jumpLatest=false;};
  for(const type of ['wheel','touchmove','pointerdown'])messageList?.addEventListener(type,readingIntent,{passive:true});
  messageList?.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))readingIntent();});
  dock.querySelector('[data-collaboration-latest]')?.addEventListener('click',readingIntent);
  dock.querySelector('[data-collaboration-older]')?.addEventListener('click',readingIntent);
  const restoreReading = () => {
    if (!messageList?.isConnected || !messageList.clientHeight || (view.collaborationReadingRevision || 0)!==readingRevision) return;
    if (prepending) {
      const anchor = [...messageList.querySelectorAll('[data-collaboration-record]')].find(row => row.dataset.collaborationRecord === prepending.anchorId);
      messageList.scrollTop = anchor ? messageList.scrollTop + anchor.getBoundingClientRect().top - messageList.getBoundingClientRect().top - prepending.offset : prepending.top + messageList.scrollHeight - prepending.height;
    } else messageList.scrollTop = !reading || reading.following ? messageList.scrollHeight : reading.top;
  };
  restoreReading();
  requestAnimationFrame(restoreReading);
  const input = dock.querySelector('#instruction-text');
  if (input && draftReading) {
    if (draftReading.focused && !input.disabled) input.focus({ preventScroll: true });
    input.setSelectionRange(...draftReading.selection);
    input.scrollTop = draftReading.top;
  }
}

/* ---------- 任务空间数据与动作 ---------- */
async function loadCollaboration(runId=state.selectedRunId,{older=false,latest=false,render:paint=true}={}) {
  if(!runId || state.currentView!=='workspace' || state.selectedRunId!==runId)return;
  const view=workspaceView(runId);
  if(latest){view.collaborationRequest=(view.collaborationRequest||0)+1;view.collaborationPending=null;view.collaborationRefreshQueued=false;view.collaborationBrowsing=false;view.collaborationPrependReading=null;}
  if(view.collaborationPending){if(!older)view.collaborationRefreshQueued=true;return view.collaborationPending;}
  const query=new URLSearchParams({limit:'30',human:'false'});
  if(older&&view.collaborationBefore)query.set('before',view.collaborationBefore);
  const token=(view.collaborationRequest||0)+1;view.collaborationRequest=token;
  view.collaborationLoading=true;if(!older)view.collaborationError=null;
  const current=()=>state.currentView==='workspace' && state.selectedRunId===runId && token===view.collaborationRequest;
  const pending=(async()=>{
    try {
      const result=await api(`/api/runs/${runId}/collaboration?${query}`);
      if(!current())return;
      // Keep loaded history together. Live refresh cannot replace a reader's range.
      if(!older && view.collaborationBrowsing && view.collaborationItems?.length)return;
      if(older){
        const list=$('#collaboration-panel .human-message-list');
        if(list?.clientHeight){
          const bounds=list.getBoundingClientRect(),anchor=[...list.querySelectorAll('[data-collaboration-record]')].find(row=>{const rect=row.getBoundingClientRect();return rect.bottom>bounds.top && rect.top<bounds.bottom;});
          view.collaborationPrependReading={top:list.scrollTop,height:list.scrollHeight,anchorId:anchor?.dataset.collaborationRecord,offset:anchor ? anchor.getBoundingClientRect().top-bounds.top : 0};
        }
        view.collaborationItems=[...new Map([...result.items,...(view.collaborationItems || [])].map(item=>[item.id,item])).values()];
      }else view.collaborationItems=result.items;
      view.collaborationLoaded=true;
      view.collaborationError=null;
      view.collaborationRetryOlder=false;
      view.collaborationHasMore=result.hasMore;view.collaborationBefore=result.nextBefore;view.collaborationBrowsing=older;
    } catch(error) {if(current()){view.collaborationError=error.message;view.collaborationRetryOlder=older;}}
    finally {
      if(token===view.collaborationRequest){
        view.collaborationLoading=false;view.collaborationPending=null;
        if(current() && paint)renderWorkspace();
        if(view.collaborationRefreshQueued){view.collaborationRefreshQueued=false;if(current() && view.tab==='collaboration')void loadCollaboration(runId);}
      }
    }
  })();
  view.collaborationPending=pending;
  if(paint)renderWorkspace();
  return pending;
}
async function loadWorkspace(runId = state.selectedRunId, { quiet = false } = {}) {
  if (!runId) { renderWorkspace(); return; }
  const request = ++workspaceRequest;
  state.selectedRunId = runId;
  state.workspaceError = null;
  if (state.currentView === "workspace" && state.workspace?.run.id !== runId) renderWorkspace();
  connectEvents(runId);
  try {
    const workspace = await api(`/api/runs/${runId}/workspace?view=compact`);
    if (request !== workspaceRequest || state.selectedRunId !== runId || state.currentView !== "workspace") return;
    state.workspace = workspace;
    if(workspace.run.task.kind === "automation") state.automationId=workspace.run.task.automationId;
    $$(".nav-item").forEach(item=>item.classList.toggle("active", item.dataset.view === (workspace.run.task.kind === "automation" ? "automations" : "tasks")));
    const task = state.tasks.find((item) => item.id === workspace.run.taskId);
    if (task) { task.status = workspace.run.task.status; task.archivedAt = workspace.run.task.archivedAt; task.deletionBlockedBy = workspace.run.task.deletionBlockedBy; task.updatedAt = workspace.run.task.updatedAt; }
    const run = state.runs.find((item) => item.id === runId);
    if (run) { run.status = workspace.run.status; run.traceCount = workspace.run.traceCount; run.artifactCount = workspace.run.artifactCount; }
    if (state.currentView === "workspace" && location.pathname !== `/runs/${encodeURIComponent(runId)}`) history.replaceState({}, "", `/runs/${encodeURIComponent(runId)}`);
    render();
    if(workspaceView(runId).tab==='collaboration')void loadCollaboration(runId);
  } catch (error) {
    if (request !== workspaceRequest || state.selectedRunId !== runId || state.currentView !== 'workspace') return;
    state.workspaceError = error.message;
    if (!state.workspace || state.workspace.run.id !== runId) renderWorkspace();
    if (!quiet) toast(error.message, true);
  }
}
function setLiveIndicator(connected) {
  const indicator = $("#live-indicator");
  indicator.classList.toggle("off", !connected);
  const label = connected ? $t("实时同步") : $t("已断开");
  indicator.querySelector(".live-label").textContent = label;
  indicator.setAttribute("aria-label", $t("实时同步：{0}", [connected ? $t("已连接") : $t("已断开")]));
  indicator.title = indicator.getAttribute("aria-label");
}
function connectEvents(runId) {
  if (state.eventSource?.runId === runId) return;
  state.eventSource?.close();
  clearTimeout(workspaceRefreshTimer); workspaceRefreshTimer = null;
  clearTimeout(consoleRenderTimer); consoleRenderTimer = null;
  for (const [key, page] of consolePages) if (key.startsWith(`${runId}:`)) { page.request++; page.loading = false; page.loaded = false; page.events = []; page.error = null; page.hasMore = false; page.nextBefore = null; }
  for(const key of consolePages.keys())if(!key.startsWith(`${runId}:`))consolePages.delete(key);
  const source = new EventSource(`/api/runs/${runId}/events`);
  source.addEventListener("auth-expired", () => { source.close(); location.replace(`/login?next=${encodeURIComponent(location.pathname)}`); });
  source.runId = runId;
  let connected = false;
  source.addEventListener("open", () => {
    if (state.eventSource !== source) return;
    setLiveIndicator(true);
    if (connected) {
      scheduleWorkspaceRefresh(runId);
      if (workspaceView(runId).tab === "console" && state.selectedAgentId) loadConsolePage(runId, state.selectedAgentId);
    }
    connected = true;
  });
  source.addEventListener("error", () => setLiveIndicator(false));
  source.addEventListener("run-event", (message) => {
    if (state.eventSource !== source || state.currentView !== "workspace" || state.selectedRunId !== runId) return;
    const event = JSON.parse(message.data);
    const page = consolePages.get(`${runId}:${event.actor?.id}`);
    if (page && (page.loaded || page.loading) && (!page.traceId || page.traceId === event.data?.traceId) && !page.events.some((item) => item.id === event.id)) {
      if (page.loadingEvents) { page.loadingEvents.set(event.id, event); if (page.loadingEvents.size > 200) page.loadingEvents.delete(page.loadingEvents.keys().next().value); }
      // A latest-page replacement buffers concurrent SSE until its response;
      // never attach a new tail to a stale historical window across a gap.
      if (page.loadingMode !== 'reset') {
        if (page.browsingHistory && !page.traceId) {
          page.liveEvents = [...new Map([...(page.liveEvents || page.events), event].map(item => [item.id, item])).values()].slice(-200);
        } else page.events.push(event);
        // Keep the automatic live window bounded; older events remain available through pagination.
        if (!page.browsingHistory && page.events.length > 200) { page.events = page.events.slice(-200); page.nextBefore = page.events[0].id; page.hasMore = true; }
        if (event.actor?.id === state.selectedAgentId && workspaceView(runId).tab === "console" && !consoleRenderTimer) consoleRenderTimer = setTimeout(() => { consoleRenderTimer = null; renderConsolePage(); }, 100);
      }
    }
    if (event.type !== "runtime.event" || event.data?.subtype === "init") scheduleWorkspaceRefresh(runId);
  });
  state.eventSource = source;
}
function scheduleWorkspaceRefresh(runId) {
  if (workspaceRefreshTimer) return;
  workspaceRefreshTimer = setTimeout(() => {
    workspaceRefreshTimer = null;
    if (state.currentView === "workspace" && state.selectedRunId === runId) loadWorkspace(runId, { quiet: true });
  }, 500);
}
async function runTask(taskId, { taskCreated = false, taskUpdated = false } = {}) {
  try {
    const { run } = await api(`/api/tasks/${taskId}/run`, { method: "POST", body: "{}" });
    state.selectedRunId = run.id;
    state.selectedAgentId = null;
    toast($t("真实本机 Run 已启动"));
    await refresh({ quiet: true });
    setView("workspace");
    await loadWorkspace(run.id);
  } catch (error) {
    if (!taskCreated && !taskUpdated) { toast(error.message, true); return; }
    const saved = taskUpdated ? $t("任务修改已保存") : $t("任务已创建");
    // Task creation and Run launch are separate commands. A rejected launch
    // leaves a real backlog Task behind; a lost response might still have
    // started the Run. Re-read the authoritative summary before telling the
    // human which recovery action is safe.
    const refreshed = await refresh({ quiet: true });
    if (!refreshed) {
      toast($t("{0}，但启动响应未确认：{1}。无法重新读取任务中心，请恢复连接后刷新再确认。", [saved, error.message]), true);
      return;
    }
    const task = state.tasks.find((item) => item.id === taskId);
    const run = runOfTask(taskId);
    if (task?.status === "backlog" && !run) {
      toast($t("{0}，但未能启动 Run：{1}。任务已保留在任务中心，可再次启动。", [saved, error.message]), true);
      return;
    }
    toast($t("{0}，但启动响应未确认：{1}。已重新读取任务中心，请以当前状态继续。", [saved, error.message]), true);
  }
}
async function editTaskDraft(taskId) {
  try {
    const {task} = await api(`/api/tasks/${taskId}`);
    if (task.kind !== 'manual' || task.status !== 'backlog' || task.runs?.length) { toast($t("此任务已启动，不能编辑草稿。"),true); await refresh({quiet:true}); return; }
    await newTaskModal({existing:task});
  } catch (error) { toast(error.message,true); }
}
async function sendInstruction(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const content = String(form.get("content") || "").trim();
  if (!content && !workspaceView().attachments?.length) return;
  /* 未 @ 成员交由 Store 路由给经理；精确回复由问题 ID 决定接收人。 */
  const agents = state.workspace ? workspaceAgents(state.workspace, state.agents) : [];
  const replyToMessageId = form.get("replyToMessageId") || null;
  if (!replyToMessageId && state.workspace.pendingQuestions?.some(item=>item.recipient.type==='human')) { toast($t("请在待答问题上点击「回复此问题」，再发送回答。"), true); return; }
  const targets = agents.filter((agent) => new RegExp(`@${agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\s|[，,。.!！?？:：;；])`).test(content));
  if (!replyToMessageId && targets.length > 1) { toast($t("一条消息只能 @ 一位当前任务成员"), true); return; }
  const target = targets[0];
  const runId = state.selectedRunId;
  const view = workspaceView(runId);
  if (view.sending || state.workspace?.run.task.archivedAt) return;
  const draft = view.draft, draftRevision=view.draftRevision || 0;
  const readingList=globalThis.document?.querySelector('#collaboration-panel .human-message-list');
  const readingBefore=readingList?.clientHeight ? {top:readingList.scrollTop,following:readingList.scrollHeight-readingList.scrollTop-readingList.clientHeight<48} : view.collaborationScroll;
  const readingRevision=view.collaborationReadingRevision || 0;
  view.sending = true;
  const attachments = [...(view.attachments || [])];
  view.outbox ||= new Map();
  const signature=JSON.stringify({content,recipientAgentId:replyToMessageId ? null : target?.id ?? null,replyToMessageId,attachments:attachments.map(item=>item.id)});
  if(view.sendRequest?.signature!==signature)view.sendRequest={id:crypto.randomUUID(),signature};
  const replyQuestion=state.workspace.pendingQuestions?.find(item=>item.id===replyToMessageId) || view.outbox.get(view.sendRequest.id)?.replyQuestion;
  const outgoing={id:view.sendRequest.id,signature,content,draft,draftRevision,createdAt:new Date().toISOString(),status:'sending',attachments,replyToMessageId,replyQuestion,recipientName:replyToMessageId ? replyQuestion?.sender.name : (target || state.workspace.run.manager)?.name};
  view.outbox.set(outgoing.id,outgoing);
  view.draft = ''; view.attachments = []; view.sendRequest = null;
  const input = event.currentTarget.querySelector?.('#instruction-text');
  if (input) { input.value = ''; input.focus({preventScroll:true}); }
  view.jumpLatest=true;
  renderCollaboration(state.workspace, agents);
  if (input && state.selectedRunId === runId) input.ownerDocument.getElementById('instruction-text')?.focus({preventScroll:true});
  try {
    for (const item of attachments) if (!item.uploaded) {
      const result = await api(`/api/runs/${runId}/attachments?name=${encodeURIComponent(item.file.name)}`, {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:item.file});
      item.uploaded = result.attachment;
    }
    const result = await api(`/api/runs/${runId}/messages`, {
      method: "POST",
      body: JSON.stringify({ clientRequestId:outgoing.id, recipientAgentId: replyToMessageId ? null : target?.id ?? null, replyToMessageId, content, attachmentIds:attachments.map(item => item.uploaded.id) }),
    });
    confirmTaskOutgoing(view,outgoing,{message:result.message});
    toast(result.interactionOnly ? $t("问题已发送，仅答疑，不恢复业务流程") : result.resumed ? $t("澄清已发送，对应协作将继续") : $t("消息已入队，不打断正在执行的成员"));
    view.collaborationBrowsing = false;
    view.jumpLatest = true;
    void loadCollaboration(runId,{latest:true});
    // The POST receipt is already a persisted message. Display it now, then
    // refresh metadata/history independently; a read failure is not a send failure.
    if (state.selectedRunId === runId && state.currentView==='workspace') void loadWorkspace(runId).catch(error=>toast($t("消息已保存，记录刷新失败：{0}", [error.message]),true));
  } catch (error) { if(outgoing.status!=='confirmed'){
    outgoing.status='unconfirmed';outgoing.error=error.message;
    if(readingBefore && (view.collaborationReadingRevision || 0)===readingRevision)view.collaborationRestore=readingBefore;
    toast(error.message, true);
  } }
  finally { view.sending = false; if (state.currentView==='workspace' && state.workspace?.run.id === runId && view.tab==='collaboration') renderCollaboration(state.workspace, workspaceAgents(state.workspace, state.agents)); }
}
function openCompletionModal(runId, workspace = state.workspace?.run?.id === runId ? state.workspace : null) {
  const acceptance = acceptanceReview(workspace || {});
  if (!acceptance?.verified) return toast($t("当前任务尚未提交人类验收。"), true);
  const findings = acceptance.findings.map((finding) => `<li>${esc(finding)}</li>`).join("");
  const criteria = acceptanceCriteriaMarkup(acceptance);
  openModal(`
    <h2>${$t("确认任务完成")}</h2>
    <p class="modal-intro">${$t("你正在代表人类确认「{0}」的交付。确认后 Run 会变为已完成；Trace、Artifact、消息和审计记录会继续保留。", [esc(workspace.run.task.title)])}</p>
    <section class="completion-review" aria-label="${$t("待确认的经理交接")}">
      <strong>${$t("经理交接说明")}</strong><ul>${findings}</ul>
      <strong class="completion-review-criteria-title">${$t("任务验收标准")}</strong>${criteria}
      <small>${$t("{0} 项已接纳交付快照 · {1} 条原任务要求", [acceptance.artifactCount, acceptance.criteria.length])}</small>
    </section>
    <label class="ack-row"><input type="checkbox" id="ack-completion" /> ${$t("我已阅读复核结论，并已核对需要的交付快照。")}</label>
    <div class="form-actions">
      <button type="button" class="ghost-button" data-close-modal>${$t("返回核验")}</button>
      <button type="button" class="primary-button" id="confirm-completion" disabled>${$t("确认完成")}</button>
    </div>`);
  const button = $("#confirm-completion");
  $("#ack-completion").addEventListener("change", (event) => { button.disabled = !event.target.checked; });
  button.addEventListener("click", async () => {
    button.disabled = true;
    const inboxTaskId = state.currentView === 'inbox' ? state.inboxSelection : null;
    try {
      await api(`/api/runs/${runId}/confirm-completion`, { method: "POST", body: "{}" });
      if (inboxTaskId && state.currentView === 'inbox' && state.inboxView !== 'recent' && state.inboxSelection === inboxTaskId) advanceInbox(inboxTaskId);
      closeModal();
      await refresh({ quiet: true });
      if (state.currentView === 'inbox') { await refreshInbox(); renderInbox(); }
      else await loadWorkspace(runId);
      toast($t("已由你确认任务完成"));
    } catch (error) {
      button.disabled = false;
      toast(error.message, true);
    }
  });
}
async function retryScheduledWorkspace(runId) {
  try {
    const result = await api(`/api/runs/${runId}/retry-now`, { method: "POST", body: "{}" });
    toast($t("已请求立即重试 {0} 项调用；失败 Trace 已保留。", [result.dispatchIds.length]));
    if (state.selectedRunId === runId) await loadWorkspace(runId);
  } catch (error) { toast(error.message, true); }
}
async function retryFailedWorkspace(runId, workflowNodeId) {
  try {
    await api(`/api/runs/${runId}/retry-failed-node`, { method: "POST", body: JSON.stringify({ workflowNodeId }) });
    toast($t("已请求原员工继续失败投递；原会话与历史证据已保留。"));
    await refresh({ quiet: true });
    if (state.selectedRunId === runId) await loadWorkspace(runId);
  } catch (error) { toast(error.message, true); }
}
async function retryFailedOrchestration(runId) {
  try {
    await api(`/api/runs/${runId}/retry-orchestration`, { method: "POST", body: "{}" });
    toast($t("已请求重新准备运行环境并继续原投递。"));
    await refresh({ quiet: true });
    if (state.selectedRunId === runId) await loadWorkspace(runId);
  } catch (error) { toast(error.message, true); }
}
function openDeleteTaskModal(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const runs = state.runs.filter((item) => item.taskId === taskId || item.task?.id === taskId);
  if (task.deletionBlockedBy) {
    toast(task.deletionBlockedBy === "active_inquiries" ? $t("答疑进行中，请等待答复完成后重试删除。") : $t("存在活跃 Run，不能删除 Task。"), true);
    return;
  }
  const artifactCount = runs.reduce((total, item) => total + (item.artifactCount || 0), 0);
  openModal(`
    <h2>${$t("删除任务")}</h2>
    <p class="modal-intro">${$t("将永久删除「{0}」及其 {1} 个 Run{2}。这只适用于没有活跃 Run 或未结束答疑的任务。", [esc(task.title), runs.length, artifactCount ? $t("、{0} 项已接纳交付快照", [artifactCount]) : ""])}</p>
    <ul class="confirm-list">
      <li>${$t("Task、Run、Trace、Artifact、消息、Decision 和 Event 都会被移除")}</li>
      <li>${$t("同一 Run 的本地文件快照会被删除，无法恢复")}</li>
      <li>${$t("若本机文件系统暂时无法清理，快照会先被服务端隔离，Console 会明确提示后续清理")}</li>
      <li>${$t("不会取消或终止正在执行的本机 Agent；活跃 Run 或答疑进行中时根本不能删除")}</li>
    </ul>
    <label class="ack-row"><input id="delete-task-acknowledged" type="checkbox" />${$t("我理解这会永久删除本地交付与审计记录")}</label>
    <div class="form-actions"><button type="button" class="ghost-button" data-close-modal>${$t("取消")}</button><button type="button" class="danger-button" id="confirm-delete-task" disabled>${$t("永久删除任务")}</button></div>`);
  const acknowledgement = $("#delete-task-acknowledged"), confirmButton = $("#confirm-delete-task");
  acknowledgement.addEventListener("change", () => { confirmButton.disabled = !acknowledgement.checked; });
  confirmButton.addEventListener("click", async () => {
    try {
      const result = await api(`/api/tasks/${taskId}`, { method: "DELETE" });
      closeModal();
      if (runs.some((item) => item.id === state.selectedRunId)) {
        state.selectedRunId = null;
        state.selectedAgentId = null;
        state.workspace = null;
        setView("tasks", { replace: true, taskArchiveView: false });
      }
      toast(result.runFileCleanup === "pending" ? $t("任务记录已删除；本地快照已隔离，服务将在下次启动时继续清理。") : $t("任务及其本地运行记录已删除。"));
      await refresh({ quiet: true });
    } catch (error) { toast(error.message, true); }
  });
}
function openTerminateModal(runId) {
  const run = state.workspace?.run?.id === runId ? state.workspace.run : state.runs.find((item) => item.id === runId);
  const title = run?.task?.title || runId;
  openModal(`
    <h2>${$t("终止执行")}</h2>
    <p class="modal-intro">${$t("「{0}」正在被终止。这是一个不可恢复的破坏性操作：", [esc(title)])}</p>
    <ul class="confirm-list">
      <li>${$t("立即终止正在运行的本机 Agent 进程")}</li>
      <li>${$t("将本次 Run 标记为已终止，并取消尚未完成的协作投递")}</li>
      <li>${$t("已接收的 Trace、Artifact、消息与终止审计记录会保留，可继续查看")}</li>
    </ul>
    <label class="ack-row"><input type="checkbox" id="ack-terminate" /> ${$t("我理解此操作不可恢复")}</label>
    <div class="form-actions">
      <button type="button" class="ghost-button" data-close-modal>${$t("再想想")}</button>
      <button type="button" class="danger-button" id="confirm-terminate" disabled style="opacity:.5">${$t("确认终止")}</button>
    </div>`);
  $("#ack-terminate").addEventListener("change", (event) => {
    const button = $("#confirm-terminate");
    button.disabled = !event.target.checked;
    button.style.opacity = event.target.checked ? "1" : ".5";
  });
  $("#confirm-terminate").addEventListener("click", async () => {
    try {
      await api(`/api/runs/${runId}/terminate`, { method: "POST", body: JSON.stringify({ reason: "用户在任务空间终止" }) });
      closeModal();
      toast($t("Run 已终止；协作记录保留了终止事实，已接收的交付仍可查看。"));
      await refresh({ quiet: true });
      await loadWorkspace(runId);
    } catch (error) { toast(error.message, true); }
  });
}

async function pauseWorkspaceRun(runId) {
  try {
    await api(`/api/runs/${runId}/pause`, { method: "POST", body: JSON.stringify({ reason: "用户在任务空间暂停" }) });
    toast($t("Run 已暂停；所有本机角色执行已停止，未完成节点可继续。"));
    await refresh({ quiet: true });
    await loadWorkspace(runId);
  } catch (error) { toast(error.message, true); }
}

async function resumeWorkspaceRun(runId) {
  try {
    await api(`/api/runs/${runId}/resume`, { method: "POST" });
    toast($t("Run 已继续；项目经理正在依据当前状态重新评估。"));
    await refresh({ quiet: true });
    await loadWorkspace(runId);
  } catch (error) { toast(error.message, true); }
}

/* ---------- 创建弹窗 ---------- */
const pathList = (value) => String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);

async function newTaskModal({ automation = false, existing = null, teamId = null, draft = null } = {}) {
  openModal(`<h2>${automation?$t("读取自动化配置"):$t("读取任务配置")}</h2><div data-task-catalog-loading class="directory-empty is-loading" role="status" aria-busy="true"><strong>${$t("正在读取成员与工作流")}</strong>${$t("读取完成后可继续编辑。")}</div><div class="form-actions"><button type="button" class="ghost-button" data-close-modal>${$t("取消")}</button></div>`);
  const loading=$('[data-task-catalog-loading]');
  let catalog;
  try {catalog=await loadCatalogReferences();}
  catch(error){if(loading.isConnected){loading.classList.remove('is-loading');loading.setAttribute('role','alert');loading.setAttribute('aria-busy','false');loading.innerHTML=`<strong>${$t("配置读取失败")}</strong>${esc(error.message)}<button type="button" class="small-button" data-retry-task-catalog>${$t("重试")}</button>`;loading.querySelector('[data-retry-task-catalog]').onclick=()=>newTaskModal({automation,existing,teamId,draft});}return;}
  if(!loading.isConnected)return;
  const source = existing || draft;
  if (!catalog.agents.some(agent => agent.status === "active")) { closeModal();toast($t("请先创建或启用数字员工。"), true); return; }
  openModal(`
    <h2>${automation ? existing ? $t("编辑自动化") : $t("新建自动化") : existing ? $t("编辑任务草稿") : $t("新建任务")}</h2>
    <form id="task-form" novalidate>
      <div class="form-field task-title-field"><label for="task-title">${automation ? $t("自动化名称") : $t("任务标题")} <b>*</b></label>
        <input id="task-title" name="title" placeholder="${$t("例如：订单结算页重构")}" /><div class="field-error"></div></div>
      <div class="form-field task-description-field"><label for="task-objective">${$t("内容描述")} <b>*</b></label>
        <textarea id="task-objective" name="objective" rows="6" placeholder="${$t("描述要完成的事、背景和要求…")}"></textarea><div class="field-error"></div></div>
      <details class="task-acceptance"><summary>${$t("验收标准（选填）")}</summary>
        <div class="form-field"><label for="task-acceptance">${$t("验收标准（每行一条）")}</label>
          <textarea id="task-acceptance" name="acceptanceCriteria" rows="3" placeholder="${$t("每行填写一条，可留空")}"></textarea><div class="field-error"></div></div>
      </details>
      ${automation ? `<section class="automation-schedule-fields" aria-labelledby="automation-schedule-title"><h3 id="automation-schedule-title">${$t("执行计划")}</h3><div class="form-field"><label for="automation-cron">${$t("Cron · 分 时 日 月 周")} <b>*</b></label><input id="automation-cron" name="cron" value="${esc(source?.cron || '0 9 * * 1-5')}" placeholder="0 9 * * 1-5"><div class="field-error"></div></div></section>` : ''}
        <div class="form-grid task-selectors">
          <div class="form-field"><div id="task-members-picker"></div><div class="field-error"></div></div>
          <div class="form-field"><label for="task-workflow">${$t("流程模板（选填）")}</label>
            <select id="task-workflow" name="workflowTemplateId"><option value="">${$t("默认协作")}</option>${source?.workflowTemplateId && !catalog.workflowTemplates.some(template=>template.id===source.workflowTemplateId) ? `<option value="${esc(source.workflowTemplateId)}">${$t("{0}（已删除，请重新选择）", [esc(source.workflowSnapshot?.name || $t("原流程模板"))])}</option>` : ''}${catalog.workflowTemplates.map((template) => `<option value="${template.id}">${esc(template.name)}</option>`).join("")}</select></div>
        </div>
        ${automation ? '' : `<small class="task-workspace-hint">${$t("系统工作根目录 {0}/tasks/任务ID/RunID", [esc(state.settings?.workspaceRoot || "/tmp/Baton")])}</small>`}
      <div class="form-actions task-form-footer">${automation ? `<span class="automation-create-note">${existing ? existing.enabled ? $t("已启用") : $t("已停用") : $t("创建后默认启用")}</span>` : ''}
        <div class="task-submit-actions"><button type="button" class="ghost-button" data-close-modal>${$t("取消")}</button>${automation && !existing ? `<button type="submit" class="ghost-button" value="disabled">${$t("保存为停用")}</button>` : !automation ? `<button type="submit" class="secondary-button" value="draft">${existing ? $t("保存修改") : $t("保存草稿")}</button>` : ''}<button type="submit" class="primary-button" value="start">${automation ? existing ? $t("保存修改") : $t("创建并启用") : $t("保存并开始")}</button></div>
      </div>
    </form>`);
  $("#modal-content").closest(".modal").classList.add("task-create-modal");
  if(automation) $("#modal-content").closest(".modal").classList.add("automation-create-modal");
  const form = $("#task-form");
  const candidates = catalog.agents.filter(agent => agent.status === "active");
  const savedMembers = [...(source?.memberSnapshots || []),source?.managerSnapshot].filter(Boolean);
  const unavailable = (source?.memberAgentIds || []).filter(id=>!candidates.some(agent=>agent.id===id)).map(id=>({...catalog.agents.find(agent=>agent.id===id) || savedMembers.find(agent=>agent.id===id) || {id,name:$t("已删除员工 {0}", [id.slice(0,8)])},status:'inactive'}));
  const teams = catalog.teams.filter(team => team.status === "active").map(team => ({ ...team, description: $t("{0} 位员工 · 团队", [team.memberAgentIds.length]), selectionKind: "team" }));
  const expandMembers = item => item.selectionKind === 'team' ? item.memberAgentIds.filter(value => candidates.some(agent => agent.id === value)) : [item.id];
  const presetTeam = teamId ? teams.find(team => team.id === teamId) : null;
  let selectedMembers = source?.memberAgentIds || (presetTeam ? expandMembers(presetTeam) : []);
  const memberSelection = createEmployeeMultiSelect($('#task-members-picker'), { selectedIds:selectedMembers, managerId:source?.managerAgentId || null, onManagerChange:()=>clearInvalidField($('#task-members')), id: 'task-members', label:$t("任务成员 *"), placeholder:$t("添加团队或数字员工"), esc, items:[...teams,...candidates,...unavailable], available:item=>item.selectionKind==='team'||item.status==='active', hideUnavailable:true, unavailableLabel:$t("不可用"), detail:item=>`<small>${esc(item.description || $t("数字员工@@item"))}</small>`, expand:expandMembers, onChange:values=>{selectedMembers=values;clearInvalidField($('#task-members'));} });
  if (source) { form.elements.title.value=source.title; form.elements.objective.value=source.objective; form.elements.acceptanceCriteria.value=source.acceptanceCriteria.join("\n"); form.elements.workflowTemplateId.value=source.workflowTemplateId || ""; }
  if (source?.acceptanceCriteria?.length) form.querySelector('.task-acceptance').open = true;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.saving) return;
    clearInvalid(form);
    let valid = true;
    if (!form.title.value.trim()) { setInvalid(form.title, $t("请填写任务标题。")); valid = false; }
    if (!form.objective.value.trim()) { setInvalid(form.objective, $t("请描述任务目标、范围或关键约束。")); valid = false; }
    const acceptanceCriteria = form.elements.acceptanceCriteria.value.split(/\r?\n/).map((criterion) => criterion.trim()).filter(Boolean);
    const criteriaError = acceptanceCriteria.length > 20 ? $t("验收标准最多 20 条。") : acceptanceCriteria.some((criterion) => criterion.length > 500) ? $t("每条验收标准不能超过 500 字符。") : "";
    if (criteriaError) { form.querySelector(".task-acceptance").open = true; setInvalid(form.elements.acceptanceCriteria, criteriaError); valid = false; }

    const memberAgentIds = memberSelection.value();
    if (!memberAgentIds.length) { setInvalid($('#task-members'), $t("请至少选择一位员工。")); valid = false; }
    else if (memberAgentIds.some(id=>!candidates.some(agent=>agent.id===id))) { setInvalid($('#task-members'), $t("已选成员不可用，请移除后重新选择。")); valid = false; }
    else if (!memberSelection.managerId()) { setInvalid($('#task-members'), $t("点击已选员工，指定一位本次经理。")); valid = false; }
    if (!valid) return;
    form.dataset.saving="true"; form.querySelectorAll('[type="submit"]').forEach(button=>button.disabled=true);
    try {
      const data = new FormData(form);
      const input = Object.fromEntries(data);
      input.memberAgentIds = memberAgentIds;
      input.managerAgentId = memberSelection.managerId();
      input.acceptanceCriteria = acceptanceCriteria;
      if (automation) {
        input.enabled=existing ? existing.enabled : event.submitter?.value !== 'disabled';
        await api(existing ? `/api/automations/${existing.id}` : '/api/automations',{method:existing?'PUT':'POST',body:JSON.stringify(input)});
        closeModal(); toast(existing?$t("自动化已保存。"):$t("自动化已创建。")); await automationUI.refresh(); return;
      }
      const created = await api(existing ? `/api/tasks/${existing.id}` : '/api/tasks', { method: existing ? 'PUT' : 'POST', body: JSON.stringify(input) });
      closeModal();
      if (event.submitter?.value !== "start") {
        // Saving a Task does not create a Run; keep the saved draft visible
        // even when the list previously had a search or status filter.
        state.tasks = [created.task, ...state.tasks.filter(task => task.id !== created.task.id)];
        state.taskChip = "all";
        state.taskSearch = { name: "", status: "all", workflow: "all" };
        state.listPages.tasks = 1;
        $("#task-search-form")?.remove();
        setView("tasks", { taskArchiveView: false });
        toast(existing ? $t("草稿修改已保存。") : $t("草稿已保存，点击启动开始执行。"));
        await refresh({ quiet: true });
        return;
      }
      await runTask(created.task.id, { taskCreated: !existing, taskUpdated: Boolean(existing) });
    } catch (error) { toast(error.message, true); } finally { delete form.dataset.saving; form.querySelectorAll('[type="submit"]').forEach(button=>button.disabled=false); }
  });
}

function workflowModal(template = null) {
  openModal(`<form id="workflow-form" novalidate><header class="workflow-editor-topbar"><button type="button" class="ghost-button workflow-back" data-close-modal aria-label="${$t("返回工作流")}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><h2 class="workflow-editor-heading" aria-label="${template ? $t("编辑工作流") : $t("新建工作流")}"><input id="workflow-name" name="workflowName" aria-label="${$t("工作流名称")}" aria-required="true" value="${esc(template?.name || '')}" placeholder="${$t("新建工作流")}" /></h2><span class="workflow-save-state" role="status">${template?$t("已保存"):$t("新工作流")}</span><div class="workflow-editor-top-actions"><button type="button" class="ghost-button" data-flow-action="preview" aria-pressed="false">${$t("文本预览")}</button><button type="button" class="small-button" data-close-modal>${$t("放弃")}</button><button type="submit" class="primary-button" aria-label="${template ? $t("保存工作流") : $t("创建工作流")}">${$t("保存")} <kbd>⌘S</kbd></button></div></header><div id="workflow-canvas-editor"></div></form>`);
  const form = $('#workflow-form');
  form.closest('.modal').classList.add('workflow-editor-modal');
  form.closest('.modal').toggleAttribute('data-native-chrome', Boolean(window.batonDesktop));
  const editor = createWorkflowEditor($('#workflow-canvas-editor'), {workflow:template || {},loadVendor,esc,nameInput:$('#workflow-name'),onChange:dirty=>{const status=form.querySelector('.workflow-save-state');status.textContent=dirty?$t("有未保存的更改"):template?$t("已保存"):$t("新工作流");status.classList.toggle('is-dirty',dirty);}});
  form.querySelector('[data-flow-action=preview]').onclick = () => editor.togglePreview();
  form.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); form.requestSubmit(form.querySelector('[type=submit]')); } });
  modalCancel = () => editor.dispose();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button=form.querySelector('[type=submit]'), errorBox=form.querySelector('.workflow-editor-error');
    if(button.disabled)return;
    let payload;
    try {payload=editor.value();if(!payload.name)throw new Error($t("请填写工作流名称。"));if(!payload.nodes.length)throw new Error($t("请添加至少一个节点。"));if(payload.nodes.some(node=>!node.title.trim()))throw new Error($t("请填写节点名称。"));}
    catch(error){errorBox.textContent=error.message;errorBox.hidden=false;return;}
    button.disabled=true;
    try {
      await api(template ? `/api/workflow-templates/${template.id}` : '/api/workflow-templates', {method:template?'PUT':'POST',body:JSON.stringify(payload)});
      if(form.isConnected)closeModal();
      toast(template?$t("工作流已更新，新任务使用此版本。"):$t("工作流已创建。"));await refresh();
    }catch(error){if(form.isConnected){errorBox.textContent=error.message;errorBox.hidden=false;}}
    finally{if(form.isConnected)button.disabled=false;}
  });
}

async function agentModal(existing = null, {draft = null} = {}) {
  let profiles, roles;
  try { [profiles, roles] = await Promise.all([api('/api/settings/runtime-profiles').then(result => result.profiles), api('/api/roles').then(result => result.roles)]); }
  catch (error) { toast($t("配置读取失败：{0}", [error.message]), true); return; }
  if (!profiles.length) { toast($t("Runtime 配置不可用，请在设置中检查。"), true); return; }
  const initial=existing || draft;
  const runtime = initial?.runtime || {};

  openModal(`
    <h2>${existing ? $t("编辑数字员工") : $t("创建数字员工")}</h2>
    <p class="modal-intro">${$t("数字员工可加入团队并承担工作流节点；修改仅影响后续新任务和沟通。")}</p>
    <form id="agent-form" novalidate>
      <div class="employee-identity-row"><div class="form-field"><label>${$t("名称")} <b>*</b></label><input name="name" value="${esc(initial?.name || "")}" placeholder="${$t("例如：周航")}" /><div class="field-error"></div></div><fieldset class="employee-status-choice"><legend>${$t("状态")}</legend><label class="directory-enabled-control"><input type="checkbox" data-enabled-toggle ${!initial || initial.status==='active'?'checked':''}>${$t("可用")}</label><input type="hidden" name="status" value="${initial?.status==='inactive'?'inactive':'active'}"></fieldset></div>
      <div class="employee-properties-row"><div class="form-field"><label for="employee-runtime-profile">${$t("Runtime 配置")} <b>*</b></label><select id="employee-runtime-profile" name="runtimeProfileId">${profiles.map(item => `<option value="${esc(item.id)}" ${!item.enabled && item.id !== runtime.profileId ? 'disabled' : ''} ${item.id === runtime.profileId ? 'selected' : ''}>${runtimeLabel(item.provider)}${item.enabled ? '' : $t("（已停用）")}</option>`).join('')}</select></div></div>
      <p class="field-hint">${$t("Runtime 在设置中管理和测试；停用不改写冻结任务与沟通。插件和 MCP 按员工独立选择。")}</p>
      <div class="form-field full" id="employee-role-selection"></div>
      <div class="form-field full"><label>${$t("系统提示词（职责与协作边界）")}</label><textarea name="systemPrompt" rows="8">${esc(initial?.systemPrompt || "")}</textarea></div>
      <div class="form-field full"><label>${$t("简介")}</label><textarea name="description" placeholder="${$t("擅长什么、能解决哪些问题、何时应咨询这位员工")}">${esc(initial?.description || "")}</textarea></div>
      <div class="form-field full"><label>${$t("能力标签（每行一条）")}</label><textarea name="capabilities" rows="3">${esc((initial?.capabilities || []).join("\n"))}</textarea></div>
      <div class="form-field full" id="employee-market-selection"></div>
      <div class="form-actions">
        <button type="button" class="ghost-button" data-close-modal>${$t("取消")}</button>
        <button type="submit" class="primary-button">${existing ? $t("保存修改") : $t("创建数字员工")}</button>
      </div>
    </form>`);
  const roleSelection=createEmployeeMultiSelect($('#employee-role-selection'),{id:'employee-role',label:$t("绑定角色（可多选）"),placeholder:$t("搜索并添加角色"),esc,items:roles,selectedIds:initial?.roleIds || [],detail:role=>`<small>${esc(role.id)}</small>`});
  const form = $("#agent-form");
  form.querySelector('[data-enabled-toggle]').onchange=event=>{form.elements.status.value=event.target.checked?'active':'inactive';};
  const capabilityField=form.capabilities.closest('.form-field'),capabilityInput=document.createElement('input'),capabilityPicker=document.createElement('div');
  capabilityPicker.className='employee-capability-picker';capabilityInput.id='employee-capability-input';capabilityInput.placeholder=$t("输入后回车添加");capabilityInput.setAttribute('aria-label',$t("添加能力标签"));form.capabilities.hidden=true;capabilityField.querySelector('label').htmlFor=capabilityInput.id;capabilityField.querySelector('label').textContent=$t("能力标签");capabilityField.append(capabilityPicker);
  const renderCapabilities=()=>{capabilityPicker.innerHTML=form.capabilities.value.split(/\r?\n/).filter(Boolean).map((value,index)=>`<span>${esc(value)}<button type="button" data-remove-capability="${index}" aria-label="${$t("移除能力 {0}", [esc(value)])}">×</button></span>`).join('');capabilityPicker.append(capabilityInput);};
  const addCapability=()=>{const value=capabilityInput.value.trim();if(value){const values=form.capabilities.value.split(/\r?\n/).filter(Boolean);if(!values.includes(value))values.push(value);form.capabilities.value=values.join('\n');capabilityInput.value='';renderCapabilities();}};
  capabilityInput.onkeydown=event=>{if(event.key==='Enter' && !event.isComposing){event.preventDefault();addCapability();}};
  capabilityPicker.onclick=event=>{const button=event.target.closest('[data-remove-capability]');if(button){const values=form.capabilities.value.split(/\r?\n/).filter(Boolean);values.splice(Number(button.dataset.removeCapability),1);form.capabilities.value=values.join('\n');renderCapabilities();capabilityInput.focus();}};form.addEventListener('submit',addCapability,true);renderCapabilities();
  const body=form.querySelector('.modal-scroll'),main=document.createElement('div');main.className='employee-edit-main';
  const sections=[['identity',$t("基本信息"),[form.querySelector('.employee-identity-row'),form.description.closest('.form-field'),form.capabilities.closest('.form-field')]],['responsibility',$t("职责与提示词"),[form.querySelector('#employee-role-selection'),form.systemPrompt.closest('.form-field')]],['runtime',$t("运行配置"),[form.querySelector('.employee-properties-row'),form.querySelector('.employee-properties-row + .field-hint')]],['tools',$t("工具"),[form.querySelector('#employee-market-selection')]]];
  for(const [id,label,nodes] of sections){const section=document.createElement('section');section.id='employee-section-'+id;section.innerHTML=`<h3 class="employee-section-title">${label}</h3>`;nodes.forEach(node=>section.append(node));main.append(section);}
  const nav=document.createElement('nav');nav.className='employee-section-nav';nav.setAttribute('aria-label',$t("员工配置分区"));nav.innerHTML=sections.map(([id,label],index)=>`<button type="button" class="text-action" data-form-section="employee-section-${id}" aria-current="${index===0?'location':'false'}">${label}</button>`).join('');
  body.classList.add('employee-edit-layout');body.append(nav,main);
  nav.onclick=event=>{const button=event.target.closest('[data-form-section]');if(button){document.getElementById(button.dataset.formSection)?.scrollIntoView({block:'start',behavior:'instant'});nav.querySelectorAll('button').forEach(item=>item.setAttribute('aria-current',item===button?'location':'false'));}};
  main.onscroll=()=>{const current=[...main.children].reverse().find(section=>section.offsetTop<=main.scrollTop+main.offsetTop+24) || main.firstElementChild;nav.querySelectorAll('button').forEach(button=>button.setAttribute('aria-current',button.dataset.formSection===current.id?'location':'false'));};
  form.closest(".modal").classList.add("employee-config-modal");
  form.querySelectorAll(".form-field").forEach((field, index) => {
    const input = field.querySelector("input,textarea,select"), label = field.querySelector("label");
    if (input && label && !label.htmlFor) { input.id ||= `employee-field-${index}`; label.htmlFor = input.id; }
  });
  let provider = profiles.find(item => item.id === form.elements.runtimeProfileId.value).provider;
  const runtimeSummary=document.createElement('dl');runtimeSummary.className='employee-runtime-details';form.querySelector('.employee-properties-row').after(runtimeSummary);
  const showRuntimeSummary=()=>{const profile=profiles.find(item=>item.id===form.elements.runtimeProfileId.value);runtimeSummary.innerHTML=`<dt>${$t("模型")}</dt><dd>${esc(profile.model || $t("CLI 默认模型"))}</dd><dt>${$t("思考等级")}</dt><dd>${esc(profile.effort || $t("默认"))}</dd>`;};showRuntimeSummary();
  const selection = marketplaceUI.select($("#employee-market-selection"), runtime, provider);
  form.elements.runtimeProfileId.addEventListener("change", () => {
    provider = profiles.find(item => item.id === form.elements.runtimeProfileId.value).provider;
    showRuntimeSummary();
    selection.provider(provider);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearInvalid(form);
    let extensionSelection;
    try { extensionSelection = selection.value(); } catch (error) { toast(error.message, true); return; }
    let valid = true;
    if (!form.name.value.trim()) { setInvalid(form.name, $t("请填写名称。")); valid = false; }


    if (!valid) return;
    const data = new FormData(form);
    const input = Object.fromEntries(data);
    input.capabilities = String(data.get("capabilities") || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if(draft?.kind)input.kind=draft.kind;
    input.roleIds = roleSelection.value();
    input.runtime = {
      profileId: data.get("runtimeProfileId"),
      extensionSelection
    };
    delete input.runtimeProfileId;
    delete input.provider;
    delete input.executable;
    try {
      await api(existing ? `/api/agents/${existing.id}` : "/api/agents", { method: existing ? "PUT" : "POST", body: JSON.stringify(input) });
      closeModal();
      toast(existing ? $t("数字员工「{0}」已更新并绑定 {1} Runtime。", [input.name, runtimeLabel(provider)]) : $t("数字员工「{0}」已创建并绑定 {1} Runtime。", [input.name, runtimeLabel(provider)]));
      await refresh();
    } catch (error) { toast(error.message, true); }
  });
}

const newAgentModal = () => agentModal();

function configurationDeletionModal(kind, id) {
  const item = (kind === "agent" ? state.agents : kind === "role" ? state.roles : state.teams).find(item => item.id === id);
  if (!item) return toast($t("配置不存在，请刷新列表。"), true);
  const title = kind === "agent" ? $t("删除数字员工") : kind === "role" ? $t("删除角色") : $t("删除团队");
  const hint = kind === "role"
    ? $t("仍有员工绑定（含停用员工）时会拒绝删除并列出绑定员工，请先在员工中解除绑定；已冻结任务中的角色提示词快照保留，历史仍可核验。")
    : kind === "agent" ? $t("从当前员工、团队与群聊中移除；在途任务继续执行，历史对话保留。") : $t("仅删除团队标识，任务与已创建群聊的成员及历史保留。");
  openModal(`<h2>${title}</h2><p class="modal-intro">${$t("确认删除「{0}」？此操作不可恢复。", [esc(item.name)])}</p><p class="field-hint">${hint}</p><p data-delete-error role="alert"></p><div class="form-actions"><button class="ghost-button" data-close-modal>${$t("取消")}</button><button class="small-button danger" data-confirm-configuration-delete>${title}</button></div>`);
  const button = $("[data-confirm-configuration-delete]"), message = $("[data-delete-error]");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await api(`/api/${kind === "agent" ? "agents" : kind === "role" ? "roles" : "teams"}/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" }); if (button.isConnected) closeModal(); toast(kind === "agent" ? $t("数字员工已删除。") : kind === "role" ? $t("角色已删除。") : $t("团队已删除。")); await refresh(); }
    catch (error) { if (button.isConnected) { message.textContent = error.message; button.disabled = false; } else toast(error.message, true); }
  });
}

function employeeSearchResults(agents, query, selectedIds, limit = 20) {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  return agents.filter(agent => agent.status === "active" && !selectedIds.has(agent.id) &&
    [agent.name, agent.description, ...(agent.capabilities || [])].join(" ").toLocaleLowerCase().includes(term)).slice(0, limit);
}

function mountEmployeePicker(host, { agents, selectedIds, name, inputId, multiple }) {
  const selected = new Set(selectedIds);
  host.classList.add("employee-picker");
  host.innerHTML = `<div class="employee-search"><input id="${inputId}" type="search" autocomplete="off" placeholder="${$t("搜索员工姓名或能力…")}" aria-controls="${inputId}-results" /><div class="employee-search-results" id="${inputId}-results" hidden></div><small class="field-hint" data-search-status role="status">${$t("输入关键词搜索，每次最多显示 20 位。")}</small></div><div class="selected-employees" data-selected-employees></div>`;
  const input = host.querySelector("input"), results = host.querySelector(".employee-search-results"), picked = host.querySelector("[data-selected-employees]");
  const renderSelected = () => {
    const items = agents.filter(agent => selected.has(agent.id));
    picked.innerHTML = `<div class="employee-selection-count">${multiple ? $t("已选 {0} 位员工", [items.length]) : $t("当前项目经理")}</div>` + (items.length ? items.map(agent => `<div class="selected-employee"><input type="hidden" name="${name}" value="${esc(agent.id)}" /><span class="check-avatar ${roleColor(agent)}">${esc(initialsOf(agent))}</span><div class="employee-picker-copy"><strong>${esc(agent.name)}${agent.status === "active" ? "" : $t("（已停用）")}</strong><small>${esc(agent.description || $t("未填写简介"))}</small></div><button type="button" class="text-action" data-remove-employee="${esc(agent.id)}" aria-label="${$t("移除{0}", [esc(agent.name)])}">${$t("移除")}</button></div>`).join("") : `<p class="field-hint">${$t("尚未选择员工，请在上方搜索添加。")}</p>`);
  };
  const search = () => {
    const matches = employeeSearchResults(agents, input.value, selected);
    results.hidden = !input.value.trim();
    results.innerHTML = matches.length ? matches.map(agent => `<button type="button" data-pick-employee="${esc(agent.id)}"><span class="check-avatar ${roleColor(agent)}">${esc(initialsOf(agent))}</span><span class="employee-picker-copy"><strong>${esc(agent.name)}</strong><small>${esc(agent.description || $t("未填写简介"))}</small></span><span>${multiple ? $t("添加") : $t("选择")}</span></button>`).join("") : `<p class="field-hint">${$t("未找到可添加的员工，试试其他关键词。")}</p>`;
    host.querySelector("[data-search-status]").textContent = input.value.trim() ? $t("显示 {0} 位候选员工，最多 20 位；可继续输入缩小范围。", [matches.length]) : $t("输入关键词搜索，每次最多显示 20 位。");
  };
  input.addEventListener("input", search);
  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); results.querySelector("button")?.focus(); }
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") { event.stopPropagation(); input.value = ""; search(); }
  });
  results.addEventListener("keydown", event => {
    const buttons = [...results.querySelectorAll("button")], index = buttons.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
    if (event.key === "Escape") { event.stopPropagation(); input.focus(); input.value = ""; search(); }
  });
  host.addEventListener("click", event => {
    const add = event.target.closest("[data-pick-employee]"), remove = event.target.closest("[data-remove-employee]");
    if (add) { if (!multiple) selected.clear(); selected.add(add.dataset.pickEmployee); input.value = ""; }
    else if (remove) selected.delete(remove.dataset.removeEmployee);
    else return;
    renderSelected(); search(); input.focus(); clearInvalidField(input);
  });
  renderSelected();
}

async function editTaskMembers() {
  await loadCatalogReferences();
  const workspace=state.workspace,run=workspace.run;
  const members=workspaceAgents(workspace,state.agents);
  const locked=new Set([run.manager.id,...workspace.traces.filter(t=>t.status==='running').map(t=>t.agentId),...(workspace.dispatches || []).filter(d=>!['done','cancelled'].includes(d.status)).map(d=>d.recipientAgentId)]);
  openModal(`<h2>${$t("任务成员")}</h2><form id="task-members-form"><div id="run-member-picker"></div><p class="field-hint">${$t("保留当前经理；正在执行、等待处理或回复的成员暂不能移除。")}</p><p role="alert" data-member-error></p><div class="form-actions"><button class="ghost-button" type="button" data-close-modal>${$t("取消")}</button><button class="primary-button" type="submit">${$t("保存")}</button></div></form>`);
  const catalog=[...members,...state.agents.filter(a=>a.status==='active'&&a.id!==run.manager.sourceAgentId&&!members.some(m=>m.id===a.id))];
  const selection=createEmployeeMultiSelect($('#run-member-picker'),{id:'run-members',label:$t("数字员工"),placeholder:$t("添加员工"),esc,items:catalog,selectedIds:members.map(a=>a.id),lockedIds:[...locked],lockReason:id=>id===run.manager.id?$t("必须保留当前项目经理"):$t("此员工有尚未结束的执行或交接"),detail:agent=>`<small>${esc(agent.description || '')}</small>`});
  $('#task-members-form').onsubmit=async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;
    try{await api(`/api/runs/${run.id}/members`,{method:'PUT',body:JSON.stringify({memberAgentIds:selection.value()})});closeModal();await loadWorkspace(run.id);toast($t("任务成员已更新。"));}
    catch(error){$('[data-member-error]').textContent=error.message;button.disabled=false;}
  };
}

async function teamModal(existing = null) {
  await loadCatalogReferences();
  openModal(`
    <h2>${existing ? $t("编辑团队") : $t("创建团队")}</h2>
    <form id="team-form" novalidate>
      <div class="form-field"><label for="team-name">${$t("团队名称")} <b>*</b></label><input id="team-name" name="name" value="${esc(existing?.name || "")}" placeholder="${$t("例如：产品交付组")}" /><div class="field-error"></div></div>
      <div class="form-field"><label for="team-mission">${$t("团队使命")}</label><textarea id="team-mission" name="mission" rows="2">${esc(existing?.mission || "")}</textarea></div>
      <div class="form-field"><div id="team-members-picker"></div><div class="field-error"></div></div>
      <label class="directory-enabled-control team-enabled-control"><input type="checkbox" data-enabled-toggle ${!existing || existing.status==='active'?'checked':''}><span><strong>${$t("启用此团队")}</strong><small>${$t("停用后不在新任务的团队列表中显示")}</small></span></label><input type="hidden" name="status" value="${existing?.status==='inactive'?'inactive':'active'}">
      <div class="form-actions"><button type="button" class="ghost-button" data-close-modal>${$t("取消")}</button><button type="submit" class="primary-button">${existing ? $t("保存修改") : $t("创建团队")}</button></div>
    </form>`);
  const form = $("#team-form"); form.closest('.modal').classList.add('team-config-modal');
  form.querySelector('[data-enabled-toggle]').onchange=event=>{form.elements.status.value=event.target.checked?'active':'inactive';};
  const selection = createEmployeeMultiSelect($('#team-members-picker'), { id:'team-members', label:$t("团队员工"), placeholder:$t("搜索并添加员工"), esc, items:state.agents, selectedIds:existing?.memberAgentIds || [], detail: agent => `<small>${esc(agent.description || $t("数字员工@@item"))}</small>` });
  form.addEventListener('submit', async event => {
    event.preventDefault(); clearInvalid(form);
    if (!form.name.value.trim()) { setInvalid(form.name, $t("请填写团队名称。")); return; }
    try {
      await api(existing ? `/api/teams/${existing.id}` : '/api/teams', { method:existing ? 'PUT' : 'POST', body:JSON.stringify({name:form.name.value,mission:form.mission.value,memberAgentIds:selection.value(),status:form.elements.status.value}) });
      closeModal(); toast($t("团队已保存。")); await refresh();
    } catch(error) { toast(error.message,true); }
  });
}

const newTeamModal = () => teamModal();

const automationUI = createAutomationUI({ api, esc, pill, exactTime, toast, catalog: () => state, showWorkflow: workflowDetails, headerActions:$('#automations-header-actions'),
  edit: (existing, { draft } = {}) => newTaskModal({ automation: true, existing, draft }),
  navigate: id => { state.automationId=id; setView("automations"); },
  openRun: runId => { state.selectedRunId=runId; state.workspace=null; setView("workspace"); void loadWorkspace(runId); },
  confirmDelete: (item, remove) => { openModal(`<h2>${$t("删除自动化")}</h2><p>${$t("永久删除「{0}」及全部触发记录和对应任务？正在执行的任务会先终止，此操作无法撤销。", [esc(item.title)])}</p><div class="form-actions"><button class="ghost-button" data-close-modal>${$t("取消")}</button><button class="danger-button" id="confirm-auto-delete">${$t("删除")}</button></div>`); $('#confirm-auto-delete').onclick=async event=>{event.currentTarget.disabled=true;try{await remove();closeModal();}catch(error){toast(error.message,true);if($('#confirm-auto-delete'))$('#confirm-auto-delete').disabled=false;}}; }
});

/* ---------- 全局交互 ---------- */
document.addEventListener("toggle", event => {
  const folder=event.target;
  if(folder.isConnected && folder.hasAttribute?.('data-directory-path')){
    const path=folder.dataset.directoryPath,view=workspaceView();view.directoryOpen[path]=folder.open;
    if(folder.open && !view.directoryPages?.[path])void loadWorkingDirectory(state.selectedRunId,{path});
  }
  const stream = event.target.closest?.('#trace-stream, [data-communication-stream]');
  if (stream) observeConsoleContent(stream);
}, true);

function render() {
  renderShell();
  const views = { inbox: renderInbox, overview: renderOverview, tasks: renderTasks, teams: renderTeams, workflows: renderWorkflows, agents: renderAgents, roles: renderRoles, manual: renderManual, workspace: renderWorkspace };
  if (state.currentView === "automations") automationUI.mount($("#automations-root"),state.automationId);
  if (state.currentView === "communication") communicationUI.mount($("#communication-root"), state, state.selectedChatId);
  if (state.currentView === "settings") settingsUI.mount($("#settings-root"), state.settingsPage);
  if (state.currentView === "mcp-marketplace") mcpMarketplaceUI.mount($("#mcp-marketplace-root"));
  if (state.currentView === "marketplace") marketplaceUI.mount($("#marketplace-root"));
  views[state.currentView]?.();
}

// Modules (marketplace, automations) publish counts on their view; keep the titlebar in step.
const titleCountObserver = new MutationObserver(renderTitleCount);
for (const view of document.querySelectorAll("main.main-content > .view")) titleCountObserver.observe(view, { attributes: true, attributeFilter: ["data-title-count", "class"] });
$("#agents-role-filter").addEventListener("change", () => { state.listPages.agents = 1; queryDirectorySoon(); });
$("#agents-search").addEventListener("input", () => {
  state.listPages.agents = 1;
  queryDirectorySoon();
});
for (const [key, render] of [["teams", renderTeams], ["workflows", renderWorkflows], ["roles", renderRoles]]) $("#" + key + "-search").addEventListener("input", () => {
  state.listPages[key] = 1;
  queryDirectorySoon();
});
function queryTaskDirectory() {
  const fields = new FormData($('#task-search-form'));
  state.taskSearch = { name:String(fields.get('name') || ''), status:String(fields.get('status') || 'all'), workflow:String(fields.get('workflow') || 'all') };
  state.listPages[state.taskArchiveView ? 'archive' : 'tasks'] = 1;
  queryDirectorySoon();
}
document.addEventListener('input', event => {
  if (event.target.matches('#task-search-form input[name=name]')) queryTaskDirectory();
});
document.addEventListener('change', event => {
  if (event.target.matches('#task-search-form select')) { state.taskChip = 'all'; queryTaskDirectory(); }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'task-search-form') { event.preventDefault(); queryTaskDirectory(); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && event.target.closest('.task-filter-control')) {
    event.preventDefault(); event.stopPropagation();
    closeFloatingLists(event.target.closest('.task-filter-control'));
    $('[data-task-filters]').focus();
  }
});

// Drawers are non-modal, so their outside clicks target the directory, not the
// dialog backdrop. Keep nested top-layer popovers inside the drawer's DOM scope.
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !$("#modal-backdrop").open) return;
  const drawer = $("#modal-backdrop .detail-drawer");
  if (drawer && !drawer.contains(event.target)) closeModal();
}, {capture:true});
document.addEventListener("click", (event) => {
  const el = (selector) => event.target.closest(selector);
  let target;
  const taskCard = event.target.closest('#tasks-table .task-row, #tasks-table .board-task');
  if (taskCard && !event.target.closest('button,a,input,summary,details')) { taskCard.querySelector('.task-title-link,h4 button')?.click(); return; }
  if ((target = el('[data-task-filters]'))) {
    const list = $('#task-filter-panel');
    const popup = createFloatingList(target,list,{minWidth:240,onClose:()=>target.setAttribute('aria-expanded','false')});
    if (target.getAttribute('aria-expanded') === 'true') popup.close();
    else { target.setAttribute('aria-expanded','true'); popup.open(); list.querySelector('select').focus(); }
    return;
  }
  if ((target = el('[data-task-chip]'))) {
    state.taskChip = target.dataset.taskChip; state.taskSearch.status = 'all';
    $('#task-search-form select[name=status]').value = 'all'; state.listPages.tasks = 1;
    return setView('tasks', {taskArchiveView:false});
  }
  if ((target = el('[data-task-layout]'))) { state.taskLayout=target.dataset.taskLayout; renderTasks(); return; }
  if ((target = el('[data-command-palette]'))) return openCommandPalette();
  if ((target = el('[data-sidebar-new-task]'))) return newTaskModal();
  if ((target = el('[data-toggle-sidebar]'))) return toggleSidebar();
  if ((target = el('[data-inbox-view]'))) { state.inboxReceipt = null; state.inboxView = target.dataset.inboxView; state.inboxSelection = null; void refreshInbox().then(renderInbox); return; }
  if ((target = el('[data-inbox-page]'))) { state.inboxPages ||= {}; state.inboxPages[target.dataset.inboxStatus] = Number(target.dataset.inboxPage); void refreshInbox().then(renderInbox); return; }
  if ((target = el('[data-inbox-select]'))) { state.inboxReceipt = null; state.inboxSelection = target.dataset.inboxSelect; renderInbox(); return; }
  if ((target = el('[data-inbox-retry]'))) { void refreshInbox().then(renderInbox); return; }
  if ((target = el('[data-inbox-confirm]'))) { const runId=target.dataset.inboxConfirm; target.disabled=true; void api(`/api/runs/${encodeURIComponent(runId)}/workspace?view=compact`).then(workspace=>{if(target.isConnected && state.currentView==='inbox' && !$('#modal-backdrop').open)openCompletionModal(runId,workspace);}).catch(error=>toast(error.message,true)).finally(()=>{if(target.isConnected)target.disabled=false;}); return; }
  if ((target = el('[data-inbox-artifact]'))) { const {runId,inboxArtifact}=target.dataset; target.disabled=true; void api(`/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(inboxArtifact)}/content`).then(file=>{if(target.isConnected && state.currentView==='inbox' && !$('#modal-backdrop').open)openModal(`<h2>${esc(file.artifact.name)}</h2><p class="modal-intro">${$t("已保存的交付快照")}</p><pre class="inbox-artifact-content">${esc(file.content || $t("该文件没有可显示的文本内容。"))}</pre>`);}).catch(error=>toast(error.message,true)).finally(()=>{if(target.isConnected)target.disabled=false;}); return; }
  if ((target = el('[data-agent-detail]'))) { const agent = state.agents.find(item => item.id === target.dataset.agentDetail); if(agent)void showEmployeeDetail(agent,{drawer:true}); return; }
  if ((target = el('[data-employee-layout]'))) { state.employeeLayout=target.dataset.employeeLayout;renderAgents();return; }
  if ((target = el('[data-agent-status]'))) { const button=target;button.disabled=true;void api(`/api/agents/${encodeURIComponent(button.dataset.agentStatus)}`,{method:'PUT',body:JSON.stringify({status:button.dataset.status})}).then(async()=>{toast(button.dataset.status==='active'?$t("员工已启用。"):$t("员工已停用。"));await refresh();}).catch(error=>toast(error.message,true)).finally(()=>{if(button.isConnected)button.disabled=false;});return; }
  if ((target = el('[data-retry-directory]'))) return refresh({quiet:false});
  if ((target = el("[data-pagination] [data-page]"))) { const key = target.closest("[data-pagination]").dataset.pagination; state.listPages[key] = Number(target.dataset.page); if(directoryResources[key]||key==="archive")refreshDirectory({paint:true}).catch(error=>toast(error.message,true)); return; }
  if ((target = el("[data-chat-agent]"))) return communicationUI.open("agent", target.dataset.chatAgent);
  if ((target = el("[data-chat-team]"))) return communicationUI.open("team", target.dataset.chatTeam);
  if ((target = el('[data-new-team-task]'))) return newTaskModal({teamId:target.dataset.newTeamTask});
  if ((target = el("#logout-button"))) {
    target.disabled = true; target.textContent = $t("退出中…");
    api("/api/auth/logout", { method: "POST", body: "{}" }).then(() => location.replace("/login")).catch(error => { toast(error.message, true); target.disabled = false; target.textContent = $t("退出登录"); });
    return;
  }
  if ((target = el("[data-send-instruction]"))) {
    event.preventDefault();
    return sendInstruction({ preventDefault() {}, currentTarget: target.closest("form") });
  }
  if ((target = el(".nav-item[data-view]"))) { if(target.dataset.view === "automations")state.automationId=null; return setView(target.dataset.view, { taskArchiveView: target.dataset.view === "tasks" ? false : state.taskArchiveView }); }
  if ((target = el("[data-goto]"))) return setView(target.dataset.goto, { taskArchiveView: target.dataset.goto === "tasks" ? false : state.taskArchiveView });
  if ((target = el("[data-open-runtime-settings]"))) { state.settingsPage = "runtime"; return setView("settings"); }
  if ((target = el("[data-manual-page]"))) {
    state.manualPage = target.dataset.manualPage;
    return setView("manual");
  }
  if ((target = el("[data-manual-next]"))) {
    event.preventDefault();
    state.manualPage = state.manualPage === "data-model" ? "system-architecture" : state.manualPage === "system-architecture" ? "task-flow" : "data-model";
    return setView("manual");
  }
  if((target=el('[data-workflow-view]'))) {
    const {scope,key,workflowView:action}=target.dataset;
    if(action==='format'){const button=target;button.disabled=true;void formatWorkflowGraph(scope,key).catch(error=>toast(error.message,true)).finally(()=>{if(button.isConnected)button.disabled=false;});return;}
    if(action==='fit')return fitWorkflowGraph(scope,key);
    if(action==='reset')return resetWorkflowGraph(scope,key);
    return zoomWorkflowGraph(scope,key,action==='zoom-in'?.16:-.16);
  }
  if ((target = el("[data-diagram-action]"))) {
    const key = target.dataset.diagramKey;
    const update = (scale) => { const label = $(`[data-diagram-scale="${key}"]`); if (label) label.textContent = `${Math.round(scale * 100)}%`; };
    if (target.dataset.diagramAction === "fit") return fitManualGraph(key, update);
    return zoomManualGraph(key, target.dataset.diagramAction === "zoom-in" ? .16 : -.16, update);
  }
  if ((target = el('[data-action="new-task"]'))) return newTaskModal();
  if ((target = el('[data-action="new-team"]'))) return newTeamModal();
  if ((target = el('[data-action="new-workflow"]'))) return workflowModal();
  if ((target = el('[data-action="new-agent"]'))) return newAgentModal();
  if ((target = el('[data-action="new-role"]'))) return newRoleModal();
  if ((target = el("[data-edit-role]"))) {
    const role = state.directoryPages?.roles?.items.find((item) => item.id === target.dataset.editRole);
    return role ? roleModal(role) : toast($t("角色不存在，请刷新列表。"), true);
  }
  if ((target = el('[data-clone-role]'))) { const role=state.directoryPages?.roles?.items.find(item=>item.id===target.dataset.cloneRole);return role?roleModal(null,{draft:{...role,name:$t("{0} 副本", [role.name])}}):toast($t("角色不存在，请刷新列表。"),true); }
  if ((target = el("[data-delete-role]"))) return configurationDeletionModal("role", target.dataset.deleteRole);
  if ((target = el("[data-edit-agent]"))) {
    const agent = state.directoryPages?.agents?.items.find((item) => item.id === target.dataset.editAgent);
    return agent ? agentModal(agent) : toast($t("数字员工不存在。"), true);
  }
  if ((target = el('[data-clone-agent]'))) { const agent=state.directoryPages?.agents?.items.find(item=>item.id===target.dataset.cloneAgent);return agent?agentModal(null,{draft:{...agent,name:$t("{0} 副本", [agent.name])}}):toast($t("数字员工不存在，请刷新列表。"),true); }
  if ((target = el("[data-edit-team]"))) {
    const team = state.directoryPages?.teams?.items.find((item) => item.id === target.dataset.editTeam);
    return team ? teamModal(team) : toast($t("团队不存在。"), true);
  }
  if ((target = el("[data-delete-agent]"))) return configurationDeletionModal("agent", target.dataset.deleteAgent);
  if ((target = el("[data-delete-team]"))) return configurationDeletionModal("team", target.dataset.deleteTeam);
  if ((target = el("[data-edit-workflow]"))) {
    closeModal();
    const workflow = state.directoryPages?.workflows?.items.find((item) => item.id === target.dataset.editWorkflow);
    return workflow ? workflowModal(workflow) : toast($t("工作流不存在。"), true);
  }
  if ((target = el("[data-workflow-details]"))) {
    const workflow = state.directoryPages?.workflows?.items.find((item) => item.id === target.dataset.workflowDetails);
    return workflow ? workflowDetails(workflow) : toast($t("工作流不存在。"), true);
  }
  if ((target = el("[data-delete-workflow]"))) {
    const workflow = state.directoryPages?.workflows?.items.find((item) => item.id === target.dataset.deleteWorkflow);
    if (!workflow) return;
    return confirmDialog({ title: $t("删除工作流"), message: $t("删除工作流「{0}」？该操作不可恢复。", [workflow.name]), confirmLabel: $t("删除工作流"), danger: true })
      .then((accepted) => accepted ? api(`/api/workflow-templates/${workflow.id}`, { method: "DELETE" }).then(async () => { toast($t("工作流已删除。")); await refresh(); }).catch((error) => toast(error.message, true)) : undefined);
  }
  if ((target = el("[data-close-modal]")) || event.target.id === "modal-close") return closeModal();
  if (event.target.id === "modal-backdrop" && modalAllowsLightDismiss()) return closeModal();
  if (event.target.id === "notify-button") return toast($t("通知中心即将支持。"));
  if ((target = el("#live-indicator"))) return toast(state.eventSource ? $t("当前任务已连接实时同步。") : $t("尚未连接任务实时同步。"));
  if ((target = el("[data-open-run]"))) {
    state.selectedAgentId = null;
    state.selectedRunId = target.dataset.openRun;
    setView("workspace");
    return loadWorkspace(target.dataset.openRun);
  }
  if ((target = el("[data-open-task]"))) {
    const run = runOfTask(target.dataset.openTask);
    state.selectedAgentId = null;
    state.selectedRunId = run?.id || null;
    setView("workspace");
    return run ? loadWorkspace(run.id) : renderWorkspace();
  }
  if ((target = el("[data-run-task]"))) return runTask(target.dataset.runTask);
  if ((target = el('[data-edit-task]'))) return editTaskDraft(target.dataset.editTask);
  if ((target = el("[data-task-center-page]"))) return setView("tasks", { taskArchiveView: target.dataset.taskCenterPage === "archive" });
  if ((target = el("[data-archive-task]"))) {
    const task = state.tasks.find((item) => item.id === target.dataset.archiveTask);
    if (!task) return;
    return confirmDialog({ title: $t("归档任务"), message: $t("归档已完成任务「{0}」？它会从默认列表移入归档历史，全部交付记录仍可查看。", [task.title]), confirmLabel: $t("归档任务") })
      .then((accepted) => accepted ? api(`/api/tasks/${task.id}/archive`, { method: "POST", body: "{}" }).then(async () => { toast($t("任务已归档，交付记录已保留。")); await refresh(); }).catch((error) => toast(error.message, true)) : undefined);
  }
  if ((target = el("[data-unarchive-task]"))) return api(`/api/tasks/${target.dataset.unarchiveTask}/unarchive`, { method: "POST", body: "{}" }).then(async () => { toast($t("任务已恢复到任务中心。")); await refresh(); }).catch((error) => toast(error.message, true));
  if ((target = el("[data-delete-task]"))) return openDeleteTaskModal(target.dataset.deleteTask);
  if ((target = el("[data-task-mention]"))) { const input = $("#instruction-text"); input.focus(); input.setRangeText("@", input.selectionStart, input.selectionEnd, "end"); input.dispatchEvent(new Event("input", {bubbles:true})); return; }
  if ((target = el("[data-close-task-details]"))) { workspaceView().detailsByTab ||= {}; workspaceView().detailsByTab[workspaceView().tab] = false; renderWorkspace(); $("[data-toggle-task-details]")?.focus(); return; }
  if ((target = el("[data-toggle-task-details]"))) { workspaceView().detailsByTab ||= {}; workspaceView().detailsByTab[workspaceView().tab] = !workspaceView().detailsOpen; return renderWorkspace(); }
  if ((target = el("[data-toggle-task-description]"))) { workspaceView().descriptionExpanded = !workspaceView().descriptionExpanded; return renderWorkspace(); }
  if ((target = el("[data-edit-task-members]"))) return editTaskMembers();
  if ((target = el("[data-task-member-console]"))) { state.selectedAgentId=target.dataset.taskMemberConsole;workspaceView().tab='console';workspaceView().jumpLatest=true;return renderWorkspace(); }
  if ((target = el("[data-task-member-detail]"))) { const member=workspaceAgents(state.workspace,state.agents).find(a=>a.id===target.dataset.taskMemberDetail);if(member)void showEmployeeDetail({...member,taskRole:member.id===state.workspace.run.manager.id ? "manager" : "member"});return; }
  if ((target = el("[data-task-workflow-details]"))) return workflowDetails(state.workspace.run.task.workflowSnapshot, { frozen: true });
  if ((target = el("[data-ws-tab]"))) { workspaceView().jumpLatest = true; workspaceView().tab = target.dataset.wsTab; renderWorkspace(); if(target.dataset.wsTab==='collaboration')return loadCollaboration().catch(error=>toast(error.message,true)); if (target.dataset.wsTab === "diff" && workspaceView().changes && !workspaceView().changesLoading) return loadWorkingChanges(state.selectedRunId); if (target.dataset.wsTab === "directory" && workspaceView().directory && !workspaceView().directoryLoading) return loadWorkingDirectory(state.selectedRunId); return; }
  if ((target = el("[data-reload-workspace]"))) return loadWorkspace();
  if ((target = el('[data-retry-collaboration]'))) return loadCollaboration(undefined,{older:Boolean(workspaceView().collaborationRetryOlder)});
  if ((target = el("[data-load-directory]"))) return loadWorkingDirectory(state.selectedRunId,{path:target.dataset.loadDirectory});
  if ((target = el("[data-load-more-directory]"))) return loadWorkingDirectory(state.selectedRunId,{path:target.dataset.loadMoreDirectory,more:true});
  if ((target = el("[data-console-older]"))) return loadConsolePage(state.selectedRunId, state.selectedAgentId, { older: true });
  if ((target = el("[data-console-reset]"))) return loadConsolePage(state.selectedRunId, state.selectedAgentId, { reset: true, traceId: null });
  if ((target = el("[data-console-retry]"))) return loadConsolePage(state.selectedRunId, state.selectedAgentId, { older: consolePage(state.selectedRunId, state.selectedAgentId).loaded });
  if ((target = el("[data-back-to-tasks]"))) { if(state.workspace?.run.task.kind === "automation") { state.automationId=state.workspace.run.task.automationId; return setView("automations"); } return setView("tasks"); }
  if ((target = el("[data-open-acceptance-directory]"))) { workspaceView().tab = "directory"; return renderWorkspace(); }
  if ((target = el("[data-select-working-file]"))) return loadWorkingFile(state.selectedRunId, target.dataset.selectWorkingFile);
  if ((target = el("[data-download-working-file]"))) return downloadWorkingFile(state.selectedRunId);
  if ((target = el("[data-select-diff]"))) return loadWorkingDiff(state.selectedRunId, target.dataset.selectDiff);
  if ((target = el("[data-diff-layout]"))) { workspaceView().diffLayout = target.dataset.diffLayout; return renderWorkingChanges(state.selectedRunId); }
  if ((target = el("[data-diff-scope]"))) { const view = workspaceView(); view.diffFull = target.dataset.diffScope === 'full'; return view.selectedDiffPath ? loadWorkingDiff(state.selectedRunId, view.selectedDiffPath) : renderWorkingChanges(state.selectedRunId); }
  if ((target = el("[data-refresh-changes]"))) return loadWorkingChanges(state.selectedRunId);
  if ((target = el("[data-refresh-directory]"))) return loadWorkingDirectory(state.selectedRunId);
  if ((target = el("[data-expand-collaboration-body]"))) {
    const body = target.closest("[data-collaboration-body]"), expanded = !body.classList.contains("is-expanded");
    body.classList.toggle("is-expanded", expanded);
    target.setAttribute("aria-expanded", String(expanded)); target.textContent = expanded ? $t("收起") : $t("展开全文");
    workspaceView().disclosures["body:" + body.dataset.collaborationBody] = expanded;
    return;
  }
  if ((target = el("[data-collaboration-latest]"))) { workspaceView().jumpLatest=true;return loadCollaboration(undefined,{latest:true}).catch(error=>toast(error.message,true)); }
  if ((target = el('[data-clear-reply]'))) { workspaceView().replyToMessageId='';workspaceView().sendRequest=null; renderWorkspace(); $('#instruction-text')?.focus({preventScroll:true}); return; }
  if ((target = el("[data-answer-message]"))) { workspaceView().replyToMessageId = target.dataset.answerMessage;workspaceView().sendRequest=null; renderWorkspace(); $("#instruction-text").focus({ preventScroll: true }); return; }
  if ((target = el("[data-open-collaboration-trace]"))) { void openCollaborationTurn(target.dataset.openCollaborationTrace, target.dataset.startMessageId); return; }
  if ((target = el("[data-open-acceptance-review]"))) { const trace = state.workspace?.traces.find((item) => item.id === target.dataset.openAcceptanceReview); if (!trace) return toast($t("经理交接记录在当前 Run 中不可读取。"), true); state.selectedAgentId = trace.agentId; workspaceView().jumpLatest = true; workspaceView().tab = "console"; loadConsolePage(state.selectedRunId, trace.agentId, { reset: true, traceId: trace.id }); renderWorkspace(); return; }
  if ((target = el("[data-console-latest]"))) { workspaceView().jumpLatest = true; workspaceView().tab = "console"; loadConsolePage(state.selectedRunId, state.selectedAgentId, { reset: true, traceId: null }); renderWorkspace(); const stream = $("#trace-stream"); followConsoleLatest(stream); return; }
  if ((target = el("[data-collaboration-older]"))) {loadCollaboration(state.selectedRunId,{older:true}).catch(error=>toast(error.message,true));return;}
  if ((target = el("[data-select-agent]"))) { state.selectedAgentId = target.dataset.selectAgent; workspaceView().jumpLatest = true; return renderWorkspace(); }
  if ((target = el("[data-mention-insert]"))) {
    const textarea = $("#instruction-text");
    if (!textarea || textarea.disabled) return;
    const upto = textarea.value.slice(0, textarea.selectionStart);
    const prefix = upto.replace(/@[^\s@]{0,12}$/, `@${target.dataset.mentionInsert} `);
    textarea.value = prefix + textarea.value.slice(textarea.selectionStart);
    textarea.setSelectionRange(prefix.length, prefix.length);
    workspaceView().draft = textarea.value;
    workspaceView().draftRevision=(workspaceView().draftRevision || 0)+1;workspaceView().sendRequest=null;
    textarea.focus();
    $("#mention-list")?.classList.remove("show");
    closeFloatingList($("#mention-list"));
    return;
  }
  if ((target = el("[data-open-workspace-directory]"))) {
    const button = target;
    button.disabled = true;
    Promise.resolve().then(() => {
      if (!window.batonDesktop?.openWorkspaceDirectory) throw new Error($t("客户端打开目录接口不可用，请重新打开应用。"));
      return window.batonDesktop.openWorkspaceDirectory();
    }).catch(error => { toast(error.message || $t("打开工作目录失败，请重试。"), true); })
      .finally(() => { button.disabled = false; });
    return;
  }
  if ((target = el("[data-copy]"))) {
    const button = target;
    button.disabled = true;
    const copy = window.batonDesktop?.copyWorkspacePath
      ? () => window.batonDesktop.copyWorkspacePath(button.dataset.copy)
      : () => navigator.clipboard?.writeText ? navigator.clipboard.writeText(button.dataset.copy) : Promise.reject(new Error($t("当前环境不支持剪贴板")));
    Promise.resolve().then(copy).then(() => {
      button.textContent = $t("已复制");
      toast($t("已复制工作目录的绝对路径。"));
      setTimeout(() => { if (button.isConnected) button.textContent = $t("复制"); }, 2000);
    }).catch(() => { button.textContent = $t("重试"); toast($t("复制失败，请重试。"), true); })
      .finally(() => { button.disabled = false; });
    return;
  }
  if ((target = el("[data-open-completion-confirm]"))) return openCompletionModal(target.dataset.openCompletionConfirm);
  if ((target = el("[data-retry-scheduled]"))) return retryScheduledWorkspace(target.dataset.retryScheduled);
  if ((target = el("[data-retry-failed-node]"))) return retryFailedWorkspace(target.dataset.retryFailedNode, target.dataset.workflowNodeId);
  if ((target = el("[data-retry-orchestration]"))) return retryFailedOrchestration(target.dataset.retryOrchestration);
  if ((target = el("[data-pause-run]"))) return pauseWorkspaceRun(target.dataset.pauseRun);
  if ((target = el("[data-resume-run]"))) return resumeWorkspaceRun(target.dataset.resumeRun);
  if ((target = el("[data-terminate-run]"))) return openTerminateModal(target.dataset.terminateRun);
});

document.addEventListener("input", (event) => {
  if (event.target.id !== "instruction-text") return;
  workspaceView().draft = event.target.value;
  /* @ 提及：光标前文本以 @xxx 结尾时弹出角色建议 */
  const list = $("#mention-list");
  if (!list || !state.workspace) return;
  const upto = event.target.value.slice(0, event.target.selectionStart);
  const match = upto.match(/@([^\s@]{0,12})$/);
  if (!match) { list.classList.remove("show"); closeFloatingList(list); return; }
  const items = mentionables(workspaceAgents(state.workspace, state.agents)).filter((item) => item.name.includes(match[1]));
  list.innerHTML = items.length ? items.map((item, index) => `
    <button type="button" class="mention-item ${index === 0 ? "selected" : ""}" aria-selected="${index === 0}" data-mention-insert="${esc(item.name)}">
      <span class="check-avatar color-${esc(item.color || "system")}">${esc(item.name.slice(0, 1))}</span>
      ${esc(item.name)}<small>${esc(item.description || "")}</small>
    </button>`).join("") : `<div class="mention-empty">${$t("没有匹配的角色")}</div>`;
  list.classList.add("show");
  createFloatingList(event.target,list,{onClose:()=>list.classList.remove('show')}).open();
});

$("#modal-backdrop").addEventListener('cancel', event => {
  event.preventDefault();
  if (modalAllowsLightDismiss()) closeModal();
});
let navigationPrefixAt = 0;
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing && event.target.closest('#task-form')) { event.preventDefault(); const button=$('#task-form button[value=start]');if(button && !button.disabled)button.click();return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.isComposing) { event.preventDefault(); if (!$('#modal-backdrop').open) openCommandPalette(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key === '\\' && !event.isComposing && !$('#modal-backdrop').open) { event.preventDefault(); toggleSidebar(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i' && state.currentView === 'workspace' && !$('#modal-backdrop').open) { event.preventDefault(); $('[data-toggle-task-details]')?.click(); return; }
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && !event.target.closest('input,textarea,select,[contenteditable=true]') && !$('#modal-backdrop').open) {
    if(event.key==='/'){const input=$('.view.active input[type=search]');if(input){event.preventDefault();input.focus();}return;}
    if (event.key.toLowerCase() === 'g') { navigationPrefixAt = Date.now(); return; }
    if (navigationPrefixAt && Date.now() - navigationPrefixAt < 1200) { navigationPrefixAt=0; const view = {i:'inbox',t:'tasks',e:'agents'}[event.key.toLowerCase()]; if(view){event.preventDefault();setView(view);return;} }
    if(event.key.toLowerCase()==='c'){event.preventDefault();newTaskModal(event.shiftKey?{automation:true}:{});return;}
    if(event.key.toLowerCase()==='m'){event.preventDefault();setView('communication');communicationUI.newConversation();return;}
    if(state.currentView==='workspace' && ['1','2','3'].includes(event.key)){event.preventDefault();$(['[data-ws-tab="collaboration"]','#directory-mode','#console-mode'][Number(event.key)-1])?.click();return;}
    if(['j','k'].includes(event.key)){const rows=$$('.view.active .task-title-link,.view.active [data-inbox-select],.view.active .employee-card h3 button');const index=rows.indexOf(document.activeElement);if(rows.length){event.preventDefault();rows[(index+(event.key==='j'?1:-1)+rows.length)%rows.length].focus();}return;}
  }
  if (event.target.id === "instruction-text" && !event.isComposing && event.keyCode !== 229) {
    const list = $("#mention-list");
    const items = list?.classList.contains("show") ? [...list.querySelectorAll("[data-mention-insert]")] : [];
    const modified = event.shiftKey || event.metaKey || event.altKey || event.ctrlKey;
    if (items.length && !modified && ["Enter", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      let index = Math.max(0, items.findIndex((item) => item.classList.contains("selected")));
      if (["Enter", "Tab"].includes(event.key)) items[index].click();
      else { index = (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; items.forEach((item, i) => { item.classList.toggle("selected", i === index); item.setAttribute("aria-selected", String(i === index)); }); items[index].scrollIntoView({ block: "nearest" }); }
      return;
    }
    if (event.key === "Enter") {
      if (modified) insertComposerLineBreak(event);
      else { event.preventDefault(); if (!state.workspace?.run.task.archivedAt) event.target.form.requestSubmit(); }
      return;
    }
  }
  if (event.key !== "Escape") return;
  if (state.currentView === "workspace" && workspaceView().detailsOpen && !$("#modal-backdrop").open && !$("#mention-list")?.classList.contains("show")) { $("[data-close-task-details]")?.click(); return; }
  if ($("#mention-list")?.classList.contains("show")) { $("#mention-list").classList.remove("show"); closeFloatingList($("#mention-list")); return; }
  $("#mention-list")?.classList.remove("show");
  if ($("#modal-backdrop").classList.contains("open") && modalAllowsLightDismiss()) closeModal();
});
window.matchMedia("(max-width: 1180px)").addEventListener("change", () => { if (state.currentView === "workspace" && state.workspace) renderWorkspace(); });
window.addEventListener("popstate", () => {
  const route = routeFromLocation();
  state.automationId = route.automationId || null;
  state.currentView = route.view;
  state.selectedChatId = route.chatId || null;
  state.selectedRunId = route.runId;
  state.manualPage = route.manualPage || "data-model";
  state.settingsPage = route.settingsPage || "general";
  state.taskArchiveView = Boolean(route.taskArchiveView);
  setView(route.view, { replace: true, taskArchiveView: state.taskArchiveView });
  if (route.view === "workspace" && route.runId) loadWorkspace(route.runId, { quiet: true });
});

/* ---------- 初始化：骨架屏 → bootstrap → 渲染 ---------- */
async function init() {
  // The static shell is translated once; dynamic views translate at render time.
  localizeStatic(document.body);
  if (location.pathname === "/settings") history.replaceState({}, "", "/settings/general");
  if (location.pathname === "/") history.replaceState({}, "", "/inbox");
  api("/api/auth/session").then(account => { $("#account-name").textContent = account.username; $(".user-card .user-avatar").textContent = initialsOf({ name: account.username }); }).catch(() => {});
  setInterval(() => { if (!resetRequestActive) api("/api/auth/session").catch(() => {}); }, 60000);
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const now = new Date();
  $("#hero-date").textContent = currentLocale() === "zh-CN"
    ? `${now.toLocaleDateString("zh-CN", { month: "long", day: "numeric" })} · 星期${days[now.getDay()]}`
    : now.toLocaleDateString(intlLocale(), { month: "long", day: "numeric", weekday: "long" });
  $("#stats-grid").innerHTML = Array.from({ length: 4 }, () =>
    '<div class="stat-card"><div class="skeleton" style="width:60px;height:10px">·</div><div class="skeleton" style="width:44px;height:26px;margin-top:10px">·</div><div class="skeleton" style="width:110px;height:9px;margin-top:9px">·</div></div>').join("");
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === (state.currentView === "workspace" ? "tasks" : state.currentView)));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === `${state.currentView}-view`));
  if(state.currentView==='tasks'){const key=state.taskArchiveView?'archive':'tasks';state.directoryStatus={[key]:{loading:true,error:null}};}
  render();
  const initialData = refresh();
  setInterval(refreshNavigation, 5000);
  // Reconcile a bounded tail after sleeps or missed SSE records without clearing the reader.
  const reconcileConsole = () => {
    if (document.visibilityState === 'hidden' || state.currentView !== 'workspace' || workspaceView().tab !== 'console' || !state.selectedAgentId) return;
    const page = consolePage(state.selectedRunId, state.selectedAgentId);
    if (page.loaded && !page.loading) void loadConsolePage(state.selectedRunId, state.selectedAgentId);
  };
  setInterval(reconcileConsole, 5000);
  document.addEventListener('visibilitychange', reconcileConsole);
  if (state.currentView === "workspace" && state.selectedRunId) await Promise.all([initialData, loadWorkspace(state.selectedRunId, { quiet: true })]);
  else if (state.currentView === "workspace") renderWorkspace();
}
init();
