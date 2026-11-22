// Task directory semantics shared with the Mac task center: quick views, the
// "who needs to act" order, the row's status line and its single next action.
import {
  Archive, CircleHelp, ClipboardCheck, type LucideIcon, Play, RotateCcw,
} from 'lucide-react-native';

import { STATUS_TEXT, taskNeedsAttention } from '@shared/console-projections.mjs';
import type { ApiClient } from '@/api/client';
import type { IconTone } from '@/ui/icon-button';
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
export type Chip = 'all' | 'attention' | 'active' | 'done';
export type TaskFilters = { search: string; status: string; workflow: string };

export const ACTIVE = ['planning', 'running', 'review'];

export function taskMatchesChip(status: string, chip: Chip): boolean {
  if (chip === 'attention') return taskNeedsAttention(status);
  if (chip === 'active') return ACTIVE.includes(status);
  if (chip === 'done') return ['done', 'completed'].includes(status);
  return true;
}

export const chipOptions = (): Array<{ value: Chip; label: string }> => [
  { value: 'all', label: $t('全部') },
  { value: 'attention', label: $t('待我处理') },
  { value: 'active', label: $t('进行中') },
  { value: 'done', label: $t('已完成') },
];

/** Finer status filters for the filter menu (labels are unique; merged where the Mac shows one label). */
export const statusFilters = () => [
  { id: 'all', label: $t('全部状态'), match: () => true },
  { id: 'awaiting_human', label: STATUS_TEXT.awaiting_human, match: (status: string) => status === 'awaiting_human' },
  { id: 'awaiting_acceptance', label: STATUS_TEXT.awaiting_acceptance, match: (status: string) => status === 'awaiting_acceptance' },
  { id: 'paused', label: STATUS_TEXT.paused, match: (status: string) => status === 'paused' },
  { id: 'failed', label: STATUS_TEXT.failed, match: (status: string) => ['failed', 'blocked'].includes(status) },
  { id: 'cancelled', label: STATUS_TEXT.cancelled, match: (status: string) => status === 'cancelled' },
];

/** Mac order (web/app.js taskGroupOrder): needs you, running, paused, then the rest; newest first inside. */
export function groupOrder(status: string): number {
  if (status === 'paused') return 2;
  if (taskNeedsAttention(status)) return 0;
  if (ACTIVE.includes(status)) return 1;
  return status === 'backlog' ? 3 : 4;
}
export const byNeed = (a: TaskSummary, b: TaskSummary) => groupOrder(a.status) - groupOrder(b.status) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

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

export type RowAction = { kind: 'archive' | 'accept' | 'open'; icon: LucideIcon; label: string; tone: IconTone };

/** The one next step of a row, as an icon (Mac labels kept for accessibility). */
export function rowAction(task: TaskSummary): RowAction | null {
  if (task.status === 'done' && !task.archivedAt) return { kind: 'archive', icon: Archive, label: $t('归档'), tone: 'neutral' };
  if (!runOfTask(task)) return null;
  if (task.status === 'awaiting_acceptance') return { kind: 'accept', icon: ClipboardCheck, label: $t('去验收'), tone: 'attention' };
  if (task.status === 'awaiting_human') return { kind: 'open', icon: CircleHelp, label: $t('去澄清'), tone: 'attention' };
  if (task.status === 'paused') return { kind: 'open', icon: Play, label: $t('查看并继续'), tone: 'accent' };
  if (['failed', 'blocked'].includes(task.status)) return { kind: 'open', icon: RotateCcw, label: $t('查看恢复选项'), tone: 'danger' };
  return null;
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
