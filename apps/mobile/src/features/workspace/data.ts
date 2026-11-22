// Task workspace data: the task, its Run read model (compact), paged
// collaboration records and live refresh from the Run's event stream.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useFocusedInterval, useWorkspaceKey } from '@/api/queries';
import type { TaskSummary } from '@/features/tasks/model';
import { $t } from '@/i18n';
import { useClient, useSession } from '@/workspace/session';

export type Party = { type: string; id: string; name: string };
export type Agent = { id: string; name: string; color?: string; initials?: string; kind?: string; status?: string; description?: string; runtime?: { provider?: string; model?: string; effort?: string }; sourceAgentId?: string; type?: string };
export type Question = { id: string; sender: Party; recipient: Party; content: string; createdAt: string; workflowNodeId?: string; traceId?: string; startMessageId?: string };
export type Trace = { id: string; agentId: string; workflowNodeId?: string; type: string; status: string; startedAt?: string; endedAt?: string; error?: unknown; dispatchId?: string };
export type Dispatch = { id: string; status: string; nextRetryAt?: string | null; interactionOnly?: boolean; traceIds: string[]; escalatedAt?: string; waitingMessageId?: string | null; sourceMessageId?: string | null; recipientAgentId?: string; workflowNodeId?: string };
export type WorkflowNode = { id: string; title?: string; name?: string; description?: string; type?: string; deliverable?: string };
export type RunTask = TaskSummary & {
  workflowSnapshot?: { name?: string; nodes?: WorkflowNode[]; edges?: unknown[] } | null;
  acceptanceCriteria?: string[]; automationId?: string; workspacePath?: string; managerAgentId?: string;
};
export type Run = {
  id: string; taskId: string; status: string; workspacePath?: string; manager: Agent; participants: Agent[];
  currentFocus?: { nodeId?: string } | null; waitingNodeId?: string | null; startedAt?: string; completedAt?: string | null;
  failure?: { message?: string; phase?: string; dispatchId?: string } | null; summary?: string | null;
  acceptanceRequest?: { summary?: string; traceId?: string } | null; deliveryReview?: { findings?: string[]; traceId?: string } | null;
  artifactCount?: number; traceCount?: number; traceCounts?: Record<string, number>; removedParticipantIds?: string[];
  blockedReason?: string; pauseReason?: string; task: RunTask;
};
export type Workspace = {
  run: Run; traces?: Trace[]; dispatches?: Dispatch[]; pendingQuestions?: Question[]; failureEvents?: unknown[];
  deletedAgentIds?: string[]; artifacts?: Array<{ id: string; name: string }>;
};
export type Attachment = { id: string; name: string; bytes?: number; mediaType?: string; sha256?: string };
export type CollaborationRecord = {
  id: string; clientRequestId?: string; timestamp: string; category: string; senderType: string; senderId: string | null;
  from: string; to: string | null; recipientType?: string | null; title: string; content: string; attachments?: Attachment[];
  status: string; statusCode: string; tone: string; canReply: boolean; replyId: string; traceId?: string | null;
  executionTraceId?: string | null; startMessageId?: string | null; reason?: string | null; files?: Array<{ id: string; name: string }>; fileCount?: number;
};
type CollaborationPage = { items: CollaborationRecord[]; hasMore: boolean; nextBefore: string | null; total: number };

export function useTaskDetail(taskId: string) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({
    queryKey: [...scope, 'task', taskId],
    queryFn: () => client.get<{ task: RunTask }>(`/api/tasks/${encodeURIComponent(taskId)}`).then((result) => result.task),
  });
}

/** Compact Run read model, refreshed after live events (debounced like the Mac). */
export function useRunWorkspace(runId: string | undefined) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const { live } = useSession();
  const interval = useFocusedInterval(live ? 60_000 : 10_000);
  const query = useQuery({
    queryKey: [...scope, 'run', runId],
    queryFn: () => client.get<Workspace>(`/api/runs/${encodeURIComponent(runId as string)}/workspace`, { view: 'compact' }),
    enabled: Boolean(runId),
    refetchInterval: interval,
  });

  return { ...query, live };
}

/** Paged collaboration records (newest page first, older pages on demand). */
export function useCollaboration(runId: string | undefined) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const interval = useFocusedInterval(15_000);
  return useInfiniteQuery({
    queryKey: [...scope, 'collaboration', runId],
    enabled: Boolean(runId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      client.get<CollaborationPage>(`/api/runs/${encodeURIComponent(runId as string)}/collaboration`, { limit: 30, human: 'false', before: pageParam }),
    getNextPageParam: (page) => (page.hasMore ? page.nextBefore : undefined),
    refetchInterval: interval,
  });
}

/** Merge pages oldest → newest without duplicates. */
export function collaborationItems(pages: CollaborationPage[] | undefined): CollaborationRecord[] {
  const byId = new Map<string, CollaborationRecord>();
  for (const page of [...(pages || [])].reverse()) for (const item of page.items) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

// Same recovery semantics as the Mac task workspace (web/app.js).
export function retryableDispatches(workspace: Workspace): Dispatch[] {
  const run = workspace.run;
  if (!run || run.task?.archivedAt) return [];
  return (workspace.dispatches || []).filter((item) => item.status === 'queued' && item.nextRetryAt && (['planning', 'running', 'review'].includes(run.status) || item.interactionOnly));
}

export function failedRunRecovery(workspace: Workspace): { type: 'node' | 'orchestration'; nodeIds: string[] } | null {
  const run = workspace.run;
  if (!run || run.status !== 'failed' || run.task?.archivedAt) return null;
  if (run.failure?.phase === 'workspace_baseline_missing') return null;
  const nodeIds = [...new Set((workspace.traces || []).filter((trace) => {
    if (trace.status !== 'failed' || !['node', 'instruction', 'consultation'].includes(trace.type)) return false;
    const delivery = (workspace.dispatches || []).find((item) => item.traceIds.includes(trace.id));
    if (run.failure?.dispatchId && delivery?.id !== run.failure.dispatchId) return false;
    return !delivery || (!delivery.interactionOnly && !delivery.escalatedAt && ['cancelled', 'queued'].includes(delivery.status) && delivery.traceIds.at(-1) === trace.id);
  }).map((trace) => trace.workflowNodeId as string))];
  return nodeIds.length ? { type: 'node', nodeIds } : { type: 'orchestration', nodeIds: [] };
}

export function acceptanceReview(workspace: Workspace | undefined, history = false) {
  const run = workspace?.run;
  if (!run || !(history ? ['awaiting_acceptance', 'completed'].includes(run.status) : run.status === 'awaiting_acceptance' && !run.task?.archivedAt)) return null;
  const review = run.deliveryReview && typeof run.deliveryReview === 'object' && !Array.isArray(run.deliveryReview) ? run.deliveryReview : {};
  const findings = run.acceptanceRequest?.summary ? [run.acceptanceRequest.summary]
    : Array.isArray(review.findings) ? review.findings.filter((finding) => typeof finding === 'string' && finding.trim()).map((finding) => finding.trim()) : [];
  const criteria = Array.isArray(run.task?.acceptanceCriteria) ? run.task.acceptanceCriteria.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
  return { findings, criteria, artifactCount: run.artifactCount ?? (workspace?.artifacts || []).length };
}

/** Members that cannot be removed now, with the reason shown in the picker (same rules as the Mac and the Store). */
export function lockedMembers(workspace: Workspace): Map<string, string> {
  const locked = new Map<string, string>();
  const busy = $t('此员工有尚未结束的执行或交接');
  for (const trace of workspace.traces || []) if (trace.status === 'running') locked.set(trace.agentId, busy);
  for (const delivery of workspace.dispatches || []) if (delivery.recipientAgentId && !['done', 'cancelled'].includes(delivery.status)) locked.set(delivery.recipientAgentId, busy);
  locked.set(workspace.run.manager.id, $t('必须保留当前项目经理'));
  return locked;
}
