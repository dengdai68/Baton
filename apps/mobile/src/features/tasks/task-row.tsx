// Two-line task card: title (one line, ellipsis); then time · status and the
// row's single next step as an icon on the right.
import { Pressable, View } from 'react-native';

import { formatRelativeTime } from '@shared/console-projections.mjs';
import { useTheme } from '@/theme';
import { IconButton } from '@/ui/icon-button';
import { StatusIcon } from '@/ui/status';
import { Txt } from '@/ui/text';
import { rowAction, type TaskSummary, taskRowStatus } from './model';

export function TaskRow({ task, onPress, onAction, busy }: { task: TaskSummary; onPress: () => void; onAction: () => void; busy?: boolean }) {
  const { colors } = useTheme();
  const status = taskRowStatus(task);
  const action = rowAction(task);
  const attention = ['awaiting_human', 'awaiting_acceptance'].includes(task.status);
  const failed = ['failed', 'blocked'].includes(task.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={task.title + '，' + status.label}
      // The row is one accessibility element, so its icon action is offered as a VoiceOver action.
      accessibilityActions={action ? [{ name: 'activate' }, { name: 'rowAction', label: action.label }] : undefined}
      onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === 'rowAction') onAction(); else onPress(); }}
      onPress={onPress}
      style={({ pressed }) => ({ paddingLeft: 16, paddingRight: 10, paddingTop: 12, paddingBottom: 10, gap: 4, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}
    >
      <Txt weight="medium" numberOfLines={1} ellipsizeMode="tail" style={{ paddingRight: 6 }}>{task.title}</Txt>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 }}>
        <Txt variant="small" tone="tertiary" numeric>{formatRelativeTime(task.updatedAt)}</Txt>
        <Txt variant="small" tone="tertiary">·</Txt>
        <StatusIcon status={task.status} size={14} />
        <Txt variant="small" tone={attention ? 'attention' : failed ? 'danger' : 'secondary'} numberOfLines={1} style={{ flex: 1 }}>
          {status.label}{status.detail ? ' · ' + status.detail : ''}
        </Txt>
        {action ? <IconButton icon={action.icon} label={action.label} tone={action.tone} tinted size={32} loading={busy} onPress={onAction} /> : null}
      </View>
    </Pressable>
  );
}
