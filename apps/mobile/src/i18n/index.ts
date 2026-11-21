// Interface language shared with the Mac client: client/i18n.mjs with the same
// catalogs (client/locales/*.json, keyed by Simplified Chinese source text).
import { getLocales } from 'expo-localization';
import { useSyncExternalStore } from 'react';

import * as shared from '@shared/i18n.mjs';
import en from '@shared/locales/en.json';
import zhTW from '@shared/locales/zh-TW.json';

export type LanguagePreference = 'system' | 'zh-CN' | 'zh-TW' | 'en';
type Params = Record<string, unknown> | unknown[];

const catalogs: Record<string, Record<string, unknown>> = { en, 'zh-TW': zhTW };
const listeners = new Set<() => void>();
let version = 0;

/** Translate interface text written in Simplified Chinese (literal keys only). */
export const $t = shared.$t as (source: string, params?: Params) => string;
/** Translate text produced elsewhere (server errors, system events); business text stays as is. */
export const $tm = shared.$tm as (text: string) => string;
export const LOCALE_NAMES = shared.LOCALE_NAMES as Record<string, string>;
export const LANGUAGE_PREFERENCES = shared.LANGUAGE_PREFERENCES as LanguagePreference[];

/** Select the interface language from a preference ("system" follows iOS). */
export function applyLanguage(preference: LanguagePreference): string {
  const system = getLocales().map((locale) => locale.languageTag);
  const locale = shared.resolveLocale(preference, system) as string;
  shared.setLocale(locale, catalogs[locale] || {});
  version++;
  listeners.forEach((listener) => listener());
  return locale;
}

export const currentLocale = () => shared.currentLocale() as string;
export const intlLocale = () => shared.intlLocale() as string;

/** Re-render on language change; returns the active locale. */
export function useLocale(): string {
  useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => version,
  );
  return currentLocale();
}
