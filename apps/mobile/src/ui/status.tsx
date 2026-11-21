// Status presentation: one hue per meaning, always with an icon and a label.
import {
  CircleCheck, CircleDashed, CircleHelp, CirclePause, CircleStop, ClipboardCheck, LoaderCircle, type LucideIcon, TriangleAlert,
} from 'lucide-react-native';
import { View } from 'react-native';

import { STATUS_TEXT } from '@shared/console-projections.mjs';
import { type Colors, useTheme } from '@/theme';
import { Txt } from './text';

export type StatusTone = 'running' | 'attention' | 'done' | 'failed' | 'planning' | 'neutral';

const statusMeta: Record<string, { tone: StatusTone; icon: LucideIcon }> = {
  backlog: { tone: 'planning', icon: CircleDashed },
  planning: { tone: 'running', icon: LoaderCircle },
  running: { tone: 'running', icon: LoaderCircle },
  review: { tone: 'running', icon: LoaderCircle },
  awaiting_human: { tone: 'attention', icon: CircleHelp },
  awaiting_acceptance: { tone: 'attention', icon: ClipboardCheck },
  paused: { tone: 'neutral', icon: CirclePause },
  blocked: { tone: 'failed', icon: TriangleAlert },
  failed: { tone: 'failed', icon: TriangleAlert },
  done: { tone: 'done', icon: CircleCheck },
  completed: { tone: 'done', icon: CircleCheck },
  cancelled: { tone: 'neutral', icon: CircleStop },
};

export function statusInfo(status: string) {
  return statusMeta[status] || { tone: 'neutral' as StatusTone, icon: CircleDashed };
}

export function tonePalette(colors: Colors, tone: StatusTone) {
  return {
    running: { text: colors.stRunning, bg: colors.stRunningBg, border: colors.stRunningBorder },
    attention: { text: colors.stAttention, bg: colors.stAttentionBg, border: colors.stAttentionBorder },
    done: { text: colors.stDone, bg: colors.stDoneBg, border: colors.stDoneBorder },
    failed: { text: colors.stFailed, bg: colors.stFailedBg, border: colors.stFailedBorder },
    planning: { text: colors.stPlanning, bg: colors.stPlanningBg, border: colors.stPlanningBorder },
    neutral: { text: colors.stNeutral, bg: colors.stNeutralBg, border: colors.stNeutralBorder },
  }[tone];
}

/** Status label for a Task/Run status, translated with the shared table. */
export const statusLabel = (status: string) => STATUS_TEXT[status] || status;

export function StatusIcon({ status, size = 16 }: { status: string; size?: number }) {
  const { colors } = useTheme();
  const { tone, icon: Icon } = statusInfo(status);
  return <Icon size={size} color={tonePalette(colors, tone).text} strokeWidth={1.8} />;
}

/** 22pt pill: tinted background, same-hue text and border, icon + label. */
export function StatusPill({ status, label, tone }: { status?: string; label?: string; tone?: StatusTone }) {
  const { colors } = useTheme();
  const meta = status ? statusInfo(status) : { tone: tone || 'neutral', icon: null };
  const palette = tonePalette(colors, tone || meta.tone);
  const Icon = meta.icon;
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 24,
        paddingHorizontal: 9, borderRadius: 999, backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border,
      }}
    >
      {Icon ? <Icon size={13} color={palette.text} strokeWidth={1.9} /> : null}
      <Txt variant="small" weight="medium" color={palette.text} numberOfLines={1}>{label || statusLabel(status || '')}</Txt>
    </View>
  );
}

/** Small neutral tag (workflow names, kinds); accent/violet variants for emphasis. */
export function Tag({ label, tone = 'neutral', mono }: { label: string; tone?: 'neutral' | 'accent' | 'violet' | 'outline' | 'done'; mono?: boolean }) {
  const { colors } = useTheme();
  const palette = {
    neutral: { bg: colors.bgActive, text: colors.textSecondary, border: 'transparent' },
    accent: { bg: colors.accentSoft, text: colors.accentText, border: colors.accentBorder },
    violet: { bg: colors.stPlanningBg, text: colors.stPlanning, border: colors.stPlanningBorder },
    outline: { bg: 'transparent', text: colors.textSecondary, border: colors.border },
    done: { bg: colors.stDoneBg, text: colors.stDone, border: colors.stDoneBorder },
  }[tone];
  return (
    <View style={{ paddingHorizontal: 6, minHeight: 20, justifyContent: 'center', borderRadius: 4, backgroundColor: palette.bg, borderWidth: 1, borderColor: palette.border, alignSelf: 'flex-start' }}>
      <Txt variant="caption" weight="medium" color={palette.text} mono={mono} numberOfLines={1}>{label}</Txt>
    </View>
  );
}

/** Count badge: amber for "needs you", blue for unread. */
export function CountBadge({ count, tone = 'attention' }: { count: number; tone?: 'attention' | 'accent' }) {
  const { colors } = useTheme();
  if (!count) return null;
  const attention = tone === 'attention';
  return (
    <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: attention ? colors.stAttentionBg : colors.accent, borderWidth: attention ? 1 : 0, borderColor: colors.stAttentionBorder }}>
      <Txt variant="caption" weight="semibold" numeric color={attention ? colors.stAttention : colors.textOnAccent}>{count > 99 ? '99+' : count}</Txt>
    </View>
  );
}
