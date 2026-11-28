// Task workspace: collaboration is the page. Header icons open the files page,
// the details page (members and their consoles) and a native menu with the Mac
// task actions (pause, resume, terminate, archive, restore, delete).
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { CircleCheck, Ellipsis, FolderOpen, Info, Pencil, Play, RotateCcw } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { workflowDisplay } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { archiveTask, confirmDeleteTask, deleteTask, startTask } from '@/features/tasks/actions';
import { editable, type TaskSummary } from '@/features/tasks/model';
import { Collaboration, confirm, openConsole } from '@/features/workspace/collaboration';
import { acceptanceReview, failedRunRecovery, retryableDispatches, useRunWorkspace, useTaskDetail, type Workspace } from '@/features/workspace/data';
import { $t, $tm, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { ComposerLayout } from '@/ui/composer';
import { HeaderButtons, headerRightOptions, useContentTopInset } from '@/ui/header';
import { IconButton } from '@/ui/icon-button';
import { Markdown } from '@/ui/markdown';
import { type MenuItem, MenuButton } from '@/ui/menu';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { StatusPill } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

const ACTIVE = ['planning', 'running', 'awaiting_human', 'review'];

function failureText(workspace: Workspace): string {
  const failure = workspace.run.failure;
  if (failure?.message) {
    const active = (workspace.traces || []).filter((trace) => trace.status === 'running').length;
    return $tm(failure.message) + (active ? $t('\n另有 {0} 名员工正在收尾，结束后可重试。', [active]) : '');
  }
  return failedRunRecovery(workspace)?.type === 'node' ? $t('已有失败的业务调用；请选择需要由原员工继续的职责。') : $t('本轮没有完成；请查看保留的调用记录 与协作记录。');
}

export default function TaskWorkspace() {
  useLocale();
  const { taskId, runId: runParam } = useLocalSearchParams<{ taskId: string; runId?: string }>();
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const topInset = useContentTopInset();
  const [busy, setBusy] = useState<string | null>(null);
  const task = useTaskDetail(taskId);
  const runId = runParam || task.data?.runs?.[0]?.id;
  const workspace = useRunWorkspace(runId);
  const data = workspace.data;
  const run = data?.run;

  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    try {
      await work();
      await queryClient.invalidateQueries({ queryKey: scope });
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  const current = task.data;
  const menuItems: MenuItem[] = [];
  if (run && ACTIVE.includes(run.status)) menuItems.push({ id: 'pause', title: $t('暂停'), icon: 'pause.circle' });
  if (run?.status === 'paused') menuItems.push({ id: 'resume', title: $t('继续'), icon: 'play.circle' });
  if (current?.status === 'done' && !current.archivedAt) menuItems.push({ id: 'archive', title: $t('归档'), icon: 'archivebox' });
  if (current?.archivedAt) menuItems.push({ id: 'restore', title: $t('恢复任务'), icon: 'arrow.uturn.backward' });
  if (run && (ACTIVE.includes(run.status) || ['paused', 'awaiting_acceptance', 'failed'].includes(run.status))) menuItems.push({ id: 'terminate', title: $t('终止执行'), icon: 'stop.circle', destructive: true });
  if (current?.deletionBlockedBy === null) menuItems.push({ id: 'delete', title: $t('删除任务'), icon: 'trash', destructive: true });

  function onMenu(id: string) {
    if (!current) return;
    if (id === 'pause' && run) void act('pause', async () => { await client.post(`/api/runs/${run.id}/pause`, { reason: '用户在任务空间暂停' }); toast($t('Run 已暂停；所有本机角色执行已停止，未完成节点可继续。')); });
    if (id === 'resume' && run) void act('resume', async () => { await client.post(`/api/runs/${run.id}/resume`); toast($t('Run 已继续；项目经理正在依据当前状态重新评估。')); });
    if (id === 'archive') void act('archive', () => archiveTask(client, current.id, toast));
    if (id === 'restore') void act('restore', () => archiveTask(client, current.id, toast, true));
    if (id === 'terminate' && run) confirm($t('终止执行'), $t('将立即终止正在运行的本机 Agent 进程，并把本次 Run 标记为已终止。已接收的记录与交付会保留。此操作不可恢复。'), $t('确认终止'),
      () => void act('terminate', async () => { await client.post(`/api/runs/${run.id}/terminate`, { reason: '用户在任务空间终止' }); toast($t('Run 已终止；协作记录保留了终止事实，已接收的交付仍可查看。')); }), true);
    if (id === 'delete') confirmDeleteTask(current as TaskSummary, () => void act('delete', async () => { await deleteTask(client, current.id, toast); router.back(); }));
  }

  const screen = (
    <Stack.Screen
      options={{
        title: current?.title || $t('任务'),
        ...headerRightOptions(
          <HeaderButtons>
            {runId ? <IconButton icon={FolderOpen} label={$t('文件')} onPress={() => router.push({ pathname: '/task/files', params: { taskId, runId } })} /> : null}
            {runId ? <IconButton icon={Info} label={$t('任务详情')} onPress={() => router.push({ pathname: '/task/details', params: { taskId, runId } })} /> : null}
            {menuItems.length ? <MenuButton icon={Ellipsis} label={$t('更多任务操作')} items={menuItems} onSelect={onMenu} /> : null}
          </HeaderButtons>
        ),
      }}
    />
  );

  if (task.isPending || (runId && workspace.isPending)) return <>{screen}<LoadingState screen label={$t('正在读取协作记录与当前状态')} /></>;
  if (!current) return <>{screen}<ErrorState title={$t('任务加载失败')} message={task.error?.message || ''} onRetry={() => void task.refetch()} /></>;

  if (!runId) {
    // A draft (created on the Mac): its brief, then start or edit.
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14 }}>
        {screen}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <StatusPill centered status={current.status} />
          <View style={{ flex: 1 }} />
          {editable(current) ? <IconButton icon={Pencil} label={$t('编辑')} onPress={() => router.push({ pathname: '/task/compose', params: { taskId: current.id } })} /> : null}
          {editable(current) ? <IconButton icon={Play} label={$t('启动')} tinted loading={busy === 'start'} onPress={() => void act('start', () => startTask(client, current.id, toast))} /> : null}
        </View>
        <Markdown content={current.objective || ''} />
        {current.acceptanceCriteria?.length ? (
          <View style={{ gap: 4 }}>
            <Txt variant="small" weight="semibold" tone="secondary">{$t('验收标准')}</Txt>
            {current.acceptanceCriteria.map((item, index) => <Txt key={index}>{'• ' + item}</Txt>)}
          </View>
        ) : null}
      </ScrollView>
    );
  }
  if (!data || !run) return <>{screen}<ErrorState title={$t('任务加载失败')} message={workspace.error?.message || ''} onRetry={() => void workspace.refetch()} /></>;

  const acceptance = acceptanceReview(data);
  const retries = retryableDispatches(data);
  const recovery = failedRunRecovery(data);
  const runningTraces = (data.traces || []).some((trace) => trace.status === 'running');
  const nodes = (workflowDisplay(run.task.workflowSnapshot)?.nodes || []) as Array<{ id: string; title?: string }>;
  const automationAcceptance = run.task.kind === 'automation' && run.status === 'awaiting_acceptance';

  // The one next step, beside the status (Graphite: one primary action per area).
  const next = acceptance ? (
    <Button size="sm" variant="primary" icon={CircleCheck} label={$t('确认完成')} onPress={() => router.push({ pathname: '/task/confirm', params: { taskId, runId: run.id } })} />
  ) : run.status === 'paused' ? (
    <Button size="sm" variant="primary" icon={Play} label={$t('继续')} loading={busy === 'resume'} onPress={() => onMenu('resume')} />
  ) : retries.length ? (
    <Button size="sm" variant="attention" icon={RotateCcw} label={$t('立即重试')} loading={busy === 'retry-now'}
      onPress={() => void act('retry-now', async () => { const result = await client.post<{ dispatchIds: string[] }>(`/api/runs/${run.id}/retry-now`, {}); toast($t('已请求立即重试 {0} 项调用；失败 Trace 已保留。', [result.dispatchIds.length])); })} />
  ) : recovery?.type === 'orchestration' ? (
    <Button size="sm" variant="attention" icon={RotateCcw} label={$t('重新尝试')} disabled={runningTraces} loading={busy === 'retry-orchestration'}
      onPress={() => void act('retry-orchestration', async () => { await client.post(`/api/runs/${run.id}/retry-orchestration`, {}); toast($t('已请求重新准备运行环境并继续原投递。')); })} />
  ) : null;

  return (
    <ComposerLayout style={{ flex: 1, backgroundColor: colors.bgCanvas, paddingTop: topInset }}>
      {screen}
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
          <StatusPill centered status={automationAcceptance ? undefined : run.status} label={automationAcceptance ? $t('待验收') : undefined} tone={automationAcceptance ? 'attention' : undefined} />
          {workspace.live ? <View accessibilityLabel={$t('实时同步')} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.live }} /> : null}
          <View style={{ flex: 1 }} />
          {next}
        </View>
        {run.status === 'failed' ? <Notice tone="failed" text={failureText(data)} /> : null}
        {recovery?.type === 'node' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {recovery.nodeIds.map((nodeId) => (
              <Button key={nodeId} size="sm" variant="attention" icon={RotateCcw} disabled={runningTraces} loading={busy === 'retry-node:' + nodeId}
                label={$t('从「{0}」恢复', [nodes.find((node) => node.id === nodeId)?.title || nodeId])}
                onPress={() => void act('retry-node:' + nodeId, async () => { await client.post(`/api/runs/${run.id}/retry-failed-node`, { workflowNodeId: nodeId }); toast($t('已请求原员工继续失败投递；原会话与历史证据已保留。')); })} />
            ))}
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Collaboration key={run.id} workspace={data} onOpenConsole={(agentId, traceId) => openConsole(taskId, run.id, agentId, traceId)} onSent={() => void workspace.refetch()} />
      </View>
    </ComposerLayout>
  );
}
