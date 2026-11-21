declare module '@shared/console-projections.mjs' {
  export const STATUS_TEXT: Record<string, string>;
  export const EVENT_KIND_LABEL: Record<string, string>;
  export const TASK_FILTERS: ReadonlyArray<{ id: string; label: string }>;
  export function refreshProjectionLabels(): void;
  export function taskNeedsAttention(status: string): boolean;
  export function taskMatchesFilter(status: string, filter: string): boolean;
  export function taskActionLabel(status: string): string;
  export function partyName(type: string | null | undefined, name: string | null | undefined): string;
  export function workflowDisplay<T>(snapshot: T): T;
  export function formatRelativeTime(iso: string, now?: number): string;
  export function formatExactTime(iso: string): string;
  export function formatMessageTime(iso: string, now?: Date): string;
  export function classifyEvent(event: any): string;
  export function displayText(event: any): string;
  export function isTransportFrame(event: any): boolean;
  export function retainsConsoleEvent(event: any): boolean;
  export function workspaceAgents(workspace: any, agents?: any[], options?: { includeDeleted?: boolean }): any[];
  export function roleExecutionStatus(run: any, traces: any[], agentId: string): { active: boolean; failed: boolean; state: string; traceCount: number; label: string; activeTrace: any };
  export function workflowFocus(run: any, traces: any[]): Record<string, string>;
  export function buildConsoleEntries(events: any[]): any[];
  export function mentionables(agents: any[]): Array<{ id: string; name: string; color?: string }>;
  export function collaborationRecords(workspace: any): any[];
  export function providerLabel(agent: any): string;
  export function toolCommandSummary(toolName: string, inputText: string): string;
  export function consoleContentTokens(value: unknown, options?: { json?: boolean; truncated?: boolean }): any;
  export function workingDirectoryIcon(name: string, type: string): string;
  export function editDiff(oldText: string, newText: string, options?: { maxCells?: number }): any;
}
