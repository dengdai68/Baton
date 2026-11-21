// Structural pieces: cards, sticky group heads, list rows, dividers and facts.
import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';
import { Txt } from './text';

/** Bordered surface without shadow (Graphite cards). */
export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const { colors, metrics } = useTheme();
  const base: ViewStyle = { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: metrics.radius.md, padding: 16 };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, pressed && { borderColor: colors.borderStrong, backgroundColor: colors.bgHover }, style]}>
      {children}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.borderSubtle, marginLeft: inset }} />;
}

/** Sticky group head: subtle band, status icon, name, count and optional note. */
export function GroupHeader({ title, count, icon, note }: { title: string; count?: number; icon?: ReactNode; note?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, backgroundColor: colors.bgSubtle, borderBottomWidth: 1, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
      {icon}
      <Txt variant="small" weight="semibold">{title}</Txt>
      {count !== undefined ? <Txt variant="small" tone="tertiary" numeric>{count}</Txt> : null}
      {note ? <Txt variant="caption" tone="tertiary" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{note}</Txt> : null}
    </View>
  );
}

/** Tappable list row with leading visual, title/subtitle and trailing accessory. */
export function ListRow({
  leading, title, subtitle, meta, trailing, onPress, chevron = Boolean(onPress), selected, accessibilityLabel, children,
}: {
  leading?: ReactNode; title: string; subtitle?: string | null; meta?: ReactNode; trailing?: ReactNode;
  onPress?: () => void; chevron?: boolean; selected?: boolean; accessibilityLabel?: string; children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: pressed ? colors.bgHover : selected ? colors.bgSelected : colors.bgCanvas,
        borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
      })}
    >
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt weight="medium" numberOfLines={1}>{title}</Txt>
        {subtitle ? <Txt variant="small" tone="tertiary" numberOfLines={2}>{subtitle}</Txt> : null}
        {meta}
        {children}
      </View>
      {trailing}
      {chevron ? <ChevronRight size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

/** Key / value facts (inspector style): tertiary label column. */
export function Fact({ label, children, value }: { label: string; value?: string | null; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 6 }}>
      <Txt variant="small" tone="tertiary" style={{ width: 88 }}>{label}</Txt>
      <View style={{ flex: 1, minWidth: 0 }}>{children ?? <Txt variant="small" selectable>{value || '—'}</Txt>}</View>
    </View>
  );
}

/** Section title inside forms, details and settings. */
export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
      <Txt variant="small" weight="semibold" tone="secondary">{title}</Txt>
      {action}
    </View>
  );
}
