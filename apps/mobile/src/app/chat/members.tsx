// Group members: each member's console, employee facts, and editing the member list.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SquareTerminal } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { providerLabel } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { useCatalog } from '@/features/catalog';
import { MemberPicker } from '@/features/chats/member-picker';
import { useConversation } from '@/features/chats/model';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { SectionTitle } from '@/ui/layout';
import { LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function ChatMembers() {
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
  if (!chat) return <LoadingState />;
  async function save() {
    if (!editing?.length) return;
    setSaving(true);
    try {
      await client.put(`/api/communications/${encodeURIComponent(chatId)}`, { memberAgentIds: editing });
      await queryClient.invalidateQueries({ queryKey: scope });
      toast($t('群聊成员已更新'));
      setEditing(null);
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }
  if (editing) {
    return (
      <View style={{ flex: 1 }}>
        <Stack.Screen options={{ title: $t('编辑成员'), headerRight: () => <Button size="sm" variant="ghost" label={$t('取消')} onPress={() => setEditing(null)} /> }} />
        <MemberPicker agents={catalog.data?.agents || []} selected={editing} onChange={setEditing} />
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28, backgroundColor: colors.bgSubtle, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
          <Button variant="primary" size="lg" label={$t('保存成员（{0} 人）', [editing.length])} loading={saving} disabled={editing.length < 2} onPress={() => void save()} />
        </View>
      </View>
    );
  }
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 40 }}>
      <Stack.Screen options={{ title: $t('成员 {0}', [chat.members.length]) }} />
      <SectionTitle title={chat.name} action={<Button size="sm" label={$t('编辑成员')} onPress={() => setEditing(chat.members.map((member) => member.id))} />} />
      {chat.members.map((member) => (
        <View key={member.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 60, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
          <Avatar member={member} size={32} live={member.running} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt weight="medium" numberOfLines={1}>{member.name}</Txt>
            <Txt variant="small" tone={member.running ? 'running' : 'tertiary'} numberOfLines={1}>{member.running ? $t('正在回复…') : providerLabel(member) || member.description}</Txt>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={$t('查看 {0} 的控制台', [member.name])} hitSlop={8}
            onPress={() => router.push({ pathname: '/chat/console', params: { chatId, agentId: member.id } })}>
            <SquareTerminal size={20} color={colors.textTertiary} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
