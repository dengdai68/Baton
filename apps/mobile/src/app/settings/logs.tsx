// Execution logs overview from the instance's diagnostics.
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Fact } from '@/ui/layout';
import { LoadingState, ErrorState } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useClient } from '@/workspace/session';

export default function Logs() {
  const client = useClient();
  const scope = useWorkspaceKey();
  const { colors } = useTheme();
  const status = useQuery({ queryKey: [...scope, 'settings-logs'], queryFn: () => client.get<{ directory?: string; fileCount?: number; latestFile?: string; recentErrors?: number }>('/api/settings/log-files') });
  return (
    <>
      <Stack.Screen options={{ title: $t('日志') }} />
      {status.isPending ? <LoadingState /> : status.error ? <ErrorState message={status.error.message} onRetry={() => void status.refetch()} /> : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 8 }}>
          <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
            <Fact label={$t('日志目录')} value={status.data?.directory || '—'} />
            <Fact label={$t('文件数')} value={String(status.data?.fileCount ?? 0)} />
            <Fact label={$t('最新文件')} value={status.data?.latestFile || '—'} />
            <Fact label={$t('近期错误')} value={String(status.data?.recentErrors ?? 0)} />
          </View>
          <Txt variant="caption" tone="tertiary">{$t('完整日志文件在 Mac 的日志目录中；这里仅显示运行概览。')}</Txt>
        </ScrollView>
      )}
    </>
  );
}
