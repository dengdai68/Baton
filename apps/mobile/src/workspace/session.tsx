// Active workspace session: saved workspaces, the API client for the open one,
// pairing, switching and forgetting. A 401 marks the session expired so the UI
// can ask the user to pair again instead of failing silently.
import { useQueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import * as Device from 'expo-device';
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type ApiClient, closedClient, createApiClient, loginDevice } from '@/api/client';
import { $t } from '@/i18n';

import { type SavedWorkspace, workspaceId, workspaceStore } from './store';

type Session = {
  live: boolean;
  ready: boolean;
  active: SavedWorkspace | null;
  client: ApiClient | null;
  expired: boolean;
  login(origin: string, name: string, password: string, pin: string | null): Promise<void>;
  leave(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

/** Device name shown in the Mac's device list. */
function deviceLabel(): string {
  return (Device.deviceName || Device.modelName || 'iPhone').slice(0, 60);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<SavedWorkspace | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const cache = useQueryClient();
  const busy = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        await workspaceStore.discardLegacy();
        const saved = await workspaceStore.current();
        if (saved) { setActive(saved.workspace); setToken(saved.token); }
      } finally { setReady(true); }
    })();
  }, []);
  const login = useCallback(async (origin: string, name: string, password: string, pin: string | null) => {
    if (busy.current || active) throw new Error($t('请先退出当前账号'));
    busy.current = true;
    try {
      const device = deviceLabel();
      const result = await loginDevice(origin, pin, name, password, device);
      const workspace: SavedWorkspace = {id:workspaceId(origin, pin), origin, pin, name:result.workspace,
        mode:result.mode, user:name, device, addedAt:Date.now(), lastUsedAt:Date.now()};
      try { await workspaceStore.save(workspace, result.token); }
      catch (error) { await createApiClient({origin, pin, token:result.token}).post('/logout').catch(() => {}); throw error; }
      setToken(result.token); setExpired(false); setActive(workspace);
    } finally { busy.current = false; }
  }, [active]);
  const leave = useCallback(async () => {
    if (active && token) await createApiClient({ ...active, token }).post('/logout').catch(() => {});
    if (active) await workspaceStore.remember(active.origin);
    await workspaceStore.clear();
    setActive(null); setToken(null); setExpired(false);
    cache.removeQueries({ queryKey:['ws'] });
  }, [active, token, cache]);

  const client = useMemo(
    () => (active && token ? createApiClient({ origin: active.origin, pin: active.pin, token, onUnauthorized: () => setExpired(true) }) : null),
    [active, token],
  );

  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!active || !client || expired) return;
    const scope = ['ws', active.id];
    let stop: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let delay = 1000;
    const connect = () => {
      if (disposed || stop || AppState.currentState === 'background') return;
      stop = client.stream('/api/workspace/events', {
        onEvent(type, data) {
          if (type === 'auth-expired') { setExpired(true); return; }
          if (type === 'ready') {
            setLive(true);
            delay = 1000;
            void cache.invalidateQueries({ queryKey: scope }, { cancelRefetch: false });
          } else if (type === 'workspace-change') {
            const topics: string[] = JSON.parse(data);
            void cache.invalidateQueries({
              queryKey: scope,
              predicate: ({ queryKey }) => {
                const key = queryKey[2];
                if (key === 'console') return topics.includes(String(queryKey[3]).startsWith('/api/runs/') ? 'console' : 'chat-console');
                if (['tasks','tasks-archive','task','run','collaboration'].includes(String(key))) return topics.includes('tasks');
                if (['chat','chats'].includes(String(key))) return topics.includes('chats');
                return ['automation','automations','automation-triggers'].includes(String(key)) && (topics.includes('automations') || topics.includes('tasks'));
              },
            }, { cancelRefetch: false });
          }
        },
        onEnd(error) {
          stop = undefined;
          setLive(false);
          if (error?.status === 401) { setExpired(true); return; }
          if (!disposed) { retry = setTimeout(connect, delay); delay = Math.min(15000, delay * 2); }
        },
      });
    };
    const disconnect = () => { clearTimeout(retry); stop?.(); stop = undefined; setLive(false); };
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { disconnect(); delay = 1000; connect(); }
      else if (state === 'background') disconnect();
    });
    connect();
    return () => { disposed = true; subscription.remove(); disconnect(); };
  }, [active?.id, client, expired, cache]);

  const value = useMemo<Session>(
    () => ({ live, ready, active, client, expired, login, leave }),
    [live, ready, active, client, expired, login, leave],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('SessionProvider missing');
  return session;
}

const closed = closedClient();

/** The API client of the open workspace; after it closes, calls reject instead of crashing screens that are still unmounting. */
export function useClient(): ApiClient {
  const { client } = useSession();
  return client ?? closed;
}
