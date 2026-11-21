// Task details (the Mac inspector): overview facts, workflow focus per node from
// recorded handoffs, members, description and the working directory.
import * as Clipboard from 'expo-clipboard';
import { CircleCheck, CircleDot, CircleX, Circle } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { formatExactTime, providerLabel, workflowDisplay, workflowFocus, workspaceAgents } from '@shared/console-projections.mjs';
import { useCatalog } from '@/features/catalog';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Fact, SectionTitle } from '@/ui/layout';
import { Markdown } from '@/ui/markdown';
import { StatusPill } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import type { Workspace } from './data';

export function Details({ workspace }: { workspace: Workspace }) {
  const { colors, metrics } = useTheme();
  const toast = useToast();
  const catalog = useCatalog();
  const { run } = workspace;
  const traces = workspace.traces || [];
  const agents = workspaceAgents(workspace, catalog.data?.agents || []) as Array<{ id: string; name: string; color?: string; runtime?: any }>;
  const focus = workflowFocus(run, traces);
  const nodeTraces = new Map<string, (typeof traces)[number]>();
  for (const trace of traces) {
    if (!trace.workflowNodeId || trace.agentId === run.manager?.id || (trace.type && trace.type !== 'node')) continue;
    const previous = nodeTraces.get(trace.workflowNodeId);
    if (!previous || (Date.parse(trace.startedAt || '') || 0) >= (Date.parse(previous.startedAt || '') || 0)) nodeTraces.set(trace.workflowNodeId, trace);
  }
  const nodes = (workflowDisplay(run.task.workflowSnapshot)?.nodes || []) as Array<{ id: string; title?: string }>;
  const running = traces.filter((trace) => trace.status === 'running').map((trace) => agents.find((agent) => agent.id === trace.agentId)?.name || trace.agentId);
  const path = run.task.workspacePath || run.workspacePath || '';

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
      <SectionTitle title={$t('概要')} />
      <View style={{ paddingHorizontal: 16 }}>
        <Fact label={$t('状态')}><StatusPill status={run.status} /></Fact>
        <Fact label={$t('经理')} value={run.manager?.name} />
        <Fact label={$t('开始')} value={run.startedAt ? formatExactTime(run.startedAt) : '—'} />
        <Fact label={$t('工作流@@field')} value={workflowDisplay(run.task.workflowSnapshot)?.name || $t('当前工作流')} />
        <Fact label={$t('当前执行')} value={running.join('、') || $t('暂无执行成员')} />
        <Fact label={$t('数字员工')} value={$t('{0} 位', [agents.length])} />
        <Fact label={$t('文件')} value={$t('{0} 项交付快照', [run.artifactCount ?? 0])} />
      </View>

      <SectionTitle title={$t('协作焦点')} />
      <View style={{ marginHorizontal: 16, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {nodes.length ? nodes.map((node, index) => {
          const trace = nodeTraces.get(node.id);
          const current = run.currentFocus?.nodeId === node.id;
          const waiting = ['waiting_human', 'waiting_agent'].includes(focus[node.id]);
          const status = trace?.status === 'failed' ? 'failed' : trace?.status === 'running' ? 'running' : waiting ? 'waiting' : current ? 'current' : trace?.status === 'completed' ? 'done' : trace ? 'recorded' : 'pending';
          const label = ({ failed: $t('交付失败'), running: $t('执行中'), waiting: focus[node.id] === 'waiting_human' ? $t('等待澄清') : $t('等待答复'), current: $t('当前焦点'), done: $t('已交接'), recorded: trace?.status === 'cancelled' ? $t('已取消') : $t('已记录'), pending: $t('未派工') } as Record<string, string>)[status];
          const executor = trace && (agents.find((agent) => agent.id === trace.agentId)?.name || trace.agentId);
          const Icon = status === 'done' ? CircleCheck : status === 'failed' ? CircleX : ['running', 'current', 'waiting'].includes(status) ? CircleDot : Circle;
          const tone = status === 'done' ? colors.stDone : status === 'failed' ? colors.stFailed : status === 'waiting' ? colors.stAttention : ['running', 'current'].includes(status) ? colors.stRunning : colors.textTertiary;
          const emphasized = ['running', 'current', 'waiting'].includes(status);
          return (
            <View key={node.id} accessibilityState={{ selected: current }} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 12, minHeight: 44, borderTopWidth: index ? 1 : 0, borderTopColor: colors.borderSubtle }}>
              <Icon size={16} color={tone} strokeWidth={1.8} />
              <Txt weight={emphasized ? 'semibold' : 'regular'} tone={status === 'pending' ? 'tertiary' : 'primary'} style={{ flex: 1 }} numberOfLines={1}>{node.title || node.id}</Txt>
              <Txt variant="small" tone="tertiary" numberOfLines={1} style={{ maxWidth: '55%' }}>{executor ? executor + ' · ' + label : status === 'pending' ? '—' : label}</Txt>
            </View>
          );
        }) : <Txt tone="tertiary" style={{ padding: 12 }}>{$t('暂无工作流节点')}</Txt>}
      </View>
      <Txt variant="caption" tone="tertiary" style={{ paddingHorizontal: 16, paddingTop: 6 }}>{$t('依据交接记录与经理当前焦点呈现，不代表平台判定完成度。')}</Txt>

      <SectionTitle title={$t('成员') + ' ' + agents.length} />
      {agents.map((agent) => (
        <View key={agent.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 48 }}>
          <Avatar member={agent} size={28} manager={agent.id === run.manager?.id} live={traces.some((trace) => trace.agentId === agent.id && trace.status === 'running')} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt weight="medium" numberOfLines={1}>{agent.name}</Txt>
            <Txt variant="caption" tone="tertiary" numberOfLines={1}>{providerLabel(agent)}{agent.runtime?.model ? ' · ' + agent.runtime.model : ''}</Txt>
          </View>
        </View>
      ))}

      <SectionTitle title={$t('任务描述')} />
      <View style={{ paddingHorizontal: 16 }}><Markdown content={run.task.objective || ''} size="body" /></View>
      {run.task.acceptanceCriteria?.length ? (
        <>
          <SectionTitle title={$t('验收标准')} />
          <View style={{ paddingHorizontal: 16, gap: 4 }}>
            {run.task.acceptanceCriteria.map((criterion, index) => <Txt key={index}>{'• ' + criterion}</Txt>)}
          </View>
        </>
      ) : null}

      <SectionTitle title={$t('工作目录')} />
      <View style={{ marginHorizontal: 16, padding: 12, gap: 8, borderRadius: metrics.radius.md, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
        <Txt variant="small" mono selectable>{path || '—'}</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button size="sm" label={$t('复制')} disabled={!path} onPress={async () => { await Clipboard.setStringAsync(path); toast($t('已复制工作目录的绝对路径。')); }} />
        </View>
        <Txt variant="caption" tone="tertiary">{$t('在 Finder 中打开目录请在 Mac 上操作。')}</Txt>
      </View>
    </ScrollView>
  );
}
