// 运行日志 (read-only): where the Mac writes diagnostics, and the latest
// execution records; a record opens its task or conversation.
import { router, Stack } from 'expo-router';
import { View } from 'react-native';

import { formatRelativeTime } from '@shared/console-projections.mjs';
import { type ExecutionLog, useExecutionLogs, useLogFiles } from '@/features/settings';
import { $t, $tm, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { CopyButton, GroupedBlock, GroupedPage, GroupedRow, GroupedSection } from '@/ui/grouped';
import { Txt } from '@/ui/text';

function LogRow({ item }: { item: ExecutionLog & { taskId?: string | null; conversationId?: string | null } }) {
  const { colors } = useTheme();
  const color = item.level === 'error' ? colors.stFailed : item.level === 'warn' || item.level === 'warning' ? colors.stAttention : colors.textDisabled;
  const open = item.taskId ? () => router.push({ pathname: '/task/[taskId]', params: { taskId: item.taskId! } })
    : item.conversationId ? () => router.push({ pathname: '/chat/[chatId]', params: { chatId: item.conversationId! } }) : undefined;
  return (
    <GroupedRow title={$tm(item.message)} titleLines={2} onPress={open} chevron={false}
      leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />}
      subtitle={[item.name, formatRelativeTime(item.timestamp)].filter(Boolean).join(' · ')} />
  );
}

export default function LogSettings() {
  useLocale();
  const files = useLogFiles();
  const logs = useExecutionLogs();
  const items = (logs.data?.pages || []).flatMap((page) => page.items);
  const data = files.data;
  return (
    <GroupedPage>
      <Stack.Screen options={{ title: $t('运行日志') }} />
      <GroupedSection title={$t('日志文件')} footer={data?.retention ? $t('{0} 格式；{1}', [data.format || 'JSONL', data.retention]) : null}>
        {files.isPending ? <GroupedBlock><Txt variant="small" tone="tertiary">{$t('正在读取…')}</Txt></GroupedBlock> : null}
        {files.error ? <GroupedBlock><Txt variant="small" tone="danger">{files.error.message}</Txt></GroupedBlock> : null}
        {data?.directory ? <GroupedRow title={$t('日志目录')} subtitle={data.directory} mono numberOfLines={4} trailing={<CopyButton value={data.directory} />} /> : null}
        {data?.filePath ? <GroupedRow title={$t('当前服务日志')} subtitle={data.filePath} mono numberOfLines={4} trailing={<CopyButton value={data.filePath} />} /> : null}
        {data && !data.available && data.error ? <GroupedBlock><Txt variant="small" tone="danger">{data.error}</Txt></GroupedBlock> : null}
      </GroupedSection>
      <GroupedSection title={$t('最近执行记录')}>
        {logs.isPending ? <GroupedBlock><Txt variant="small" tone="tertiary">{$t('正在读取…')}</Txt></GroupedBlock> : null}
        {logs.error ? <GroupedBlock><Txt variant="small" tone="danger">{logs.error.message}</Txt></GroupedBlock> : null}
        {logs.data && !items.length ? <GroupedBlock><Txt variant="small" tone="tertiary">{$t('暂无执行记录')}</Txt></GroupedBlock> : null}
        {items.map((item) => <LogRow key={item.id} item={item} />)}
        {logs.hasNextPage ? <GroupedRow title={logs.isFetchingNextPage ? $t('正在加载…') : $t('加载更多')} onPress={() => { if (!logs.isFetchingNextPage) void logs.fetchNextPage(); }} chevron={false} /> : null}
      </GroupedSection>
    </GroupedPage>
  );
}
