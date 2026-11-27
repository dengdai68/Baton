// Paired workspaces and their device tokens live in the iOS Keychain (expo-secure-store).
import * as SecureStore from 'expo-secure-store';

export type SavedWorkspace = {
  id: string;
  origin: string;
  /** Certificate fingerprint for local workspaces; null uses system trust. */
  pin: string | null;
  name: string;
  mode: 'local' | 'cloud';
  relay?: string;
  deviceKey?: string;
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

const addressesKey = 'baton.login.addresses';
export const workspaceStore = {
  addresses: () => readJson<string[]>(addressesKey, []),
  async remember(origin: string) {
    const addresses = await workspaceStore.addresses();
    const next = [origin, ...addresses.filter(address => address !== origin)];
    await SecureStore.setItemAsync(addressesKey, JSON.stringify(next));
    return next;
  },
  async forget(origin: string) {
    const addresses = (await workspaceStore.addresses()).filter(address => address !== origin);
    await SecureStore.setItemAsync(addressesKey, JSON.stringify(addresses));
    return addresses;
  },
  current: () => readJson<{workspace: SavedWorkspace; token: string} | null>('baton.login.v1', null),
  async save(workspace: SavedWorkspace, token: string) {
    await SecureStore.setItemAsync('baton.login.v1', JSON.stringify({workspace, token}));
  },
  clear: () => SecureStore.deleteItemAsync('baton.login.v1'),
  async discardLegacy() {
    const items = await readJson<SavedWorkspace[]>(LIST, []);
    for (const item of items) await SecureStore.deleteItemAsync(tokenKey(item.id));
    await SecureStore.deleteItemAsync(LIST);
    await SecureStore.deleteItemAsync(ACTIVE);
  },
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
