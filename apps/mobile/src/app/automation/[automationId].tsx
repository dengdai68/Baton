// Automation detail: run switch and "run now", facts cards, trigger records
// (each opens its task), and the configuration view (same fields as the form).
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ellipsis } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, ScrollView, Switch, View } from 'react-native';

import { useHeaderHeight } from 'expo-router/react-navigation';
import { formatExactTime, providerLabel, workflowDisplay } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { outcomeText, useAutomation, useAutomationTriggers } from '@/features/automations/model';
import { useCatalog } from '@/features/catalog';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Segmented } from '@/ui/form';
import { HeaderButton } from '@/ui/header';
import { Fact, SectionTitle } from '@/ui/layout';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { StatusPill, Tag } from '@/ui/status';
import { Markdown } from '@/ui/markdown';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function AutomationDetail() {
  useLocale();
  const { automationId } = useLocalSearchParams<{ automationId: string }>();
  const { colors, metrics } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const headerHeight = useHeaderHeight();
  const automation = useAutomation(automationId);
  const [tab, setTab] = useState<'triggers' | 'config'>('triggers');
  const [busy, setBusy] = useState<string | null>(null);
  const item = automation.data;
  const triggers = useAutomationTriggers(automationId, Boolean(item) && tab === 'triggers');
  const catalog = useCatalog();
  const agents = catalog.data?.agents || [];

  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    try { await work(); await queryClient.invalidateQueries({ queryKey: scope }); }
    catch (error) { toast((error as Error).message, true); }
    finally { setBusy(null); }
  }
  async function triggerNow() {
    await act('trigger', async () => {
      const result = await client.post<{ outcome: string; reason?: string; taskId?: string }>(`/api/automations/${encodeURIComponent(automationId)}/trigger`, {});
      if (result.outcome === 'started') toast($t('已触发一次执行'));
      else toast($t('已跳过本次触发：{0}', [result.reason || $t('未知原因')]));
    });
  }
  async function remove() {
    Alert.alert($t('删除自动化'), $t('将删除「{0}」及其触发记录，无法恢复。', [item?.title || '']), [
      { text: $t('取消'), style: 'cancel' },
      { text: $t('删除'), style: 'destructive', onPress: () => void act('delete', async () => { await client.del(`/api/automations/${encodeURIComponent(automationId)}`); router.back(); }) },
    ]);
  }
  const screen = (
    <Stack.Screen
      options={{
        title: item?.title || $t('自动化'),
        headerRight: () => <HeaderButton icon={Ellipsis} label={$t('更多操作')} disabled={!item} onPress={() => {
          const items: Array<[string, () => void, boolean?]> = [
            [$t('编辑配置'), () => router.push({ pathname: '/task/compose', params: { automation: '1', id: automationId } })],
            [$t('刷新'), () => void automation.refetch()],
            [$t('删除自动化'), remove, true],
          ];
          ActionSheetIOS.showActionSheetWithOptions(
            { title: item?.title, options: [$t('取消'), ...items.map((entry) => entry[0])], cancelButtonIndex: 0, destructiveButtonIndex: items.findIndex((entry) => entry[2]) + 1 || undefined },
            (index) => index > 0 && items[index - 1][1](),
          );
        }} />,
      }}
    />
  );
  if (automation.isPending) return <>{screen}<LoadingState /></>;
  if (automation.error) return <>{screen}<ErrorState message={automation.error.message} onRetry={() => void automation.refetch()} /></>;
  const workflow = workflowDisplay((item as any)?.workflowSnapshot)?.name;
  const latest = outcomeText(item!.latestTrigger);
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.bgCanvas, paddingTop: headerHeight }}>
      {screen}
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <StatusPill status={item!.enabled ? 'running' : 'paused'} label={item!.enabled ? $t('已启用') : $t('已停用')} tone={item!.enabled ? 'done' : 'neutral'} />
          {workflow ? <Tag label={workflow} /> : <Tag label={$t('默认协作')} />}
        </View>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button variant="primary" label={item!.enabled ? $t('停用') : $t('启用')} loading={busy === 'toggle'} onPress={() => void act('toggle', () => client.put(`/api/automations/${encodeURIComponent(automationId)}`, { enabled: !item!.enabled }))} />
            <Button label={$t('立即执行')} loading={busy === 'trigger'} disabled={!item!.enabled} onPress={() => void triggerNow()} />
            <Button label={$t('编辑配置')} onPress={() => router.push({ pathname: '/task/compose', params: { automation: '1', id: automationId } })} />
          </View>
        </View>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'triggers', label: $t('触发记录') }, { value: 'config', label: $t('配置') }]} />
        {tab === 'triggers' ? (
          <View style={{ borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
            {(triggers.data?.items || []).map((trigger, index) => {
              const outcome = outcomeText(trigger);
              return (
                <Button key={trigger.id} size="lg" block variant="ghost" style={{ borderRadius: 0, borderTopWidth: index ? 1 : 0, borderTopColor: colors.borderSubtle, justifyContent: 'space-between' }}
                  onPress={() => trigger.taskId && router.push({ pathname: '/task/[taskId]', params: { taskId: trigger.taskId! } })}
                  trailing={<Txt variant="small" tone={outcome.tone === 'done' ? 'done' : outcome.tone === 'failed' ? 'danger' : 'secondary'} numberOfLines={2} style={{ maxWidth: '46%' }}>{[outcome.label, formatExactTime(trigger.triggeredAt)].join('\n')}</Txt>}
                  label={trigger.taskTitle || trigger.taskId || $t('本轮执行')} />
              );
            })}
            {!triggers.data?.items.length ? <Notice text={$t('还没有触发记录。')} /> : null}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={{ padding: 14, gap: 8, borderRadius: metrics.radius.md, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
              <Txt variant="small" weight="semibold" tone="secondary">{$t('内容描述')}</Txt>
              <Markdown content={item!.objective || ''} size="body" />
            </View>
            <View style={{ borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 }}>
              <Fact label={$t('执行计划')} value={item!.cron} />
              <Fact label={$t('时区')} value={item!.timeZone || $t('系统默认')} />
              <Fact label={$t('下次执行')} value={item!.nextTriggerAt ? formatExactTime(item!.nextTriggerAt) : $t('已停用')} />
              <Fact label={$t('最近结果')} value={latest.label} />
              {(item!.acceptanceCriteria || []).length ? <Fact label={$t('验收标准')} value={item!.acceptanceCriteria!.join('\n')} /> : null}
            </View>
            <SectionTitle title={$t('成员') + ' ' + (item!.memberAgentIds || []).length} />
            {(item!.memberAgentIds || []).map((id) => {
              const agent = agents.find((row) => row.id === id);
              return agent ? (
                <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 48 }}>
                  <Avatar member={agent} size={28} manager={id === item!.managerAgentId} />
                  <View style={{ flex: 1 }}><Txt weight="medium" numberOfLines={1}>{agent.name}</Txt><Txt variant="caption" tone="tertiary">{providerLabel(agent)}</Txt></View>
                </View>
              ) : null;
            })}
            <Notice text={$t('自动化运行继承定义时的成员权限；异常任务会出现在你的「待我处理」。')} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
