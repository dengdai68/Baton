// Automations: two lines per item (title; cron · state), enabled first.
import { router, Stack } from 'expo-router';
import { CalendarClock, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { useManualRefresh } from '@/api/queries';
import { Chips } from '@/ui/form';
import { useDebounced } from '@/lib/store';
import { useAutomations, type AutomationFilter } from '@/features/automations/model';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { IconButton } from '@/ui/icon-button';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';
import { TabToolbar } from '@/ui/toolbar';

export default function Automations() {
  useLocale();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AutomationFilter>('all');
  const search = useDebounced(query.trim(), 300);
  const list = useAutomations(status, search);
  const filtered = !!search || status !== 'all';
  const pull = useManualRefresh(list.refetch);
  const items = (list.data?.pages || []).flatMap((page) => page.items)
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.title.localeCompare(b.title));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      <Stack.Screen options={{ headerShown: false }} />
      <TabToolbar search={query} onSearchChange={setQuery} placeholder={$t('搜索自动化')}>
        <IconButton icon={Plus} label={$t('新建自动化')} onPress={() => router.push({ pathname: '/task/compose', params: { automation: '1' } })} />
      </TabToolbar>
      <View style={{borderBottomWidth:1,borderBottomColor:colors.borderSubtle,paddingBottom:8}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal:12,gap:4}}>
          <Chips<AutomationFilter> value={status} onChange={setStatus} options={[
            {value:'all', label:$t('全部')}, {value:'enabled', label:$t('启用中')}, {value:'disabled', label:$t('已停用')},
          ]}/>
        </ScrollView>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={item.title}
            onPress={() => router.push({ pathname: '/automation/[automationId]', params: { automationId: item.id } })}
            style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, gap: 4, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
            <Txt weight="medium" numberOfLines={1} tone={item.enabled ? 'primary' : 'secondary'}>{item.title}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt variant="small" tone="tertiary" mono>{item.cron}</Txt>
              <Txt variant="small" tone="tertiary">·</Txt>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: item.enabled ? colors.stDone : colors.textDisabled }} />
              <Txt variant="small" tone={item.enabled ? 'done' : 'tertiary'}>{item.enabled ? $t('已启用') : $t('已停用')}</Txt>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={list.isPending ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
          : <EmptyState icon={CalendarClock} title={filtered ? $t('没有匹配的自动化') : $t('暂无自动化')} description={filtered ? undefined : $t('用 Cron 安排重复任务，独立记录每轮执行与成果。')} />}
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}
