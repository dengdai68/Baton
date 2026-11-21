declare module '@shared/i18n.mjs' {
  export const LOCALES: readonly string[];
  export const LANGUAGE_PREFERENCES: readonly string[];
  export const LOCALE_NAMES: Record<string, string>;
  export function resolveLocale(preference: string, systemLanguages: string[]): string;
  export function setLocale(locale: string, messages?: Record<string, unknown>): string;
  export function currentLocale(): string;
  export function intlLocale(): string;
  export function $t(source: string, params?: unknown): string;
  export function $tm(text: string): string;
}
