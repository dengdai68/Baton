// Icon-only buttons (the phone's default action style): 36pt circle, semantic tint.
import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { type Colors, useTheme } from '@/theme';

export type IconTone = 'accent' | 'neutral' | 'attention' | 'danger' | 'done';

export function toneTint(colors: Colors, tone: IconTone) {
  return {
    accent: { icon: colors.accentText, bg: colors.accentSoft },
    neutral: { icon: colors.textSecondary, bg: colors.bgActive },
    attention: { icon: colors.stAttention, bg: colors.stAttentionBg },
    danger: { icon: colors.stFailed, bg: colors.stFailedBg },
    done: { icon: colors.stDone, bg: colors.stDoneBg },
  }[tone];
}

export function IconButton({ icon: Icon, label, onPress, tone = 'accent', tinted, active, size = 36, disabled, loading, style }: {
  icon: LucideIcon; label: string; onPress?: () => void; tone?: IconTone; tinted?: boolean; active?: boolean;
  size?: number; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const tint = toneTint(colors, tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading), selected: Boolean(active) }}
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center',
          backgroundColor: active || tinted ? tint.bg : pressed ? colors.bgHover : 'transparent', opacity: disabled ? 0.4 : pressed && (active || tinted) ? 0.7 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={tint.icon} /> : <Icon size={Math.round(size * 0.5)} color={tint.icon} strokeWidth={1.8} />}
    </Pressable>
  );
}
