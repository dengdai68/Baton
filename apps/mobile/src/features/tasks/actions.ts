// Task commands shared by the list, the workspace and the inbox.
import { router } from 'expo-router';
import { Alert } from 'react-native';

import type { ApiClient } from '@/api/client';
import { $t } from '@/i18n';
import type { TaskSummary } from './model';

type Toast = (message: string, error?: boolean) => void;

/** Start a draft's Run and open its workspace. */
export async function startTask(client: ApiClient, taskId: string, toast: Toast) {
  const { run } = await client.post<{ run: { id: string } }>(`/api/tasks/${taskId}/run`, {});
  toast($t('真实本机 Run 已启动'));
  router.push({ pathname: '/task/[taskId]', params: { taskId, runId: run.id } });
}

export async function archiveTask(client: ApiClient, taskId: string, toast: Toast, restore = false) {
  await client.post(`/api/tasks/${taskId}/${restore ? 'unarchive' : 'archive'}`, {});
  toast(restore ? $t('任务已恢复到任务中心') : $t('任务已归档'));
}

/** Explicit destructive confirmation mirroring the Mac dialog's consequences. */
export function confirmDeleteTask(task: TaskSummary, onConfirm: () => void) {
  if (task.deletionBlockedBy) {
    Alert.alert($t('暂时不能删除'), task.deletionBlockedBy === 'active_inquiries' ? $t('答疑进行中，请等待答复完成后重试删除。') : $t('存在活跃 Run，不能删除 Task。'));
    return;
  }
  Alert.alert(
    $t('删除任务'),
    $t('将永久删除「{0}」及其 Run、消息、交付快照和审计记录，无法恢复。活跃 Run 或答疑进行中时不能删除。', [task.title]),
    [
      { text: $t('取消'), style: 'cancel' },
      { text: $t('永久删除任务'), style: 'destructive', onPress: onConfirm },
    ],
  );
}

export async function deleteTask(client: ApiClient, taskId: string, toast: Toast) {
  const result = await client.del<{ runFileCleanup?: string }>(`/api/tasks/${taskId}`);
  toast(result?.runFileCleanup === 'pending' ? $t('任务记录已删除；本地快照已隔离，服务将在下次启动时继续清理。') : $t('任务及其本地运行记录已删除。'));
}
