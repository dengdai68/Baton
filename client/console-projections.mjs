import { $t, $tm, currentLocale, intlLocale } from "./i18n.mjs";
import {runtimeLabel} from "./runtime-providers.mjs";
// Browser-safe view models shared by Web and desktop hosts. These functions only
// project already-authoritative API payloads; they never own domain state.

// Server pages are in stable archive order. Keep adjacent pages together up to
// a fixed window; a missed live page must not silently bridge a history gap.
export function consoleEventWindow(current, incoming, { older = false, limit = 200 } = {}) {
  const currentIds = new Set(current.map(event => event.id));
  const reset = !older && current.length > 0 && incoming.length > 0 && !incoming.some(event => currentIds.has(event.id));
  const rows = [...new Map((older ? [...incoming, ...current] : [...(reset ? [] : current), ...incoming]).map(event => [event.id, event])).values()];
  return { events: older ? rows.slice(0, limit) : rows.slice(-limit), trimmedBefore: !older && rows.length > limit, reset };
}

// Validate JSON, then format its original tokens: parsing and re-stringifying
// would silently round large integers in tool output. Never interpret HTML.
export function consoleContentTokens(value, { json = true, truncated = false } = {}) {
  const text = String(value ?? "");
  const plain = { json: false, tokens: [{ kind: "plain", text }] };
  if (!json || truncated || text.length > 12000) return plain;
  try { JSON.parse(text); } catch { return plain; }
  const raw = text.match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g) || [];
  const tokens = [];
  let depth = 0;
  const add = (text, kind = "plain") => tokens.push({ kind, text });
  const newline = () => add("\n" + "  ".repeat(depth));
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (token === "{" || token === "[") {
      if (++depth > 40) return plain;
      add(token);
      if (!["}", "]"].includes(raw[i + 1])) newline();
    } else if (token === "}" || token === "]") {
      depth--;
      if (!["{", "["].includes(raw[i - 1])) newline();
      add(token);
    } else if (token === ",") { add(token); newline(); }
    else if (token === ":") add(": ");
    else add(token, token.startsWith('"') ? raw[i + 1] === ":" ? "attr" : "string" : /^(true|false|null)$/.test(token) ? "literal" : "number");
  }
  return { json: true, tokens };
}

export const STATUS_TEXT = {
  backlog: $t("草稿"), planning: $t("进行中"), running: $t("进行中"), awaiting_human: $t("等待你的澄清"),
  review: $t("进行中"), awaiting_acceptance: $t("待你验收"), paused: $t("已暂停"), done: $t("已完成"),
  blocked: $t("错误中断"), failed: $t("错误中断"), completed: $t("已完成"), cancelled: $t("已终止")
};

// Shell-like tools whose already-redacted input carries a real command line.
const SHELL_TOOL_NAMES = new Set(["bash", "shell", "command_execution", "exec", "local_shell", "terminal", "powershell", "cmd"]);

export function isShellTool(toolName) {
  return SHELL_TOOL_NAMES.has(String(toolName || "").toLowerCase());
}

// The raw multi-line command carried by a shell tool's redacted input. Same
// honesty rules as toolCommandSummary: unparseable (for example truncated)
// JSON and non-command fields return null rather than a fabricated fragment.
export function shellCommandText(toolName, inputText) {
  if (!isShellTool(toolName)) return null;
  const text = String(inputText ?? "").trim();
  if (!text) return null;
  let command = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.command === "string") command = parsed.command;
  } catch {
    // Codex command_execution input is the raw command string, not JSON.
    if (!text.startsWith("{") && !text.startsWith("[")) command = text;
  }
  return command && command.trim() ? command : null;
}

// Lightweight browser-safe Shell coloring for already-redacted commands and
// output. Tokens only re-segment the original text; joining every token's
// text must reproduce the input exactly so copying loses nothing.
export function shellTokens(value) {
  const text = String(value ?? "");
  const tokens = [];
  let index = 0, fresh = true; // fresh: start of a command position (line start or after a separator)
  const push = (kind, tokenText) => { if (tokenText) tokens.push({ kind, text: tokenText }); };
  while (index < text.length) {
    const rest = text.slice(index);
    let match = rest.match(/^\s+/);
    if (match) { push("plain", match[0]); fresh = fresh || match[0].includes("\n"); index += match[0].length; continue; }
    if (rest.startsWith("#")) {
      match = rest.match(/^#[^\n]*/);
      push("comment", match[0]); fresh = false; index += match[0].length; continue;
    }
    if (rest.startsWith('"') || rest.startsWith("'") || rest.startsWith("`")) {
      const quote = rest[0];
      match = rest.match(quote === "`" ? /^`[^`]*`?/ : quote === '"' ? /^"(?:\\.|[^"\\])*"?/ : /^'[^']*'?/);
      push("string", match[0]); fresh = false; index += match[0].length; continue;
    }
    match = rest.match(/^(?:&&|\|\||[|;&<>]|\(|\))/);
    if (match) { push("operator", match[0]); fresh = true; index += match[0].length; continue; }
    match = rest.match(/^-[^\s|;&<>()]*/);
    if (match && !fresh) { push("option", match[0]); index += match[0].length; continue; }
    match = rest.match(/^\$(?:\{[^}\n]*\}|\w+|\?)/);
    if (match) { push("variable", match[0]); fresh = false; index += match[0].length; continue; }
    match = rest.match(/^[^\s"'`$#|;&<>()]+/);
    if (match) { push(fresh ? "command" : "plain", match[0]); fresh = false; index += match[0].length; continue; }
    push("plain", rest[0]); index += 1;
  }
  return tokens;
}

// Curated vscode-icons subset vendored under web/icons/vscode/ (MIT, see the
// LICENSE and README beside the icons). Unknown names/extensions fall back to
// the default file/folder glyphs instead of guessing a brand logo.
const DIRECTORY_ICON_BY_NAME = new Map(Object.entries({
  ".gitignore": "file_type_git", ".gitattributes": "file_type_git", ".gitmodules": "file_type_git",
  "license": "file_type_text", "readme": "file_type_markdown", "changelog": "file_type_markdown",
}));
const DIRECTORY_ICON_BY_EXTENSION = new Map(Object.entries({
  md: "file_type_markdown", mdx: "file_type_markdown", markdown: "file_type_markdown",
  js: "file_type_js", mjs: "file_type_js", cjs: "file_type_js", jsx: "file_type_js",
  ts: "file_type_typescript", tsx: "file_type_typescript",
  json: "file_type_json", map: "file_type_json",
  css: "file_type_css", html: "file_type_html", htm: "file_type_html",
  py: "file_type_python",
  sh: "file_type_shell", bash: "file_type_shell", zsh: "file_type_shell",
  yml: "file_type_yaml", yaml: "file_type_yaml",
  png: "file_type_image", jpg: "file_type_image", jpeg: "file_type_image", gif: "file_type_image", webp: "file_type_image", svg: "file_type_image",
  txt: "file_type_text", log: "file_type_text",
  xml: "file_type_xml", sql: "file_type_sql",
  java: "file_type_java", go: "file_type_go", rs: "file_type_rust",
  c: "file_type_c", h: "file_type_c", cpp: "file_type_cpp", hpp: "file_type_cpp", cc: "file_type_cpp",
  vue: "file_type_vue", pdf: "file_type_pdf", zip: "file_type_binary", gz: "file_type_binary",
}));
export function workingDirectoryIcon(name, type) {
  if (type === "directory") return { closed: "default_folder", open: "default_folder_opened" };
  const base = String(name || "").split("/").filter(Boolean).at(-1) || "";
  const lower = base.toLowerCase();
  const stem = lower.replace(/\.[^.]*$/, "");
  const icon = DIRECTORY_ICON_BY_NAME.get(lower) || DIRECTORY_ICON_BY_NAME.get(stem) || DIRECTORY_ICON_BY_EXTENSION.get(lower.includes(".") ? lower.split(".").at(-1) : "") || "default_file";
  return { closed: icon, open: icon };
}

// Title summaries only restate console content the client already fetched and
// the runtime already redacted. Any parse failure (for example a truncated
// field) must fall back to no summary rather than show a fabricated fragment.
export function toolCommandSummary(toolName, inputText) {
  const name = String(toolName || "").toLowerCase();
  if (["read", "write"].includes(name)) return toolFileInput(toolName, inputText)?.filePath || null;
  if (!SHELL_TOOL_NAMES.has(name)) return null;
  const text = String(inputText ?? "").trim();
  if (!text) return null;
  let command = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && typeof parsed.command === "string") command = parsed.command;
  } catch {
    // Codex command_execution input is the raw command string, not JSON. A
    // truncated JSON payload starts with a brace and must not be shown as a
    // half command, so only clearly non-JSON text qualifies.
    if (!text.startsWith("{") && !text.startsWith("[")) command = text;
  }
  if (!command || !command.trim()) return null;
  return command.trim().replace(/\s*\r?\n\s*/g, " ⏎ ");
}

// Only interpret complete, already-redacted file-tool input. Never extract
// fragments from truncated JSON or infer content from the current filesystem.
export function toolFileInput(toolName, inputText) {
  if (!["read", "write"].includes(String(toolName || "").toLowerCase())) return null;
  let input;
  try { input = JSON.parse(String(inputText ?? "")); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const filePath = input.file_path ?? input.path;
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  return { filePath, content: typeof input.content === "string" ? input.content : null };
}

// Real Edit invocations carry file_path/old_string/new_string in their
// redacted input. Missing or non-string fields mean the record cannot support
// a truthful diff and the caller must fall back to the generic sections.
export function toolEditInput(toolName, inputText) {
  if (String(toolName || "") !== "Edit") return null;
  let parsed;
  try { parsed = JSON.parse(String(inputText ?? "")); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { file_path, old_string, new_string } = parsed;
  if (typeof old_string !== "string" || typeof new_string !== "string") return null;
  if (!old_string && !new_string) return null;
  return { filePath: typeof file_path === "string" ? file_path : "", oldText: old_string, newText: new_string };
}

// Line-oriented LCS diff for already-bounded Edit inputs (≤12,000 chars per
// field). Common prefixes/suffixes stay context; an oversized middle degrades
// to an honest deletions-then-additions block instead of expensive alignment.
export function editDiff(oldText, newText, { maxCells = 2000000 } = {}) {
  if (typeof oldText !== "string" || typeof newText !== "string") return null;
  const oldLines = oldText.split("\n"), newLines = newText.split("\n");
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let oldEnd = oldLines.length, newEnd = newLines.length;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd--; }
  const context = (text) => ({ type: "context", text });
  const removed = (text) => ({ type: "del", text });
  const added = (text) => ({ type: "add", text });
  const head = oldLines.slice(0, prefix).map(context);
  const tail = oldLines.slice(oldEnd).map(context);
  const oldMiddle = oldLines.slice(prefix, oldEnd), newMiddle = newLines.slice(prefix, newEnd);
  if (!oldMiddle.length && !newMiddle.length) return { aligned: true, lines: [...head, ...tail] };
  if (oldMiddle.length * newMiddle.length > maxCells) return { aligned: false, lines: [...head, ...oldMiddle.map(removed), ...newMiddle.map(added), ...tail] };
  const rows = oldMiddle.length, columns = newMiddle.length, width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) for (let j = columns - 1; j >= 0; j--) table[i * width + j] = oldMiddle[i] === newMiddle[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
  const middle = [];
  let i = 0, j = 0;
  while (i < rows && j < columns) {
    if (oldMiddle[i] === newMiddle[j]) { middle.push(context(oldMiddle[i])); i++; j++; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { middle.push(removed(oldMiddle[i])); i++; }
    else { middle.push(added(newMiddle[j])); j++; }
  }
  while (i < rows) middle.push(removed(oldMiddle[i++]));
  while (j < columns) middle.push(added(newMiddle[j++]));
  return { aligned: true, lines: [...head, ...middle, ...tail] };
}

// These categories are display-only. Store remains the authority for every
// Task/Run transition; clients use them only to make human next actions clear.
export const TASK_FILTERS = Object.freeze([
  { id: "all", label: $t("全部") },
  { id: "attention", label: $t("待你处理") },
  { id: "active", label: $t("执行中") },
  { id: "backlog", label: $t("草稿") },
  { id: "done", label: $t("已完成") },
  { id: "cancelled", label: $t("已终止") }
]);

const taskAttentionStatuses = new Set(["awaiting_human", "awaiting_acceptance", "paused", "blocked", "failed"]);
const taskActiveStatuses = new Set(["planning", "running", "review"]);
const terminalRunStatuses = new Set(["completed", "cancelled", "failed"]);

export function taskNeedsAttention(status) {
  return taskAttentionStatuses.has(status);
}

export function taskMatchesFilter(status, filter) {
  if (filter === "all") return true;
  if (filter === "attention") return taskNeedsAttention(status);
  if (filter === "active") return taskActiveStatuses.has(status);
  return status === filter;
}

export function taskActionLabel(status) {
  return {
    awaiting_human: $t("去澄清"),
    awaiting_acceptance: $t("去验收"),
    paused: $t("查看并继续"),
    blocked: $t("查看恢复选项"),
    failed: $t("查看恢复选项"),
    done: $t("查看结果"),
    cancelled: $t("查看记录")
  }[status] || $t("进入任务空间");
}

export const EVENT_KIND_LABEL = { output: $t("输出"), thinking: $t("推理片段"), tool: $t("工具调用"), deliver: $t("交付"), system: $t("系统") };

const asArray = (value) => Array.isArray(value) ? value : [];
const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function providerLabel(agent) {
  return runtimeLabel(agent?.runtime?.provider || "claude-code");
}

export function formatRelativeTime(iso, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return $t("刚刚");
  if (minutes < 60) return $t("{0} 分钟前", [minutes]);
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? $t("{0} 小时前", [hours]) : $t("{0} 天前", [Math.floor(hours / 24)]);
}

export function formatExactTime(iso) {
  return new Date(iso).toLocaleString(intlLocale(), { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatMessageTime(iso, now = new Date()) {
  if (!iso) return '';
  const day = new Date(iso);
  if (!Number.isFinite(day.getTime())) return '';
  const sameYear = day.getFullYear() === now.getFullYear();
  // zh-CN keeps the established "11月17日 14:05" wording; other locales use Intl.
  if (currentLocale() === 'zh-CN') return `${sameYear ? '' : `${day.getFullYear()}年`}${day.getMonth() + 1}月${day.getDate()}日 ${day.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit', hour12:false})}`;
  return day.toLocaleString(intlLocale(), { ...(sameYear ? {} : { year: 'numeric' }), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function classifyEvent(event = {}) {
  if (event.type === "node.completed") return "deliver";
  if (event.type !== "runtime.event") return "system";
  if (event.data?.presentation === "tool_result") return "tool";
  // Claude Code can label natural-language assistant content as thinking. It is
  // still visible output in a client console, not hidden model reasoning.
  if (event.data?.presentation === "thinking" && event.data?.providerEventType === "assistant") return "output";
  if (event.data?.presentation) return event.data.presentation;
  const type = String(event.data?.providerEventType || "").toLowerCase();
  if (type === "system") return "system";
  if (/tool|command|bash|exec|edit|write|read|patch|shell|stderr|stdout/.test(type)) return "tool";
  if (/think|reason/.test(type)) return "thinking";
  if (/result|complete|deliver|artifact/.test(type)) return "deliver";
  return "output";
}

export function displayText(event = {}) {
  const message = String(event.message || "");
  const type = event.data?.providerEventType;
  if (event.type === "runtime.event" && type) {
    const marker = ` · ${type}: `;
    const index = message.indexOf(marker);
    if (index !== -1) return message.slice(index + marker.length);
  }
  // Old audit records lack a provider event type. Only remove an exact actor
  // prefix so URLs, JSON and command text retain their leading content.
  const actorName = event.actor?.name;
  return actorName ? message.replace(new RegExp(`^${escapeRegExp(actorName)}(?: · [^:\n]+)?:\\s*`), "") : message;
}

export function isTransportFrame(event = {}) {
  if (event.data?.providerEventType === "stream_event") return true;
  const type = event.data?.providerEventType;
  if (event.type !== "runtime.event" || !type) return false;
  const text = displayText(event).trim();
  return text === type || /^(thinking_tokens|status|init|message_start|message_stop|content_block_start|content_block_stop)$/.test(text);
}

// Console content is not the full audit log. Suppress only known, empty
// bookkeeping notifications; never discard recorded bodies, tools, abnormal
// lifecycle events or unfamiliar messages. The source events stay untouched.
export function isRoutineConsoleEvent(event = {}) {
  const data = event.data || {};
  if (data.contentRef || ["tool", "tool_result", "error"].includes(data.presentation)) return false;
  if (/error|fail|cancel|reset|recover|retry|timeout|interrupt|escalat|blocked/i.test([event.type, data.providerEventType, data.subtype, data.status].join(" "))) return false;
  if (["session.created", "session.resumed", "communication.started", "communication.completed", "trace.started", "trace.completed", "trace.accepted"].includes(event.type)) return true;
  if (event.type !== "runtime.event" || data.auditVersion !== 2) return false;
  const type = data.providerEventType;
  if (type === "stderr" && data.presentation === "system") return true; // diagnostic text remains in the private log
  if (!["system", "thread.started", "turn.started", "turn.completed", "result", "item.started", "item.completed", "assistant", "tool_progress"].includes(type)) return false;
  const text = displayText(event).trim();
  // Task audits prefix their message with the exact Provider event type;
  // communication audits do not. Normalize that envelope, not business text.
  const summary = text.startsWith(`${type}: `) ? text.slice(type.length + 2) : text;
  return [$t("Provider 会话已初始化"), $t("成员会话已连接"), $t("Provider 已返回结构化结果"), $t("模型已更新执行进展"), $t("模型正在整理执行方案")].includes(summary);
}

export function workspaceAgents(workspace = {}, agents = [], { includeDeleted = false } = {}) {
  const run = workspace.run;
  if (!run) return [];
  const assigned = Array.isArray(run.participants)
    ? run.participants.filter((member) => member.type === "agent" && member.id !== run.manager?.id)
    : Object.values(run.task?.nodeAssignments || {}).map((agentId) => asArray(agents).find((agent) => agent.id === agentId));
  const members = new Map();
  for (const agent of [run.manager, ...assigned, ...asArray(workspace.traces).map((trace) => trace.agent)].filter(Boolean)) if (!members.has(agent.id)) members.set(agent.id, agent);
  const deleted = new Set(workspace.deletedAgentIds || []);
  return [...members.values()].filter(member => includeDeleted || (!deleted.has(member.sourceAgentId || member.id) && !(run.removedParticipantIds || []).includes(member.id)));
}

// A running Trace is an invocation fact, but a terminal Run is the lifecycle
// authority for the whole workspace. A late read model must not make a
// cancelled or completed Run look active. Failed Runs can have peers finishing.
export function roleExecutionStatus(run = {}, traces = [], agentId) {
  const agentTraces = asArray(traces).filter(trace => trace.agentId === agentId)
    .map((trace, index) => ({ trace, index }))
    .sort((a, b) => (Date.parse(a.trace.startedAt || a.trace.createdAt) || 0) - (Date.parse(b.trace.startedAt || b.trace.createdAt) || 0) || a.index - b.index)
    .map(item => item.trace);
  const traceCount=run.traceCounts?.[agentId]??agentTraces.length;
  const latest = agentTraces.at(-1), terminal = terminalRunStatuses.has(run.status);
  const activeTrace = (!terminal || run.status === "failed") && latest?.status === "running" ? latest : null;
  const failed = !activeTrace && latest?.status === "failed";
  const terminalLabel = terminal ? run.status === "failed" ? $t("已停止") : STATUS_TEXT[run.status] || run.status : null;
  return {
    active: Boolean(activeTrace), activeTrace, failed,
    state: activeTrace ? "running" : failed ? "error" : "idle",
    traceCount,
    label: activeTrace ? $t("● 执行中 · {0}", [activeTrace.workflowNodeId])
      : $t("{0} · {1} 条 Trace", [failed ? $t("● 错误") : `○ ${terminalLabel || $t("空闲")}`, traceCount]),
  };
}

export function workflowFocus(run = {}, traces = []) {
  const focus = {};
  for (const trace of asArray(traces)) if (trace.workflowNodeId && trace.agentId !== run.manager?.id) focus[trace.workflowNodeId] = trace.status === "running" ? "active" : "recent";
  if (run.waitingNodeId) focus[run.waitingNodeId] = run.status === "awaiting_human" ? "waiting_human" : "waiting_agent";
  if (run.currentFocus?.nodeId && !run.waitingNodeId && !asArray(traces).some((trace) => trace.workflowNodeId === run.currentFocus.nodeId && trace.status === "running")) focus[run.currentFocus.nodeId] = "current";
  return focus;
}

export function buildConsoleEntries(events = []) {
  const entries = [];
  const calls = new Map();
  for (const event of asArray(events)) {
    if (isRoutineConsoleEvent(event)) continue;
    if (classifyEvent(event) !== "tool") { entries.push({ type: "event", event }); continue; }
    const result = event.data?.presentation === "tool_result" || Boolean(event.data?.toolResultId);
    if (result) {
      const key = `${event.data?.traceId || ""}:${event.data?.toolResultId}`;
      const invocation = event.data?.toolResultId && calls.get(key);
      if (invocation) {
        if (invocation.event.data?.presentation === 'tool_result' || invocation.event.data?.toolResultId) invocation.event = event;
        else invocation.result = event;
      }
      else {
        const entry = { type: "tool", event, result: null };
        entries.push(entry);
        if (event.data?.toolResultId) calls.set(key, entry);
      }
      continue;
    }
    const key = `${event.data?.traceId || ""}:${event.data?.toolUseId}`;
    const previous = event.data?.toolUseId && calls.get(key);
    if (previous) {
      // Provider phases with the same native call ID are one invocation, not
      // repeated calls. Distinct IDs (even for the same tool) stay separate.
      if (previous.event.data?.presentation === 'tool_result') { previous.result = previous.event; previous.event = event; }
      else if (event.data?.contentRef) previous.event = event;
      continue;
    }
    const entry = { type: "tool", event, result: null };
    entries.push(entry);
    if (event.data?.toolUseId) calls.set(key, entry);
  }
  return groupConsecutiveToolEntries(entries);
}

function groupConsecutiveToolEntries(entries) {
  const grouped = [];
  let index = 0;
  while (index < entries.length) {
    const current = entries[index];
    if (current.type !== "tool") { grouped.push(current); index += 1; continue; }
    const toolName = current.event.data?.toolName || current.event.data?.providerEventType || $t("工具");
    if (toolName === "StructuredOutput") { grouped.push(current); index += 1; continue; }
    // A group is one visual run of identical calls within a single invocation;
    // merging across Trace boundaries would hide later invocations' entries.
    const traceId = current.event.data?.traceId || null;
    const tools = [current];
    let next = index + 1;
    while (next < entries.length) {
      const candidate = entries[next];
      const candidateName = candidate.type === "tool" ? (candidate.event.data?.toolName || candidate.event.data?.providerEventType || $t("工具")) : null;
      if (candidateName !== toolName || (candidate.event.data?.traceId || null) !== traceId) break;
      tools.push(candidate);
      next += 1;
    }
    grouped.push(tools.length > 1 ? { type: "tool-group", toolName, tools, timestamp: current.event.timestamp } : current);
    index = next;
  }
  return grouped;
}

export function mentionables(agents = []) {
  return [...new Map(asArray(agents).filter(Boolean).map((agent) => [agent.id, { id: agent.id, name: agent.name, color: agent.color }])).values()];
}

// The original Message remains an immutable execution fact. Only known worker
// result envelopes are projected into their recorded natural-language report.
function collaborationContent(message) {
  const content = message.content || "";
  if (message.kind !== "handoff" || message.sender?.type !== "agent") return content;
  let envelope;
  const source = content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  try { envelope = JSON.parse(source); } catch {
    // Some recorded handoffs contain unescaped prose quotes inside summary.
    // Recover only this closed two-field display shape, never routing fields.
    const match = source.match(/^\{\s*"summary"\s*:\s*"([\s\S]*)",\s*"handoff"\s*:\s*(\{[^{}]*\})\s*\}$/);
    if (!match) return content;
    try {
      const handoff = JSON.parse(match[2]);
      if (Object.keys(handoff).length !== 1 || typeof handoff.recipientAgentId !== 'string' || !handoff.recipientAgentId.trim()) return content;
      const report = JSON.parse('"' + match[1].replace(/\\[\s\S]|"/g, token => token === '"' ? '\\"' : token) + '"');
      return report.trim() ? report : content;
    } catch { return content; }
  }
  if (envelope && !Array.isArray(envelope) && typeof envelope.summary === 'string' && envelope.summary.trim() &&
      Object.keys(envelope).every(key => ['summary','handoff','managerDecision','consultation','deliveryReview','artifacts','decisions','kind','rawResponse'].includes(key)) &&
      ['handoff','managerDecision','consultation','deliveryReview'].some(key => envelope[key] && typeof envelope[key] === 'object' && !Array.isArray(envelope[key]))) return envelope.summary;
  if (!envelope || Array.isArray(envelope) || typeof envelope.rawResponse !== "string" ||
      !(typeof envelope.status === "string" || typeof envelope.node === "string" || envelope.kind === "node_result")) return content;
  const raw = envelope.rawResponse.trim();
  const report = raw.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (block, body) => {
    try {
      const value = JSON.parse(body);
      return value && !Array.isArray(value) && Object.keys(value).length && Object.entries(value).every(([key, item]) =>
        Object.hasOwn(envelope, key) && JSON.stringify(envelope[key]) === JSON.stringify(item)) ? "" : block;
    } catch { return block; }
  }).trim();
  if (report) {
    try { JSON.parse(report); } catch { return report; }
  }
  const facts = [["status", $t("状态")], ["verdict", $t("结论")], ["handoff", $t("交接文件")]]
    .filter(([key]) => typeof envelope[key] === "string")
    .map(([key, label]) => `${label}：${envelope[key]}`);
  return facts.length ? facts.join("\n\n") : $t("员工已提交结构化交接结果，详情见本轮控制台。");
}

export function collaborationRecords(workspace = {}) {
  const messages = asArray(workspace.messages), dispatches = asArray(workspace.dispatches);
  const traces = asArray(workspace.traces), events = asArray(workspace.events), run = workspace.run || {};
  const byMessage = new Map(messages.map(item => [item.id, item]));
  const byDispatch = new Map(dispatches.map(item => [item.id, item]));
  const byTrace = new Map(traces.map(item => [item.id, item]));
  const participants = asArray(run.participants), nodes = asArray(run.task?.workflowSnapshot?.nodes);
  const memberName = id => participants.find(item => item.id === id)?.name || (run.manager?.id === id ? run.manager.name : id);
  const time = value => Date.parse(value) || 0;
  const chronological = (a, b) => time(a.timestamp) - time(b.timestamp);
  const kinds = { inquiry: $t("人类咨询"), inquiry_answer: $t("答疑回复"), agent_consultation: $t("成员咨询"), clarification_question: $t("询问人类"), consultation_answer: $t("咨询答复"), clarification_answer: $t("人类答复"), human_instruction: $t("追加指令"), instruction: $t("追加指令"), handoff: $t("交接"), manager_decision: $t("经理决策"), escalation: $t("升级协调"), coordination_notice: $t("协调说明"), automatic_retry: $t("重试说明") };
  const purposes = { manager: $t("经理协调"), node: $t("节点派工"), consultation: $t("咨询投递"), instruction: $t("指令投递"), inquiry: $t("答疑投递"), delivery_review: $t("交付复核") };
  const eventTitles = { "dispatch.retry_scheduled": $t("安排重试"), "dispatch.retry_requested": $t("人类重试"), "dispatch.retry_stopped": $t("因失败停止"), "dispatch.escalated": $t("升级协调"), "dispatch.coordination_followups_settled": $t("协调投递结算"), "session.reset": $t("会话重建"), "run.completed": $t("人类确认完成"), "run.awaiting_acceptance": $t("提交人类验收"), "run.acceptance_reopened": $t("重新协作"), "run.recovered": $t("中断恢复"), "run.cancelled": $t("人类终止"), "run.paused": $t("任务暂停"), "run.resumed": $t("任务继续"), "run.inquiries_cancelled": $t("停止答疑"), "run.failed": $t("执行失败"), "run.retry_requested": $t("人类恢复"), "run.orchestration_retry_requested": $t("重新协调"), "run.reassessment_requested": $t("重新评估") };
  const publicEvent = event => ({
    id: event.id, timestamp: event.timestamp, category: "event", eventType: event.type,
    title: eventTitles[event.type], content: event.message || "", from: event.actor?.name || "Baton",
    senderType: event.actor?.type || "system", traceId: event.data?.traceId || event.data?.acceptanceRequest?.traceId || null,
    error: event.data?.error || null, reason: event.data?.reason || null, nextRetryAt: event.data?.nextRetryAt || null,
    relatedDispatchIds: event.data?.dispatchIds || event.data?.cancelledDispatchIds || event.data?.recoveredDispatchIds || [],
  });
  const records = messages.map(item => {
    const waiting = dispatches.find(entry => entry.status === "waiting" && entry.waitingMessageId === item.id);
    const answer = messages.find(entry => entry.replyToMessageId === item.id), question = byMessage.get(item.replyToMessageId);
    const statusCode = answer ? "answered" : waiting ? "waiting" : "recorded";
    // A manager working a node itself is both sender and recipient; the
    // underlying message keeps the real recipient, the record omits the
    // redundant self target.
    const selfAddressed = item.recipient?.type === "agent" && item.recipient?.id && item.recipient.id === item.sender?.id;
    return {
      id: item.id, ...(item.clientRequestId ? { clientRequestId: item.clientRequestId } : {}), timestamp: item.createdAt, category: "message", senderType: item.sender?.type, senderId: item.sender?.id || null,
      from: item.sender?.name || "Baton", to: selfAddressed ? null : item.recipient?.type === "team" ? null : item.recipient?.name || (item.recipient?.type === "human" ? $t("你") : item.recipient?.id || null),
      title: kinds[item.kind] || (item.replyToMessageId ? $t("答复") : $t("协作消息")), content: collaborationContent(item), attachments: asArray(item.attachments),
      status: answer ? $t("当前：已回答") : waiting ? $t("当前：等待答复") : "", statusCode,
      tone: waiting || item.kind === "escalation" ? "warning" : item.sender?.type === "human" ? "info" : ["manager_decision", "agent_consultation"].includes(item.kind) ? "violet" : "teal",
      human: item.sender?.type === "human" || item.recipient?.type === "human",
      questionType: item.questionType, routingReason: item.routingReason,
      reply: question ? `${question.sender?.name || $t("团队")}：${question.content || ""}` : null,
      replyId: item.id, canReply: Boolean(!answer && waiting && item.recipient?.type === "human"), traceId: item.traceId,
      deliveries: [], relatedEvents: [],
    };
  });
  const recordById = new Map(records.map(item => [item.id, item]));
  const start = run.startedAt && run.task?.objective ? {
    id: `${run.id}:start`, timestamp: run.startedAt, category: "event", eventType: "run.started", title: $t("开始协作"),
    from: "Baton", to: run.manager?.name || null, senderType: "system", content: run.task.objective,
    acceptanceCriteria: asArray(run.task.acceptanceCriteria), tone: "info", statusCode: "recorded", status: "", human: true, deliveries: [], relatedEvents: [],
  } : null;
  if (start) { records.push(start); recordById.set(start.id, start); }
  const eventRecords = new Map();
  for (const event of events.filter(item => Object.hasOwn(eventTitles, item.type))) {
    const record = { ...publicEvent(event), to: null, status: "", statusCode: "recorded",
      tone: /failed|cancelled/.test(event.type) ? "warning" : "info",
      human: event.actor?.type === "human" || ["run.completed", "run.awaiting_acceptance", "run.acceptance_reopened", "run.cancelled", "run.paused", "run.resumed", "run.inquiries_cancelled"].includes(event.type),
      deliveries: [], relatedEvents: [],
    };
    eventRecords.set(event.id, record);
  }
  // Resolve existing structured references only. Never match prose, names,
  // timestamps, or mere inbox membership to invent a historical handoff.
  const sourceFor = delivery => {
    if (delivery.sourceMessageId) return byMessage.has(delivery.sourceMessageId) ? { id: delivery.sourceMessageId, via: "sourceMessageId" } : null;
    const messageKey = /^message:(.+)$/.exec(delivery.dedupeKey || "");
    if (messageKey && asArray(delivery.messageIds).includes(messageKey[1]) && byMessage.has(messageKey[1])) return { id: messageKey[1], via: "messageReference" };
    if (["consultation", "instruction", "inquiry"].includes(delivery.purpose)) {
      const candidates = asArray(delivery.messageIds).map(id => byMessage.get(id)).filter(item => item?.recipient?.id === delivery.recipientAgentId && ["agent_consultation", "instruction", "human_instruction", "inquiry"].includes(item.kind));
      if (candidates.length === 1) return { id: candidates[0].id, via: "addressedMessage" };
    }
    const match = /^(handoff|delivery|followup|routing|redispatch):(.+)$/.exec(delivery.dedupeKey || "");
    const sourceDelivery = match && byDispatch.get(match[2]);
    if (!sourceDelivery) return null;
    const expected = match[1] === "handoff" ? ["manager_decision"] : match[1] === "delivery" ? ["handoff"] : ["routing", "redispatch"].includes(match[1]) ? ["coordination_notice"] : ["manager_decision", "handoff"];
    const sourceTraces = asArray(sourceDelivery.traceIds).filter(id => {
      const trace = byTrace.get(id);
      return trace?.status === "completed" && trace.agentId === sourceDelivery.recipientAgentId;
    });
    const candidates = messages.filter(item => sourceTraces.includes(item.traceId) && expected.includes(item.kind));
    return candidates.length === 1 ? { id: candidates[0].id, via: "dispatchTrace" } : null;
  };
  const deliveryHistory = new Map(dispatches.map(item => [item.id, []]));
  const absorbedEvents = new Set();
  for (const event of events) {
    if (!["dispatch.retry_scheduled", "dispatch.retry_stopped", "dispatch.escalated", "session.reset"].includes(event.type)) continue;
    const id = event.data?.dispatchId || byTrace.get(event.data?.traceId)?.dispatchId;
    if (!deliveryHistory.has(id)) continue;
    deliveryHistory.get(id).push(publicEvent(event)); absorbedEvents.add(event.id);
  }
  for (const delivery of dispatches.filter(item => item.id)) {
    const sources = asArray(delivery.coalescedSourceMessageIds).length
      ? delivery.coalescedSourceMessageIds.filter(id => byMessage.has(id)).map(id => ({id,via:'coalescedSourceMessageIds'}))
      : [sourceFor(delivery)];
    for (const source of sources.length ? sources : [sourceFor(delivery)]) {
      const recovery = !source && events.find(event => ["run.retry_requested", "run.orchestration_retry_requested"].includes(event.type) && event.data?.dispatchId === delivery.id);
      let record = source ? recordById.get(source.id) : recovery ? eventRecords.get(recovery.id) : delivery.dedupeKey === "initial-manager" ? start : null;
      if (!record) {
        record = { id: delivery.id, timestamp: delivery.createdAt, category: "dispatch", title: $t("建立投递"), from: "Baton", to: memberName(delivery.recipientAgentId), senderType: "system", content: "", status: "", statusCode: "recorded", tone: "violet", human: false, sourceNotice: $t("来源未关联；仅展示已建立的实际投递。"), deliveries: [], relatedEvents: [] };
        records.push(record); recordById.set(record.id, record);
      }
      const history = asArray(delivery.traceIds).map((id, index) => {
        const trace = byTrace.get(id);
        return trace ? { id: `attempt:${id}`, category: "attempt", timestamp: trace.startedAt, endedAt: trace.endedAt || null, title: $t("第 {0} 次执行", [index + 1]), status: trace.status, statusLabel: ({ running: $t("执行中"), completed: $t("执行结束"), failed: $t("失败"), cancelled: $t("已停止") })[trace.status] || trace.status, traceId: id, error: trace.error || null } : null;
      }).filter(Boolean).concat(deliveryHistory.get(delivery.id) || []).sort(chronological);
      const scope = ["manager", "delivery_review"].includes(delivery.purpose) ? $t("全流程协调") : nodes.find(node => node.id === delivery.workflowNodeId)?.title || delivery.workflowNodeId;
      const currentStatus = ({ queued: delivery.nextRetryAt ? $t("等待重试") : $t("排队中"), claimed: $t("执行中"), waiting: $t("等待答复"), done: $t("执行已结束"), cancelled: delivery.lastError ? $t("因失败停止") : $t("已取消") })[delivery.status] || delivery.status;
      const details = {
        dispatchId: delivery.id, sourceMessageId: source?.id || null, sourceLink: source?.via || (recovery ? "recoveryEvent" : delivery.dedupeKey === "initial-manager" && start ? "runStart" : null),
        recipientAgentId: delivery.recipientAgentId, recipientName: memberName(delivery.recipientAgentId), workflowNodeId: delivery.workflowNodeId,
        scope, purposeCode: delivery.purpose, purpose: purposes[delivery.purpose] || delivery.purpose, createdAt: delivery.createdAt, updatedAt: delivery.updatedAt,
        currentStatusCode: delivery.status, currentStatus, attempts: delivery.attempts || 0,
        nextRetryAt: delivery.nextRetryAt || null, error: delivery.status === "done" ? null : delivery.lastError || null,
        previousError: delivery.status === "done" && delivery.lastError && !history.some(item => item.error === delivery.lastError) ? delivery.lastError : null,
        executionTraceId: asArray(delivery.traceIds).at(-1) || null, history,
      };
      record.deliveries.push(details);
      if (source && byMessage.get(source.id)?.kind === "manager_decision" && delivery.purpose === "node") record.title = $t("派工");
      record.human ||= history.some(item => item.senderType === "human");
      if (!record.dispatchId) {
        // Keep scalar references for existing clients; all mutable state is scoped
        // under deliveries, never stamped onto the message's historical time.
        Object.assign(record, { dispatchId: details.dispatchId, sourceMessageId: details.sourceMessageId, recipientAgentId: details.recipientAgentId, workflowNodeId: details.workflowNodeId, executionTraceId: details.executionTraceId });
        const originalRecipient = source && byMessage.get(source.id)?.recipient;
        // A team-addressed decision followed by the sender's own coordination
        // turn (purpose manager/delivery_review) is not a handoff target.
        const selfDelivery = details.recipientAgentId && details.recipientAgentId === record.senderId;
        if (originalRecipient?.type === "team") record.to = selfDelivery ? null : details.recipientName;
        else if (originalRecipient?.type === "agent" && originalRecipient.id !== delivery.recipientAgentId) {
          record.addressedRecipient = { id: originalRecipient.id, name: originalRecipient.name };
          record.routingNote = $t("原消息指向 {0}；实际交由 {1} 处理。", [originalRecipient.name || originalRecipient.id, details.recipientName]);
          record.to = details.recipientName;
        }
        if (recovery) record.to = details.recipientName;
      }
    }
  }
  const acceptances = [];
  for (const event of events.filter(item => Object.hasOwn(eventTitles, item.type) && !absorbedEvents.has(item.id)).sort((a, b) => time(a.timestamp) - time(b.timestamp))) {
    const record = eventRecords.get(event.id);
    if (event.type === "run.awaiting_acceptance") {
      const matches = messages.filter(item => item.kind === "manager_decision" && item.traceId && item.traceId === event.data?.acceptanceRequest?.traceId);
      const anchor = matches.length === 1 ? recordById.get(matches[0].id) : record;
      anchor.title = run.task?.kind === "automation" ? $t("本轮交付完成") : $t("提交人类验收"); anchor.human = run.task?.kind !== "automation";
      if (anchor !== record) {
        anchor.relatedEvents.push({ ...publicEvent(event), content: event.message === anchor.content ? (run.task?.kind === "automation" ? $t("经理已完成本轮交付。") : $t("经理已提交人类验收。")) : event.message || "" });
      } else records.push(record);
      const latestFiles = new Map();
      for (const file of asArray(workspace.artifacts).filter(item => !item.createdAt || time(item.createdAt) <= time(event.timestamp))) {
        const previous = latestFiles.get(file.name);
        if (!previous || time(file.createdAt) >= time(previous.createdAt)) latestFiles.set(file.name, file);
      }
      const files = [...latestFiles.values()].filter(item => !item.deleted && item.storagePath);
      anchor.fileCount = workspace.acceptanceFiles?.[event.id]?.count ?? files.length;
      anchor.files = workspace.acceptanceFiles?.[event.id]?.files ?? files.slice(-8).map(({ id, name }) => ({ id, name }));
      acceptances.push({ timestamp: event.timestamp, recordId: anchor.id });
    } else {
      if (event.type === "run.completed") {
        const acceptance = acceptances.filter(item => time(item.timestamp) <= time(event.timestamp)).sort(chronological).at(-1);
        if (acceptance) record.acceptanceRecordId = acceptance.recordId;
        record.confirmationNote = $t("确认前的交付说明与未验证事项保留在对应验收记录中；平台不替代人类判断交付质量。");
      }
      records.push(record);
    }
  }
  return records.filter(record => record.category === "message" && ["agent", "human"].includes(record.senderType)).map(record => ({
    ...record,
    startMessageId: byMessage.get(record.id)?.startMessageId || byTrace.get(record.traceId || record.executionTraceId)?.inputMessageId || record.traceId || record.executionTraceId || null,
  })).sort(chronological);
}
