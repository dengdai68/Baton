// One member's console inside a conversation.
import { Stack, useLocalSearchParams } from 'expo-router';

import { useConversation } from '@/features/chats/model';
import { ConsoleStream } from '@/features/workspace/console';
import { $t } from '@/i18n';

export default function ChatConsole() {
  const { chatId, agentId } = useLocalSearchParams<{ chatId: string; agentId: string }>();
  const conversation = useConversation(chatId);
  const member = conversation.data?.pages[0]?.conversation.members.find((item) => item.id === agentId);
  return (
    <>
      <Stack.Screen options={{ title: member ? $t('{0} · 控制台', [member.name]) : $t('控制台') }} />
      <ConsoleStream runId={chatId} agentId={agentId} base={`/api/communications/${encodeURIComponent(chatId)}`} provider={(member as { runtime?: { provider?: string } } | undefined)?.runtime?.provider} />
    </>
  );
}
