// "待我处理" — the Mac inbox (web/app.js refreshInbox/inboxFacts): five groups read
// from the task directory, each item described from its compact Run read model.
import { useQueries, useQuery } from '@tanstack/react-query';

import { STATUS_TEXT } from '@shared/console-projections.mjs';
import { useFocusedInterval, useWorkspaceKey } from '@/api/queries';
import type { TaskPage, TaskSummary } from '@/features/tasks/model';
import type { Workspace } from '@/features/workspace/data';
import { $t, $tm } from '@/i18n';
import { useClient } from '@/workspace/session';

export const inboxGroups = () => [
  { status: 'awaiting_human', label: $t('等待你的澄清') },
  { status: 'awaiting_acceptance', label: $t('待你验收') },
  { status: 'failed', label: $t('执行中断') },
  { status: 'paused', label: $t('已暂停') },
  { status: 'blocked', label: $t('等待恢复') },
];

export function useInbox(view: 'pending' | 'recent') {
  const client = useClient();
  const scope = useWorkspaceKey();
  const interval = useFocusedInterval(10_000);
  const groups = view === 'recent' ? [{ status: 'done', label: $t('最近已处理') }] : inboxGroups();
  const pages = useQueries({
    queries: groups.map((group) => ({
      queryKey: [...scope, 'inbox', group.status],
      queryFn: () => client.get<TaskPage>('/api/tasks', { status: group.status, archived: 'false', page: 1, pageSize: 20 }),
      refetchInterval: interval,
    })),
  });
  const tasks = pages.flatMap((page) => page.data?.tasks || []);
  // Compact details only for rows whose run/status/update changed (cached by signature).
  const details = useQueries({
    queries: tasks.map((task) => {
      const run = task.runs?.[0];
      return {
        queryKey: [...scope, 'inbox-detail', task.id, run?.id, run?.status, task.updatedAt],
        queryFn: () => client.get<Workspace>(`/api/runs/${encodeURIComponent(run!.id)}/workspace`, { view: 'compact' }),
        enabled: Boolean(run),
        staleTime: Infinity,
      };
    }),
  });
  const detailOf = new Map(tasks.map((task, index) => [task.id, details[index]?.data]));
  return { groups: groups.map((group, index) => ({ ...group, page: pages[index] })), detailOf, refetch: () => Promise.all(pages.map((page) => page.refetch())) };
}

/** Who asks / what happened, as the Mac inbox row and preview describe it. */
export function inboxFacts(task: TaskSummary, workspace?: Workspace) {
  const run = workspace?.run;
  const question = workspace?.pendingQuestions?.find((item) => item.recipient?.type === 'human');
  const agent = run?.participants?.find((item) => item.id === question?.sender?.id) || question?.sender;
  const failedTrace = (workspace?.traces || []).filter((item) => item.status === 'failed').at(-1);
  const failedAgent = run?.participants?.find((item) => item.id === failedTrace?.agentId);
  const traceError = failedTrace?.error as { message?: string } | string | undefined;
  const error = $tm(run?.failure?.message || (typeof traceError === 'object' ? traceError?.message : traceError) || '');
  const reason = $tm(run?.blockedReason || run?.pauseReason || '');
  const description = ({
    awaiting_human: question ? $t('{0} 向你提问', [agent?.name || $t('任务成员')]) : $t('等待你的澄清'),
    awaiting_acceptance: $t('{0} 提交了验收', [run?.manager?.name || $t('项目经理')]),
    failed: failedAgent ? $t('{0} 执行失败', [failedAgent.name]) : $t('执行失败'),
    paused: reason || $t('任务已暂停'),
    blocked: reason || $t('等待恢复'),
    done: $t('你确认了完成'),
  } as Record<string, string>)[task.status] || STATUS_TEXT[task.status];
  const summary = question?.content || error || run?.acceptanceRequest?.summary || reason || task.objective || '';
  return { run, question, agent, error, reason, description, summary };
}

export const useTaskSummaryDetail = (task: TaskSummary | undefined) => {
  const client = useClient();
  const scope = useWorkspaceKey();
  const run = task?.runs?.[0];
  return useQuery({
    queryKey: [...scope, 'inbox-detail', task?.id, run?.id, run?.status, task?.updatedAt],
    queryFn: () => client.get<Workspace>(`/api/runs/${encodeURIComponent(run!.id)}/workspace`, { view: 'compact' }),
    enabled: Boolean(run),
  });
};
