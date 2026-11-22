// All trigger rounds of an automation, newest first; each opens the task it created.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { History } from 'lucide-react-native';
import { FlatList, RefreshControl } from 'react-native';

import { useManualRefresh } from '@/api/queries';
import { useAutomationTriggers } from '@/features/automations/model';
import { TriggerRow } from '@/features/automations/trigger-row';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';

export default function AutomationTriggers() {
  useLocale();
  const { automationId } = useLocalSearchParams<{ automationId: string }>();
  const { colors } = useTheme();
  const triggers = useAutomationTriggers(automationId, true);
  const pull = useManualRefresh(triggers.refetch);
  return (
    <>
      <Stack.Screen options={{ title: $t('触发记录') }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.bgCanvas }}
        data={triggers.data?.items || []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        renderItem={({ item }) => (
          <TriggerRow trigger={item} onPress={item.taskId ? () => router.push({ pathname: '/task/[taskId]', params: { taskId: item.taskId! } }) : undefined} />
        )}
        ListEmptyComponent={triggers.isPending ? <LoadingState /> : triggers.error ? <ErrorState message={triggers.error.message} onRetry={() => void triggers.refetch()} />
          : <EmptyState icon={History} title={$t('还没有触发记录')} description={$t('到达执行计划或手动立即执行后，每一轮都会记录在这里。')} />}
      />
    </>
  );
}
