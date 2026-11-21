// Detail for one directory entry: view facts; edit where the desktop allows it.
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Pencil } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { formatExactTime, providerLabel } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { useDetail, type Member, type Role, type Team, type Workflow } from '@/features/directory/api';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Fact, SectionTitle } from '@/ui/layout';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { Tag } from '@/ui/status';
import { Markdown } from '@/ui/markdown';
import { Txt } from '@/ui/text';
import { useClient } from '@/workspace/session';

const resourceOf = (kind: string) => ({ agents: 'agents', teams: 'teams', workflows: 'workflow-templates', roles: 'roles', marketplace: 'runtime/marketplace', mcp: 'runtime/mcp-marketplace', git: 'runtime/git-credentials' } as any)[kind];

export default function DirectoryDetail() {
  useLocale();
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const { colors, metrics } = useTheme();
  const client = useClient();
  const scope = useWorkspaceKey();
  const headerHeight = useHeaderHeight();
  const resource = resourceOf(kind);
  const detail = useDetail<any>(`/api/${resource}/${encodeURIComponent(id)}`);
  const queryClient = useQueryClient();
  const item = detail.data;
  const isWorkflow = kind === 'workflows';
  const editable = kind === 'marketplace' || kind === 'mcp' || kind === 'git';
  async function toggle(next: boolean) {
    try {
      await client.put(`/api/runtime/${kind === 'marketplace' ? 'marketplace' : 'mcp-marketplace'}/${encodeURIComponent(id)}`, { enabled: next });
      await queryClient.invalidateQueries({ queryKey: scope });
    } catch (error) {
      // ignore; list still refetches on focus
    }
  }
  const screen = <Stack.Screen options={{ title: item?.name || item?.title || $t('详情'), headerRight: editable && item ? () => <Button size="sm" variant="ghost" label={item.enabled === false ? $t('启用') : $t('停用')} onPress={() => void toggle(!(item.enabled !== false))} /> : undefined }} />;
  if (detail.isPending) return <>{screen}<LoadingState /></>;
  if (detail.error) return <>{screen}<ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} /></>;

  let body: React.ReactNode = null;
  if (kind === 'agents') {
    const member = item as Member;
    body = (
      <>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16 }}>
          <Avatar member={member} size={44} manager={member.kind === 'manager'} />
          <View style={{ flex: 1 }}>
            <Txt variant="title" weight="semibold">{member.name}</Txt>
            <Txt variant="small" tone="tertiary">{[providerLabel(member), member.runtime?.model, member.status === 'inactive' ? $t('已停用') : ''].filter(Boolean).join(' · ')}</Txt>
          </View>
        </View>
        {member.description ? <View style={{ paddingHorizontal: 16 }}><Markdown content={member.description} size="body" /></View> : null}
        {member.systemPrompt ? <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SectionTitle title={$t('系统提示词')} /><Markdown content={member.systemPrompt} size="body" /></View> : null}
        {member.capabilities?.length ? <View style={{ paddingHorizontal: 16, paddingTop: 8 }}><SectionTitle title={$t('能力')} />{member.capabilities.map((cap) => <Txt key={cap}>{'• ' + cap}</Txt>)}</View> : null}
        <View style={{ padding: 16, gap: 8 }}>
          <Button label={$t('对话')} onPress={async () => { const { conversation } = await client.post<{ conversation: { id: string } }>('/api/communications', { kind: 'agent', targetId: member.id }); router.push({ pathname: '/chat/[chatId]', params: { chatId: conversation.id } }); }} />
          <Button label={$t('编辑')} icon={Pencil} onPress={() => router.push({ pathname: '/directory/edit', params: { kind: 'agent', id } })} />
        </View>
      </>
    );
  } else if (kind === 'teams') {
    const team = item as Team;
    body = (
      <>
        <View style={{ padding: 16, gap: 6 }}>
          <Txt variant="title" weight="semibold">{team.name}</Txt>
          {team.mission ? <Markdown content={team.mission} size="body" /> : null}
        </View>
        <SectionTitle title={$t('成员') + ' ' + (team.memberAgentIds || []).length} />
        {(team.memberAgentIds || []).map((memberId) => (
          <Txt key={memberId} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>{memberId}</Txt>
        ))}
        <View style={{ padding: 16, gap: 8 }}>
          <Button label={$t('编辑')} icon={Pencil} onPress={() => router.push({ pathname: '/directory/edit', params: { kind: 'team', id } })} />
          <Button label={$t('预填新任务')} onPress={() => router.push({ pathname: '/task/compose', params: { teamId: id } })} />
        </View>
      </>
    );
  } else if (kind === 'workflows') {
    const workflow = item as Workflow;
    body = (
      <>
        <View style={{ padding: 16, gap: 8 }}>
          <Txt variant="title" weight="semibold">{workflow.name}</Txt>
          {workflow.description ? <Markdown content={workflow.description} size="body" /> : null}
        </View>
        <SectionTitle title={$t('节点') + ' ' + (workflow.nodes || []).length} />
        {(workflow.nodes || []).map((node, index) => (
          <View key={node.id} style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
            <Txt weight="medium">{index + 1}. {node.title || node.id}</Txt>
            {node.description ? <Txt variant="small" tone="tertiary" numberOfLines={2}>{node.description}</Txt> : null}
            {node.deliverable ? <Txt variant="small" tone="secondary" numberOfLines={2}>{$t('交付要求：{0}', [node.deliverable])}</Txt> : null}
          </View>
        ))}
      </>
    );
  } else if (kind === 'roles') {
    const role = item as Role;
    body = (
      <View style={{ padding: 16, gap: 10 }}>
        <Txt variant="title" weight="semibold">{role.name}</Txt>
        {role.prompt ? <Markdown content={role.prompt} /> : null}
        <Button label={$t('编辑')} icon={Pencil} onPress={() => router.push({ pathname: '/directory/edit', params: { kind: 'role', id } })} />
      </View>
    );
  } else if (kind === 'marketplace' || kind === 'mcp') {
    body = (
      <View style={{ padding: 16, gap: 8 }}>
        <Txt variant="title" weight="semibold">{item.name}</Txt>
        {item.description ? <Markdown content={item.description} size="body" /> : null}
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Tag label={item.enabled === false ? $t('已停用') : $t('已启用')} tone={item.enabled === false ? 'neutral' : 'done'} />
          <Tag label={(item.version ? 'v' + item.version : '') || item.origin || ''} tone="outline" />
        </View>
      </View>
    );
  } else if (kind === 'git') {
    body = (
      <View style={{ padding: 16, gap: 8 }}>
        <Txt variant="title" weight="semibold">{item.provider || item.host || $t('仓库访问')}</Txt>
        <Fact label={$t('主机')} value={item.host || '—'} />
        <Fact label={$t('状态')} value={item.configured ? $t('已配置') : $t('未配置')} />
        <Button label={$t('配置凭据')} icon={Pencil} onPress={() => router.push({ pathname: '/directory/edit', params: { kind: 'git', id } })} />
      </View>
    );
  }
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingTop: headerHeight + 4, paddingBottom: 64 }}>
      {screen}
      {body}
    </ScrollView>
  );
}
