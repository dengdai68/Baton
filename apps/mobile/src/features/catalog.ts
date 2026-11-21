// Lightweight references (agents, teams, roles, workflows) used across screens.
import { useApi } from '@/api/queries';
import type { Member } from '@/features/tasks/model';

export type TeamRef = { id: string; name: string; status: string; memberAgentIds: string[] };
export type WorkflowRef = { id: string; name: string };
export type Catalog = { agents: Member[]; roles: Array<{ id: string; name: string }>; teams: TeamRef[]; workflowTemplates: WorkflowRef[]; taskWorkflows: WorkflowRef[] };

export const useCatalog = () => useApi<Catalog>('/api/catalog-references', undefined, { staleTime: 30_000 });
