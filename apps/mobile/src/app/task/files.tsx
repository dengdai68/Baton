// Task files (pushed from the task header): working directory, changes and
// delivery snapshots, below the native header.
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { View } from 'react-native';

import { FilesPanel } from '@/features/workspace/files';
import { useRunWorkspace, useTaskDetail } from '@/features/workspace/data';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { LoadingState } from '@/ui/states';

export default function TaskFiles() {
  useLocale();
  const { taskId, runId: runParam } = useLocalSearchParams<{ taskId: string; runId?: string }>();
  const { colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const task = useTaskDetail(taskId);
  const runId = runParam || task.data?.runs?.[0]?.id;
  const workspace = useRunWorkspace(runId);
  const run = workspace.data?.run;
  return (
    <View style={{ flex: 1, paddingTop: headerHeight, backgroundColor: colors.bgCanvas }}>
      <Stack.Screen options={{ title: $t('文件') }} />
      {runId ? <FilesPanel taskId={taskId} runId={runId} artifactCount={run?.artifactCount} /> : <LoadingState />}
    </View>
  );
}
