// File preview: working file, saved snapshot or Git diff.
import { Stack, useLocalSearchParams } from 'expo-router';

import { FilePreview } from '@/features/workspace/files';

export default function File() {
  const { runId, path, source, artifactId, repo } = useLocalSearchParams<{ runId: string; path: string; source: 'working' | 'artifact' | 'diff'; artifactId?: string; repo?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: path.split('/').pop() || path }} />
      <FilePreview runId={runId} path={path} source={source || 'working'} artifactId={artifactId} repo={repo} />
    </>
  );
}
