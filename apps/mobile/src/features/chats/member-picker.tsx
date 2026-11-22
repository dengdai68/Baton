// Pick employees (search by name or responsibility); used by new chats, group edits
// and task members. Locked members stay selected with the reason they can't be removed.
import { Search } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import type { Member } from '@/features/tasks/model';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { ChoiceRow, TextField } from '@/ui/form';
import { Txt } from '@/ui/text';

export function MemberPicker({ agents, selected, onChange, locked }: {
  agents: Member[]; selected: string[]; onChange: (ids: string[]) => void;
  /** Member id → why it cannot be removed (current manager, unfinished work). */
  locked?: Map<string, string>;
}) {
  const { colors, metrics } = useTheme();
  const [query, setQuery] = useState('');
  // Selected members stay listed even if no longer active, so they can be removed.
  const visible = agents.filter((agent) => (agent.status === 'active' || selected.includes(agent.id)) && (!query.trim() || (agent.name + ' ' + (agent.description || '')).toLowerCase().includes(query.trim().toLowerCase())));
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 120 }}>
      <View style={{ margin: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
        <Search size={16} color={colors.textTertiary} />
        <TextField value={query} onChangeText={setQuery} placeholder={$t('搜索姓名、职责或能力')} style={{ flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0, minHeight: 40 }} accessibilityLabel={$t('搜索数字员工')} />
      </View>
      <View style={{ marginHorizontal: 16, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {visible.map((agent) => (
          <ChoiceRow key={agent.id} selected={selected.includes(agent.id)} disabled={locked?.has(agent.id)}
            onPress={() => onChange(selected.includes(agent.id) ? selected.filter((id) => id !== agent.id) : [...selected, agent.id])}>
            <Avatar member={agent} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt weight="medium" numberOfLines={1}>{agent.name}</Txt>
              {locked?.has(agent.id) ? <Txt variant="caption" tone="attention" numberOfLines={1}>{locked.get(agent.id)}</Txt>
                : agent.description ? <Txt variant="caption" tone="tertiary" numberOfLines={1}>{agent.description}</Txt> : null}
            </View>
          </ChoiceRow>
        ))}
        {!visible.length ? <Txt tone="tertiary" style={{ padding: 16 }}>{$t('没有匹配的数字员工')}</Txt> : null}
      </View>
    </ScrollView>
  );
}
