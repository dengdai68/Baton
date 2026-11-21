// Scheduled automations: the same facts the desktop directory shows (rule,
// next run, latest outcome) plus trigger records leading to their tasks.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useFocusedInterval, useWorkspaceKey } from '@/api/queries';
import { $t } from '@/i18n';
import { useClient } from '@/workspace/session';

export type Automation = {
  id: string; title: string; objective: string; enabled: boolean; cron: string; timeZone?: string;
  nextTriggerAt?: string | null; latestTrigger?: { outcome?: string; reason?: string; triggeredAt?: string; taskId?: string; runId?: string; error?: string } | null;
  memberAgentIds: string[]; managerAgentId?: string; workflowTemplateId?: string | null; acceptanceCriteria?: string[]; version?: number; updatedAt?: string;
};
type List = { items: Automation[]; page: number; totalPages: number; total: number };
export type Trigger = { id: string; outcome: string; reason?: string | null; triggeredAt: string; finishedAt?: string | null; taskId?: string; taskTitle?: string; runId?: string; error?: string | null };

export function useAutomations(enabled?: 'all' | 'on' | 'off') {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useInfiniteQuery({
    queryKey: [...scope, 'automations', enabled ?? 'all'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => client.get<List>('/api/automations', { page: pageParam }),
    getNextPageParam: (page) => (page.page < page.totalPages ? page.page + 1 : undefined),
    refetchInterval: useFocusedInterval(8_000),
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.filter((item) => (enabled === 'on' ? item.enabled : enabled === 'off' ? !item.enabled : true)),
      })),
    }),
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

export const outcomeText = (trigger: Automation['latestTrigger'] | Trigger): { label: string; tone: 'done' | 'failed' | 'attention' | 'running' } => {
  if (!trigger) return { label: $t('尚未触发'), tone: 'attention' };
  const outcome = trigger.outcome || '';
  if (outcome === 'started') return { label: $t('已开始'), tone: 'running' };
  if (outcome === 'completed') return { label: $t('已完成'), tone: 'done' };
  if (outcome === 'skipped') return { label: trigger.reason || $t('已跳过'), tone: 'attention' };
  if (outcome === 'failed') return { label: $t('失败：{0}', [trigger.error || trigger.reason || $t('未知原因')]), tone: 'failed' };
  if (outcome === 'error') return { label: $t('触发失败：{0}', [trigger.reason || $t('未知原因')]), tone: 'failed' };
  return { label: outcome, tone: 'attention' };
};
