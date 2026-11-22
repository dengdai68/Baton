// Scheduled automations: the same facts the desktop directory shows (rule,
// next run, latest outcome) plus trigger records leading to their tasks.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useFocusedInterval, useWorkspaceKey } from '@/api/queries';
import { $t, $tm } from '@/i18n';
import { useClient } from '@/workspace/session';

export type Trigger = {
  id: string; source?: 'schedule' | 'manual' | string; plannedAt?: string; createdAt?: string; completedAt?: string | null;
  /** started | skipped | failed: whether this round created its task. */
  outcome?: string; reason?: string | null; error?: string | null;
  /** The created task's status (the Mac shows this pill); completion 'automatic' = confirmed by the next round. */
  status?: string; completion?: string | null; taskId?: string; taskTitle?: string; runId?: string;
};
export type Automation = {
  id: string; title: string; objective: string; enabled: boolean; cron: string; timeZone?: string;
  nextTriggerAt?: string | null; latestTrigger?: Trigger | null; latestExecution?: { startedAt: string; status: string; taskId: string } | null;
  memberAgentIds: string[]; managerAgentId?: string; workflowTemplateId?: string | null; acceptanceCriteria?: string[]; version?: number; updatedAt?: string;
};
type List = { items: Automation[]; page: number; totalPages: number; total: number };

export type AutomationFilter = 'all' | 'enabled' | 'disabled';

export function useAutomations(status: AutomationFilter, search: string) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useInfiniteQuery({
    queryKey: [...scope, 'automations', status, search],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => client.get<List>('/api/automations', { page: pageParam, status, search }),
    getNextPageParam: (page) => (page.page < page.totalPages ? page.page + 1 : undefined),
    refetchInterval: useFocusedInterval(8_000),
  });
}

export function useAutomation(id: string) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({
    queryKey: [...scope, 'automation', id],
    queryFn: () => client.get<{ automation: Automation }>(`/api/automations/${encodeURIComponent(id)}`).then((result) => result.automation),
    refetchInterval: useFocusedInterval(8_000),
  });
}

export function useAutomationTriggers(id: string, enabled: boolean) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({
    queryKey: [...scope, 'automation-triggers', id],
    queryFn: () => client.get<{ items: Trigger[] }>(`/api/automations/${encodeURIComponent(id)}/triggers`, { pageSize: 50 }),
    enabled,
    refetchInterval: useFocusedInterval(8_000),
  });
}

/** A trigger round's state as the Mac shows it: the task status, or skipped / automatically confirmed. */
export function triggerState(trigger: Trigger | null | undefined): { status?: string; label?: string; tone?: 'done' | 'failed' | 'attention' | 'neutral' } {
  if (!trigger) return { label: $t('尚未触发'), tone: 'neutral' };
  if (trigger.outcome === 'skipped' || trigger.status === 'skipped') return { label: trigger.reason ? $t('已跳过：{0}', [$tm(trigger.reason)]) : $t('已跳过'), tone: 'neutral' };
  if (trigger.completion === 'automatic') return { label: $t('已自动确认'), tone: 'done' };
  if (trigger.status) return { status: trigger.status };
  if (['failed', 'error'].includes(trigger.outcome || '')) return { label: $t('触发失败：{0}', [$tm(trigger.error || trigger.reason || '') || $t('未知原因')]), tone: 'failed' };
  return { label: $t('已开始'), tone: 'attention' };
}

export const triggerSource = (trigger: Trigger) => (trigger.source === 'schedule' ? $t('定时') : $t('手动'));
