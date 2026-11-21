// Task center: quick views, search, filters and groups ordered by who needs to act.
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Archive, Filter, ListChecks, Plus, Search } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, RefreshControl, ScrollView, SectionList, View } from 'react-native';

import { useFocusedInterval, useManualRefresh, useWorkspaceKey } from '@/api/queries';
import { useCatalog } from '@/features/catalog';
import { archiveTask, confirmDeleteTask, deleteTask, startTask } from '@/features/tasks/actions';
import { taskFilters } from '@/features/tasks/filters';
import { type Chip, chipOptions, editable, nextAction, readTaskDirectory, type TaskSummary, taskGroups, taskMatchesChip } from '@/features/tasks/model';
import { TaskRow } from '@/features/tasks/task-row';
import { $t, useLocale } from '@/i18n';
import { useDebounced } from '@/lib/store';
import { useTheme } from '@/theme';
import { Chips, TextField } from '@/ui/form';
import { HeaderButton, HeaderButtons } from '@/ui/header';
import { GroupHeader } from '@/ui/layout';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { StatusIcon } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function Tasks() {
  useLocale();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const { colors } = useTheme();
  const [chip, setChip] = useState<Chip>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const term = useDebounced(search.trim(), 300);
  const filters = taskFilters.use();
  const catalog = useCatalog();
  const directory = useQuery({
    queryKey: [...scope, 'tasks', term, filters.status, filters.workflow],
    queryFn: () => readTaskDirectory(client, { search: term, ...filters }, false),
    refetchInterval: useFocusedInterval(10_000),
  });
  const pull = useManualRefresh(directory.refetch);
  const all = directory.data?.all || [];
  const visible = all.filter((task) => taskMatchesChip(task.status, chip));
  const sections = taskGroups().map((group) => ({ ...group, data: visible.filter(group.match) })).filter((group) => group.data.length);
  const filtered = filters.status !== 'all' || filters.workflow !== 'all';

  async function run(task: TaskSummary, work: () => Promise<unknown>) {
    setBusy(task.id);
    try { await work(); await directory.refetch(); }
    catch (error) { toast((error as Error).message, true); }
    finally { setBusy(null); }
  }
  function open(task: TaskSummary) {
    if (editable(task)) router.push({ pathname: '/task/compose', params: { taskId: task.id } });
    else router.push({ pathname: '/task/[taskId]', params: { taskId: task.id } });
  }
  function act(task: TaskSummary) {
    const action = nextAction(task);
    if (action.kind === 'start') void run(task, () => startTask(client, task.id, toast));
    else if (action.kind === 'archive') void run(task, () => archiveTask(client, task.id, toast));
    else open(task);
  }
  function menu(task: TaskSummary) {
    const items: Array<[string, () => void, boolean?]> = [[$t('打开'), () => open(task)]];
    if (editable(task)) items.push([$t('编辑'), () => router.push({ pathname: '/task/compose', params: { taskId: task.id } })]);
    if (task.status === 'done') items.push([$t('归档'), () => void run(task, () => archiveTask(client, task.id, toast))]);
    if (task.deletionBlockedBy === null) items.push([$t('删除任务'), () => confirmDeleteTask(task, () => void run(task, () => deleteTask(client, task.id, toast))), true]);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: task.title, options: [$t('取消'), ...items.map(([label]) => label)], cancelButtonIndex: 0, destructiveButtonIndex: items.findIndex((item) => item[2]) + 1 || undefined },
      (index) => index > 0 && items[index - 1][1](),
    );
  }

  const header = (
    <View style={{ paddingTop: 8, paddingBottom: 8, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
      <View style={{ marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
        <Search size={16} color={colors.textTertiary} />
        <TextField value={search} onChangeText={setSearch} placeholder={$t('筛选任务名称')} returnKeyType="search" clearButtonMode="while-editing"
          accessibilityLabel={$t('筛选任务名称')} style={{ flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0, minHeight: 40 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 4, alignItems: 'center' }}>
        <Chips
          value={chip}
          onChange={setChip}
          options={chipOptions().map((option) => ({ ...option, count: directory.data ? all.filter((task) => taskMatchesChip(task.status, option.value)).length : undefined }))}
        />
      </ScrollView>
      {filtered ? (
        <Txt variant="small" tone="tertiary" style={{ paddingHorizontal: 16, paddingTop: 6 }}>{$t('已应用筛选条件')}</Txt>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: $t('任务') + (directory.data ? ' ' + all.length : ''),
          headerRight: () => (
            <HeaderButtons>
              <HeaderButton icon={Archive} label={$t('归档历史')} onPress={() => router.push('/tasks/archive')} />
              <HeaderButton icon={Filter} label={$t('筛选')} onPress={() => router.push('/tasks/filter')} />
              <HeaderButton icon={Plus} label={$t('新建任务')} onPress={() => router.push('/task/compose')} />
            </HeaderButtons>
          ),
        }}
      />
      <SectionList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.bgCanvas }}
        sections={sections}
        keyExtractor={(task) => task.id}
        stickySectionHeadersEnabled
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <GroupHeader icon={<StatusIcon status={section.status} />} title={section.label} count={section.data.length} note={section.id === 'attention' ? $t('回答澄清、验收交付或处理中断') : undefined} />
        )}
        renderItem={({ item }) => (
          <TaskRow task={item} agents={catalog.data?.agents || []} busy={busy === item.id} onPress={() => open(item)} onLongPress={() => menu(item)} onAction={() => act(item)} />
        )}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        ListEmptyComponent={
          directory.isPending ? <LoadingState label={$t('正在读取任务')} />
            : directory.error ? <ErrorState title={$t('任务读取失败')} message={directory.error.message} onRetry={() => void directory.refetch()} />
              : all.length ? <EmptyState icon={ListChecks} title={$t('没有匹配的任务')} description={$t('请调整筛选条件，或清空任务名称查看全部任务。')} />
                : <EmptyState icon={ListChecks} title={$t('还没有任务')} description={$t('创建一个任务，选择团队或员工，由经理组织协作。')} />
        }
        contentContainerStyle={{ paddingBottom: 96 }}
      />
    </>
  );
}
