import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { History, Play, SlidersHorizontal, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { automationScheduleLabel, formatExactTime, formatNextTriggerTime, providerLabel } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { useAutomation, useAutomationTriggers } from '@/features/automations/model';
import { useCatalog } from '@/features/catalog';
import { Avatar } from '@/ui/avatar';
import { TriggerRow } from '@/features/automations/trigger-row';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { GroupedBlock, GroupedPage, GroupedRow, GroupedSection } from '@/ui/grouped';
import { HeaderButtons, plainHeaderItem } from '@/ui/header';
import { IconButton } from '@/ui/icon-button';
import { Markdown } from '@/ui/markdown';
import { ErrorState, LoadingState } from '@/ui/states';
import { StatusPill, statusLabel } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

/** Latest rounds shown inline; the History icon opens all of them. */
const RECENT_ROUNDS = 3;

export default function AutomationDetail() {
  useLocale();
  const { automationId } = useLocalSearchParams<{ automationId: string }>();
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const automation = useAutomation(automationId);
  const triggers = useAutomationTriggers(automationId, true);
  const [busy, setBusy] = useState<string | null>(null);
  const item = automation.data;
  const catalog = useCatalog();
  const agents = catalog.data?.agents || [];
  function remove() {
    if (!item) return;
    Alert.alert($t('删除自动化'), $t('将删除「{0}」及其触发记录，无法恢复。', [item.title]), [
      { text: $t('取消'), style: 'cancel' },
      { text: $t('删除'), style: 'destructive', onPress: async () => {
        try {
          await client.del(`/api/automations/${encodeURIComponent(automationId)}`);
          await queryClient.invalidateQueries({ queryKey: scope });
          toast($t('自动化已删除'));
          router.dismissTo('/automations');
        } catch (error) { toast((error as Error).message, true); }
      } },
    ]);
  }


  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    try { await work(); await queryClient.invalidateQueries({ queryKey: scope }); }
    catch (error) { toast((error as Error).message, true); }
    finally { setBusy(null); }
  }
  const runNow = () => void act('trigger', async () => {
    const result = await client.post<{ trigger?: { outcome?: string; reason?: string } }>(`/api/automations/${encodeURIComponent(automationId)}/trigger`, {});
    if (result.trigger?.outcome === 'skipped') toast($t('已跳过本次触发：{0}', [result.trigger.reason || $t('未知原因')]));
    else toast($t('已触发一次执行'));
  });
  const setEnabled = (next: boolean) => void act('toggle', async () => {
    await client.put(`/api/automations/${encodeURIComponent(automationId)}`, { enabled: next });
    toast(next ? $t('自动化已启用') : $t('自动化已停用'));
  });

  const screen = (
    <Stack.Screen
      options={{
        // Like a task: the title is the page; no generic "自动化" heading.
        title: item?.title || '',
        headerLargeTitle: false,
        unstable_headerRightItems: () => plainHeaderItem(
          <HeaderButtons>
            <IconButton icon={Play} label={$t('立即执行')} loading={busy === 'trigger'} disabled={!item?.enabled} onPress={runNow} />
            <IconButton icon={History} label={$t('触发记录')} onPress={() => router.push({ pathname: '/automation/triggers', params: { automationId } })} />
            <IconButton icon={SlidersHorizontal} label={$t('配置')} onPress={() => router.push({ pathname: '/task/compose', params: { automation: '1', id: automationId } })} />
          </HeaderButtons>
        ),
      }}
    />
  );
  if (automation.isPending) return <>{screen}<LoadingState /></>;
  if (automation.error || !item) return <>{screen}<ErrorState message={automation.error?.message || ''} onRetry={() => void automation.refetch()} /></>;
  const recent = (triggers.data?.items || []).slice(0, RECENT_ROUNDS);
  const openTask = (taskId?: string) => (taskId ? () => router.push({ pathname: '/task/[taskId]', params: { taskId } }) : undefined);
  return (
    <GroupedPage>
      {screen}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16 }}>
        <StatusPill centered label={item.enabled ? $t('已启用') : $t('已停用')} tone={item.enabled ? 'done' : 'neutral'} />
        <Txt variant="small" tone="tertiary" numberOfLines={1} style={{ flex: 1 }}>
          {item.enabled && item.nextTriggerAt ? $t('下次 {0}', [formatNextTriggerTime(item.nextTriggerAt, item.timeZone)]) : ''}
        </Txt>
        <Switch accessibilityLabel={$t('启用')} value={item.enabled} disabled={busy === 'toggle'} trackColor={{ true: colors.accent, false: colors.borderStrong }} onValueChange={setEnabled} />
      </View>
      <GroupedSection style={{ marginTop: 8 }}>
        <GroupedRow title={$t('最近执行')} subtitle={item.latestExecution ? formatExactTime(item.latestExecution.startedAt) : undefined} value={item.latestExecution ? statusLabel(item.latestExecution.status) : $t('尚未执行')} onPress={openTask(item.latestExecution?.taskId)} />
        <GroupedRow title={$t('执行规则')} subtitle={item.cron} mono value={automationScheduleLabel(item.cron)} />
        <GroupedRow title={$t('时区')} value={item.timeZone || $t('本机时区')} />
      </GroupedSection>
      <GroupedSection title={$t('最近触发')}>
        {recent.length ? recent.map((trigger) => <TriggerRow key={trigger.id} trigger={trigger} grouped onPress={openTask(trigger.taskId)} />)
          : <GroupedBlock><Txt variant="small" tone="tertiary">{triggers.isPending ? $t('正在读取…') : $t('还没有触发记录')}</Txt></GroupedBlock>}
      </GroupedSection>
      <GroupedSection title={$t('内容描述')}>
        <GroupedBlock><Markdown content={item.objective || ''} size="body" /></GroupedBlock>
      </GroupedSection>
      <GroupedSection title={$t('成员')}>
        {(item.memberAgentIds || []).map((id) => {
          const agent = agents.find((row) => row.id === id);
          return <GroupedRow key={id} leading={<Avatar member={agent || { id, name: id }} size={30} manager={id === item.managerAgentId} />} title={agent?.name || id} subtitle={agent ? providerLabel(agent) : undefined} />;
        })}
      </GroupedSection>
      {(item.acceptanceCriteria || []).length ? (
        <GroupedSection title={$t('验收标准')}>
          <View style={{ padding: 14, gap: 6 }}>{item.acceptanceCriteria!.map((criterion, index) => <Txt key={index}>{'• ' + criterion}</Txt>)}</View>
        </GroupedSection>
      ) : null}
      <GroupedSection footer={$t('自动化运行继承定义时的成员权限；异常任务会提醒你处理。')}>
        <GroupedRow icon={Trash2} destructive title={$t('删除自动化')} chevron={false} onPress={remove} />
      </GroupedSection>
    </GroupedPage>
  );
}
