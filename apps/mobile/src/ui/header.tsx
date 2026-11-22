// Header icon buttons for native navigation bars (accent tint, 44pt targets).
import { router } from 'expo-router';
import { $t } from '@/i18n';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { useTheme } from '@/theme';

export function HeaderButton({ icon: Icon, label, onPress, disabled }: { icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={8}
      style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}>
      <Icon size={22} color={colors.accentText} strokeWidth={1.8} />
    </Pressable>
  );
}

export function HeaderButtons({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{children}</View>;
}

// iOS 26 draws glass behind native bar items unless the item opts out.
export function plainHeaderItem(element: React.ReactElement) {
  return [{ type: 'custom' as const, element, hidesSharedBackground: true }];
}

export function backHeaderItems({canGoBack}: {canGoBack?: boolean}) {
  return canGoBack ? plainHeaderItem(<HeaderButton icon={ChevronLeft} label={$t('后退')} onPress={() => router.back()} />) : [];
}
