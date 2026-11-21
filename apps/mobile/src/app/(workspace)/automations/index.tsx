// Automations: switch, rule and next run, latest result, member stack.
import { router, Stack } from 'expo-router';
import { CalendarClock, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Switch, View } from 'react-native';

import { formatExactTime, formatRelativeTime } from '@shared/console-projections.mjs';
import { useManualRefresh, useWorkspaceKey } from '@/api/queries';
import { outcomeText, useAutomations } from '@/features/automations/model';
import { useCatalog } from '@/features/catalog';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Segmented } from '@/ui/form';
import { HeaderButton } from '@/ui/header';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Tag } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function Automations() {
  useLocale();
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const list = useAutomations(filter);
  const catalog = useCatalog();
  const pull = useManualRefresh(list.refetch);
  const items = (list.data?.pages || []).flatMap((page) => page.items);
  const agents = catalog.data?.agents || [];
  async function toggle(item: { id: string; title: string; enabled: boolean }, next: boolean) {
    try { await client.put(`/api/automations/${encodeURIComponent(item.id)}`, { enabled: next }); await list.refetch(); toast(next ? $t('自动化已启用') : $t('自动化已停用')); }
    catch (error) { toast((error as Error).message, true); await list.refetch(); }
  }
  return (
    <>
      <Stack.Screen options={{ title: $t('自动化'), headerRight: () => <HeaderButton icon={Plus} label={$t('新建自动化')} onPress={() => router.push({ pathname: '/task/compose', params: { automation: '1' } })} /> }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.bgCanvas }}
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ padding: 12 }}>
            <Segmented value={filter} onChange={setFilter} options={[
              { value: 'all', label: $t('全部'), count: items.length },
              { value: 'on', label: $t('已启用'), count: (list.data?.pages || []).flatMap((page) => page.items).filter((item) => item.enabled).length },
              { value: 'off', label: $t('已停用'), count: (list.data?.pages || []).flatMap((page) => page.items).filter((item) => !item.enabled).length },
            ]} />
          </View>
        }
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
        renderItem={({ item }) => {
          const outcome = outcomeText(item.latestTrigger);
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
              <Switch value={item.enabled} onValueChange={(next) => void toggle(item, next)} trackColor={{ true: colors.accent, false: colors.borderStrong }} accessibilityLabel={$t('启用 {0}', [item.title])} />
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/automation/[automationId]', params: { automationId: item.id } })} style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.title}</Txt>
                  {!item.enabled ? <Tag label={$t('已停用')} tone="neutral" /> : null}
                </View>
                <Txt variant="small" tone="tertiary" mono numberOfLines={1}>{item.cron}{item.nextTriggerAt ? ' · ' + $t('下次 {0}', [formatExactTime(item.nextTriggerAt)]) : ''}</Txt>
                <Txt variant="small" tone={outcome.tone === 'done' ? 'done' : outcome.tone === 'failed' ? 'danger' : 'secondary'} numberOfLines={1}>{outcome.label}{item.latestTrigger?.triggeredAt ? ' · ' + formatRelativeTime(item.latestTrigger.triggeredAt) : ''}</Txt>
                <View style={{ flexDirection: 'row' }}>
                  {(item.memberAgentIds || []).slice(0, 5).map((id, index) => {
                    const agent = agents.find((row) => row.id === id);
                    return agent ? <View key={id + index} style={{ marginLeft: index ? -5 : 0, borderWidth: 2, borderColor: colors.bgCanvas, borderRadius: 7 }}><Avatar member={agent} size={20} /></View> : null;
                  })}
                </View>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={list.isPending ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
          : <EmptyState icon={CalendarClock} title={$t('暂无自动化')} description={$t('用 Cron 安排重复任务，独立记录每轮执行与成果。')} />}
        contentContainerStyle={{ paddingBottom: 96 }}
      />
    </>
  );
}
