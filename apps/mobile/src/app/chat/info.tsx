import { headerRightOptions } from '@/ui/header';
// Conversation management (replaces the action sheet): identity, rename,
// members each with their console, add/remove members, delete the group.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pencil, SquareTerminal, Trash2, UserPlus, X } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';

import { providerLabel } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { useCatalog } from '@/features/catalog';
import { MemberPicker } from '@/features/chats/member-picker';
import { useConversation } from '@/features/chats/model';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar, GroupAvatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { PromptDialog } from '@/ui/form';
import { DetailHeader, GroupedRow, GroupedSection } from '@/ui/grouped';
import { IconButton } from '@/ui/icon-button';
import { ErrorState, LoadingState } from '@/ui/states';
import { Tag } from '@/ui/status';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function ConversationInfo() {
  useLocale();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const conversation = useConversation(chatId);
  const chat = conversation.data?.pages[0]?.conversation;
  const [editing, setEditing] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const group = chat?.kind === 'group';
  const openConsole = (agentId: string) => router.push({ pathname: '/chat/console', params: { chatId, agentId } });

  async function update(body: Record<string, unknown>, done: string) {
    setSaving(true);
    try {
      await client.put(`/api/communications/${encodeURIComponent(chatId)}`, body);
      await queryClient.invalidateQueries({ queryKey: scope });
      toast(done);
      return true;
    } catch (error) {
      toast((error as Error).message, true);
      return false;
    } finally {
      setSaving(false);
    }
  }
  function applyName(name?: string) {
    const next = name?.trim();
    if (chat && next && next !== chat.name) void update({ name: next }, $t('群聊名称已更新'));
  }
  function rename() {
    if (!chat) return;
    // iOS has a native text prompt; Android shows the same field in a dialog.
    if (Platform.OS === 'ios') Alert.prompt($t('重命名群聊'), undefined, applyName, 'plain-text', chat.name);
    else setRenaming(true);
  }
  function remove() {
    if (!chat) return;
    Alert.alert($t('删除群聊'), $t('将删除「{0}」及其消息记录，无法恢复。', [chat.name]), [
      { text: $t('取消'), style: 'cancel' },
      { text: $t('删除'), style: 'destructive', onPress: async () => {
        try {
          await client.del(`/api/communications/${encodeURIComponent(chatId)}`);
          await queryClient.invalidateQueries({ queryKey: scope });
          toast($t('群聊已删除'));
          router.dismissTo('/chats');
        } catch (error) { toast((error as Error).message, true); }
      } },
    ]);
  }

  if (conversation.isPending) return <LoadingState screen />;
  if (!chat) return <ErrorState message={conversation.error?.message || ''} onRetry={() => void conversation.refetch()} />;

  if (editing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
        <Stack.Screen options={{ title: $t('编辑成员'), ...headerRightOptions(<IconButton icon={X} label={$t('取消')} tone="neutral" onPress={() => setEditing(null)} />) }} />
        <MemberPicker agents={catalog.data?.agents || []} selected={editing} onChange={setEditing} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28, backgroundColor: colors.bgSubtle, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
          <Button variant="primary" size="lg" label={$t('保存成员（{0} 人）', [editing.length])} loading={saving} disabled={editing.length < 2}
            onPress={async () => { if (await update({ memberAgentIds: editing }, $t('群聊成员已更新'))) setEditing(null); }} />
        </View>
      </View>
    );
  }

  const member = chat.members[0];
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bgSubtle }} contentContainerStyle={{ paddingBottom: 48 }}>
      <Stack.Screen options={{ title: group ? $t('群聊信息') : $t('会话信息'), ...(group ? headerRightOptions(<IconButton icon={Pencil} label={$t('重命名群聊')} onPress={rename} />) : {}) }} />
      <PromptDialog visible={renaming} title={$t('重命名群聊')} label={$t('群聊名称')} value={chat.name} confirmLabel={$t('保存')}
        onCancel={() => setRenaming(false)} onSubmit={(name) => { setRenaming(false); applyName(name); }} />
      <DetailHeader
        visual={group ? <GroupAvatar members={chat.members} size={56} /> : <Avatar member={member || { name: chat.name }} size={56} live={member?.running} />}
        title={chat.name}
        subtitle={group ? $t('群聊 · {0} 位成员', [chat.members.length]) : member?.description || $t('长期私聊')}
        badges={!group && member ? <Tag label={providerLabel(member)} /> : undefined}
      />
      <GroupedSection title={group ? $t('成员') : $t('员工')}>
        {chat.members.map((item) => (
          <GroupedRow key={item.id}
            leading={<Avatar member={item} size={32} live={item.running} />}
            title={item.name}
            subtitle={item.running ? $t('正在回复…') : [providerLabel(item), item.runtime?.model].filter(Boolean).join(' · ') || item.description}
            trailing={<IconButton icon={SquareTerminal} label={$t('查看 {0} 的控制台', [item.name])} tone="neutral" onPress={() => openConsole(item.id)} />} />
        ))}
        {group ? <GroupedRow icon={UserPlus} title={$t('添加或移除成员')} onPress={() => setEditing(chat.members.map((item) => item.id))} /> : null}
      </GroupedSection>
      {group ? (
        <GroupedSection footer={$t('删除后无法恢复；员工本身不受影响。')}>
          <GroupedRow icon={Trash2} destructive title={$t('删除群聊')} chevron={false} onPress={remove} />
        </GroupedSection>
      ) : null}
    </ScrollView>
  );
}
