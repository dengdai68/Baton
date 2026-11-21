// 待我处理: everything that needs you to answer, accept or recover, grouped.
import { router, Stack } from 'expo-router';
import { Inbox as InboxIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';

import { formatRelativeTime } from '@shared/console-projections.mjs';
import { useManualRefresh } from '@/api/queries';
import { inboxFacts, useInbox } from '@/features/inbox/model';
import type { TaskSummary } from '@/features/tasks/model';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Segmented } from '@/ui/form';
import { GroupHeader } from '@/ui/layout';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { StatusIcon } from '@/ui/status';
import { Txt } from '@/ui/text';

export default function Inbox() {
  useLocale();
  const { colors } = useTheme();
  const [view, setView] = useState<'pending' | 'recent'>('pending');
  const inbox = useInbox(view);
  const pull = useManualRefresh(inbox.refetch);
  const sections = inbox.groups.filter((group) => group.page.data?.tasks.length || group.page.error).map((group) => ({ ...group, data: group.page.error ? [] : group.page.data!.tasks }));
  const loading = inbox.groups.every((group) => group.page.isPending);
  const total = inbox.groups.reduce((sum, group) => sum + (group.page.data?.tasks.length || 0), 0);

  function row(task: TaskSummary) {
    const facts = inboxFacts(task, inbox.detailOf.get(task.id));
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={task.title + '，' + facts.description} onPress={() => router.push({ pathname: '/inbox-item/[taskId]', params: { taskId: task.id } })}
        style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingLeft: 16, paddingRight: 14, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
        <View style={{ paddingTop: 2 }}><StatusIcon status={task.status} size={18} /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Txt weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{task.title}</Txt>
            <Txt variant="caption" tone="tertiary" numeric>{formatRelativeTime(task.updatedAt)}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {facts.agent ? <Avatar member={facts.agent as any} size={18} /> : null}
            <Txt variant="small" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>{facts.description}</Txt>
          </View>
          {facts.summary ? <Txt variant="small" tone="tertiary" numberOfLines={2}>{facts.summary}</Txt> : null}
        </View>
      </Pressable>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: $t('待我处理') + (total ? ' ' + total : '') }} />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.bgCanvas }}
        sections={sections}
        keyExtractor={(task) => task.id}
        stickySectionHeadersEnabled
        ListHeaderComponent={
          <View style={{ padding: 12 }}>
            <Segmented value={view} onChange={setView} options={[{ value: 'pending', label: $t('待处理') }, { value: 'recent', label: $t('最近已处理') }]} />
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View>
            <GroupHeader icon={<StatusIcon status={section.status} />} title={section.label} count={section.page.data?.total} />
            {section.page.error ? <ErrorState message={section.page.error.message} onRetry={() => void section.page.refetch()} /> : null}
          </View>
        )}
        renderItem={({ item }) => row(item)}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        ListEmptyComponent={loading ? <LoadingState label={$t('正在读取事项…')} /> : (
          <EmptyState icon={InboxIcon}
            title={view === 'recent' ? $t('暂无最近处理记录') : $t('暂时没有待处理事项')}
            description={view === 'recent' ? $t('完成确认或回答问题后，可在这里回看。') : $t('需要你回答、验收或恢复时，任务会出现在这里。')} />
        )}
        contentContainerStyle={{ paddingBottom: 96 }}
      />
    </>
  );
}
