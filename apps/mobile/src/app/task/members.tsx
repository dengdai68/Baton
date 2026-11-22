// Add or remove task members (the Mac's 编辑任务成员): the current manager and
// members with unfinished work stay locked; removal keeps their history.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { workspaceAgents } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { useCatalog } from '@/features/catalog';
import { MemberPicker } from '@/features/chats/member-picker';
import type { Member } from '@/features/tasks/model';
import { lockedMembers, useRunWorkspace } from '@/features/workspace/data';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { ErrorState, LoadingState } from '@/ui/states';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export default function TaskMembers() {
  useLocale();
  const { runId } = useLocalSearchParams<{ taskId: string; runId: string }>();
  const { colors } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const workspace = useRunWorkspace(runId);
  const catalog = useCatalog();
  const data = workspace.data;
  const current = data ? (workspaceAgents(data, (catalog.data?.agents || []) as Member[]) as Member[]) : [];
  const [selected, setSelected] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const screen = <Stack.Screen options={{ title: $t('任务成员') }} />;
  if (workspace.isPending || catalog.isPending) return <>{screen}<LoadingState screen /></>;
  if (workspace.error || !data) return <>{screen}<ErrorState message={workspace.error?.message || ''} onRetry={() => void workspace.refetch()} /></>;
  const chosen = selected ?? current.map((agent) => agent.id);
  const run = data.run;
  // Current members first, then every other active employee (not the manager's source profile).
  const choices = [...current, ...((catalog.data?.agents || []) as Member[]).filter((agent) => agent.status === 'active' && agent.id !== run.manager.sourceAgentId && !current.some((member) => member.id === agent.id))];

  async function save() {
    setSaving(true);
    try {
      await client.put(`/api/runs/${encodeURIComponent(run.id)}/members`, { memberAgentIds: chosen });
      await queryClient.invalidateQueries({ queryKey: scope });
      toast($t('任务成员已更新。'));
      router.back();
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      {screen}
      <MemberPicker agents={choices} selected={chosen} onChange={setSelected} locked={lockedMembers(data)} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, paddingBottom: 28, backgroundColor: colors.bgSubtle, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
        <Button variant="primary" size="lg" label={$t('保存成员（{0} 人）', [chosen.length])} loading={saving} disabled={selected === null} onPress={() => void save()} />
      </View>
    </View>
  );
}
