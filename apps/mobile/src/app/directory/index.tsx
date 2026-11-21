// Directory screen for one "更多" section: search + list, with the section's actions.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { formatRelativeTime, workflowDisplay } from '@shared/console-projections.mjs';
import { useManualRefresh } from '@/api/queries';
import { useCatalog } from '@/features/catalog';
import { directoryItems, useDirectory, type Member, type Role, type Team, type Workflow } from '@/features/directory/api';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar, GroupAvatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/form';
import { HeaderButton } from '@/ui/header';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Tag } from '@/ui/status';
import { Txt } from '@/ui/text';

const meta = () => ({
  agents: { title: $t('数字员工'), resource: 'agents', icon: $t('员工'), create: () => router.push({ pathname: '/directory/edit', params: { kind: 'agent' } }) },
  teams: { title: $t('团队'), resource: 'teams', icon: $t('团队'), create: () => router.push({ pathname: '/directory/edit', params: { kind: 'team' } }) },
  workflows: { title: $t('工作流'), resource: 'workflow-templates', icon: $t('流程') },
  roles: { title: $t('角色'), resource: 'roles', icon: $t('角色'), create: () => router.push({ pathname: '/directory/edit', params: { kind: 'role' } }) },
  marketplace: { title: $t('插件'), resource: 'runtime/marketplace', icon: $t('插件') },
  mcp: { title: $t('MCP'), resource: 'runtime/mcp-marketplace', icon: 'MCP' },
  git: { title: $t('仓库访问'), resource: 'runtime/git-credentials', icon: $t('仓库') },
} as const);

export default function Directory() {
  useLocale();
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const { colors, metrics } = useTheme();
  const catalog = useCatalog();
  const [query, setQuery] = useState('');
  const spec = (meta() as any)[kind] || meta().agents;
  const list = useDirectory(spec.resource);
  const pull = useManualRefresh(list.refetch);
  const items = directoryItems(list.data);
  const agents = catalog.data?.agents || [];
  const filtered = items.filter((item: any) => !query.trim() || (item.name || '') .toLowerCase().includes(query.trim().toLowerCase()));

  const row = ({ item }: { item: any }) => {
    const open = () => router.push({ pathname: '/directory/detail', params: { kind, id: item.id } });
    if (kind === 'teams') {
      const members = (item as Team).memberAgentIds.map((id) => agents.find((agent) => agent.id === id)).filter(Boolean) as Member[];
      return (
        <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
          <GroupAvatar members={members} size={36} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Txt weight="medium" numberOfLines={1}>{item.name}</Txt>
            <Txt variant="small" tone="tertiary" numberOfLines={1}>{(item as Team).mission || $t('{0} 位成员', [members.length])}</Txt>
          </View>
          <Tag label={item.status === 'inactive' ? $t('已停用') : $t('{0} 位成员', [members.length])} tone={item.status === 'inactive' ? 'neutral' : 'violet'} />
        </Pressable>
      );
    }
    if (kind === 'workflows') {
      const workflow = workflowDisplay(item as Workflow);
      return (
        <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, gap: 4 })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt weight="medium" numberOfLines={1} style={{ flex: 1 }}>{workflow.name}</Txt>
            <Txt variant="caption" tone="tertiary" numeric>{formatRelativeTime((item as Workflow).updatedAt || '')}</Txt>
          </View>
          {workflow.description ? <Txt variant="small" tone="tertiary" numberOfLines={2}>{workflow.description}</Txt> : null}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            {(workflow.nodes || []).slice(0, 4).map((node) => <Tag key={node.id} label={node.title || node.id} tone="outline" />)}
            {(workflow.nodes || []).length > 4 ? <Tag label={'+' + ((workflow.nodes || []).length - 4)} tone="outline" /> : null}
          </View>
        </Pressable>
      );
    }
    if (kind === 'roles') {
      return (
        <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
          <Avatar member={{ name: (item as Role).name }} size={36} />
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Txt weight="medium" numberOfLines={1}>{item.name}</Txt>
            <Txt variant="small" tone="tertiary" numberOfLines={1}>{(item as Role).prompt}</Txt>
          </View>
        </Pressable>
      );
    }
    if (kind === 'marketplace' || kind === 'mcp') {
      return (
        <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bgActive, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="small" weight="semibold" mono>{String(item.name || '?').slice(0, 2).toUpperCase()}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Txt weight="medium" numberOfLines={1}>{item.name}</Txt>
            {item.description ? <Txt variant="small" tone="tertiary" numberOfLines={1}>{item.description}</Txt> : null}
          </View>
          <Tag label={item.enabled === false ? $t('已停用') : item.installed ? $t('已安装') : $t('可用')} tone={item.enabled === false ? 'neutral' : 'done'} />
        </Pressable>
      );
    }
    if (kind === 'git') {
      const connected = Boolean((item as any).configured || (item as any).token || (item as any).username);
      return (
        <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bgActive, alignItems: 'center', justifyContent: 'center' }}>
            <Txt variant="small" weight="semibold" mono>{String(item.provider || item.name || '?').slice(0, 2).toUpperCase()}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Txt weight="medium" numberOfLines={1}>{item.provider || item.name}</Txt>
            {item.host ? <Txt variant="small" tone="tertiary" mono numberOfLines={1}>{item.host}</Txt> : null}
          </View>
          <Tag label={connected ? $t('已配置') : $t('未配置')} tone={connected ? 'done' : 'neutral'} />
        </Pressable>
      );
    }
    const member = item as Member;
    return (
      <Pressable accessibilityRole="button" onPress={open} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
        <Avatar member={member} size={36} manager={member.kind === 'manager'} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Txt weight="medium" numberOfLines={1}>{member.name}</Txt>
          <Txt variant="small" tone="tertiary" numberOfLines={1}>{member.description}</Txt>
        </View>
        {member.kind === 'manager' ? <Tag label={$t('经理')} tone="accent" /> : null}
        {member.status === 'inactive' ? <Tag label={$t('已停用')} tone="neutral" /> : null}
      </Pressable>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: spec.title, headerRight: spec.create ? () => <HeaderButton icon={Plus} label={$t('新建')} onPress={spec.create} /> : undefined }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.bgCanvas }}
        data={filtered}
        keyExtractor={(item: any) => item.id}
        renderItem={row}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
        ListHeaderComponent={
          <View style={{ margin: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
            <TextField value={query} onChangeText={setQuery} placeholder={$t('搜索')} style={{ flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0, minHeight: 40 }} accessibilityLabel={$t('搜索')} />
          </View>
        }
        ListEmptyComponent={list.isPending ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} /> : <EmptyState icon={Plus} title={$t('暂无记录')} />}
      />
    </>
  );
}
