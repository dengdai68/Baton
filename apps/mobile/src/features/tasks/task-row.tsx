// One task row: status icon, title, workflow and status line, members, time and
// a single next step; the full menu is on long press.
import { View } from 'react-native';

import { formatRelativeTime, workflowDisplay } from '@shared/console-projections.mjs';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { StatusIcon, Tag } from '@/ui/status';
import { Txt } from '@/ui/text';
import { Pressable } from 'react-native';
import { type Member, membersOf, nextAction, type TaskSummary, taskRowStatus } from './model';

export function TaskRow({ task, agents, onPress, onLongPress, onAction, busy }: {
  task: TaskSummary; agents: Member[]; onPress: () => void; onLongPress: () => void; onAction: () => void; busy?: boolean;
}) {
  const { colors } = useTheme();
  const status = taskRowStatus(task);
  const action = nextAction(task);
  const members = membersOf(task, agents);
  const workflow = workflowDisplay(task.workflowSnapshot)?.name || $t('默认协作');
  const attention = ['awaiting_human', 'awaiting_acceptance'].includes(task.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={task.title + '，' + status.label}
      accessibilityHint={$t('长按查看更多操作')}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingLeft: 16, paddingRight: 14, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}
    >
      <View style={{ paddingTop: 2 }}><StatusIcon status={task.status} size={18} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Txt weight="medium" numberOfLines={2} style={{ flex: 1 }}>{task.title}</Txt>
          <Txt variant="caption" tone="tertiary" numeric style={{ paddingTop: 2 }}>{formatRelativeTime(task.updatedAt)}</Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Tag label={workflow} />
          <Txt variant="small" tone={attention ? 'attention' : ['failed', 'blocked'].includes(task.status) ? 'danger' : 'secondary'} numberOfLines={1} style={{ flexShrink: 1 }}>
            {status.label}{status.detail ? ' · ' + status.detail : ''}
          </Txt>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
          <View style={{ flexDirection: 'row' }}>
            {members.map((member, index) => (
              <View key={member.id} style={{ marginLeft: index ? -5 : 0, borderWidth: 2, borderColor: colors.bgCanvas, borderRadius: 7 }}>
                <Avatar member={member} size={20} />
              </View>
            ))}
          </View>
          <Button
            size="sm"
            variant={attention ? 'attention' : action.kind === 'start' ? 'primary' : 'secondary'}
            label={action.label}
            loading={busy}
            onPress={onAction}
          />
        </View>
      </View>
    </Pressable>
  );
}
