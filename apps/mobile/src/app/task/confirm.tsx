// Human acceptance: review the manager's handoff and criteria, acknowledge, confirm.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { acceptanceReview, useRunWorkspace } from '@/features/workspace/data';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { ChoiceRow } from '@/ui/form';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function ConfirmCompletion() {
  const { runId } = useLocalSearchParams<{ taskId: string; runId: string }>();
  const { colors, metrics } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const workspace = useRunWorkspace(runId);
  const [acknowledged, setAcknowledged] = useState(false);
  const [sending, setSending] = useState(false);
  const review = acceptanceReview(workspace.data);
  const screen = <Stack.Screen options={{ title: $t('确认任务完成') }} />;
  if (workspace.isPending) return <>{screen}<LoadingState /></>;
  if (workspace.error) return <>{screen}<ErrorState message={workspace.error.message} onRetry={() => void workspace.refetch()} /></>;
  if (!review) return <>{screen}<View style={{ padding: 16 }}><Notice tone="attention" text={$t('当前任务尚未提交人类验收。')} /></View></>;

  async function confirmCompletion() {
    setSending(true);
    try {
      await client.post(`/api/runs/${encodeURIComponent(runId)}/confirm-completion`, {});
      await queryClient.invalidateQueries({ queryKey: scope });
      toast($t('已由你确认任务完成'));
      router.back();
    } catch (error) {
      toast((error as Error).message, true);
      setSending(false);
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      {screen}
      <Txt tone="secondary">{$t('你正在代表人类确认「{0}」的交付。确认后 Run 会变为已完成；Trace、Artifact、消息和审计记录会继续保留。', [workspace.data?.run.task.title || ''])}</Txt>
      <View style={{ padding: 14, gap: 10, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSubtle }}>
        <Txt variant="small" weight="semibold">{$t('经理交接说明')}</Txt>
        {review.findings.length ? review.findings.map((finding, index) => <Txt key={index}>{'• ' + finding}</Txt>) : <Txt tone="tertiary">—</Txt>}
        <Txt variant="small" weight="semibold" style={{ marginTop: 6 }}>{$t('任务验收标准')}</Txt>
        {review.criteria.length ? review.criteria.map((criterion, index) => <Txt key={index}>{'• ' + criterion}</Txt>) : <Txt tone="tertiary">{$t('此任务没有单独记录验收标准。')}</Txt>}
        <Txt variant="caption" tone="tertiary">{$t('{0} 项已接纳交付快照 · {1} 条原任务要求', [review.artifactCount, review.criteria.length])}</Txt>
      </View>
      <View style={{ borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        <ChoiceRow selected={acknowledged} onPress={() => setAcknowledged(!acknowledged)}>
          <Txt style={{ flex: 1 }}>{$t('我已阅读复核结论，并已核对需要的交付快照。')}</Txt>
        </ChoiceRow>
      </View>
      <Button variant="primary" size="lg" label={$t('确认完成')} disabled={!acknowledged} loading={sending} onPress={() => void confirmCompletion()} />
      <Button size="lg" label={$t('返回核验')} onPress={() => router.back()} />
    </ScrollView>
  );
}
