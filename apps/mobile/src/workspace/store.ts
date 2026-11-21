// Paired workspaces and their device tokens live in the iOS Keychain (expo-secure-store).
import * as SecureStore from 'expo-secure-store';

export type SavedWorkspace = {
  id: string;
  origin: string;
  /** Certificate fingerprint for local workspaces; null uses system trust. */
  pin: string | null;
  name: string;
  mode: 'local' | 'cloud';
  user: string;
  device: string;
  addedAt: number;
  lastUsedAt: number;
};
export type Preferences = { theme: 'system' | 'light' | 'dark'; language: 'system' | 'zh-CN' | 'zh-TW' | 'en' };

const LIST = 'baton.workspaces';
const ACTIVE = 'baton.active';
const PREFERENCES = 'baton.preferences';
const tokenKey = (id: string) => 'baton.token.' + id;
export const defaultPreferences: Preferences = { theme: 'system', language: 'system' };

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await SecureStore.getItemAsync(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const workspaceStore = {
  list: () => readJson<SavedWorkspace[]>(LIST, []),
  async saveAll(items: SavedWorkspace[]) {
    await SecureStore.setItemAsync(LIST, JSON.stringify(items));
  },
  activeId: () => SecureStore.getItemAsync(ACTIVE),
  async setActive(id: string | null) {
    if (id) await SecureStore.setItemAsync(ACTIVE, id);
    else await SecureStore.deleteItemAsync(ACTIVE);
  },
  token: (id: string) => SecureStore.getItemAsync(tokenKey(id)),
  setToken: (id: string, token: string) => SecureStore.setItemAsync(tokenKey(id), token),
  deleteToken: (id: string) => SecureStore.deleteItemAsync(tokenKey(id)),
  preferences: () => readJson<Preferences>(PREFERENCES, defaultPreferences),
  savePreferences: (value: Preferences) => SecureStore.setItemAsync(PREFERENCES, JSON.stringify(value)),
};

/** Stable identifier for a workspace: same origin and certificate means the same pairing target. */
export function workspaceId(origin: string, pin: string | null): string {
  let hash = 2166136261;
  for (const char of origin + '|' + (pin ?? 'system')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 'ws' + hash.toString(36);
}
