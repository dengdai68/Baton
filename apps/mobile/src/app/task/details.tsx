// Task details page (members, consoles, focus, description, directory).
import { Stack, useLocalSearchParams } from 'expo-router';

import { useRunWorkspace } from '@/features/workspace/data';
import { Details } from '@/features/workspace/details';
import { $t } from '@/i18n';
import { ErrorState, LoadingState } from '@/ui/states';

export default function TaskDetails() {
  const { taskId, runId } = useLocalSearchParams<{ taskId: string; runId: string }>();
  const workspace = useRunWorkspace(runId);
  const screen = <Stack.Screen options={{ title: $t('任务详情') }} />;
  if (workspace.isPending) return <>{screen}<LoadingState screen /></>;
  if (workspace.error || !workspace.data) return <>{screen}<ErrorState message={workspace.error?.message || ''} onRetry={() => void workspace.refetch()} /></>;
  return <>{screen}<Details workspace={workspace.data} taskId={taskId} /></>;
}
