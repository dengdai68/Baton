// Console: per-member execution records. Members list (live dot = executing now)
// and the member stream built with the shared buildConsoleEntries; stored
// content (output, thinking, tool input/result) loads when a record is expanded.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, SquareTerminal } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { buildConsoleEntries, classifyEvent, displayText, formatExactTime, providerLabel, retainsConsoleEvent, roleExecutionStatus, workspaceAgents } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { useCatalog } from '@/features/catalog';
import { $t, $tm } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useClient } from '@/workspace/session';
import type { Workspace } from './data';

export function ConsoleMembers({ workspace, onOpen }: { workspace: Workspace; onOpen: (agentId: string) => void }) {
  const { colors } = useTheme();
  const catalog = useCatalog();
  const agents = workspaceAgents(workspace, catalog.data?.agents || [], { includeDeleted: true }) as Array<{ id: string; name: string; color?: string; runtime?: any }>;
  const traces = workspace.traces || [];
  if (!agents.length) return <EmptyState icon={SquareTerminal} title={$t('暂无成员')} />;
  return (
    <FlatList
      data={agents}
      keyExtractor={(agent) => agent.id}
      renderItem={({ item: agent }) => {
        const execution = roleExecutionStatus(workspace.run, traces, agent.id);
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={$t('查看 {0} 的控制台，{1}', [agent.name, execution.label])} onPress={() => onOpen(agent.id)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 60, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
            <Avatar member={agent} size={32} live={execution.active} manager={agent.id === workspace.run.manager?.id} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt weight="medium" numberOfLines={1}>{agent.name}</Txt>
              <Txt variant="small" tone={execution.failed ? 'danger' : execution.active ? 'running' : 'tertiary'} numberOfLines={1}>{providerLabel(agent)} · {execution.label}</Txt>
            </View>
            <SquareTerminal size={18} color={colors.textTertiary} strokeWidth={1.6} />
          </Pressable>
        );
      }}
      ListFooterComponent={<Txt variant="caption" tone="tertiary" style={{ padding: 16 }}>{$t('每位成员的执行记录独立保存；正文按需加载。')}</Txt>}
    />
  );
}

type ConsolePage = { events: any[]; hasMore: boolean; nextBefore: string | null; traces: any[] };

function ContentBlock({ runId, event, base }: { runId: string; event: any; base: string }) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const { colors, metrics } = useTheme();
  const content = useQuery({
    queryKey: [...scope, 'console-content', base, event.id],
    queryFn: () => client.get<any>(`${base}/console-content/${encodeURIComponent(event.id)}`),
    staleTime: Infinity,
  });
  if (content.isPending) return <Txt variant="small" tone="tertiary">{$t('正在加载…')}</Txt>;
  if (content.error) return <Txt variant="small" tone="danger">{content.error.message}</Txt>;
  const value = content.data?.content ?? content.data;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <View style={{ marginTop: 6, padding: 10, borderRadius: metrics.radius.sm, backgroundColor: colors.codeBg, borderWidth: 1, borderColor: colors.borderSubtle }}>
      <Txt variant="small" mono selectable>{text.length > 20000 ? text.slice(0, 20000) + '\n…' : text}</Txt>
      {content.data?.truncated ? <Txt variant="caption" tone="tertiary">{$t('内容已截断')}</Txt> : null}
    </View>
  );
}

function EntryRow({ entry, runId, base }: { entry: any; runId: string; base: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const event = entry.type === 'tool-group' ? entry.tools[0].event : entry.event;
  const kind = event.type === 'trace.failed' ? 'error' : classifyEvent(event);
  const legacy = event.type === 'runtime.event' && event.data?.auditVersion !== 2;
  const tool = entry.type === 'tool' || entry.type === 'tool-group';
  const toolName = entry.type === 'tool-group' ? entry.toolName : event.data?.toolName || entry.result?.data?.toolName || $t('本机工具');
  const status = tool ? (/error|failed/i.test(String(entry.result?.data?.providerEventType || entry.result?.data?.presentation || '')) || ['failed', 'error'].includes(event.data?.status) ? 'failed' : entry.result || event.data?.status === 'completed' ? 'completed' : 'running') : null;
  const level = legacy ? 'HISTORY' : tool ? 'TOOL' + (entry.type === 'tool-group' ? ' ×' + entry.tools.length : '') : event.data?.presentation === 'thinking' ? 'THINKING' : kind === 'error' ? 'ERROR' : kind === 'deliver' ? 'DELIVER' : event.data?.providerEventType === 'assistant' ? 'TEXT' : 'SYSTEM';
  const levelColor = kind === 'error' || status === 'failed' ? colors.stFailed : tool ? colors.stPlanning : kind === 'deliver' ? colors.stDone : colors.textTertiary;
  const text = legacy ? $t('历史运行记录已按当前审计边界隐藏原始内容。') : tool ? toolName : $tm(displayText(event));
  const expandable = !legacy && (tool ? entry.type === 'tool-group' || Boolean(event.data?.contentRef || entry.result?.data?.contentRef) : Boolean(event.data?.contentRef));
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, backgroundColor: kind === 'error' ? colors.stFailedBg : 'transparent' }}>
      <Pressable disabled={!expandable} onPress={() => setOpen(!open)} accessibilityRole={expandable ? 'button' : undefined} style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt variant="caption" weight="semibold" color={levelColor}>{level}</Txt>
          <Txt variant="caption" tone="tertiary" numeric>{formatExactTime(event.timestamp)}</Txt>
          {status ? <Txt variant="caption" tone={status === 'failed' ? 'danger' : status === 'running' ? 'running' : 'tertiary'}>{status === 'failed' ? $t('失败') : status === 'running' ? $t('运行中') : $t('已完成')}</Txt> : null}
          <View style={{ flex: 1 }} />
          {expandable ? <Chevron size={16} color={colors.textTertiary} /> : null}
        </View>
        <Txt variant="small" tone={event.data?.presentation === 'thinking' ? 'secondary' : 'primary'} mono={tool} numberOfLines={open ? undefined : 4}>{text}</Txt>
      </Pressable>
      {open ? (
        entry.type === 'tool-group' ? entry.tools.map((item: any) => (
          <View key={item.event.id} style={{ marginTop: 6 }}>
            {item.event.data?.contentRef ? <ContentBlock runId={runId} event={item.event} base={base} /> : null}
            {item.result?.data?.contentRef ? <ContentBlock runId={runId} event={item.result} base={base} /> : null}
          </View>
        )) : (
          <>
            {event.data?.contentRef ? <ContentBlock runId={runId} event={event} base={base} /> : null}
            {entry.result?.data?.contentRef ? <ContentBlock runId={runId} event={entry.result} base={base} /> : null}
          </>
        )
      ) : null}
    </View>
  );
}

/** One member's console for a task Run (or a chat when base points at a conversation). */
export function ConsoleStream({ runId, agentId, traceId, liveEvents = [], base }: { runId: string; agentId: string; traceId?: string; liveEvents?: any[]; base: string }) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const { colors } = useTheme();
  const pages = useInfiniteQuery({
    queryKey: [...scope, 'console', base, agentId, traceId ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.get<ConsolePage>(`${base}/console`, { agentId, limit: 50, traceId, before: pageParam }),
    getNextPageParam: (page) => (page.hasMore ? page.nextBefore : undefined),
    refetchInterval: 15_000,
  });
  const loaded = [...(pages.data?.pages || [])].reverse().flatMap((page) => page.events);
  const ids = new Set(loaded.map((event) => event.id));
  const live = liveEvents.filter((event) => event.actor?.id === agentId && retainsConsoleEvent(event) && (!traceId || event.data?.traceId === traceId) && !ids.has(event.id));
  const entries = buildConsoleEntries([...loaded, ...live]);
  if (pages.isPending) return <LoadingState label={$t('正在读取执行记录…')} />;
  if (pages.error) return <ErrorState message={pages.error.message} onRetry={() => void pages.refetch()} />;
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry, index) => (entry.event?.id || entry.tools?.[0]?.event?.id || 'entry') + ':' + index}
      contentInsetAdjustmentBehavior="automatic"
      renderItem={({ item }) => <EntryRow entry={item} runId={runId} base={base} />}
      style={{ backgroundColor: colors.bgCanvas }}
      ListHeaderComponent={pages.hasNextPage ? (
        <View style={{ alignItems: 'center', paddingVertical: 10 }}>
          <Button size="sm" label={pages.isFetchingNextPage ? $t('正在加载…') : $t('加载更早记录')} disabled={pages.isFetchingNextPage} onPress={() => void pages.fetchNextPage()} />
        </View>
      ) : undefined}
      ListEmptyComponent={<EmptyState icon={SquareTerminal} title={$t('暂无执行记录')} description={$t('该成员开始执行后，记录会按时间出现在这里。')} />}
    />
  );
}
