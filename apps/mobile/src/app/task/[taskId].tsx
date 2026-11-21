// Task workspace: status and next action, then 协作 / 文件 / 控制台 / 详情.
// Header menu mirrors the Mac task actions (pause, resume, terminate, archive,
// restore, delete); drafts show their brief with Edit / Start.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Ellipsis } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { workflowDisplay } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { archiveTask, confirmDeleteTask, deleteTask, startTask } from '@/features/tasks/actions';
import { editable, type TaskSummary } from '@/features/tasks/model';
import { Collaboration, confirm, openConsole } from '@/features/workspace/collaboration';
import { ConsoleMembers } from '@/features/workspace/console';
import { acceptanceReview, failedRunRecovery, retryableDispatches, useRunWorkspace, useTaskDetail, type Workspace } from '@/features/workspace/data';
import { Details } from '@/features/workspace/details';
import { FilesPanel } from '@/features/workspace/files';
import { $t, $tm, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Segmented } from '@/ui/form';
import { HeaderButton } from '@/ui/header';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { StatusPill, Tag } from '@/ui/status';
import { Markdown } from '@/ui/markdown';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

type Tab = 'collaboration' | 'files' | 'console' | 'details';
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
  const headerHeight = useHeaderHeight();
  const [tab, setTab] = useState<Tab>('collaboration');
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

  function menu() {
    const current = task.data;
    if (!current) return;
    const items: Array<[string, () => void, boolean?]> = [];
    if (run && ACTIVE.includes(run.status)) items.push([$t('暂停'), () => void act('pause', async () => { await client.post(`/api/runs/${run.id}/pause`, { reason: '用户在任务空间暂停' }); toast($t('Run 已暂停；所有本机角色执行已停止，未完成节点可继续。')); })]);
    if (run?.status === 'paused') items.push([$t('继续'), () => void act('resume', async () => { await client.post(`/api/runs/${run.id}/resume`); toast($t('Run 已继续；项目经理正在依据当前状态重新评估。')); })]);
    if (run && (ACTIVE.includes(run.status) || ['paused', 'awaiting_acceptance', 'failed'].includes(run.status)))
      items.push([$t('终止执行'), () => confirm($t('终止执行'), $t('将立即终止正在运行的本机 Agent 进程，并把本次 Run 标记为已终止。已接收的记录与交付会保留。此操作不可恢复。'), $t('确认终止'),
        () => void act('terminate', async () => { await client.post(`/api/runs/${run.id}/terminate`, { reason: '用户在任务空间终止' }); toast($t('Run 已终止；协作记录保留了终止事实，已接收的交付仍可查看。')); }), true), true]);
    if (current.status === 'done' && !current.archivedAt) items.push([$t('归档'), () => void act('archive', () => archiveTask(client, current.id, toast))]);
    if (current.archivedAt) items.push([$t('恢复任务'), () => void act('restore', () => archiveTask(client, current.id, toast, true))]);
    if (current.deletionBlockedBy === null) items.push([$t('删除任务'), () => confirmDeleteTask(current as TaskSummary, () => void act('delete', async () => { await deleteTask(client, current.id, toast); router.back(); })), true]);
    items.push([$t('刷新'), () => void act('refresh', async () => { await Promise.all([task.refetch(), workspace.refetch()]); })]);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: current.title, options: [$t('取消'), ...items.map((item) => item[0])], cancelButtonIndex: 0, destructiveButtonIndex: items.map((item, index) => (item[2] ? index + 1 : -1)).filter((index) => index > 0) },
      (index) => index > 0 && items[index - 1][1](),
    );
  }

  const screen = (
    <Stack.Screen
      options={{
        title: task.data?.title || $t('任务'),
        headerRight: () => <HeaderButton icon={Ellipsis} label={$t('更多任务操作')} onPress={menu} disabled={!task.data} />,
      }}
    />
  );

  if (task.isPending || (runId && workspace.isPending)) return <>{screen}<LoadingState label={$t('正在读取协作记录与当前状态')} /></>;
  if (task.error) return <>{screen}<ErrorState title={$t('任务加载失败')} message={task.error.message} onRetry={() => void task.refetch()} /></>;
  const current = task.data as TaskSummary & { objective: string; acceptanceCriteria?: string[]; workflowSnapshot?: any };

  if (!runId) {
    // Draft: the brief plus the Mac's two actions.
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14 }}>
        {screen}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <StatusPill status={current.status} />
          <Tag label={workflowDisplay(current.workflowSnapshot)?.name || $t('默认协作')} />
        </View>
        <Markdown content={current.objective || ''} />
        {current.acceptanceCriteria?.length ? (
          <View style={{ gap: 4 }}>
            <Txt variant="small" weight="semibold" tone="secondary">{$t('验收标准')}</Txt>
            {current.acceptanceCriteria.map((item, index) => <Txt key={index}>{'• ' + item}</Txt>)}
          </View>
        ) : null}
        {editable(current) ? (
          <View style={{ gap: 10 }}>
            <Button variant="primary" size="lg" label={$t('启动')} loading={busy === 'start'} onPress={() => void act('start', () => startTask(client, current.id, toast))} />
            <Button size="lg" label={$t('编辑')} onPress={() => router.push({ pathname: '/task/compose', params: { taskId: current.id } })} />
          </View>
        ) : null}
      </ScrollView>
    );
  }
  if (workspace.error || !data || !run) return <>{screen}<ErrorState title={$t('任务加载失败')} message={workspace.error?.message || $t('正在读取协作记录与当前状态')} onRetry={() => void workspace.refetch()} /></>;

  const acceptance = acceptanceReview(data);
  const retries = retryableDispatches(data);
  const recovery = failedRunRecovery(data);
  const runningTraces = (data.traces || []).some((trace) => trace.status === 'running');
  const questions = (data.pendingQuestions || []).filter((item) => item.recipient?.type === 'human').length;
  const nodes = (workflowDisplay(run.task.workflowSnapshot)?.nodes || []) as Array<{ id: string; title?: string }>;

  const summary = (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusPill status={run.task.kind === 'automation' && run.status === 'awaiting_acceptance' ? undefined : run.status} label={run.task.kind === 'automation' && run.status === 'awaiting_acceptance' ? $t('待验收') : undefined} tone={run.task.kind === 'automation' && run.status === 'awaiting_acceptance' ? 'attention' : undefined} />
        <Tag label={workflowDisplay(run.task.workflowSnapshot)?.name || $t('默认协作')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: workspace.live ? colors.live : colors.textDisabled }} />
          <Txt variant="caption" tone="tertiary">{workspace.live ? $t('实时同步') : $t('已断开')}</Txt>
        </View>
      </View>
      {acceptance ? (
        <Button variant="primary" label={$t('确认完成')} onPress={() => router.push({ pathname: '/task/confirm', params: { taskId, runId: run.id } })} />
      ) : null}
      {run.status === 'paused' ? (
        <Button variant="primary" label={$t('继续')} loading={busy === 'resume'} onPress={() => void act('resume', async () => { await client.post(`/api/runs/${run.id}/resume`); toast($t('Run 已继续；项目经理正在依据当前状态重新评估。')); })} />
      ) : null}
      {retries.length ? (
        <Button variant="attention" label={$t('立即重试 {0} 项调用', [retries.length])} loading={busy === 'retry-now'}
          onPress={() => void act('retry-now', async () => { const result = await client.post<{ dispatchIds: string[] }>(`/api/runs/${run.id}/retry-now`, {}); toast($t('已请求立即重试 {0} 项调用；失败 Trace 已保留。', [result.dispatchIds.length])); })} />
      ) : null}
      {run.status === 'failed' ? <Notice tone="failed" text={$t('本轮未完成') + '：' + failureText(data)} /> : null}
      {recovery?.type === 'orchestration' ? (
        <Button variant="attention" label={$t('修复后重新尝试')} disabled={runningTraces} loading={busy === 'retry-orchestration'}
          onPress={() => void act('retry-orchestration', async () => { await client.post(`/api/runs/${run.id}/retry-orchestration`, {}); toast($t('已请求重新准备运行环境并继续原投递。')); })} />
      ) : null}
      {recovery?.type === 'node' ? recovery.nodeIds.map((nodeId) => (
        <Button key={nodeId} variant="attention" disabled={runningTraces} loading={busy === 'retry-node:' + nodeId}
          label={$t('从「{0}」恢复', [nodes.find((node) => node.id === nodeId)?.title || nodeId])}
          onPress={() => void act('retry-node:' + nodeId, async () => { await client.post(`/api/runs/${run.id}/retry-failed-node`, { workflowNodeId: nodeId }); toast($t('已请求原员工继续失败投递；原会话与历史证据已保留。')); })} />
      )) : null}
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'collaboration', label: $t('协作'), count: questions || undefined },
          { value: 'files', label: $t('文件'), count: run.artifactCount ?? undefined },
          { value: 'console', label: $t('控制台') },
          { value: 'details', label: $t('详情') },
        ]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bgCanvas, paddingTop: headerHeight }} behavior="padding">
      {screen}
      {summary}
      <View style={{ flex: 1 }}>
        {tab === 'collaboration' ? (
          <Collaboration workspace={data} onOpenConsole={(agentId, traceId) => openConsole(taskId, run.id, agentId, traceId)} onSent={() => void workspace.refetch()} />
        ) : tab === 'files' ? (
          <FilesPanel taskId={taskId} runId={run.id} artifactCount={run.artifactCount} />
        ) : tab === 'console' ? (
          <ConsoleMembers workspace={data} onOpen={(agentId) => openConsole(taskId, run.id, agentId)} />
        ) : (
          <Details workspace={data} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
