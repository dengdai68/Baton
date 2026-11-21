// Desktop directory endpoints for 更多 sections (agents / teams / workflows / roles / extensions).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useFocusedInterval, useWorkspaceKey } from '@/api/queries';
import { useClient } from '@/workspace/session';

export type Member = { id: string; name: string; color?: string; initials?: string; status?: string; kind?: string; description?: string; roleIds?: string[]; runtime?: any; capabilities?: string[]; systemPrompt?: string };
export type Team = { id: string; name: string; mission?: string; status?: string; memberAgentIds: string[]; createdAt?: string; updatedAt?: string };
export type Workflow = { id: string; name: string; description?: string; system?: boolean; nodes?: Array<{ id: string; title?: string; description?: string; deliverable?: string }>; edges?: Array<{ from: string; to: string }>; updatedAt?: string };
export type Role = { id: string; name: string; prompt?: string; updatedAt?: string };

// Directory endpoints return their collection under different keys.
const listKey = (resource: string) => ({ agents: 'agents', teams: 'teams', 'workflow-templates': 'workflowTemplates', roles: 'roles', 'runtime/marketplace': 'items', 'runtime/mcp-marketplace': 'items', 'runtime/git-credentials': 'items' } as any)[resource] || 'items';

export function useDirectory<T>(resource: string, pageSize = 50) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const key = listKey(resource);
  return useInfiniteQuery({
    queryKey: [...scope, 'directory', resource],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => client.get<Record<string, unknown> & { page: number; totalPages: number; total: number }>(`/api/${resource}`, { page: pageParam, pageSize }),
    getNextPageParam: (page) => (page.page < page.totalPages ? page.page + 1 : undefined),
    refetchInterval: useFocusedInterval(10_000),
    select: (data) => ({
      ...data,
      pages: data.pages.map((page) => ({ ...page, items: (Array.isArray(page[key]) ? page[key] : []) as T[] })),
    }),
  });
}
export const directoryItems = <T,>(data: { pages?: Array<{ items: T[] }> } | undefined): T[] => (data?.pages || []).flatMap((page) => page.items || []);

export function useDetail<T>(path: string | null) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({
    queryKey: [...scope, 'detail', path],
    queryFn: () => client.get<{ [key: string]: T }>(path as string).then((result) => Object.values(result)[0] as T),
    enabled: Boolean(path),
    refetchInterval: useFocusedInterval(10_000),
  });
}
