// Loading, empty and error are three distinct states; errors offer an in-place retry.
import { CircleAlert, type LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, View } from 'react-native';

import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from './button';
import { Txt } from './text';

export function LoadingState({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label || $t('正在加载…')} style={{ padding: 40, alignItems: 'center', gap: 10 }}>
      <ActivityIndicator color={colors.textTertiary} />
      {label ? <Txt variant="small" tone="tertiary">{label}</Txt> : null}
    </View>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  const { colors, metrics } = useTheme();
  return (
    <View style={{ paddingVertical: 48, paddingHorizontal: 32, alignItems: 'center', gap: 8 }}>
      <View style={{ width: 44, height: 44, borderRadius: metrics.radius.md, backgroundColor: colors.bgActive, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
        <Icon size={22} color={colors.textSecondary} strokeWidth={1.7} />
      </View>
      <Txt variant="titleSm" weight="semibold" style={{ textAlign: 'center' }}>{title}</Txt>
      {description ? <Txt tone="secondary" style={{ textAlign: 'center', maxWidth: 380 }}>{description}</Txt> : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  );
}

/** Failure callout: never shown as an empty state; retry stays in place. */
export function ErrorState({ title, message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  const { colors, metrics } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ margin: 16, padding: 14, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.stFailedBorder, backgroundColor: colors.stFailedBg, flexDirection: 'row', gap: 10 }}>
      <CircleAlert size={18} color={colors.stFailed} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Txt weight="semibold">{title || $t('加载失败')}</Txt>
        <Txt variant="small" tone="secondary" selectable>{message}</Txt>
        {onRetry ? <View style={{ marginTop: 6, flexDirection: 'row' }}><Button size="sm" label={$t('重试')} onPress={onRetry} /></View> : null}
      </View>
    </View>
  );
}

/** Short inline notice inside forms and composers. */
export function Notice({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'attention' | 'failed' }) {
  const { colors, metrics } = useTheme();
  const palette = tone === 'attention' ? { bg: colors.stAttentionBg, border: colors.stAttentionBorder, text: colors.stAttention }
    : tone === 'failed' ? { bg: colors.stFailedBg, border: colors.stFailedBorder, text: colors.stFailed }
      : { bg: colors.bgSubtle, border: colors.borderSubtle, text: colors.textSecondary };
  return (
    <View style={{ padding: 10, borderRadius: metrics.radius.sm, backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border }}>
      <Txt variant="small" color={palette.text}>{text}</Txt>
    </View>
  );
}
