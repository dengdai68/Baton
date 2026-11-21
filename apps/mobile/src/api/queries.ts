// Data hooks over the open workspace. Keys are scoped by workspace id so data
// from another Mac never shows after switching.
import { type QueryKey, useMutation, type UseMutationOptions, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

import { useIsFocused } from 'expo-router/react-navigation';
import { useState } from 'react';

import { type ApiClient, type Query } from '@/api/client';
import { useSession } from '@/workspace/session';

export function useWorkspaceKey(): QueryKey {
  const { active } = useSession();
  return ['ws', active?.id ?? 'none'];
}

/** GET a JSON resource of the open workspace. */
export function useApi<T>(path: string | null, query?: Query, options: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'> = {}) {
  const { client } = useSession();
  const scope = useWorkspaceKey();
  return useQuery<T, Error>({
    queryKey: [...scope, path, query ?? null],
    queryFn: () => (client as ApiClient).get<T>(path as string, query),
    enabled: Boolean(client && path) && (options.enabled ?? true),
    ...options,
  });
}

/** A write against the open workspace; invalidates the workspace cache afterwards. */
export function useApiMutation<TInput, TResult = unknown>(
  run: (client: ApiClient, input: TInput) => Promise<TResult>,
  options: Omit<UseMutationOptions<TResult, Error, TInput>, 'mutationFn'> & { invalidate?: boolean } = {},
) {
  const { client } = useSession();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const { invalidate = true, onSuccess, ...rest } = options;
  return useMutation<TResult, Error, TInput>({
    mutationFn: (input) => run(client as ApiClient, input),
    onSuccess: async (...args) => {
      if (invalidate) await queryClient.invalidateQueries({ queryKey: scope });
      await onSuccess?.(...args);
    },
    ...rest,
  });
}

export type Notifications = { taskAttentionCount: number; communicationUnreadCount: number };
export const useNotifications = () => useApi<Notifications>('/api/notifications', undefined, { refetchInterval: 15_000 });

/** Poll only while this screen is focused (hidden tab/stack screens stop polling). */
export function useFocusedInterval(ms: number): number | false {
  return useIsFocused() ? ms : false;
}

/** Pull-to-refresh state: spins only for a refresh the user started, never for polling. */
export function useManualRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  return {
    refreshing,
    onRefresh: () => {
      setRefreshing(true);
      void refetch().finally(() => setRefreshing(false));
    },
  };
}
