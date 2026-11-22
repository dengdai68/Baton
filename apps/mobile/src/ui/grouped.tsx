// iOS inset-grouped sections in Graphite colors: page on subtle background,
// raised rounded cards with hairline separators, icon tiles and chevrons.
import * as Clipboard from 'expo-clipboard';
import { ChevronRight, Copy, type LucideIcon } from 'lucide-react-native';
import { Children, type ReactNode } from 'react';
import { Pressable, ScrollView, type StyleProp, View, type ViewStyle } from 'react-native';

import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { IconButton } from './icon-button';
import { Txt } from './text';
import { useToast } from './toast';

/** Grouped page body: subtle background, insets under the native header handled by iOS. */
export function GroupedPage({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bgSubtle }} contentContainerStyle={{ paddingBottom: 56 }}>
      {children}
    </ScrollView>
  );
}

/** Small copy icon for paths, commands and fingerprints. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <IconButton icon={Copy} label={label || $t('复制')} size={30} tone="neutral" disabled={!value}
      onPress={() => void Clipboard.setStringAsync(value).then(() => toast($t('已复制'))).catch((error) => toast((error as Error).message, true))} />
  );
}

export function GroupedSection({ title, footer, action, children, style }: {
  title?: string; footer?: string | null; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const { colors, metrics } = useTheme();
  const rows = Children.toArray(children).filter(Boolean);
  if (!rows.length) return null;
  return (
    <View style={[{ marginHorizontal: 16, marginTop: 20 }, style]}>
      {title || action ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 22, paddingHorizontal: 4, marginBottom: 6, gap: 8 }}>
          <Txt variant="small" weight="semibold" tone="tertiary" style={{ flex: 1 }} numberOfLines={1}>{title}</Txt>
          {action}
        </View>
      ) : null}
      <View style={{ borderRadius: metrics.radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised, overflow: 'hidden' }}>
        {rows.map((row, index) => (
          <View key={index} style={index ? { borderTopWidth: 1, borderTopColor: colors.borderSubtle } : undefined}>{row}</View>
        ))}
      </View>
      {footer ? <Txt variant="caption" tone="tertiary" style={{ paddingHorizontal: 4, marginTop: 6 }}>{footer}</Txt> : null}
    </View>
  );
}

/** Padded free content inside a grouped section (prompts, descriptions, code). */
export function GroupedBlock({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ paddingHorizontal: 14, paddingVertical: 12, gap: 8 }, style]}>{children}</View>;
}

/** Rounded icon tile used at the start of grouped rows. */
export function IconTile({ icon: Icon, tone = 'accent', size = 30 }: { icon: LucideIcon; tone?: 'accent' | 'neutral' | 'danger'; size?: number }) {
  const { colors } = useTheme();
  const palette = { accent: [colors.accentSoft, colors.accentText], neutral: [colors.bgActive, colors.textSecondary], danger: [colors.stFailedBg, colors.stFailed] }[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: palette[0], alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={Math.round(size * 0.56)} color={palette[1]} strokeWidth={1.8} />
    </View>
  );
}

export function GroupedRow({ icon, leading, title, subtitle, value, onPress, chevron = Boolean(onPress), destructive, trailing, numberOfLines = 1, titleLines = 1, mono }: {
  icon?: LucideIcon; leading?: ReactNode; title: string; subtitle?: string | null; value?: string | null; onPress?: () => void;
  /** numberOfLines limits the subtitle; titleLines the title. */
  chevron?: boolean; destructive?: boolean; trailing?: ReactNode; numberOfLines?: number; titleLines?: number; mono?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      // Read-only rows are not one element, so trailing controls (copy, console) stay reachable.
      accessible={Boolean(onPress)}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? colors.bgHover : 'transparent' })}
    >
      {leading ?? (icon ? <IconTile icon={icon} tone={destructive ? 'danger' : 'accent'} /> : null)}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt weight="medium" tone={destructive ? 'danger' : 'primary'} numberOfLines={titleLines}>{title}</Txt>
        {subtitle ? <Txt variant="small" tone="tertiary" numberOfLines={numberOfLines} mono={mono} selectable={!onPress}>{subtitle}</Txt> : null}
      </View>
      {value ? <Txt variant="small" tone="tertiary" numberOfLines={1} style={{ maxWidth: '45%' }}>{value}</Txt> : null}
      {trailing}
      {chevron ? <ChevronRight size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

/** Profile-style header for detail pages: visual, title, subtitle and trailing badges. */
export function DetailHeader({ visual, title, subtitle, badges }: { visual?: ReactNode; title: string; subtitle?: string | null; badges?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 12 }}>
      {visual}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Txt variant="title" weight="semibold" numberOfLines={2}>{title}</Txt>
        {subtitle ? <Txt variant="small" tone="secondary" numberOfLines={2}>{subtitle}</Txt> : null}
        {badges ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>{badges}</View> : null}
      </View>
    </View>
  );
}
