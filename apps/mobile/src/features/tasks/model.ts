// Task directory semantics shared with the Mac task center: quick views, groups
// ordered by who needs to act, the row's status line and its next action.
import { STATUS_TEXT, taskActionLabel, taskNeedsAttention } from '@shared/console-projections.mjs';
import type { ApiClient } from '@/api/client';
import { $t, $tm } from '@/i18n';

export type Member = { id: string; name: string; color?: string; initials?: string; status?: string; kind?: string; description?: string };
export type RunSummary = { id: string; taskId: string; status: string; artifactCount?: number; failure?: { message?: string } | null };
export type TaskSummary = {
  id: string; title: string; objective: string; status: string; kind?: string; workspaceKind?: string;
  memberAgentIds: string[]; memberSnapshots?: Member[]; managerAgentId?: string;
  workflowTemplateId?: string | null; workflowSnapshot?: { name?: string } | null;
  archivedAt: string | null; createdAt: string; updatedAt: string; deletionBlockedBy: string | null;
  runs?: RunSummary[];
};
export type TaskPage = { tasks: TaskSummary[]; total: number; page: number; pageSize: number; totalPages: number; hasMore: boolean };
export type Chip = 'all' | 'attention' | 'active' | 'backlog' | 'done';
export type TaskFilters = { search: string; status: string; workflow: string };

export const ACTIVE = ['planning', 'running', 'review'];
export const FILTER_STATUSES = ['backlog', 'planning', 'running', 'awaiting_human', 'review', 'awaiting_acceptance', 'paused', 'blocked', 'failed', 'done', 'cancelled'];

export function taskMatchesChip(status: string, chip: Chip): boolean {
  if (chip === 'attention') return taskNeedsAttention(status);
  if (chip === 'active') return ACTIVE.includes(status);
  if (chip === 'done') return ['done', 'completed'].includes(status);
  return chip === 'all' || status === chip;
}

export const chipOptions = (): Array<{ value: Chip; label: string; attention?: boolean }> => [
  { value: 'all', label: $t('全部') },
  { value: 'attention', label: $t('待我处理'), attention: true },
  { value: 'active', label: $t('进行中') },
  { value: 'backlog', label: $t('草稿') },
  { value: 'done', label: $t('已完成') },
];

/** Groups in the order "who needs to act": attention first, paused after running. */
export const taskGroups = () => [
  { id: 'attention', label: $t('待我处理'), status: 'awaiting_human', match: (task: TaskSummary) => task.status !== 'paused' && taskNeedsAttention(task.status) },
  { id: 'active', label: $t('进行中'), status: 'running', match: (task: TaskSummary) => ACTIVE.includes(task.status) },
  { id: 'paused', label: $t('已暂停'), status: 'paused', match: (task: TaskSummary) => task.status === 'paused' },
  { id: 'backlog', label: $t('草稿'), status: 'backlog', match: (task: TaskSummary) => task.status === 'backlog' },
  { id: 'done', label: $t('已完成'), status: 'done', match: (task: TaskSummary) => ['done', 'completed', 'cancelled'].includes(task.status) },
];

export const runOfTask = (task: TaskSummary): RunSummary | undefined => task.runs?.[0];

/** Status line of a row; directory summaries carry only facts, never invented detail. */
export function taskRowStatus(task: TaskSummary): { label: string; detail: string } {
  const run = runOfTask(task);
  const labels: Record<string, string> = {
    awaiting_human: $t('等待你的澄清'), awaiting_acceptance: $t('待你验收'), failed: $t('错误中断'), blocked: $t('错误中断'),
    backlog: $t('尚未开始'), done: $t('你已确认完成'), completed: $t('你已确认完成'),
  };
  const label = labels[task.status] || STATUS_TEXT[task.status] || task.status;
  const detail = task.status === 'awaiting_acceptance' && Number.isInteger(run?.artifactCount)
    ? $t('{0} 个文件', [run?.artifactCount])
    : ['failed', 'blocked'].includes(task.status) ? $tm(run?.failure?.message || '') : '';
  return { label, detail };
}

/** The one next step shown on a row (the rest lives in the row menu). */
export function nextAction(task: TaskSummary): { kind: 'start' | 'archive' | 'open' | 'edit'; label: string } {
  if (task.status === 'backlog' && !runOfTask(task)) return { kind: 'start', label: $t('启动') };
  if (task.status === 'done') return { kind: 'archive', label: $t('归档') };
  if (runOfTask(task)) return { kind: 'open', label: taskActionLabel(task.status) };
  return { kind: 'edit', label: $t('编辑') };
}

export const editable = (task: TaskSummary) => task.status === 'backlog' && !runOfTask(task);

/** Read every page of the current task directory (the Mac does the same before client-side views). */
export async function readTaskDirectory(client: ApiClient, filters: TaskFilters, archived: boolean, page = 1): Promise<TaskPage & { all: TaskSummary[] }> {
  const query = { page, pageSize: archived ? 20 : 100, search: filters.search, status: filters.status, workflow: filters.workflow, archived: String(archived) };
  let result = await client.get<TaskPage>('/api/tasks', query);
  const all = [...result.tasks];
  while (!archived && result.page < result.totalPages) {
    result = await client.get<TaskPage>('/api/tasks', { ...query, page: result.page + 1 });
    all.push(...result.tasks);
  }
  return { ...result, all };
}

export function membersOf(task: TaskSummary, agents: Member[], limit = 5): Member[] {
  return (task.memberAgentIds || []).slice(0, limit)
    .map((id) => task.memberSnapshots?.find((agent) => agent.id === id) || agents.find((agent) => agent.id === id))
    .filter(Boolean) as Member[];
}
