// One member's console in a task Run, with live records from the Run stream.
import { Stack, useLocalSearchParams } from 'expo-router';

import { workflowDisplay } from '@shared/console-projections.mjs';
import { ConsoleStream } from '@/features/workspace/console';
import { useRunWorkspace } from '@/features/workspace/data';
import { $t } from '@/i18n';

export default function MemberConsole() {
  const { runId, agentId, traceId } = useLocalSearchParams<{ taskId: string; runId: string; agentId: string; traceId?: string }>();
  const workspace = useRunWorkspace(runId);
  const run = workspace.data?.run;
  const agent = run?.participants?.find((item) => item.id === agentId) || (run?.manager?.id === agentId ? run.manager : null);
  return (
    <>
      <Stack.Screen options={{ title: agent?.name || $t('控制台') }} />
      <ConsoleStream runId={runId} agentId={agentId} traceId={traceId} base={`/api/runs/${encodeURIComponent(runId)}`}
        provider={agent?.runtime?.provider} nodes={(workflowDisplay(run?.task.workflowSnapshot)?.nodes || []) as Array<{ id: string; title?: string }>} />
    </>
  );
}
