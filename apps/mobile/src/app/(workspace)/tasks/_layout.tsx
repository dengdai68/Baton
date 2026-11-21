import { Stack } from 'expo-router';

import { $t } from '@/i18n';
import { useTheme } from '@/theme';

import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable } from 'react-native';

export default function TasksStack() {
  const { colors } = useTheme();
  const back = (
    <Pressable accessibilityRole="button" accessibilityLabel={$t('返回')} onPress={() => router.back()} hitSlop={10}
      style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.bgHover : 'transparent' })}>
      <ChevronLeft size={22} color={colors.accentText} strokeWidth={2} />
    </Pressable>
  );
  return (
    <Stack screenOptions={{ headerTintColor: colors.accentText, headerTitleStyle: { color: colors.text }, headerLargeTitleStyle: { color: colors.text }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: colors.bgCanvas } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="filter" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], sheetGrabberVisible: true, headerShown: true, title: $t('筛选') }} />
    </Stack>
  );
}
