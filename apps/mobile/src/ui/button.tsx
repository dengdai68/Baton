// Graphite buttons: one primary per area; secondary, ghost, danger and attention
// variants; 44pt minimum for large touch targets.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, type PressableProps, type StyleProp, View, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { useTheme } from '@/theme';
import { Txt } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSolid' | 'attention';
type Props = Omit<PressableProps, 'children' | 'style'> & {
  label?: string;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  block?: boolean;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, icon: Icon, variant = 'secondary', size = 'md', loading, block, disabled, trailing, style, ...rest }: Props) {
  const { colors, metrics } = useTheme();
  const height = metrics.control[size];
  const palette = {
    primary: { bg: colors.accent, pressed: colors.accentActive, border: colors.accent, text: colors.textOnAccent },
    secondary: { bg: colors.bgRaised, pressed: colors.bgHover, border: colors.border, text: colors.text },
    ghost: { bg: 'transparent', pressed: colors.bgHover, border: 'transparent', text: colors.textSecondary },
    danger: { bg: colors.bgRaised, pressed: colors.stFailedBg, border: colors.border, text: colors.stFailed },
    dangerSolid: { bg: colors.stFailed, pressed: colors.stFailed, border: colors.stFailed, text: colors.onSolid },
    attention: { bg: colors.stAttentionBg, pressed: colors.stAttentionBorder, border: colors.stAttentionBorder, text: colors.stAttention },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: Boolean(loading) }}
      disabled={inactive}
      hitSlop={size === 'sm' ? 6 : 0}
      style={({ pressed }) => [
        {
          minHeight: height,
          paddingHorizontal: label ? (size === 'sm' ? 10 : size === 'lg' ? 18 : 14) : 0,
          width: label ? undefined : height,
          borderRadius: size === 'lg' ? metrics.radius.md : metrics.radius.sm,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          opacity: disabled ? 0.45 : 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          alignSelf: block ? 'stretch' : 'auto',
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.text} />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 15 : 18} color={palette.text} strokeWidth={1.8} />
      ) : null}
      {label ? (
        <Txt variant={size === 'sm' ? 'small' : 'body'} weight="medium" color={palette.text} numberOfLines={1}>
          {label}
        </Txt>
      ) : null}
      {trailing ? <View>{trailing}</View> : null}
    </Pressable>
  );
}
