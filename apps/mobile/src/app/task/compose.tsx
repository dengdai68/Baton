// New task, edit a draft (?taskId=), or new/edit an automation (?automation=1&id=).
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { useAutomation } from '@/features/automations/model';
import { startTask } from '@/features/tasks/actions';
import { TaskForm, type TaskSource } from '@/features/tasks/task-form';
import { useTaskDetail } from '@/features/workspace/data';
import { $t } from '@/i18n';
import { Button } from '@/ui/button';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

function EditDraft({ taskId }: { taskId: string }) {
  const client = useClient();
  const toast = useToast();
  const task = useTaskDetail(taskId);
  if (task.isPending) return <LoadingState />;
  if (task.error) return <ErrorState message={task.error.message} onRetry={() => void task.refetch()} />;
  const draft = task.data;
  if (draft.kind !== 'manual' || draft.status !== 'backlog' || draft.runs?.length)
    return <View style={{ padding: 16, gap: 12 }}><Notice tone="attention" text={$t('此任务已启动，不能编辑草稿。')} /><Button label={$t('关闭')} onPress={() => router.back()} /></View>;
  return <TaskForm existing={draft as unknown as TaskSource} onStart={(id) => startTask(client, id, toast)} />;
}

function EditAutomation({ automationId }: { automationId: string }) {
  const automation = useAutomation(automationId);
  if (automation.isPending) return <LoadingState />;
  if (automation.error) return <ErrorState message={automation.error.message} onRetry={() => void automation.refetch()} />;
  return <TaskForm automation existing={automation.data as unknown as TaskSource} />;
}

export default function ComposeTask() {
  const { taskId, teamId, automation, id } = useLocalSearchParams<{ taskId?: string; teamId?: string; automation?: string; id?: string }>();
  const isAutomation = automation === '1';
  const client = useClient();
  const toast = useToast();
  const title = taskId ? $t('编辑任务草稿') : isAutomation ? (id ? $t('编辑自动化') : $t('新建自动化')) : $t('新建任务');
  return (
    <>
      <Stack.Screen options={{ title, headerLeft: () => <Button size="sm" variant="ghost" label={$t('取消')} onPress={() => router.back()} /> }} />
      {isAutomation && id ? <EditAutomation automationId={id} /> : taskId ? <EditDraft taskId={taskId} /> : (
        <TaskForm automation={isAutomation} presetTeamId={teamId} onStart={(id) => startTask(client, id, toast)} />
      )}
    </>
  );
}
