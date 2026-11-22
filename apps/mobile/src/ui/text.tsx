// Graphite typography on the phone: one variant per type step, semantic tones only.
import { Text, type TextProps } from 'react-native';

import { type Colors, monoFont, useTheme } from '@/theme';

export type TextVariant = 'caption' | 'small' | 'body' | 'read' | 'titleSm' | 'title' | 'display';
export type Tone =
  | 'primary' | 'secondary' | 'tertiary' | 'disabled' | 'accent' | 'link' | 'onAccent'
  | 'danger' | 'attention' | 'done' | 'running' | 'planning' | 'neutral';

export function toneColor(colors: Colors, tone: Tone): string {
  return {
    primary: colors.text, secondary: colors.textSecondary, tertiary: colors.textTertiary, disabled: colors.textDisabled,
    accent: colors.accentText, link: colors.textLink, onAccent: colors.textOnAccent, danger: colors.stFailed,
    attention: colors.stAttention, done: colors.stDone, running: colors.stRunning, planning: colors.stPlanning, neutral: colors.stNeutral,
  }[tone];
}

type Props = TextProps & {
  variant?: TextVariant;
  weight?: 'regular' | 'medium' | 'semibold';
  tone?: Tone;
  color?: string;
  mono?: boolean;
  /** Tabular digits for counts and times. */
  numeric?: boolean;
};

/** Text with a Graphite type step, weight and semantic tone. */
export function Txt({ variant = 'body', weight = 'regular', tone = 'primary', color, mono, numeric, style, ...rest }: Props) {
  const { colors, type, metrics } = useTheme();
  const step = type[variant];
  return (
    <Text
      {...rest}
      style={[
        {
          color: color ?? toneColor(colors, tone),
          fontSize: step.size,
          lineHeight: step.line,
          fontWeight: metrics.weight[weight],
          fontFamily: mono ? monoFont : undefined,
          fontVariant: numeric ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    />
  );
}
