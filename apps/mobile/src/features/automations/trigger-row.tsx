// One trigger round, two lines like a task row: the task it created (or the
// planned time); then when · 定时/手动 · the task's state, as the Mac shows it.
import { ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { formatExactTime, formatRelativeTime } from '@shared/console-projections.mjs';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { statusLabel, StatusIcon, tonePalette } from '@/ui/status';
import { Txt } from '@/ui/text';
import { type Trigger, triggerSource, triggerState } from './model';

export function TriggerRow({ trigger, onPress, grouped }: { trigger: Trigger; onPress?: () => void; grouped?: boolean }) {
  const { colors } = useTheme();
  const state = triggerState(trigger);
  const when = trigger.plannedAt || trigger.createdAt;
  const tone = state.tone ? tonePalette(colors, state.tone).text : undefined;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={(trigger.taskTitle || $t('本轮执行')) + '，' + (state.label || statusLabel(state.status || ''))}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: grouped ? 14 : 16, paddingRight: 12, paddingVertical: 11,
        backgroundColor: pressed ? colors.bgHover : grouped ? 'transparent' : colors.bgCanvas,
        borderBottomWidth: grouped ? 0 : 1, borderBottomColor: colors.borderSubtle,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Txt weight="medium" numberOfLines={1}>{trigger.taskTitle || (when ? formatExactTime(when) : $t('本轮执行'))}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {when ? <Txt variant="small" tone="tertiary" numeric>{formatRelativeTime(when)}</Txt> : null}
          <Txt variant="small" tone="tertiary">· {triggerSource(trigger)} ·</Txt>
          {state.status ? <StatusIcon status={state.status} size={14} /> : null}
          <Txt variant="small" color={tone} tone={tone ? undefined : 'secondary'} numberOfLines={1} style={{ flex: 1 }}>{state.label || statusLabel(state.status || '')}</Txt>
        </View>
      </View>
      {onPress ? <ChevronRight size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}
