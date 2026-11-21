// Task collaboration: paged records, question cards, the acceptance and failure
// banners above, and a composer with the Mac's send rules (web/app.js
// sendInstruction): reply to the pending question first, at most one @member,
// attachments uploaded before the message, local "sending" records confirmed by id.
import { router } from 'expo-router';
import { MessagesSquare } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, View } from 'react-native';

import { partyName, workspaceAgents } from '@shared/console-projections.mjs';
import { useCatalog } from '@/features/catalog';
import { type MessageAttachment, MessageAttachments } from '@/features/messages/attachment';
import { dayLabel, sameDay } from '@/features/messages/day';
import { AgentMessage, CollapsibleBody, DayDivider, HumanMessage } from '@/features/messages/views';
import { $t, $tm } from '@/i18n';
import { type LocalAttachment, pickFiles, pickImages } from '@/lib/attachments';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Composer } from '@/ui/composer';
import { Markdown } from '@/ui/markdown';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';
import { type CollaborationRecord, collaborationItems, useCollaboration, type Workspace } from './data';

type Outgoing = {
  id: string; content: string; createdAt: string; status: 'sending' | 'unconfirmed';
  replyToMessageId: string | null; recipientName?: string; attachments: LocalAttachment[]; error?: string;
};
const requestId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function Collaboration({ workspace, header, onOpenConsole, onSent }: {
  workspace: Workspace; header?: React.ReactNode; onOpenConsole: (agentId: string, traceId: string) => void; onSent: () => void;
}) {
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const catalog = useCatalog();
  const { run } = workspace;
  const collaboration = useCollaboration(run.id);
  const records = collaborationItems(collaboration.data?.pages);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [sending, setSending] = useState(false);
  const questions = (workspace.pendingQuestions || []).filter((item) => item.recipient?.type === 'human');
  const [replyTo, setReplyTo] = useState<string | undefined>(undefined);
  const effectiveReply = replyTo === undefined || (replyTo && !questions.some((item) => item.id === replyTo)) ? questions[0]?.id || '' : replyTo;
  const replyQuestion = questions.find((item) => item.id === effectiveReply);
  const agents = workspaceAgents(workspace, catalog.data?.agents || []) as Array<{ id: string; name: string; color?: string; sourceAgentId?: string }>;
  const autonomous = run.task.kind === 'automation';
  const blocked = Boolean(autonomous || run.task.archivedAt || run.status === 'failed');
  const list = useRef<FlatList>(null);
  const following = useRef(true);

  // Confirmed records replace local entries with the same clientRequestId.
  const confirmed = new Set(records.map((item) => item.clientRequestId).filter(Boolean));
  const pending = outbox.filter((item) => !confirmed.has(item.id));
  useEffect(() => {
    if (pending.length !== outbox.length) setOutbox(pending);
  }, [pending.length, outbox.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const note = run.task.archivedAt ? $t('任务已归档，协作记录只读。')
    : run.status === 'failed' ? $t('任务因错误中断，请先点击重试继续失败员工；当前不能发送消息或 @ 其他成员。')
      : questions.length ? $t('请先回复待澄清的问题。')
        : ['completed', 'cancelled', 'paused'].includes(run.status) ? $t('可继续咨询；仅答疑，不恢复业务流程。')
          : $t('新指令入队，不打断当前成员。');

  async function attach(kind: 'file' | 'image') {
    try {
      const picked = kind === 'file' ? await pickFiles() : await pickImages();
      setAttachments((current) => [...current, ...picked]);
    } catch (error) {
      toast((error as Error).message, true);
    }
  }

  async function send(retry?: Outgoing) {
    const content = (retry?.content ?? draft).trim();
    const files = retry?.attachments ?? attachments;
    if (!content && !files.length) return;
    const reply = retry ? retry.replyToMessageId : effectiveReply || null;
    if (!reply && questions.length) { toast($t('请在待答问题上点击「回复此问题」，再发送回答。'), true); return; }
    const targets = agents.filter((agent) => new RegExp('@' + escapeRegExp(agent.name) + '(?=$|\\s|[，,。.!！?？:：;；])').test(content));
    if (!reply && targets.length > 1) { toast($t('一条消息只能 @ 一位当前任务成员'), true); return; }
    const target = targets[0];
    const entry: Outgoing = retry ? { ...retry, status: 'sending', error: undefined } : {
      id: requestId(), content, createdAt: new Date().toISOString(), status: 'sending', replyToMessageId: reply,
      recipientName: reply ? replyQuestion?.sender.name : (target || run.manager)?.name, attachments: files,
    };
    setOutbox((current) => [...current.filter((item) => item.id !== entry.id), entry]);
    if (!retry) { setDraft(''); setAttachments([]); }
    following.current = true;
    setSending(true);
    try {
      for (const item of entry.attachments) if (!item.uploaded) {
        const result = await client.upload<{ attachment: { id: string; name: string } }>(`/api/runs/${encodeURIComponent(run.id)}/attachments`, item.uri, { name: item.name });
        item.uploaded = result.attachment;
      }
      const result = await client.post<{ interactionOnly?: boolean; resumed?: boolean }>(`/api/runs/${encodeURIComponent(run.id)}/messages`, {
        clientRequestId: entry.id, recipientAgentId: reply ? null : target?.id ?? null, replyToMessageId: reply, content,
        attachmentIds: entry.attachments.map((item) => item.uploaded?.id),
      });
      toast(result.interactionOnly ? $t('问题已发送，仅答疑，不恢复业务流程') : result.resumed ? $t('澄清已发送，对应协作将继续') : $t('消息已入队，不打断正在执行的成员'));
      if (reply) setReplyTo(undefined);
      await collaboration.refetch();
      onSent();
    } catch (error) {
      setOutbox((current) => current.map((item) => (item.id === entry.id ? { ...item, status: 'unconfirmed', error: (error as Error).message } : item)));
      toast((error as Error).message, true);
    } finally {
      setSending(false);
    }
  }

  function restore(entry: Outgoing) {
    if (draft && draft !== entry.content) { toast($t('输入框已有新草稿，请先保存或清空，再恢复这条消息。'), true); return; }
    setDraft(entry.content);
    setAttachments(entry.attachments);
    setReplyTo(entry.replyToMessageId || '');
    setOutbox((current) => current.filter((item) => item.id !== entry.id));
  }

  const senderOf = (item: CollaborationRecord) =>
    (item.senderId && (run.participants?.find((agent) => agent.id === item.senderId || agent.sourceAgentId === item.senderId) || agents.find((agent) => agent.id === item.senderId))) || { name: item.from, id: item.senderId };

  type Row = { kind: 'record'; item: CollaborationRecord } | { kind: 'outgoing'; item: Outgoing };
  const rows: Row[] = [
    ...records.map((item) => ({ kind: 'record' as const, item })),
    ...pending.map((item) => ({ kind: 'outgoing' as const, item })),
  ];
  const timeOf = (row: Row) => (row.kind === 'record' ? row.item.timestamp : row.item.createdAt);

  function renderRow({ item: row, index }: { item: Row; index: number }) {
    const divider = !index || !sameDay(timeOf(rows[index - 1]), timeOf(row)) ? <DayDivider label={dayLabel(timeOf(row))} /> : null;
    if (row.kind === 'outgoing') {
      const entry = row.item;
      return (
        <View>
          {divider}
          <HumanMessage name={$t('你')} kind={entry.replyToMessageId ? $t('回复') : $t('消息')} to={entry.recipientName} time={entry.createdAt}
            footer={
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Txt variant="caption" tone={entry.status === 'sending' ? 'tertiary' : 'danger'}>
                  {entry.status === 'sending' ? $t('发送中…') : $t('未确认送达：{0}', [entry.error || ''])}
                </Txt>
                {entry.status === 'unconfirmed' ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button size="sm" label={$t('恢复草稿')} onPress={() => restore(entry)} />
                    <Button size="sm" label={$t('重试发送')} onPress={() => void send(entry)} />
                  </View>
                ) : null}
              </View>
            }>
            <Markdown content={entry.content || $t('（附件）')} />
          </HumanMessage>
        </View>
      );
    }
    const item = row.item;
    const trace = item.traceId || item.executionTraceId;
    const consoleLink = trace && item.senderType !== 'human' && item.senderId ? (
      <Button size="sm" variant="ghost" label={$t('本轮控制台 ↗')} onPress={() => onOpenConsole(item.senderId as string, trace)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
    ) : null;
    if (item.senderType === 'human') {
      return (
        <View>
          {divider}
          <HumanMessage name={partyName(item.senderType, item.from)} kind={$tm(item.title)} to={item.to ? partyName(item.recipientType || 'agent', item.to) : null} time={item.timestamp}>
            <CollapsibleBody content={item.content} mentions={agents.map((agent) => agent.name)} />
            <MessageAttachments items={item.attachments as MessageAttachment[]} scope="runs" ownerId={run.id} />
          </HumanMessage>
        </View>
      );
    }
    return (
      <View>
        {divider}
        <AgentMessage sender={senderOf(item)} name={partyName(item.senderType, item.from)} kind={$tm(item.title)}
          to={item.to ? partyName(item.recipientType || 'agent', item.to) : null} time={item.timestamp} status={item.status} attention={item.canReply}>
          <CollapsibleBody content={item.content} mentions={agents.map((agent) => agent.name)} />
          <MessageAttachments items={item.attachments as MessageAttachment[]} scope="runs" ownerId={run.id} />
          {item.reason ? <Txt variant="small" tone="secondary">{$tm(item.reason)}</Txt> : null}
          {item.canReply ? (
            <Button size="sm" variant="primary" label={$t('回复此问题')} onPress={() => { setReplyTo(item.replyId); following.current = true; list.current?.scrollToEnd({ animated: true }); }} style={{ alignSelf: 'flex-start' }} />
          ) : null}
          {consoleLink}
        </AgentMessage>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(row) => row.kind + ':' + row.item.id}
        renderItem={renderRow}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={80}
        onContentSizeChange={() => { if (following.current) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false })); }}
        onLayout={() => { if (following.current) list.current?.scrollToEnd({ animated: false }); }}
        onScroll={({ nativeEvent }) => {
          following.current = nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height < 64;
        }}
        scrollEventThrottle={64}
        ListHeaderComponent={
          <View>
            {header}
            {collaboration.hasNextPage ? (
              <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                <Button size="sm" label={collaboration.isFetchingNextPage ? $t('正在加载…') : $t('加载更早协作记录')} disabled={collaboration.isFetchingNextPage}
                  onPress={() => { following.current = false; void collaboration.fetchNextPage(); }} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          collaboration.isPending ? <LoadingState label={$t('正在读取协作记录…')} />
            : collaboration.error ? <ErrorState message={collaboration.error.message} onRetry={() => void collaboration.refetch()} />
              : <EmptyState icon={MessagesSquare} title={$t('暂无协作消息')} description={$t('角色之间的沟通会按时间出现在这里；执行细节请查看控制台。')} />
        }
        contentContainerStyle={{ paddingBottom: 12, backgroundColor: colors.bgCanvas }}
      />
      {autonomous ? null : (
        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send()}
          sending={sending}
          disabled={blocked}
          note={note}
          reply={replyQuestion ? { label: $t('回复 {0}：{1}', [replyQuestion.sender.name, replyQuestion.content]), onCancel: () => setReplyTo('') } : null}
          attachments={attachments}
          onAttach={(kind) => void attach(kind)}
          onRemoveAttachment={(key) => setAttachments((current) => current.filter((item) => item.key !== key))}
          mentionables={blocked || replyQuestion ? [] : agents}
        />
      )}
    </View>
  );
}

/** Confirm a destructive or state-changing command with the system dialog. */
export function confirm(title: string, message: string, action: string, onConfirm: () => void, destructive = false) {
  Alert.alert(title, message, [
    { text: $t('取消'), style: 'cancel' },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

export const openConsole = (taskId: string, runId: string, agentId: string, traceId?: string) =>
  router.push({ pathname: '/task/console', params: { taskId, runId, agentId, ...(traceId ? { traceId } : {}) } });
