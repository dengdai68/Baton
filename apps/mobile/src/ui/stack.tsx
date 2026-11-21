// Shared Stack configuration for every tab: native headers in Baton colors.
import { Stack } from 'expo-router';

import { useTheme } from '@/theme';

export function TabStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.accentText,
        headerTitleStyle: { color: colors.text },
        headerLargeTitleStyle: { color: colors.text },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.bgCanvas },
      }}
    />
  );
}
