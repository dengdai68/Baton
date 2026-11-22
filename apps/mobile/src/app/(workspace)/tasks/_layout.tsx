import { backHeaderItems } from '@/ui/header';
import { Stack } from 'expo-router';

import { useTheme } from '@/theme';

export default function TasksStack() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerTintColor: colors.accentText, headerTitleStyle: { color: colors.text }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', unstable_headerLeftItems: backHeaderItems, contentStyle: { backgroundColor: colors.bgCanvas } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
