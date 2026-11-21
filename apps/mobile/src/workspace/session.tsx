// Active workspace session: saved workspaces, the API client for the open one,
// pairing, switching and forgetting. A 401 marks the session expired so the UI
// can ask the user to pair again instead of failing silently.
import * as Device from 'expo-device';
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type ApiClient, createApiClient, pairDevice } from '@/api/client';
import { $t } from '@/i18n';
import type { ParsedInput } from './link';
import { type SavedWorkspace, workspaceId, workspaceStore } from './store';

type Session = {
  ready: boolean;
  workspaces: SavedWorkspace[];
  active: SavedWorkspace | null;
  client: ApiClient | null;
  expired: boolean;
  pair(input: ParsedInput): Promise<SavedWorkspace>;
  open(id: string): Promise<void>;
  leave(): Promise<void>;
  forget(id: string): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

/** Device name shown in the Mac's device list. */
function deviceLabel(): string {
  return (Device.deviceName || Device.modelName || 'iPhone').slice(0, 60);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>([]);
  const [active, setActive] = useState<SavedWorkspace | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const listRef = useRef<SavedWorkspace[]>([]);

  const persist = useCallback(async (items: SavedWorkspace[]) => {
    listRef.current = items;
    setWorkspaces(items);
    await workspaceStore.saveAll(items);
  }, []);

  useEffect(() => {
    (async () => {
      const items = await workspaceStore.list();
      listRef.current = items;
      setWorkspaces(items);
      const id = await workspaceStore.activeId();
      const current = items.find((item) => item.id === id) || null;
      const saved = current ? await workspaceStore.token(current.id) : null;
      if (current && saved) {
        setActive(current);
        setToken(saved);
      }
      setReady(true);
    })();
  }, []);

  const open = useCallback(async (id: string) => {
    const item = listRef.current.find((entry) => entry.id === id);
    const saved = item ? await workspaceStore.token(item.id) : null;
    if (!item || !saved) throw new Error($t('此工作空间需要重新配对。'));
    const updated = { ...item, lastUsedAt: Date.now() };
    await persist(listRef.current.map((entry) => (entry.id === id ? updated : entry)));
    await workspaceStore.setActive(id);
    setExpired(false);
    setToken(saved);
    setActive(updated);
  }, [persist]);

  const pair = useCallback(async ({ address, code }: ParsedInput) => {
    if (!code) throw new Error($t('这是工作空间地址。本地工作空间请在 Mac 上选择「连接 iPhone…」生成配对码后扫描；云端账号登录将在后续版本提供。'));
    const device = deviceLabel();
    const issued = await pairDevice(address.origin, address.pin, code, device);
    const client = createApiClient({ origin: address.origin, pin: address.pin, token: issued });
    const facts = await client.get<{ name?: string; mode?: string; user?: { name?: string } }>('/workspace').catch(() => null);
    const id = workspaceId(address.origin, address.pin);
    const previous = listRef.current.find((entry) => entry.id === id);
    const item: SavedWorkspace = {
      id,
      origin: address.origin,
      pin: address.pin,
      name: facts?.name || previous?.name || 'Baton',
      mode: facts?.mode === 'cloud' ? 'cloud' : 'local',
      user: facts?.user?.name || previous?.user || '',
      device,
      addedAt: previous?.addedAt || Date.now(),
      lastUsedAt: Date.now(),
    };
    await workspaceStore.setToken(id, issued);
    await persist([item, ...listRef.current.filter((entry) => entry.id !== id)]);
    await workspaceStore.setActive(id);
    setExpired(false);
    setToken(issued);
    setActive(item);
    return item;
  }, [persist]);

  const leave = useCallback(async () => {
    await workspaceStore.setActive(null);
    setActive(null);
    setToken(null);
    setExpired(false);
  }, []);

  const forget = useCallback(async (id: string) => {
    const item = listRef.current.find((entry) => entry.id === id);
    const saved = item ? await workspaceStore.token(id) : null;
    if (item && saved) {
      // Best effort: revoke this device on the Mac; forgetting locally always succeeds.
      await createApiClient({ origin: item.origin, pin: item.pin, token: saved }).post('/logout').catch(() => undefined);
    }
    await workspaceStore.deleteToken(id);
    await persist(listRef.current.filter((entry) => entry.id !== id));
    if (active?.id === id) await leave();
  }, [active?.id, leave, persist]);

  const client = useMemo(
    () => (active && token ? createApiClient({ origin: active.origin, pin: active.pin, token, onUnauthorized: () => setExpired(true) }) : null),
    [active, token],
  );

  const value = useMemo<Session>(
    () => ({ ready, workspaces, active, client, expired, pair, open, leave, forget }),
    [ready, workspaces, active, client, expired, pair, open, leave, forget],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('SessionProvider missing');
  return session;
}

/** The API client of the open workspace (screens under the workspace tabs only). */
export function useClient(): ApiClient {
  const { client } = useSession();
  if (!client) throw new Error('No open workspace');
  return client;
}
