import { headerLeftOptions } from '@/ui/header';
// Start a conversation: one employee opens the private chat, several create a group.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { useCatalog } from '@/features/catalog';
import { MemberPicker } from '@/features/chats/member-picker';
import { startConversation } from '@/features/chats/model';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { ErrorState, LoadingState } from '@/ui/states';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function NewChat() {
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const catalog = useCatalog();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const { conversation } = await startConversation(client, selected);
      await queryClient.invalidateQueries({ queryKey: [...scope, 'chats'] });
      router.replace({ pathname: '/chat/[chatId]', params: { chatId: conversation.id } });
    } catch (error) {
      toast((error as Error).message, true);
      setBusy(false);
    }
  }
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: $t('发起沟通'), ...headerLeftOptions(<IconButton icon={X} label={$t('取消')} tone="neutral" onPress={() => router.back()} />) }} />
      {catalog.isPending ? <LoadingState /> : catalog.error ? <ErrorState message={catalog.error.message} onRetry={() => void catalog.refetch()} /> : (
        <MemberPicker agents={catalog.data.agents} selected={selected} onChange={setSelected} />
      )}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28, backgroundColor: colors.bgSubtle, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
        <Button variant="primary" size="lg" loading={busy} disabled={!selected.length}
          label={selected.length > 1 ? $t('创建群聊（{0} 人）', [selected.length]) : $t('开始私聊')} onPress={() => void start()} />
      </View>
    </View>
  );
}
