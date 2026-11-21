// One inbox item (web/app.js renderInboxPreview): answer a clarification inline;
// acceptance, interruption and pause show their facts and lead into the task.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { formatRelativeTime, workflowDisplay } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { inboxFacts } from '@/features/inbox/model';
import type { TaskSummary } from '@/features/tasks/model';
import { acceptanceReview, type CollaborationRecord, useRunWorkspace, useTaskDetail } from '@/features/workspace/data';
import { $t, $tm, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/form';
import { Markdown } from '@/ui/markdown';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { StatusPill } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function InboxItem() {
  useLocale();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { colors, metrics } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const headerHeight = useHeaderHeight();
  const task = useTaskDetail(taskId);
  const runId = task.data?.runs?.[0]?.id;
  const workspace = useRunWorkspace(runId);
  const facts = task.data ? inboxFacts(task.data as TaskSummary, workspace.data) : null;
  const question = facts?.question;
  const collaboration = useQuery({
    queryKey: [...scope, 'inbox-context', runId, question?.id],
    queryFn: () => client.get<{ items: CollaborationRecord[] }>(`/api/runs/${encodeURIComponent(runId!)}/collaboration`, { limit: 100 }),
    enabled: Boolean(runId && question && task.data?.status === 'awaiting_human'),
  });
  const timeline = useQuery({
    queryKey: [...scope, 'inbox-timeline', runId, task.data?.status],
    queryFn: () => client.get<{ events: Array<{ type: string; data?: { reason?: string } }> }>(`/api/runs/${encodeURIComponent(runId!)}/timeline`),
    enabled: Boolean(runId && ['paused', 'blocked'].includes(task.data?.status || '')),
  });
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const openTask = () => router.push({ pathname: '/task/[taskId]', params: { taskId } });
  const screen = <Stack.Screen options={{ title: $t('事项详情') }} />;

  if (task.isPending || (runId && workspace.isPending)) return <>{screen}<LoadingState label={$t('正在读取事项详情…')} /></>;
  if (task.error) return <>{screen}<ErrorState message={task.error.message} onRetry={() => void task.refetch()} /></>;
  const current = task.data;
  const run = workspace.data?.run;

  async function send() {
    if (!answer.trim() || !runId || !question) return;
    setSending(true);
    try {
      await client.post(`/api/runs/${encodeURIComponent(runId)}/messages`, { recipientAgentId: null, replyToMessageId: question.id, content: answer.trim(), attachmentIds: [] });
      toast($t('回答已发送'));
      await queryClient.invalidateQueries({ queryKey: scope });
      router.back();
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setSending(false);
    }
  }

  let body: React.ReactNode = null;
  if (current.status === 'awaiting_human' && question && run) {
    const trace = workspace.data?.traces?.find((item) => item.id === question.traceId);
    const dispatch = workspace.data?.dispatches?.find((item) => item.waitingMessageId === question.id);
    const contextId = question.startMessageId || (trace as any)?.inputMessageId || dispatch?.sourceMessageId;
    const context = collaboration.data?.items.find((item) => item.id === contextId);
    const node = (workflowDisplay(run.task.workflowSnapshot)?.nodes || []).find((item: any) => item.id === question.workflowNodeId) as any;
    const name = facts?.agent?.name || $t('任务成员');
    body = (
      <View style={{ gap: 14 }}>
        <Txt variant="title" weight="semibold">{$t('{0} 需要你的澄清', [name])}</Txt>
        <Txt variant="small" tone="tertiary">{[node?.title || node?.name || question.workflowNodeId, formatRelativeTime(question.createdAt)].filter(Boolean).join(' · ')}</Txt>
        <View style={{ borderLeftWidth: 3, borderLeftColor: colors.borderStrong, paddingLeft: 12, gap: 4 }}>
          <Txt variant="small" weight="semibold">{$t('上下文{0}', [context?.from ? ' · ' + $t('{0} 的交接', [context.from]) : ''])}</Txt>
          {collaboration.isPending ? <Txt variant="small" tone="tertiary">{$t('正在加载…')}</Txt> : (
            <Markdown content={context?.content || $t('当前分页中没有该问题的原始上文，请打开任务工作区查看完整记录。')} size="small" tone={colors.textSecondary} />
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Avatar member={facts?.agent as any} size={28} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt weight="semibold">{name} <Txt variant="small" tone="tertiary">{$t('向你提问')}</Txt></Txt>
            <View style={{ padding: 12, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.stAttentionBorder, backgroundColor: colors.stAttentionBg }}>
              <Markdown content={question.content} />
            </View>
          </View>
        </View>
        <TextField value={answer} onChangeText={setAnswer} multiline placeholder={$t('输入回答，发送后 {0} 会继续执行', [name])} accessibilityLabel={$t('回答 {0} 的问题', [name])} />
        <Button variant="primary" size="lg" label={$t('发送回答')} loading={sending} disabled={!answer.trim()} onPress={() => void send()} />
      </View>
    );
  } else if (current.status === 'awaiting_acceptance') {
    const review = acceptanceReview(workspace.data);
    body = (
      <View style={{ gap: 12 }}>
        <View style={{ padding: 14, gap: 6, borderRadius: metrics.radius.md, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
          <Txt variant="small" weight="semibold">{$t('经理总结')}</Txt>
          <Markdown content={run?.acceptanceRequest?.summary || $t('请核对交付文件与原任务要求。')} size="body" />
        </View>
        <Txt variant="small" tone="secondary">{$t('{0} 项交付文件', [run?.artifactCount ?? 0])}</Txt>
        {review?.criteria.length ? (
          <View style={{ gap: 4 }}>
            <Txt variant="small" weight="semibold" tone="secondary">{$t('验收标准')}</Txt>
            {review.criteria.map((item, index) => <Txt key={index}>{'• ' + item}</Txt>)}
          </View>
        ) : null}
        {review ? <Button variant="primary" size="lg" label={$t('确认完成')} onPress={() => router.push({ pathname: '/task/confirm', params: { taskId, runId: runId! } })} /> : null}
      </View>
    );
  } else if (current.status === 'failed') {
    body = (
      <View style={{ gap: 12 }}>
        <Txt weight="semibold">{$t('执行中断')}</Txt>
        <View style={{ padding: 12, borderRadius: metrics.radius.md, backgroundColor: colors.stFailedBg, borderWidth: 1, borderColor: colors.stFailedBorder }}>
          <Txt variant="small" mono selectable>{facts?.error || $t('没有记录错误原文，请查看任务控制台。')}</Txt>
        </View>
        <Button variant="primary" size="lg" label={$t('查看恢复选项')} onPress={openTask} />
      </View>
    );
  } else if (['paused', 'blocked'].includes(current.status)) {
    const reason = timeline.data?.events.filter((item) => ['run.paused', 'run.blocked'].includes(item.type)).at(-1)?.data?.reason;
    body = (
      <View style={{ gap: 12 }}>
        <Txt weight="semibold">{current.status === 'paused' ? $t('暂停原因') : $t('等待恢复')}</Txt>
        <Txt tone="secondary">{$tm(reason || '') || facts?.reason || $t('请查看任务中的暂停或阻塞记录。')}</Txt>
        <Button variant="primary" size="lg" label={$t('查看并继续')} onPress={openTask} />
      </View>
    );
  } else {
    body = (
      <View style={{ gap: 12 }}>
        <Txt variant="small" weight="semibold" tone="secondary">{$t('处理结果')}</Txt>
        <Txt>{run?.acceptanceRequest?.summary || run?.summary || $t('你已确认任务完成。')}</Txt>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
      {screen}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: headerHeight + 12, gap: 16, paddingBottom: 48 }}>
        <StatusPill status={current.status} />
        <Txt variant="title" weight="semibold">{current.title}</Txt>
        {!current.objective ? null : (
          <View style={{ gap: 4 }}>
            <Txt variant="small" weight="semibold" tone="secondary">{$t('任务内容')}</Txt>
            <Markdown content={current.objective} size="body" />
          </View>
        )}
        {body}
        {runId ? <Button label={$t('打开任务工作区')} onPress={openTask} /> : <Notice text={$t('任务尚未启动。')} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
