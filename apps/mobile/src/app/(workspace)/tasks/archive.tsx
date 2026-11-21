// Archived tasks: complete records kept; restore to the task center or delete.
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Archive } from 'lucide-react-native';
import { ActionSheetIOS, FlatList, RefreshControl, View } from 'react-native';

import { formatExactTime, workflowDisplay } from '@shared/console-projections.mjs';
import { useManualRefresh, useWorkspaceKey } from '@/api/queries';
import { archiveTask, confirmDeleteTask, deleteTask } from '@/features/tasks/actions';
import type { TaskPage, TaskSummary } from '@/features/tasks/model';
import { $t } from '@/i18n';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/layout';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { StatusIcon } from '@/ui/status';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function ArchivedTasks() {
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const pages = useInfiniteQuery({
    queryKey: [...scope, 'tasks-archive'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => client.get<TaskPage>('/api/tasks', { page: pageParam, pageSize: 20, archived: 'true', status: 'all', workflow: 'all' }),
    getNextPageParam: (page) => (page.page < page.totalPages ? page.page + 1 : undefined),
  });
  const tasks = (pages.data?.pages || []).flatMap((page) => page.tasks);
  const pull = useManualRefresh(pages.refetch);
  async function run(work: () => Promise<unknown>) {
    try { await work(); await pages.refetch(); } catch (error) { toast((error as Error).message, true); }
  }
  function menu(task: TaskSummary) {
    const items: Array<[string, () => void, boolean?]> = [
      [$t('打开'), () => router.push({ pathname: '/task/[taskId]', params: { taskId: task.id } })],
      [$t('恢复任务'), () => void run(() => archiveTask(client, task.id, toast, true))],
    ];
    if (task.deletionBlockedBy === null) items.push([$t('删除任务'), () => confirmDeleteTask(task, () => void run(() => deleteTask(client, task.id, toast))), true]);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: task.title, options: [$t('取消'), ...items.map((item) => item[0])], cancelButtonIndex: 0, destructiveButtonIndex: items.findIndex((item) => item[2]) + 1 || undefined },
      (index) => index > 0 && items[index - 1][1](),
    );
  }
  return (
    <>
      <Stack.Screen options={{ title: $t('归档历史') }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={tasks}
        keyExtractor={(task) => task.id}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        renderItem={({ item }) => (
          <ListRow
            leading={<StatusIcon status={item.status} size={18} />}
            title={item.title}
            subtitle={[workflowDisplay(item.workflowSnapshot)?.name, item.archivedAt ? $t('归档于 {0}', [formatExactTime(item.archivedAt)]) : ''].filter(Boolean).join(' · ')}
            onPress={() => menu(item)}
            chevron={false}
            trailing={<Button size="sm" label={$t('恢复任务')} onPress={() => void run(() => archiveTask(client, item.id, toast, true))} />}
          />
        )}
        onEndReached={() => { if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage(); }}
        ListEmptyComponent={pages.isPending ? <LoadingState /> : pages.error ? <ErrorState message={pages.error.message} onRetry={() => void pages.refetch()} /> : <EmptyState icon={Archive} title={$t('没有归档任务')} description={$t('归档的任务保留完整记录，可以恢复到任务中心或删除。')} />}
        ListFooterComponent={pages.isFetchingNextPage ? <View style={{ padding: 16 }}><LoadingState /></View> : undefined}
      />
    </>
  );
}
