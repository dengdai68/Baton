// Read-only Mac settings shown on the phone (runtime, repositories, paths, logs).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useWorkspaceKey } from '@/api/queries';
import { $t } from '@/i18n';
import { useClient } from '@/workspace/session';

export type RuntimeProfile = { id: string; provider: string; installed?: boolean; enabled?: boolean; model?: string; effort?: string; employeeCount?: number };
export type GitProvider = { id: string; label: string; host: string; configured: boolean };
export type WorkspacePaths = {
  workspaceRoot?: string; version?: string; businessRoot?: string; databasePath?: string; runFilesRoot?: string;
  runtimeConfigRoot?: string; configurationRoot?: string; configurationFile?: string; logDirectory?: string;
};
export type LogFiles = { directory?: string; filePath?: string; available?: boolean; error?: string | null; format?: string; retention?: string };
export type ExecutionLog = { id: string; timestamp: string; level: string; type?: string; message: string; source?: string; name?: string };

function useSetting<T>(path: string) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({ queryKey: [...scope, 'setting', path], queryFn: () => client.get<T>(path) });
}
export const useRuntimeProfiles = () => useSetting<{ profiles: RuntimeProfile[] }>('/api/settings/runtime-profiles');
export const useGitProviders = () => useSetting<{ providers: GitProvider[] }>('/api/runtime/git-credentials');
export const useWorkspacePaths = () => useSetting<WorkspacePaths>('/api/settings/workspace');
export const useLogFiles = () => useSetting<LogFiles>('/api/settings/log-files');

export function useExecutionLogs() {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useInfiniteQuery({
    queryKey: [...scope, 'execution-logs'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.get<{ items: ExecutionLog[]; hasMore: boolean; nextBefore: string | null }>('/api/settings/execution-logs', { limit: 50, before: pageParam }),
    getNextPageParam: (page) => (page.hasMore ? page.nextBefore : undefined),
  });
}

/** Two-letter Runtime marks (same as the Mac's runtime settings). */
const RUNTIME_MARKS: Record<string, string> = { 'claude-code': 'CC', codex: 'CX', dsh: 'DS', opencode: 'OC', cursor: 'CU', gemini: 'GE', qwen: 'QW', kimi: 'KM', pi: 'PI' };
export const runtimeMark = (provider: string, label: string) => RUNTIME_MARKS[provider] || label.slice(0, 2).toUpperCase();

/** Appearance preference names (shared by the hub and the appearance page). */
export const themeName = (theme: string) => ({ system: $t('跟随系统'), light: $t('浅色'), dark: $t('深色') } as Record<string, string>)[theme] || theme;
