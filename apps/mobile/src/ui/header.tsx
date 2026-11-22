// Header icon buttons for native navigation bars (accent tint, 44pt targets).
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { $t } from '@/i18n';
import { ChevronLeft, type LucideIcon } from 'lucide-react-native';
import { Platform, Pressable, View } from 'react-native';

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

/**
 * Trailing header actions on both platforms: iOS renders only `unstable_headerRightItems`
 * (bar items without glass), Android renders only `headerRight` (toolbar views).
 */
export function headerRightOptions(element: React.ReactElement) {
  return Platform.OS === 'ios'
    ? { unstable_headerRightItems: () => plainHeaderItem(element) }
    : { headerRight: () => element };
}

/** Leading header action (cancel) that replaces the back button on both platforms. */
export function headerLeftOptions(element: React.ReactElement) {
  return Platform.OS === 'ios'
    ? { unstable_headerLeftItems: () => plainHeaderItem(element) }
    : { headerLeft: () => element };
}

/**
 * Top padding for non-scrolling pages under a native header: iOS draws them beneath its
 * translucent bar, while Android already lays the page out below the toolbar.
 */
export function useContentTopInset(): number {
  const headerHeight = useHeaderHeight();
  return Platform.OS === 'ios' ? headerHeight : 0;
}
