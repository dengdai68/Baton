// Synchronous language selection at startup (module evaluation order matters:
// shared projection tables translate their labels when first imported).
import * as SecureStore from 'expo-secure-store';

import { applyLanguage, type LanguagePreference } from './index';

let language: LanguagePreference = 'system';
try {
  const saved = SecureStore.getItem('baton.preferences');
  const value = saved ? JSON.parse(saved).language : null;
  if (['system', 'zh-CN', 'zh-TW', 'en'].includes(value)) language = value;
} catch {
  // Keychain unavailable (first launch before unlock): follow the system.
}
applyLanguage(language);
