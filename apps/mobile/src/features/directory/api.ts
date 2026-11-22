// Read-only directory data for 更多: agents, teams, workflows, roles, plugins
// and MCP, read through the same desktop API the Mac client uses.
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';

import { useFocusedInterval, useWorkspaceKey } from '@/api/queries';
import { useClient } from '@/workspace/session';

export type Selection = { pluginIds?: string[]; mcpIds?: string[] };
export type Member = {
  id: string; name: string; color?: string; initials?: string; status?: string; kind?: string; description?: string; roleIds?: string[];
  system?: boolean; capabilities?: string[]; systemPrompt?: string; inheritedExtensionSelection?: Selection;
  runtime?: { profileId?: string; provider?: string; model?: string; effort?: string; extensionSelection?: Selection };
};
export type Team = { id: string; name: string; mission?: string; status?: string; memberAgentIds: string[]; members?: Member[]; createdAt?: string };
export type WorkflowNode = {
  id: string; type?: string; title?: string; description?: string; deliverable?: string; staffingGuidance?: string; dependsOn?: string[]; artifactPaths?: string[];
};
export type WorkflowEdge = { id?: string; source: string; target: string; condition?: string; description?: string; dependency?: boolean; handoff?: boolean };
export type Workflow = { id: string; name: string; description?: string; system?: boolean; nodes?: WorkflowNode[]; edges?: WorkflowEdge[]; referenceCount?: number; updatedAt?: string };
export type Role = { id: string; name: string; prompt?: string; extensionSelection?: Selection; createdAt?: string; updatedAt?: string };
export type PluginComponent = { name?: string; event?: string; description?: string; providers?: string[] };
export type Extension = {
  id: string; kind?: string; name: string; description?: string; version?: string; createdAt?: string; providers?: string[];
  source?: { url?: string; origin?: { url?: string } };
  compatibility?: Record<string, { reasons?: string[] }>;
  warnings?: Array<{ plugin?: string; component?: string; path?: string; message?: string }>;
  components?: Record<'skills' | 'agents' | 'hooks', PluginComponent[] | number>;
  configuration?: { mcpServers?: Record<string, { command?: string; type?: string; url?: string }> };
  redacted?: boolean;
};
export type McpTool = { name: string; title?: string; description?: string };

export type DirectoryKind = 'agents' | 'teams' | 'workflows' | 'roles' | 'plugins' | 'mcp';
/** API resource, list key and detail key per section (plugin/MCP details are the object itself). */
export const directorySpec: Record<DirectoryKind, { resource: string; list: string; detail: string | null; extension?: boolean }> = {
  agents: { resource: 'agents', list: 'agents', detail: 'agent' },
  teams: { resource: 'teams', list: 'teams', detail: 'team' },
  workflows: { resource: 'workflow-templates', list: 'workflowTemplates', detail: 'workflowTemplate' },
  roles: { resource: 'roles', list: 'roles', detail: 'role' },
  plugins: { resource: 'runtime/marketplace', list: 'plugins', detail: null, extension: true },
  mcp: { resource: 'runtime/mcp-marketplace', list: 'entries', detail: null, extension: true },
};
export const isDirectoryKind = (value: unknown): value is DirectoryKind => typeof value === 'string' && value in directorySpec;

type Page = Record<string, unknown> & { page?: number; totalPages?: number };
const PAGE_SIZE = 50;

/** One section's list, searched on the server (the marketplace accepts only page and search). */
export function useDirectory<T>(kind: DirectoryKind, search = '') {
  const client = useClient();
  const scope = useWorkspaceKey();
  const spec = directorySpec[kind];
  return useInfiniteQuery({
    queryKey: [...scope, 'directory', kind, search],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => client.get<Page>(`/api/${spec.resource}`, { page: pageParam, pageSize: spec.extension ? undefined : PAGE_SIZE, search: search || undefined }),
    getNextPageParam: (page) => (page.page && page.totalPages && page.page < page.totalPages ? page.page + 1 : undefined),
    refetchInterval: useFocusedInterval(30_000),
    select: (data) => data.pages.flatMap((page) => (Array.isArray(page[spec.list]) ? (page[spec.list] as T[]) : [])),
  });
}

async function detailOf<T>(client: ReturnType<typeof useClient>, kind: DirectoryKind, id: string): Promise<T> {
  const spec = directorySpec[kind];
  const result = await client.get<Record<string, unknown>>(`/api/${spec.resource}/${encodeURIComponent(id)}`);
  return (spec.detail ? result[spec.detail] : result) as T;
}

/** One entry of a section. */
export function useDirectoryDetail<T>(kind: DirectoryKind, id: string) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({ queryKey: [...scope, 'directory-detail', kind, id], queryFn: () => detailOf<T>(client, kind, id), enabled: Boolean(id) });
}

/** Several entries of one section by id (role prompts, selected plugins and MCP). */
export function useDirectoryDetails<T>(kind: DirectoryKind, ids: string[]) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQueries({
    queries: ids.map((id) => ({ queryKey: [...scope, 'directory-detail', kind, id], queryFn: () => detailOf<T>(client, kind, id), retry: false })),
  });
}

/** Every employee with its runtime selection (for "who selected this plugin / MCP / role"). */
export function useAllAgents() {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({
    queryKey: [...scope, 'directory-all', 'agents'],
    queryFn: async () => {
      const agents: Member[] = [];
      for (let page = 1; page <= 40; page += 1) {
        const result = await client.get<{ agents: Member[]; hasMore?: boolean }>('/api/agents', { page, pageSize: PAGE_SIZE });
        agents.push(...result.agents);
        if (!result.hasMore) break;
      }
      return agents;
    },
    staleTime: 30_000,
  });
}

/** Plugin and MCP ids an employee uses: its own selection plus what its roles bring. */
export function selectedExtensions(member: Pick<Member, 'runtime' | 'inheritedExtensionSelection'>) {
  const ids = (key: keyof Selection) => [...new Set([...(member.runtime?.extensionSelection?.[key] || []), ...(member.inheritedExtensionSelection?.[key] || [])])];
  return { pluginIds: ids('pluginIds'), mcpIds: ids('mcpIds') };
}

/** Tools an MCP server exposes; discovery starts the server on the Mac (refresh re-reads it). */
export function useMcpTools(id: string, refresh: number) {
  const client = useClient();
  const scope = useWorkspaceKey();
  return useQuery({
    queryKey: [...scope, 'mcp-tools', id, refresh],
    queryFn: () => client.post<{ tools: McpTool[]; total: number }>(`/api/runtime/mcp-marketplace/${encodeURIComponent(id)}/tools`, { refresh: refresh > 0 }),
    retry: false,
    staleTime: 5 * 60_000,
  });
}
