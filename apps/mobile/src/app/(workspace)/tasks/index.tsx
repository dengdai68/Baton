// Task center: one top row (short search, archive, filter menu, new), quick
// views without counts, and cards ordered by who needs to act. Drafts are not
// shown on the phone.
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Archive, Filter, ListChecks, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';

import { useFocusedInterval, useManualRefresh, useWorkspaceKey } from '@/api/queries';
import { archiveTask } from '@/features/tasks/actions';
import { byNeed, type Chip, chipOptions, readTaskDirectory, rowAction, statusFilters, type TaskSummary, taskMatchesChip } from '@/features/tasks/model';
import { TaskRow } from '@/features/tasks/task-row';
import { $t, useLocale } from '@/i18n';
import { useDebounced } from '@/lib/store';
import { useTheme } from '@/theme';
import { Chips } from '@/ui/form';
import { IconButton } from '@/ui/icon-button';
import { type MenuItem, MenuButton } from '@/ui/menu';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { TabToolbar } from '@/ui/toolbar';
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
  const [status, setStatus] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const term = useDebounced(search.trim(), 300);
  const directory = useQuery({
    queryKey: [...scope, 'tasks', term],
    queryFn: () => readTaskDirectory(client, term),
    refetchInterval: useFocusedInterval(10_000),
  });
  const pull = useManualRefresh(directory.refetch);
  const statusMatch = statusFilters().find((item) => item.id === status)?.match || (() => true);
  const tasks = useMemo(
    () => (directory.data?.all || []).filter((task) => task.status !== 'backlog' && taskMatchesChip(task.status, chip) && statusMatch(task.status)).sort(byNeed),
    [directory.data, chip, status], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filtered = status !== 'all';
  const filterItems: MenuItem[] = [
    { id: 'status', title: $t('任务状态'), inline: true, children: statusFilters().map((item) => ({ id: 'status:' + item.id, title: item.label, checked: status === item.id })) },
    ...(filtered ? [{ id: 'clear', title: $t('清除筛选'), icon: 'xmark.circle' }] : []),
  ];
  function selectFilter(id: string) {
    if (id === 'clear') setStatus('all');
    else if (id.startsWith('status:')) setStatus(id.slice('status:'.length));
  }

  async function act(task: TaskSummary) {
    const action = rowAction(task);
    if (!action) return;
    if (action.kind === 'archive') {
      setBusy(task.id);
      try { await archiveTask(client, task.id, toast); await directory.refetch(); }
      catch (error) { toast((error as Error).message, true); }
      finally { setBusy(null); }
      return;
    }
    if (action.kind === 'accept' && task.runs?.[0]) {
      router.push({ pathname: '/task/confirm', params: { taskId: task.id, runId: task.runs[0].id } });
      return;
    }
    router.push({ pathname: '/task/[taskId]', params: { taskId: task.id } });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      <Stack.Screen options={{ headerShown: false }} />
      <TabToolbar search={search} onSearchChange={setSearch} placeholder={$t('搜索任务')}>
        <IconButton icon={Archive} label={$t('归档历史')} onPress={() => router.push('/tasks/archive')} />
        <MenuButton icon={Filter} label={$t('筛选')} items={filterItems} onSelect={selectFilter} active={filtered} />
        <IconButton icon={Plus} label={$t('新建任务')} onPress={() => router.push('/task/compose')} />
      </TabToolbar>
      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, paddingBottom: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}>
          <Chips value={chip} onChange={setChip} options={chipOptions()} />
        </ScrollView>
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => (
          <TaskRow task={item} busy={busy === item.id} onPress={() => router.push({ pathname: '/task/[taskId]', params: { taskId: item.id } })} onAction={() => void act(item)} />
        )}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          directory.isPending ? <LoadingState label={$t('正在读取任务')} />
            : directory.error ? <ErrorState title={$t('任务读取失败')} message={directory.error.message} onRetry={() => void directory.refetch()} />
              : directory.data?.all.length ? <EmptyState icon={ListChecks} title={$t('没有匹配的任务')} description={$t('请调整筛选条件，或清空搜索查看全部任务。')} />
                : <EmptyState icon={ListChecks} title={$t('还没有任务')} description={$t('点右上角 + 新建任务，选择团队或员工，由经理组织协作。')} />
        }
        contentContainerStyle={{ paddingBottom: 16 }}
      />
    </View>
  );
}
