// Graphite theme for the phone: semantic colors generated from web/tokens.css,
// phone type scale and touch metrics. Appearance follows the saved preference.
import { createContext, type ReactNode, use, useCallback, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { applyLanguage, type LanguagePreference } from '@/i18n';
import { refreshProjectionLabels } from '@shared/console-projections.mjs';
import { defaultPreferences, type Preferences, workspaceStore } from '@/workspace/store';
import { darkColors, lightColors, metrics, typeScale } from './tokens.generated';

export type Colors = { [K in keyof typeof lightColors]: string };
export type Scheme = 'light' | 'dark';
export type Theme = { scheme: Scheme; colors: Colors; type: typeof typeScale; metrics: typeof metrics };
type PreferencesContextValue = {
  preferences: Preferences;
  setTheme(theme: Preferences['theme']): Promise<void>;
  setLanguage(language: LanguagePreference): Promise<void>;
};

const ThemeContext = createContext<Theme | null>(null);
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const system = useColorScheme();

  useEffect(() => {
    workspaceStore.preferences().then((saved) => {
      setPreferences(saved);
      Appearance.setColorScheme(saved.theme === 'system' ? 'unspecified' : saved.theme);
    });
  }, []);

  const save = useCallback(async (next: Preferences) => {
    setPreferences(next);
    await workspaceStore.savePreferences(next);
  }, []);
  const setTheme = useCallback(async (theme: Preferences['theme']) => {
    Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
    await save({ ...preferences, theme });
  }, [preferences, save]);
  const setLanguage = useCallback(async (language: LanguagePreference) => {
    applyLanguage(language);
    refreshProjectionLabels();
    await save({ ...preferences, language });
  }, [preferences, save]);

  const scheme: Scheme = preferences.theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : preferences.theme;
  const theme = useMemo<Theme>(
    () => ({ scheme, colors: scheme === 'dark' ? darkColors : lightColors, type: typeScale, metrics }),
    [scheme],
  );
  const preferencesValue = useMemo(() => ({ preferences, setTheme, setLanguage }), [preferences, setTheme, setLanguage]);
  return (
    <PreferencesContext value={preferencesValue}>
      <ThemeContext value={theme}>{children}</ThemeContext>
    </PreferencesContext>
  );
}

export function useTheme(): Theme {
  const theme = use(ThemeContext);
  if (!theme) throw new Error('ThemeProvider missing');
  return theme;
}

export function usePreferences(): PreferencesContextValue {
  const value = use(PreferencesContext);
  if (!value) throw new Error('ThemeProvider missing');
  return value;
}

/** Identity colors for avatars (never status), chosen from the stored color or a stable id hash. */
const identityKeys = ['avViolet', 'avCyan', 'avBlue', 'avOrange', 'avGreen'] as const;
export function identityColor(colors: Colors, color?: string | null, id?: string | null): string {
  const named: Record<string, string> = {
    violet: colors.avViolet, cyan: colors.avCyan, blue: colors.avBlue, orange: colors.avOrange, amber: colors.avOrange, green: colors.avGreen, system: colors.avSystem,
  };
  if (color && named[color]) return named[color];
  let hash = 0;
  for (const char of id || '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return id ? colors[identityKeys[hash % identityKeys.length]] : colors.avSystem;
}
