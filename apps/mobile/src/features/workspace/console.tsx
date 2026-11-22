// Console: one member's execution records, rendered with the Mac console's rules
// (web/app.js renderChatStream and friends) on the shared projections: records
// grouped into one card per call, the call's prompt snapshot, tool calls with
// their command or file in the header, shell input/output, Edit diffs, written
// content, Markdown text and Provider thinking. Stored content loads when a
// record is shown (or expanded), never as a whole page.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, SquareTerminal } from 'lucide-react-native';
import { type ReactNode, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import {
  buildConsoleEntries, classifyEvent, consoleContentTokens, displayText, editDiff, EVENT_KIND_LABEL, formatExactTime,
  isShellTool, isTransportFrame, shellCommandText, shellTokens, toolCommandSummary, toolEditInput, toolFileInput,
} from '@shared/console-projections.mjs';
import { runtimeLabel } from '@shared/runtime-providers.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { $t, $tm, useLocale } from '@/i18n';
import { type Colors, monoFont, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Markdown } from '@/ui/markdown';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useClient } from '@/workspace/session';

type ConsoleEvent = { id: string; type: string; runId?: string; timestamp: string; actor?: { id?: string; type?: string; name?: string }; message?: string; data?: any };
type ConsoleTrace = {
  id: string; agentId?: string; workflowNodeId?: string; type?: string; status?: string; startedAt?: string; createdAt?: string;
  promptRef?: unknown; providerSessionId?: string | null; agent?: { runtime?: { provider?: string } };
};
type ConsolePage = { events: ConsoleEvent[]; hasMore: boolean; nextBefore: string | null; traces: ConsoleTrace[] };
type Field = { text?: string; redacted?: boolean; truncated?: boolean };
type Content = { fields?: Partial<Record<'text' | 'thinking' | 'input' | 'output', Field>> };
type ToolEntry = { type: 'tool'; event: ConsoleEvent; result: ConsoleEvent | null };
type Entry =
  | { type: 'event'; event: ConsoleEvent }
  | ToolEntry
  | { type: 'tool-group'; toolName: string; tools: ToolEntry[]; timestamp: string }
  | { type: 'historical-audit-summary'; count: number; firstTimestamp: string; lastTimestamp: string };
type Row = { key: string; traceId: string | null; time: number | null; prompt?: boolean; entry?: Entry; trace?: ConsoleTrace };
type Group = { key: string; traceId: string | null; rows: Row[] };
type Context = { base: string; provider?: string; nodeTitle: (id?: string) => string | undefined };

/** Mac shell colors (web/styles.css .shell-token-*) on the terminal background. */
const SHELL_COLORS: Record<string, string> = { command: '#7ee0a3', option: '#79c0ff', string: '#e3c07f', comment: '#7d8590', variable: '#d2a8ff', operator: '#ff9d8a' };
const jsonColor = (colors: Colors, kind: string) => ({ attr: colors.accentText, string: colors.synString, number: colors.synNumber, literal: colors.synKeyword } as Record<string, string>)[kind];

const isCurrentAudit = (event?: ConsoleEvent | null) => event?.type === 'runtime.event' && event.data?.auditVersion === 2;
const historicalEvent = (entry: Entry) => (entry.type === 'event' && entry.event.type === 'runtime.event' && !isCurrentAudit(entry.event) ? entry.event : null);
const auditText = (event: ConsoleEvent) => {
  if (event.type === 'runtime.event' && !isCurrentAudit(event)) return $t('历史运行记录已按当前审计边界隐藏原始内容。');
  if (event.type === 'trace.failed' && event.data?.auditVersion !== 2) return $t('历史调用记录 失败原因已按当前审计边界隐藏原始内容。');
  return $tm(displayText(event)) || $t('收到运行时事件');
};
const timestamp = (value?: string | null) => { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : null; };
const clock = (value?: string | null) => (value ? formatExactTime(value).split(' ').at(-1) || '' : '');

/** Consecutive legacy runtime records fold into one "hidden history" row (Mac summarizeHistoricalAuditEntries). */
function summarizeHistory(entries: Entry[]): Entry[] {
  const out: Entry[] = [];
  for (const entry of entries) {
    const event = historicalEvent(entry);
    if (!event) { out.push(entry); continue; }
    const previous = out.at(-1);
    if (previous?.type === 'historical-audit-summary') { previous.count += 1; previous.lastTimestamp = event.timestamp; continue; }
    out.push({ type: 'historical-audit-summary', count: 1, firstTimestamp: event.timestamp, lastTimestamp: event.timestamp });
  }
  return out;
}

/** Rows in time order with one prompt row per call (Mac renderChatStream). */
export function consoleRows(events: ConsoleEvent[], agentId: string, traces: ConsoleTrace[], { traceId, hasMore }: { traceId?: string; hasMore: boolean }): Row[] {
  const list = events.filter((event) => event.actor?.id === agentId && event.type !== 'message.sent' && !isTransportFrame(event))
    .sort((a, b) => (timestamp(a.timestamp) ?? 0) - (timestamp(b.timestamp) ?? 0));
  const entries = summarizeHistory(buildConsoleEntries(list) as Entry[]);
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const traceOf = (entry: Entry) => (entry.type === 'tool-group' ? entry.tools[0].event.data?.traceId : entry.type === 'historical-audit-summary' ? null : entry.event.data?.traceId) || null;
  const timeOf = (entry: Entry) => timestamp(entry.type === 'tool-group' ? entry.timestamp : entry.type === 'historical-audit-summary' ? entry.firstTimestamp : entry.event.timestamp);
  const pageTimes = events.filter((event) => event.actor?.id === agentId).map((event) => timestamp(event.timestamp)).filter((time): time is number => time !== null);
  const windowStart = pageTimes.length ? Math.min(...pageTimes) : null;
  const starts = new Set(events.filter((event) => ['trace.started', 'communication.started'].includes(event.type)).map((event) => event.data?.traceId));
  const encountered = new Map<string, number | null>();
  const rows: Row[] = [];
  for (const entry of entries) {
    const id = traceOf(entry);
    if (id && !encountered.has(id)) encountered.set(id, timeOf(entry));
    const first = entry.type === 'tool-group' ? entry.tools[0].event : entry.type === 'historical-audit-summary' ? null : entry.event;
    const call = first?.data?.toolUseId || first?.data?.toolResultId;
    rows.push({ key: call ? `tool:${id}:${call}` : first?.id || `historical:${id}:${timeOf(entry)}`, traceId: id, time: timeOf(entry), entry });
  }
  for (const id of new Set([...encountered.keys(), ...traces.filter((trace) => trace.agentId === agentId).map((trace) => trace.id)])) {
    if (traceId && id !== traceId) continue;
    const trace = traceById.get(id);
    const time = timestamp(trace?.startedAt) ?? encountered.get(id) ?? null;
    // While older pages remain, a call that began before this window shows its prompt once history reaches it.
    if (!traceId && hasMore && !starts.has(id) && (time === null || (windowStart !== null && time < windowStart))) continue;
    rows.push({ key: `prompt:${id}`, traceId: id, time, prompt: true, trace });
  }
  return rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || Number(Boolean(b.prompt)) - Number(Boolean(a.prompt)));
}

/** One card per contiguous run of rows of the same call (a later segment gets its own card). */
function groupRows(rows: Row[]): Group[] {
  const groups: Group[] = [], seen = new Map<string, number>();
  for (const row of rows) {
    let group = groups.at(-1);
    if (!group || group.traceId !== row.traceId) {
      const id = row.traceId || 'unlinked', occurrence = seen.get(id) || 0;
      seen.set(id, occurrence + 1);
      group = { key: `${id}:${occurrence}`, traceId: row.traceId, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

function useContent(url: string | null) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({
    queryKey: [...scope, 'console-content', url],
    queryFn: () => client.get<Content>(url!),
    enabled: Boolean(url),
    staleTime: Infinity,
    retry: false,
  });
}

function Notes({ field }: { field: Field }) {
  if (!field.redacted && !field.truncated) return null;
  return <Txt variant="caption" tone="tertiary">{[field.redacted ? $t('已脱敏') : '', field.truncated ? $t('内容过长，已截断') : ''].filter(Boolean).join(' ')}</Txt>;
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <View style={{ gap: 4, marginTop: 6 }}><Txt variant="caption" tone="tertiary">{label}</Txt>{children}</View>;
}

/**
 * Code block. Execution text wraps (Mac .execution-text, pre-wrap); shell blocks
 * (`dark`, the terminal style) and diffs keep their lines and scroll sideways.
 */
function Code({ children, dark, accent, wrap, tone }: { children: ReactNode; dark?: boolean; accent?: string; wrap?: boolean; tone?: string }) {
  const { colors, metrics } = useTheme();
  const box = { borderRadius: metrics.radius.sm, backgroundColor: dark ? colors.dark : colors.codeBg, borderWidth: dark ? 0 : 1, borderColor: colors.borderSubtle, borderLeftWidth: accent ? 3 : dark ? 0 : 1, borderLeftColor: accent || colors.borderSubtle };
  const text = <Text selectable style={{ fontFamily: monoFont, fontSize: 12, lineHeight: 18, color: tone || (dark ? colors.onSolidText : colors.text) }}>{children}</Text>;
  if (wrap) return <View style={[box, { paddingHorizontal: 10, paddingVertical: 8 }]}>{text}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={box} contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}>{text}</ScrollView>
  );
}

function DiffBlock({ edit }: { edit: { filePath: string; oldText: string; newText: string } }) {
  const { colors } = useTheme();
  const diff = editDiff(edit.oldText, edit.newText);
  if (!diff) return null;
  const path = edit.filePath || $t('未记录路径');
  const signs = { add: '+', del: '-', context: ' ' } as const;
  const line = (key: string, text: string, color: string, background?: string) => (
    <Text key={key} style={{ color, backgroundColor: background }}>{text + '\n'}</Text>
  );
  return (
    <>
      <Code>
        {line('a', '--- a/' + path, colors.textSecondary)}
        {line('b', '+++ b/' + path, colors.textSecondary)}
        {diff.lines.map((item, index) => line(String(index), signs[item.type] + (item.text || ' '),
          item.type === 'add' ? colors.accentText : item.type === 'del' ? colors.stFailed : colors.text,
          item.type === 'add' ? colors.bgSelected : item.type === 'del' ? colors.stFailedBg : undefined))}
      </Code>
      {diff.aligned ? null : <Txt variant="caption" tone="tertiary">{$t('变更行较多，已按删除后新增顺序如实排列')}</Txt>}
    </>
  );
}

/** Stored content of one record, field by field as the Mac hydrates it. */
function ContentView({ url, toolName = '' }: { url: string; toolName?: string }) {
  const { colors } = useTheme();
  const content = useContent(url);
  if (content.isPending) return <Txt variant="small" tone="tertiary">{$t('正在读取执行内容…')}</Txt>;
  if (content.error) return <Txt variant="small" tone="danger">{$t('执行内容不可读取或校验失败；刷新后可重试。')}</Txt>;
  const labels = { text: $t('正文'), thinking: $t('思考 · Provider 公开内容'), input: $t('输入'), output: $t('输出') };
  const shell = isShellTool(toolName);
  const sections = Object.entries(content.data?.fields || {}).filter(([kind]) => kind in labels).map(([kind, raw]) => {
    const field = raw as Field, text = String(field.text ?? ''), label = labels[kind as keyof typeof labels];
    if (kind === 'thinking') {
      return (
        <Section key={kind} label={label}>
          {text.trim() ? <Code wrap tone={colors.textSecondary}>{text}</Code> : <Txt variant="small" tone="tertiary">{$t('此条记录未保存可显示的思考正文。')}</Txt>}
          {text.trim() ? <Notes field={field} /> : null}
        </Section>
      );
    }
    const edit = kind === 'input' ? toolEditInput(toolName, text) : null;
    if (edit) return <Section key={kind} label={$t('{0} · 变更差异', [label])}><DiffBlock edit={edit} /><Notes field={field} /></Section>;
    if (shell && kind === 'input') {
      const command = shellCommandText(toolName, text);
      return (
        <Section key={kind} label={(command ? $t('命令') : $t('输入 · 原始内容')) + ' · Shell'}>
          <Code dark accent={colors.stDone}>{shellTokens(command ?? text).map((token, index) => <Text key={index} style={{ color: SHELL_COLORS[token.kind], fontWeight: token.kind === 'command' ? '600' : undefined }}>{token.text}</Text>)}</Code>
          {command ? null : <Txt variant="caption" tone="tertiary">{$t('命令参数不可解析，如实显示原始已脱敏输入。')}</Txt>}
          <Notes field={field} />
        </Section>
      );
    }
    if (shell && kind === 'output') return <Section key={kind} label={$t('输出 · Shell')}><Code dark accent={colors.borderStrong}>{text}</Code><Notes field={field} /></Section>;
    const file = kind === 'input' ? toolFileInput(toolName, text) : null;
    if (file && toolName.toLowerCase() === 'read') return null;
    if (file && file.content !== null) return <Section key={kind} label={$t('写入内容')}><Code wrap>{file.content}</Code><Notes field={field} /></Section>;
    if (kind === 'text') return <Section key={kind} label={label + ' · Markdown'}><Markdown content={text} size="body" /><Notes field={field} /></Section>;
    const formatted = consoleContentTokens(text, { json: kind === 'input' || kind === 'output', truncated: field.truncated });
    return (
      <Section key={kind} label={label + (formatted.json ? ' · JSON' : '')}>
        <Code wrap>{formatted.tokens.map((token, index) => <Text key={index} style={{ color: jsonColor(colors, token.kind) }}>{token.text}</Text>)}</Code>
        <Notes field={field} />
      </Section>
    );
  });
  return <View>{sections}</View>;
}

/** Row frame: level tag on the left, clock on the right, body below (Mac log-row). */
function LogRow({ level, levelColor, time, children }: { level: string; levelColor: string; time?: string; children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt variant="caption" weight="semibold" color={levelColor}>{level}</Txt>
        <View style={{ flex: 1 }} />
        {time ? <Txt variant="caption" tone="tertiary" numeric>{time}</Txt> : null}
      </View>
      {children}
    </View>
  );
}

/** A disclosure header: chevron, bold title, optional summary and a trailing status. */
function Disclosure({ open, onToggle, title, summary, trailing, children }: { open: boolean; onToggle?: () => void; title: string; summary?: string | null; trailing?: ReactNode; children?: ReactNode }) {
  const { colors } = useTheme();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View>
      <Pressable accessibilityRole={onToggle ? 'button' : undefined} accessibilityState={{ expanded: open }} disabled={!onToggle} onPress={onToggle} hitSlop={4}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 }}>
        {onToggle ? <Chevron size={14} color={colors.textTertiary} /> : null}
        <Txt variant="small" weight="semibold" numberOfLines={1} style={{ flexShrink: 0, maxWidth: '45%' }}>{title}</Txt>
        <Txt variant="small" tone="secondary" mono numberOfLines={1} style={{ flex: 1 }}>{summary || ''}</Txt>
        {trailing}
      </Pressable>
      {open ? <View style={{ paddingLeft: onToggle ? 20 : 0 }}>{children}</View> : null}
    </View>
  );
}

function toolStatus(entry: ToolEntry): 'failed' | 'completed' | 'running' {
  const { event, result } = entry;
  const resultType = String(result?.data?.providerEventType || result?.data?.presentation || '');
  if (/error|failed/i.test(resultType) || ['failed', 'error'].includes(result?.data?.status) || ['failed', 'error'].includes(event.data?.status)) return 'failed';
  return result || event.data?.status === 'completed' ? 'completed' : 'running';
}

function ToolCall({ entry, context, compact }: { entry: ToolEntry; context: Context; compact?: boolean }) {
  const { colors } = useTheme();
  const { event, result } = entry;
  const current = isCurrentAudit(event);
  const toolName = current ? event.data?.toolName || result?.data?.toolName || $t('本机工具') : $t('历史工具调用');
  const status = toolStatus(entry);
  const url = (item?: ConsoleEvent | null) => (item?.data?.contentRef ? `${context.base}/console-content/${encodeURIComponent(item.id)}` : null);
  const hasContent = Boolean(url(event) || url(result));
  const direct = toolName === 'StructuredOutput' && hasContent;
  const [open, setOpen] = useState(direct || toolName === 'Edit');
  // Shell, Read and Write show their command or file in the header (from the stored input).
  const wantsSummary = current && Boolean(url(event)) && (isShellTool(toolName) || ['read', 'write'].includes(toolName.toLowerCase()));
  const summaryContent = useContent(wantsSummary ? url(event) : null);
  const summary = summaryContent.error ? $t('执行内容不可读取或校验失败；刷新后可重试。') : toolCommandSummary(toolName, summaryContent.data?.fields?.input?.text);
  const statusText = status === 'running' ? $t('运行中') : status === 'failed' ? $t('失败') : $t('已完成');
  const body = current && toolName.toLowerCase() === 'read' && status === 'completed'
    ? <Txt variant="small" tone="tertiary">Done</Txt>
    : <>{url(event) ? <ContentView url={url(event)!} toolName={toolName} /> : null}{url(result) ? <ContentView url={url(result)!} toolName={toolName} /> : null}</>;
  const call = (
    <Disclosure open={open} onToggle={direct ? undefined : () => setOpen(!open)} title={toolName} summary={summary}
      trailing={<Txt variant="caption" color={status === 'failed' ? colors.stFailed : status === 'running' ? colors.stRunning : colors.textTertiary}>{statusText}</Txt>}>
      {body}
      {!hasContent ? <Txt variant="small" tone="tertiary">{$t('此记录当时仅保存工具名称、状态与关联；参数和输出未保存。')}</Txt> : null}
    </Disclosure>
  );
  if (compact) return <View style={{ paddingVertical: 2 }}>{call}</View>;
  return <LogRow level="TOOL" levelColor={colors.stPlanning} time={clock(event.timestamp)}>{call}</LogRow>;
}

function ToolGroup({ group, context }: { group: Extract<Entry, { type: 'tool-group' }>; context: Context }) {
  const { colors } = useTheme();
  const toolName = isCurrentAudit(group.tools[0].event) ? group.toolName : $t('历史工具调用');
  const [open, setOpen] = useState(isShellTool(toolName) || ['read', 'write'].includes(toolName.toLowerCase()));
  return (
    <LogRow level={'TOOL ×' + group.tools.length} levelColor={colors.stPlanning} time={clock(group.timestamp)}>
      <Disclosure open={open} onToggle={() => setOpen(!open)} title={toolName + ' ×' + group.tools.length} summary={$t('状态摘要')}>
        {group.tools.map((entry) => <ToolCall key={entry.event.id} entry={entry} context={context} compact />)}
      </Disclosure>
    </LogRow>
  );
}

function EventRow({ event, context }: { event: ConsoleEvent; context: Context }) {
  const { colors } = useTheme();
  const kind = event.type === 'trace.failed' ? 'error' : classifyEvent(event);
  const provider = event.data?.providerEventType || 'system';
  const legacy = event.type === 'runtime.event' && !isCurrentAudit(event);
  if (!legacy && kind === 'tool') return <ToolCall entry={{ type: 'tool', event, result: null }} context={context} />;
  const level = legacy ? 'HISTORICAL EVENT' : event.data?.presentation === 'thinking' ? 'THINKING' : provider === 'assistant' ? 'TEXT' : provider === 'user' ? 'USER EVENT' : provider === 'stderr' ? 'STDERR' : String(EVENT_KIND_LABEL[kind] || provider).toUpperCase();
  const color = kind === 'error' ? colors.stFailed : kind === 'deliver' ? colors.stDone : colors.textTertiary;
  const text = auditText(event);
  let body: ReactNode;
  if (!legacy && event.data?.contentRef) body = <ContentView url={`${context.base}/console-content/${encodeURIComponent(event.id)}`} />;
  else if (!legacy && event.type === 'runtime.event' && provider === 'assistant') body = <><Txt variant="small">{text}</Txt><Txt variant="caption" tone="tertiary">{$t('此记录当时未保存正文或思考内容，仅有状态摘要。')}</Txt></>;
  else body = <Txt variant="small" color={kind === 'error' ? colors.stFailed : kind === 'deliver' ? colors.stDone : undefined} tone={legacy ? 'tertiary' : undefined}>{kind === 'deliver' ? '✓ ' + text : text}</Txt>;
  return <LogRow level={level} levelColor={color} time={clock(event.timestamp)}>{body}</LogRow>;
}

function HistoryRow({ entry }: { entry: Extract<Entry, { type: 'historical-audit-summary' }> }) {
  const { colors } = useTheme();
  const first = clock(entry.firstTimestamp), last = clock(entry.lastTimestamp);
  return (
    <LogRow level="HISTORICAL" levelColor={colors.textTertiary} time={first === last ? first : first + ' — ' + last}>
      <Txt variant="small" weight="medium">{$t('已隐藏 {0} 条历史运行明细', [entry.count])}</Txt>
      <Txt variant="caption" tone="tertiary">{$t('这些记录产生于当前审计边界前；原始内容不会在控制台回显。')}</Txt>
    </LogRow>
  );
}

/** The call's prompt snapshot (redacted) and native session ID, collapsed by default. */
function PromptRow({ trace, context }: { trace?: ConsoleTrace; context: Context }) {
  const { colors } = useTheme();
  const client = useClient();
  const scope = useWorkspaceKey();
  const [open, setOpen] = useState(false);
  const prompt = useQuery({
    queryKey: [...scope, 'console-prompt', context.base, trace?.id],
    queryFn: () => client.get<{ prompt?: Field }>(`${context.base}/traces/${encodeURIComponent(trace!.id)}/prompt`),
    enabled: open && Boolean(trace?.promptRef),
    staleTime: Infinity,
    retry: false,
  });
  if (!trace) {
    return <LogRow level="TRACE" levelColor={colors.textTertiary}><Txt variant="small" tone="tertiary">{$t('调用的 Trace 记录不在当前读取范围内，其提示词快照不可定位。')}</Txt></LogRow>;
  }
  const provider = trace.agent?.runtime?.provider || context.provider;
  const session = (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6 }}>
      <Txt variant="caption" tone="tertiary">{$t('{0} 会话 ID', [runtimeLabel(provider || '')])}</Txt>
      <Txt variant="caption" mono selectable numberOfLines={1} style={{ flex: 1 }}>{trace.providerSessionId || $t('未记录')}</Txt>
    </View>
  );
  const label = $t('本次提示词 · {0}', [context.nodeTitle(trace.workflowNodeId) || trace.workflowNodeId || trace.type || $t('调用')]);
  return (
    <LogRow level="TRACE" levelColor={colors.textTertiary} time={clock(trace.startedAt)}>
      <Disclosure open={open} onToggle={() => setOpen(!open)} title={label} summary={$t('本次调用提示词 · 已脱敏')}>
        {!trace.promptRef ? <Txt variant="small" tone="tertiary">{$t('该次调用未保存提示词快照。')}</Txt>
          : prompt.isPending ? <Txt variant="small" tone="tertiary">{$t('正在读取提示词快照…')}</Txt>
            : prompt.error ? <Txt variant="small" tone="danger">{prompt.error.message}</Txt>
              : <><Code wrap>{prompt.data?.prompt?.text || ''}</Code><Notes field={prompt.data?.prompt || {}} /></>}
        {session}
      </Disclosure>
    </LogRow>
  );
}

function RowView({ row, context }: { row: Row; context: Context }) {
  if (row.prompt) return <PromptRow trace={row.trace} context={context} />;
  const entry = row.entry!;
  if (entry.type === 'historical-audit-summary') return <HistoryRow entry={entry} />;
  if (entry.type === 'tool-group') return <ToolGroup group={entry} context={context} />;
  if (entry.type === 'tool') return <ToolCall entry={entry} context={context} />;
  return <EventRow event={entry.event} context={context} />;
}

type Item = { kind: 'card'; group: Group; trace?: ConsoleTrace } | { kind: 'row'; row: Row; group: string; last: boolean };

/** One member's console for a task Run (or a chat when base points at a conversation). */
export function ConsoleStream({ agentId, traceId, base, provider, nodes = [] }: {
  runId?: string; agentId: string; traceId?: string; base: string;
  /** The member's Runtime (for the session ID label) and the workflow nodes (card titles). */
  provider?: string; nodes?: Array<{ id: string; title?: string }>;
}) {
  useLocale();
  const client = useClient();
  const scope = useWorkspaceKey();
  const { colors, metrics } = useTheme();
  const list = useRef<FlatList<Item>>(null);
  const following = useRef(true);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const pages = useInfiniteQuery({
    queryKey: [...scope, 'console', base, agentId, traceId ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.get<ConsolePage>(`${base}/console`, { agentId, limit: 50, traceId, before: pageParam }),
    getNextPageParam: (page) => (page.hasMore ? page.nextBefore : undefined),
    refetchInterval: 15_000,
  });
  if (pages.isPending) return <LoadingState label={$t('正在读取执行记录…')} />;
  if (pages.error) return <ErrorState message={pages.error.message} onRetry={() => void pages.refetch()} />;
  const loaded = [...pages.data.pages].reverse().flatMap((page) => page.events);
  const traces = [...new Map(pages.data.pages.flatMap((page) => page.traces || []).map((trace) => [trace.id, trace])).values()];
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const context: Context = { base, provider, nodeTitle: (id) => nodes.find((node) => node.id === id)?.title };
  const groups = groupRows(consoleRows(loaded, agentId, traces, { traceId, hasMore: Boolean(pages.hasNextPage) }));
  const items: Item[] = groups.flatMap((group) => [
    { kind: 'card' as const, group, trace: group.traceId ? traceById.get(group.traceId) : undefined },
    ...(closed.has(group.key) ? [] : group.rows.map((row, index) => ({ kind: 'row' as const, row, group: group.key, last: index === group.rows.length - 1 }))),
  ]);
  const toggle = (key: string) => setClosed((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  function render({ item }: { item: Item }) {
    const edge = { marginHorizontal: 12, backgroundColor: colors.bgRaised, borderColor: colors.border, borderLeftWidth: 1, borderRightWidth: 1 };
    if (item.kind === 'row') {
      return (
        <View style={[edge, { borderBottomWidth: item.last ? 1 : 0, borderBottomLeftRadius: item.last ? metrics.radius.md : 0, borderBottomRightRadius: item.last ? metrics.radius.md : 0, marginBottom: item.last ? 12 : 0, borderTopWidth: 1, borderTopColor: colors.borderSubtle }]}>
          <RowView row={item.row} context={context} />
        </View>
      );
    }
    const { group, trace } = item;
    const open = !closed.has(group.key);
    const start = trace?.startedAt || trace?.createdAt;
    const status = trace?.status ? ({ running: $t('执行中'), completed: $t('已结束'), failed: $t('失败'), cancelled: $t('已取消') } as Record<string, string>)[trace.status] || trace.status : '';
    const records = group.rows.filter((row) => !row.prompt).length;
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => toggle(group.key)}
        style={[edge, { borderTopWidth: 1, borderBottomWidth: open ? 0 : 1, borderTopLeftRadius: metrics.radius.md, borderTopRightRadius: metrics.radius.md, borderBottomLeftRadius: open ? 0 : metrics.radius.md, borderBottomRightRadius: open ? 0 : metrics.radius.md, marginBottom: open ? 0 : 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
        <Chevron size={15} color={colors.textTertiary} />
        <Txt variant="small" weight="semibold">{group.traceId ? $t('执行') : $t('记录')}</Txt>
        {trace?.workflowNodeId ? <Txt variant="small" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>{context.nodeTitle(trace.workflowNodeId) || trace.workflowNodeId}</Txt> : null}
        <View style={{ flex: 1 }} />
        {start ? <Txt variant="caption" tone="tertiary" numeric>{formatExactTime(start)}</Txt> : null}
        <Txt variant="caption" tone="tertiary">{$t('{0} 条', [records])}</Txt>
        {status ? <Txt variant="caption" color={trace?.status === 'failed' ? colors.stFailed : trace?.status === 'running' ? colors.stRunning : colors.textTertiary}>{status}</Txt> : null}
      </Pressable>
    );
  }

  return (
    <FlatList
      ref={list}
      data={items}
      keyExtractor={(item) => (item.kind === 'card' ? 'card:' + item.group.key : item.group + ':' + item.row.key)}
      contentInsetAdjustmentBehavior="automatic"
      renderItem={render}
      style={{ backgroundColor: colors.bgSubtle }}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
      initialNumToRender={30}
      // Open at the latest records (like the Mac), then keep following only while at the bottom.
      onContentSizeChange={() => { if (following.current) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false })); }}
      onScroll={({ nativeEvent }) => { following.current = nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height < 64; }}
      scrollEventThrottle={64}
      ListHeaderComponent={pages.hasNextPage ? (
        <View style={{ alignItems: 'center', paddingBottom: 12 }}>
          <Button size="sm" label={pages.isFetchingNextPage ? $t('正在加载…') : $t('加载更早记录')} disabled={pages.isFetchingNextPage}
            onPress={() => { following.current = false; void pages.fetchNextPage(); }} />
        </View>
      ) : undefined}
      ListEmptyComponent={<EmptyState icon={SquareTerminal} title={$t('尚无执行内容')} description={$t('正文、思考、工具调用和异常将在这里显示。')} />}
    />
  );
}
