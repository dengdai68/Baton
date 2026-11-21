// Long-lived private and group conversations (web/communication.js semantics).
import { useInfiniteQuery } from '@tanstack/react-query';

import { useFocusedInterval, useWorkspaceKey } from '@/api/queries';
import type { MessageAttachment } from '@/features/messages/attachment';
import { useClient } from '@/workspace/session';

export type ChatMember = { id: string; name: string; color?: string; initials?: string; description?: string; status?: string; running?: boolean; runtime?: any; roles?: Array<{ name: string }> };
export type Conversation = {
  id: string; kind: 'agent' | 'group'; name: string; targetId?: string; unreadCount: number; pending?: number;
  createdAt: string; updatedAt: string; preview?: string; members: ChatMember[];
};
export type ChatMessage = {
  id: string; clientRequestId?: string; sender: { type: string; id: string; name: string }; content: string;
  attachments?: MessageAttachment[]; mentionAgentIds?: string[]; createdAt: string;
};
export type Delivery = { id: string; messageId: string; agentId: string; status: string; attempts?: number; error?: string | null };
export type ConversationPage = { conversation: Conversation; messages: ChatMessage[]; hasMore: boolean; nextBefore: string | null; deliveries: Delivery[]; revision?: string };
type ListPage = { conversations: Conversation[]; page: number; totalPages: number; total: number };

export function useConversations() {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useInfiniteQuery({
    queryKey: [...scope, 'chats'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => client.get<ListPage>('/api/communications', { page: pageParam }),
    getNextPageParam: (page) => (page.page < page.totalPages ? page.page + 1 : undefined),
    refetchInterval: useFocusedInterval(8_000),
  });
}

export function useConversation(chatId: string) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useInfiniteQuery({
    queryKey: [...scope, 'chat', chatId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.get<ConversationPage>(`/api/communications/${encodeURIComponent(chatId)}`, { before: pageParam }),
    getNextPageParam: (page) => (page.hasMore ? page.nextBefore : undefined),
    // Replies stream in while an employee works; poll faster while a reply is pending.
    refetchInterval: useFocusedInterval(3_000),
  });
}

export function chatMessages(pages: ConversationPage[] | undefined): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const page of [...(pages || [])].reverse()) for (const message of page.messages) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export const startConversation = (client: ReturnType<typeof useClient>, memberAgentIds: string[]) =>
  client.post<{ conversation: Conversation }>('/api/communications', memberAgentIds.length === 1 ? { kind: 'agent', targetId: memberAgentIds[0] } : { kind: 'group', memberAgentIds });
