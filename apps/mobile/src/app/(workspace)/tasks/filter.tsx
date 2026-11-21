// Filter sheet: task status and workflow, matching the Mac filter panel.
import { router, Stack } from 'expo-router';
import { Check } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';

import { STATUS_TEXT } from '@shared/console-projections.mjs';
import { useCatalog } from '@/features/catalog';
import { taskFilters } from '@/features/tasks/filters';
import { FILTER_STATUSES } from '@/features/tasks/model';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { SectionTitle } from '@/ui/layout';
import { Txt } from '@/ui/text';

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 46, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: pressed ? colors.bgHover : 'transparent', borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
      <Txt>{label}</Txt>
      {selected ? <Check size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

export default function TaskFilter() {
  const filters = taskFilters.use();
  const catalog = useCatalog();
  const workflows = [...new Map([...(catalog.data?.workflowTemplates || []), ...(catalog.data?.taskWorkflows || [])].map((item) => [item.id, item.name]))];
  const set = (patch: Partial<typeof filters>) => taskFilters.set({ ...filters, ...patch });
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen options={{ title: $t('筛选'), headerRight: () => <Button size="sm" variant="ghost" label={$t('完成')} onPress={() => router.back()} /> }} />
      <SectionTitle title={$t('任务状态')} />
      <Option label={$t('全部状态')} selected={filters.status === 'all'} onPress={() => set({ status: 'all' })} />
      {FILTER_STATUSES.map((status) => (
        <Option key={status} label={STATUS_TEXT[status] || status} selected={filters.status === status} onPress={() => set({ status })} />
      ))}
      <SectionTitle title={$t('工作流@@field')} />
      <Option label={$t('全部工作流')} selected={filters.workflow === 'all'} onPress={() => set({ workflow: 'all' })} />
      {workflows.map(([id, name]) => <Option key={id} label={name} selected={filters.workflow === id} onPress={() => set({ workflow: id })} />)}
      <View style={{ padding: 16 }}>
        <Button label={$t('清除筛选')} block onPress={() => taskFilters.set({ status: 'all', workflow: 'all' })} />
      </View>
    </ScrollView>
  );
}
