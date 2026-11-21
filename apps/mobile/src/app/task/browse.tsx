// A folder of a task's working directory.
import { Stack, useLocalSearchParams } from 'expo-router';

import { DirectoryList } from '@/features/workspace/files';

export default function Browse() {
  const { taskId, runId, path } = useLocalSearchParams<{ taskId: string; runId: string; path: string }>();
  return (
    <>
      <Stack.Screen options={{ title: path.split('/').pop() || path }} />
      <DirectoryList taskId={taskId} runId={runId} path={path} inset />
    </>
  );
}
