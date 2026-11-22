import { plainHeaderItem } from '@/ui/header';
// One conversation: messages (agents left, you right), "正在回复…", failed replies
// with retry/console, read receipts, @mentions in groups and attachments.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Ellipsis, MessageSquare, RotateCcw, SquareTerminal, Undo2 } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { type ChatMessage, chatMessages, useConversation } from '@/features/chats/model';
import { LocalAttachments, MessageAttachments } from '@/features/messages/attachment';
import { dayLabel, sameDay } from '@/features/messages/day';
import { AgentMessage, CollapsibleBody, DayDivider, HumanMessage } from '@/features/messages/views';
import { $t, useLocale } from '@/i18n';
import { type LocalAttachment, pickFiles, pickImages } from '@/lib/attachments';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Composer } from '@/ui/composer';
import { IconButton } from '@/ui/icon-button';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

type Outgoing = { id: string; content: string; createdAt: string; status: 'sending' | 'unconfirmed'; error?: string; attachments: LocalAttachment[] };
const requestId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);

export default function Conversation() {
  useLocale();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const headerHeight = useHeaderHeight();
  const conversation = useConversation(chatId);
  const first = conversation.data?.pages[0];
  const chat = first?.conversation;
  const messages = chatMessages(conversation.data?.pages);
  const deliveries = (conversation.data?.pages || []).flatMap((page) => page.deliveries || []);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList>(null);
  const following = useRef(true);
  const lastRead = useRef<string | null>(null);
  const group = chat?.kind === 'group';
  const members = chat?.members || [];
  const confirmed = new Set(messages.map((message) => message.clientRequestId).filter(Boolean));
  const pending = outbox.filter((entry) => !confirmed.has(entry.id));
  const latest = messages.at(-1);

  // Read receipt for the newest visible message.
  useEffect(() => {
    if (!latest || !chat?.unreadCount || lastRead.current === latest.id) return;
    lastRead.current = latest.id;
    client.post(`/api/communications/${encodeURIComponent(chatId)}/read`, { messageId: latest.id })
      .then(() => queryClient.invalidateQueries({ queryKey: [...scope, 'chats'] }))
      .catch(() => { lastRead.current = null; });
  }, [latest?.id, chat?.unreadCount]); // eslint-disable-line react-hooks/exhaustive-deps

  async function attach(kind: 'file' | 'image') {
    try { const picked = kind === 'file' ? await pickFiles() : await pickImages(); setAttachments((current) => [...current, ...picked]); }
    catch (error) { toast((error as Error).message, true); }
  }

  async function send(retry?: Outgoing) {
    const content = retry?.content ?? draft;
    const files = retry?.attachments ?? attachments;
    if (!content.trim() && !files.length) return;
    if (content.length > 32000) { toast($t('消息最多 32000 字符。'), true); return; }
    const entry: Outgoing = retry ? { ...retry, status: 'sending', error: undefined } : { id: requestId(), content, createdAt: new Date().toISOString(), status: 'sending', attachments: files };
    setOutbox((current) => [...current.filter((item) => item.id !== entry.id), entry]);
    if (!retry) { setDraft(''); setAttachments([]); }
    following.current = true;
    setSending(true);
    try {
      for (const item of entry.attachments) if (!item.uploaded) {
        const result = await client.upload<{ attachment: { id: string; name: string } }>(`/api/communications/${encodeURIComponent(chatId)}/attachments`, item.uri, { name: item.name });
        item.uploaded = result.attachment;
      }
      const mentionAgentIds = members.filter((member) => content.includes('@' + member.name)).map((member) => member.id);
      await client.post(`/api/communications/${encodeURIComponent(chatId)}/messages`, {
        content, mentionAgentIds, attachmentIds: entry.attachments.map((item) => item.uploaded?.id), clientRequestId: entry.id,
      });
      await conversation.refetch();
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
    setOutbox((current) => current.filter((item) => item.id !== entry.id));
  }

  async function retryDelivery(deliveryId: string) {
    try { await client.post(`/api/communications/${encodeURIComponent(chatId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`, {}); await conversation.refetch(); }
    catch (error) { toast((error as Error).message, true); }
  }

  type Row = { kind: 'message'; item: ChatMessage } | { kind: 'outgoing'; item: Outgoing };
  const rows: Row[] = [...messages.map((item) => ({ kind: 'message' as const, item })), ...pending.map((item) => ({ kind: 'outgoing' as const, item }))];
  const timeOf = (row: Row) => row.item.createdAt;
  const mentionNames = members.map((member) => member.name);

  function renderRow({ item: row, index }: { item: Row; index: number }) {
    const divider = !index || !sameDay(timeOf(rows[index - 1]), timeOf(row)) ? <DayDivider label={dayLabel(timeOf(row))} /> : null;
    if (row.kind === 'outgoing') {
      const entry = row.item;
      return (
        <View>
          {divider}
          <HumanMessage testID={entry.id} name={$t('你')} time={entry.createdAt} footer={
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Txt variant="caption" tone={entry.status === 'sending' ? 'tertiary' : 'danger'}>{entry.status === 'sending' ? $t('发送中…') : $t('未确认送达：{0}', [entry.error || ''])}</Txt>
              {entry.status === 'unconfirmed' ? (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <IconButton icon={Undo2} label={$t('恢复草稿')} tone="neutral" tinted size={32} onPress={() => restore(entry)} />
                  <IconButton icon={RotateCcw} label={$t('重试发送')} tinted size={32} onPress={() => void send(entry)} />
                </View>
              ) : null}
            </View>
          }>
            {entry.content ? <CollapsibleBody content={entry.content} mentions={mentionNames} /> : null}
            <LocalAttachments items={entry.attachments} />
          </HumanMessage>
        </View>
      );
    }
    const message = row.item;
    const failed = deliveries.filter((delivery) => delivery.messageId === message.id && delivery.status === 'failed');
    const recovery = failed.map((delivery) => (
      <View key={delivery.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Txt variant="small" tone="danger">{$t('{0} 回复失败', [members.find((member) => member.id === delivery.agentId)?.name || $t('员工')])}</Txt>
        <IconButton icon={RotateCcw} label={$t('重试')} tone="danger" tinted size={30} onPress={() => void retryDelivery(delivery.id)} />
        <IconButton icon={SquareTerminal} label={$t('控制台')} tone="neutral" size={30} onPress={() => router.push({ pathname: '/chat/console', params: { chatId, agentId: delivery.agentId } })} />
      </View>
    ));
    if (message.sender.type === 'human') {
      return (
        <View>
          {divider}
          <HumanMessage testID={message.id} name={$t('你')} time={message.createdAt} footer={recovery.length ? <View style={{ gap: 6, alignItems: 'flex-end' }}>{recovery}</View> : null}>
            <CollapsibleBody content={message.content} mentions={mentionNames} />
            <MessageAttachments items={message.attachments} scope="communications" ownerId={chatId} />
          </HumanMessage>
        </View>
      );
    }
    const member = members.find((item) => item.id === message.sender.id) || message.sender;
    return (
      <View>
        {divider}
        <AgentMessage sender={member} name={message.sender.name} time={message.createdAt}>
          <CollapsibleBody content={message.content} mentions={mentionNames} />
          <MessageAttachments items={message.attachments} scope="communications" ownerId={chatId} />
        </AgentMessage>
      </View>
    );
  }

  const running = members.filter((member) => member.running);
  const screen = <Stack.Screen options={{ title: chat?.name || $t('沟通'), unstable_headerRightItems: () => plainHeaderItem(<IconButton icon={Ellipsis} label={$t('会话信息')} disabled={!chat} onPress={() => router.push({ pathname: '/chat/info', params: { chatId } })} />) }} />;
  if (conversation.isPending) return <>{screen}<LoadingState label={$t('正在读取聊天记录…')} /></>;
  if (conversation.error && !first) return <>{screen}<ErrorState message={conversation.error.message} onRetry={() => void conversation.refetch()} /></>;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bgCanvas, paddingTop: headerHeight }}>
      {screen}
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(row) => row.kind + ':' + row.item.id}
        renderItem={renderRow}
        initialNumToRender={80}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => { if (following.current) requestAnimationFrame(() => list.current?.scrollToEnd({ animated: false })); }}
        onLayout={() => { if (following.current) list.current?.scrollToEnd({ animated: false }); }}
        onScroll={({ nativeEvent }) => { following.current = nativeEvent.contentSize.height - nativeEvent.contentOffset.y - nativeEvent.layoutMeasurement.height < 64; }}
        scrollEventThrottle={64}
        ListHeaderComponent={conversation.hasNextPage ? (
          <View style={{ alignItems: 'center', paddingVertical: 10 }}>
            <Button size="sm" label={conversation.isFetchingNextPage ? $t('正在加载…') : $t('加载更早消息')} disabled={conversation.isFetchingNextPage}
              onPress={() => { following.current = false; void conversation.fetchNextPage(); }} />
          </View>
        ) : undefined}
        ListFooterComponent={running.length ? (
          <View accessibilityRole="text" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
            <Avatar member={running[0]} size={22} live />
            <Txt variant="small" tone="secondary">{$t('{0}正在回复…', [running.map((member) => member.name).join('、')])}</Txt>
          </View>
        ) : undefined}
        ListEmptyComponent={<EmptyState icon={MessageSquare} title={$t('从一句话开始沟通。消息将持续保留。')} />}
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send()}
        sending={sending}
        placeholder={group ? $t('输入消息，@ 指定成员回复…') : $t('输入消息…')}
        attachments={attachments}
        onAttach={(kind) => void attach(kind)}
        onRemoveAttachment={(key) => setAttachments((current) => current.filter((item) => item.key !== key))}
        mentionables={group ? members : []}
      />
    </KeyboardAvoidingView>
  );
}
