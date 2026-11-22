// Conversations: private chats with one employee and group chats, newest first.
import { router, Stack } from 'expo-router';
import { MessageSquare, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { formatRelativeTime } from '@shared/console-projections.mjs';
import { useManualRefresh } from '@/api/queries';
import { type Conversation, useConversations } from '@/features/chats/model';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar, GroupAvatar } from '@/ui/avatar';
import { IconButton } from '@/ui/icon-button';
import { TabToolbar } from '@/ui/toolbar';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';

export default function Chats() {
  useLocale();
  const { colors } = useTheme();
  const list = useConversations();
  const pull = useManualRefresh(list.refetch);
  const [query, setQuery] = useState('');
  const conversations = (list.data?.pages || []).flatMap((page) => page.conversations)
    .filter((item) => !query.trim() || (item.name + ' ' + item.members.map((member) => member.name).join(' ')).toLowerCase().includes(query.trim().toLowerCase()));

  const row = ({ item }: { item: Conversation }) => {
    const running = item.members.some((member) => member.running);
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={item.name + (item.unreadCount ? '，' + $t('{0} 条未读', [item.unreadCount]) : '')}
        onPress={() => router.push({ pathname: '/chat/[chatId]', params: { chatId: item.id } })}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
        {item.kind === 'group' ? <GroupAvatar members={item.members} size={40} /> : <Avatar member={item.members[0] || { name: item.name }} size={40} live={running} />}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt weight={item.unreadCount ? 'semibold' : 'medium'} numberOfLines={1} style={{ flex: 1 }}>{item.name}</Txt>
            <Txt variant="caption" tone="tertiary" numeric>{formatRelativeTime(item.updatedAt)}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt variant="small" tone={running ? 'running' : 'tertiary'} numberOfLines={1} style={{ flex: 1 }}>
              {running ? $t('{0}正在回复…', [item.members.filter((member) => member.running).map((member) => member.name).join('、')]) : item.preview || (item.kind === 'group' ? $t('{0} 位成员', [item.members.length]) : $t('长期私聊'))}
            </Txt>
            {item.unreadCount ? <View accessibilityLabel={$t('有未读消息')} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      <Stack.Screen options={{ headerShown: false }} />
      <TabToolbar search={query} onSearchChange={setQuery} placeholder={$t('搜索会话或成员')}>
        <IconButton icon={Plus} label={$t('发起沟通')} onPress={() => router.push('/chat/new')} />
      </TabToolbar>
      <FlatList
        style={{ backgroundColor: colors.bgCanvas, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={row}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
        ListEmptyComponent={list.isPending ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
          : <EmptyState icon={MessageSquare} title={query ? $t('没有匹配的会话') : $t('还没有沟通')} description={query ? undefined : $t('与员工私聊讨论需求，或建立群聊并通过 @ 定向提问。')} />}
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}
