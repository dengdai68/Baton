// React Query wiring: refetch on foreground and when connectivity returns.
import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
});

AppState.addEventListener('change', (status: AppStateStatus) => focusManager.setFocused(status === 'active'));
