// Task details (the Mac inspector): overview, workflow focus from recorded
// handoffs, members each with their console, description, criteria and the
// working directory.
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { Circle, CircleCheck, CircleDot, CircleX, Copy, SquareTerminal, UserPlus } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { formatExactTime, providerLabel, roleExecutionStatus, workflowDisplay, workflowFocus, workspaceAgents } from '@shared/console-projections.mjs';
import { useCatalog } from '@/features/catalog';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { GroupedRow, GroupedSection } from '@/ui/grouped';
import { IconButton } from '@/ui/icon-button';
import { Markdown } from '@/ui/markdown';
import { StatusPill } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { openConsole } from './collaboration';
import type { Workspace } from './data';

export function Details({ workspace, taskId }: { workspace: Workspace; taskId: string }) {
  const { colors } = useTheme();
  const toast = useToast();
  const catalog = useCatalog();
  const { run } = workspace;
  const traces = workspace.traces || [];
  const agents = workspaceAgents(workspace, catalog.data?.agents || [], { includeDeleted: true }) as Array<{ id: string; name: string; color?: string; runtime?: any }>;
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
  // Same rule as the Mac: members change only while the task is open.
  const editableMembers = !run.task.archivedAt && !['completed', 'cancelled'].includes(run.status);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bgSubtle }} contentContainerStyle={{ paddingBottom: 48 }}>
      <GroupedSection title={$t('概要')}>
        <GroupedRow title={$t('状态')} trailing={<StatusPill status={run.status} />} />
        <GroupedRow title={$t('经理')} value={run.manager?.name || '—'} />
        <GroupedRow title={$t('开始')} value={run.startedAt ? formatExactTime(run.startedAt) : '—'} />
        <GroupedRow title={$t('当前执行')} value={running.join('、') || $t('暂无执行成员')} />
        <GroupedRow title={$t('交付快照')} value={String(run.artifactCount ?? 0)} onPress={() => router.push({ pathname: '/task/files', params: { taskId, runId: run.id } })} />
      </GroupedSection>

      {nodes.length ? (
        <GroupedSection title={$t('协作焦点')} footer={$t('依据交接记录与经理当前焦点呈现，不代表平台判定完成度。')}>
          {nodes.map((node) => {
            const trace = nodeTraces.get(node.id);
            const current = run.currentFocus?.nodeId === node.id;
            const waiting = ['waiting_human', 'waiting_agent'].includes(focus[node.id]);
            const status = trace?.status === 'failed' ? 'failed' : trace?.status === 'running' ? 'running' : waiting ? 'waiting' : current ? 'current' : trace?.status === 'completed' ? 'done' : trace ? 'recorded' : 'pending';
            const label = ({ failed: $t('交付失败'), running: $t('执行中'), waiting: focus[node.id] === 'waiting_human' ? $t('等待澄清') : $t('等待答复'), current: $t('当前焦点'), done: $t('已交接'), recorded: trace?.status === 'cancelled' ? $t('已取消') : $t('已记录'), pending: $t('未派工') } as Record<string, string>)[status];
            const executor = trace && (agents.find((agent) => agent.id === trace.agentId)?.name || trace.agentId);
            const Icon = status === 'done' ? CircleCheck : status === 'failed' ? CircleX : ['running', 'current', 'waiting'].includes(status) ? CircleDot : Circle;
            const tone = status === 'done' ? colors.stDone : status === 'failed' ? colors.stFailed : status === 'waiting' ? colors.stAttention : ['running', 'current'].includes(status) ? colors.stRunning : colors.textTertiary;
            return (
              <GroupedRow key={node.id} leading={<Icon size={18} color={tone} strokeWidth={1.8} />} title={node.title || node.id}
                subtitle={executor ? executor + ' · ' + label : status === 'pending' ? undefined : label} />
            );
          })}
        </GroupedSection>
      ) : null}

      <GroupedSection title={$t('成员')} action={editableMembers ? (
        <IconButton icon={UserPlus} label={$t('添加或移除成员')} size={30} onPress={() => router.push({ pathname: '/task/members', params: { taskId, runId: run.id } })} />
      ) : undefined}>
        {agents.map((agent) => {
          const execution = roleExecutionStatus(run, traces, agent.id);
          return (
            <GroupedRow key={agent.id}
              leading={<Avatar member={agent} size={32} live={execution.active} manager={agent.id === run.manager?.id} />}
              title={agent.name}
              subtitle={providerLabel(agent) + (agent.runtime?.model ? ' · ' + agent.runtime.model : '') + ' · ' + execution.label}
              trailing={<IconButton icon={SquareTerminal} label={$t('查看 {0} 的控制台', [agent.name])} tone="neutral" onPress={() => openConsole(taskId, run.id, agent.id)} />} />
          );
        })}
      </GroupedSection>

      <GroupedSection title={$t('任务描述')}>
        <View style={{ padding: 14 }}><Markdown content={run.task.objective || ''} size="body" /></View>
      </GroupedSection>

      {run.task.acceptanceCriteria?.length ? (
        <GroupedSection title={$t('验收标准')}>
          <View style={{ padding: 14, gap: 6 }}>
            {run.task.acceptanceCriteria.map((criterion, index) => <Txt key={index}>{'• ' + criterion}</Txt>)}
          </View>
        </GroupedSection>
      ) : null}

      <GroupedSection title={$t('工作目录')} footer={$t('在 Finder 中打开目录请在 Mac 上操作。')}>
        <GroupedRow title={path ? path.split('/').pop() || path : '—'} subtitle={path} mono numberOfLines={3}
          trailing={path ? <IconButton icon={Copy} label={$t('复制')} tone="neutral" onPress={async () => { await Clipboard.setStringAsync(path); toast($t('已复制工作目录的绝对路径。')); }} /> : null} />
      </GroupedSection>
    </ScrollView>
  );
}
