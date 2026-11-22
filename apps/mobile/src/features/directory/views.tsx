// Read-only detail pages of 更多 (the Mac directory drawers on the phone): a
// profile header, grouped facts, prompts and the related entries. Nothing here
// edits the Mac's configuration; icons only open chats, tasks or other details.
import { router, Stack } from 'expo-router';
import { Bot, Check, IdCard, type LucideIcon, MessageSquare, MessagesSquare, Plug, Puzzle, RotateCw, SquarePen, Users, Wrench, X, Workflow as WorkflowIcon } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { formatExactTime, formatRelativeTime, workflowDisplay } from '@shared/console-projections.mjs';
import { runtimeLabel, RUNTIME_IDS } from '@shared/runtime-providers.mjs';
import { useCatalog } from '@/features/catalog';
import { startConversation } from '@/features/chats/model';
import { CollapsibleBody } from '@/features/messages/views';
import { useRuntimeProfiles } from '@/features/settings';
import { $t, useLocale } from '@/i18n';
import { identityColor, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { DetailHeader, GroupedBlock, GroupedPage, GroupedRow, GroupedSection, IconTile } from '@/ui/grouped';
import { HeaderButtons, plainHeaderItem } from '@/ui/header';
import { IconButton } from '@/ui/icon-button';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { Tag } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';
import {
  type DirectoryKind, type Extension, type Member, type PluginComponent, type Role, type Team, type Workflow,
  selectedExtensions, useAllAgents, useDirectoryDetail, useDirectoryDetails, useMcpTools,
} from './api';

/** Section names, shared by the 更多 hub, the lists and the detail titles. */
export const directoryTitle = (kind: DirectoryKind) => ({
  agents: $t('数字员工'), teams: $t('团队'), workflows: $t('工作流'), roles: $t('角色'), plugins: $t('插件'), mcp: 'MCP',
})[kind];

export const directoryIcons: Record<DirectoryKind, LucideIcon> = { agents: Bot, teams: Users, workflows: WorkflowIcon, roles: IdCard, plugins: Puzzle, mcp: Plug };

export const openDirectory = (kind: DirectoryKind, id: string) => router.push({ pathname: '/directory/detail', params: { kind, id } });

/** Same stable color choice as the Mac's extension avatars. */
function extensionColor(id: string) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + (char.codePointAt(0) || 0)) >>> 0;
  return ['violet', 'cyan', 'orange', 'blue', 'green'][hash % 5];
}

/** Two-letter tile for plugins, MCP and teams (Mac: extension avatar). */
export function LetterTile({ id, name, size = 36, letters = 2 }: { id: string; name: string; size?: number; letters?: number }) {
  const { colors, metrics } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * metrics.avatarRadius, backgroundColor: identityColor(colors, extensionColor(id)), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.onSolid, fontSize: Math.round(size * (letters > 1 ? 0.36 : 0.42)), fontWeight: '600' }}>{[...(name || '?')].slice(0, letters).join('').toUpperCase()}</Text>
    </View>
  );
}

const installedDate = (value?: string) => {
  const date = new Date(value || '');
  if (Number.isNaN(+date)) return $t('安装日期未记录');
  const days = Math.floor((Date.now() - +date) / 86400000);
  return days < 1 ? $t('今天安装') : days < 30 ? $t('{0} 天前安装', [days]) : $t('{0}月{1}日安装', [date.getMonth() + 1, date.getDate()]);
};
const sourceLabel = (item: Extension) => {
  const url = item.source?.origin?.url || item.source?.url;
  if (!url) return $t('来源未记录');
  if (url.startsWith('file:')) { try { return $t('本地目录 · {0}', [decodeURIComponent(new URL(url).pathname)]); } catch { return $t('本地目录 · {0}', [url]); } }
  if (url.startsWith('/') || url.startsWith('~')) return $t('本地目录 · {0}', [url]);
  return 'Git · ' + url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '');
};
const mcpType = (item: Extension) => {
  const server = Object.values(item.configuration?.mcpServers || {})[0];
  return server?.command ? 'stdio' : server?.type === 'sse' ? 'SSE' : server?.url ? 'HTTP' : $t('类型未记录');
};
const countTitle = (title: string, count: number) => title + ' · ' + count;

/** One-line plain preview of Markdown for list rows (headings, emphasis and links unwrapped). */
export function plainPreview(markdown?: string | null) {
  return (markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

type Loadable = { isPending: boolean; error: Error | null; refetch: () => unknown };

/** Page frame: native title + header icons, loading/error, grouped scroll body. */
function DetailPage({ title, actions, state, children }: { title: string; actions?: ReactNode; state: Loadable; children: () => ReactNode }) {
  const screen = <Stack.Screen options={{ title, unstable_headerRightItems: actions ? () => plainHeaderItem(<HeaderButtons>{actions}</HeaderButtons>) : undefined }} />;
  if (state.isPending) return <>{screen}<LoadingState /></>;
  if (state.error) return <>{screen}<ErrorState message={state.error.message} onRetry={() => void state.refetch()} /></>;
  return <GroupedPage>{screen}{children()}</GroupedPage>;
}

function Prompt({ content }: { content?: string | null }) {
  return <GroupedBlock>{content?.trim() ? <CollapsibleBody content={content} /> : <Txt tone="tertiary">{$t('未填写')}</Txt>}</GroupedBlock>;
}

function MemberRows({ members, empty }: { members: Member[]; empty: string }) {
  if (!members.length) return <GroupedBlock><Txt variant="small" tone="tertiary">{empty}</Txt></GroupedBlock>;
  return (
    <>
      {members.map((member) => (
        <GroupedRow key={member.id} leading={<Avatar member={member} size={32} />} title={member.name}
          subtitle={member.description} onPress={() => openDirectory('agents', member.id)} />
      ))}
    </>
  );
}

/** Selected plugins and MCP as rows that open their own details. */
function ExtensionRows({ pluginIds, mcpIds, empty }: { pluginIds: string[]; mcpIds: string[]; empty: string }) {
  const plugins = useDirectoryDetails<Extension>('plugins', pluginIds);
  const mcps = useDirectoryDetails<Extension>('mcp', mcpIds);
  const rows = [
    ...pluginIds.map((id, index) => ({ id, kind: 'plugins' as const, label: $t('插件'), result: plugins[index] })),
    ...mcpIds.map((id, index) => ({ id, kind: 'mcp' as const, label: 'MCP', result: mcps[index] })),
  ];
  if (!rows.length) return <GroupedBlock><Txt variant="small" tone="tertiary">{empty}</Txt></GroupedBlock>;
  return (
    <>
      {rows.map(({ id, kind, label, result }) => {
        const name = result?.data?.name || id;
        return (
          <GroupedRow key={kind + id} leading={<LetterTile id={id} name={name} size={30} />} title={name}
            value={result?.error ? label + ' · ' + $t('读取失败') : label} onPress={result?.data ? () => openDirectory(kind, id) : undefined} />
        );
      })}
    </>
  );
}

export function AgentDetail({ id }: { id: string }) {
  useLocale();
  const client = useClient();
  const toast = useToast();
  const detail = useDirectoryDetail<Member>('agents', id);
  const profiles = useRuntimeProfiles();
  const member = detail.data;
  const roles = useDirectoryDetails<Role>('roles', member?.roleIds || []);
  const [opening, setOpening] = useState(false);
  async function chat() {
    setOpening(true);
    try { const { conversation } = await startConversation(client, [id]); router.push({ pathname: '/chat/[chatId]', params: { chatId: conversation.id } }); }
    catch (error) { toast((error as Error).message, true); }
    finally { setOpening(false); }
  }
  return (
    <DetailPage title={directoryTitle('agents')} state={detail}
      actions={<IconButton icon={MessageSquare} label={$t('对话')} loading={opening} disabled={!member || member.status === 'inactive'} onPress={() => void chat()} />}>
      {() => {
        if (!member) return null;
        const profile = profiles.data?.profiles.find((item) => item.id === member.runtime?.profileId);
        const provider = profile?.provider || member.runtime?.provider;
        const roleNames = roles.map((result, index) => result.data?.name || member.roleIds?.[index]).filter(Boolean);
        const tools = selectedExtensions(member);
        return (
          <>
            <DetailHeader visual={<Avatar member={member} size={56} />} title={member.name}
              subtitle={roleNames.join(' · ') || null}
              badges={(
                <>
                  {member.status === 'inactive' ? <Tag label={$t('已停用')} /> : null}
                  {provider ? <Tag label={runtimeLabel(provider)} tone="outline" /> : null}
                </>
              )} />
            <GroupedSection title={$t('简介')}>
              <GroupedBlock><Txt tone={member.description ? 'primary' : 'tertiary'} selectable>{member.description || $t('暂无简介')}</Txt></GroupedBlock>
            </GroupedSection>
            {member.capabilities?.length ? (
              <GroupedSection title={$t('能力标签')}>
                <GroupedBlock style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{member.capabilities.map((item) => <Tag key={item} label={item} tone="outline" />)}</GroupedBlock>
              </GroupedSection>
            ) : null}
            <GroupedSection title={$t('运行配置')} footer={profiles.error ? $t('运行配置读取失败，请重新打开详情。') : null}>
              <GroupedRow title={$t('运行时')} value={provider ? runtimeLabel(provider) : '—'} />
              <GroupedRow title={$t('模型')} value={(profile ? profile.model : member.runtime?.model) || $t('CLI 默认模型')} />
              <GroupedRow title={$t('思考等级')} value={(profile ? profile.effort : member.runtime?.effort) || $t('默认')} />
            </GroupedSection>
            <GroupedSection title={countTitle($t('工具'), tools.pluginIds.length + tools.mcpIds.length)}>
              <ExtensionRows pluginIds={tools.pluginIds} mcpIds={tools.mcpIds} empty={$t('未选择插件或 MCP。')} />
            </GroupedSection>
            <GroupedSection title={$t('工作提示词')}><Prompt content={member.systemPrompt} /></GroupedSection>
            {roles.map((result, index) => result.data ? (
              <GroupedSection key={result.data.id} title={$t('角色提示词 · {0}', [result.data.name])}
                action={<IconButton icon={IdCard} label={$t('查看角色')} size={28} onPress={() => openDirectory('roles', member.roleIds![index])} />}>
                <Prompt content={result.data.prompt} />
              </GroupedSection>
            ) : null)}
          </>
        );
      }}
    </DetailPage>
  );
}

export function TeamDetail({ id }: { id: string }) {
  useLocale();
  const client = useClient();
  const toast = useToast();
  const detail = useDirectoryDetail<Team>('teams', id);
  const team = detail.data;
  const [opening, setOpening] = useState(false);
  async function chat() {
    if (!team) return;
    setOpening(true);
    try { const { conversation } = await startConversation(client, team.memberAgentIds); router.push({ pathname: '/chat/[chatId]', params: { chatId: conversation.id } }); }
    catch (error) { toast((error as Error).message, true); }
    finally { setOpening(false); }
  }
  const active = team?.status === 'active';
  return (
    <DetailPage title={directoryTitle('teams')} state={detail}
      actions={(
        <>
          <IconButton icon={MessagesSquare} label={$t('群聊')} loading={opening} disabled={!team?.memberAgentIds.length} onPress={() => void chat()} />
          <IconButton icon={SquarePen} label={$t('用此团队新建任务')} disabled={!active} onPress={() => router.push({ pathname: '/task/compose', params: { teamId: id } })} />
        </>
      )}>
      {() => team ? (
        <>
          <DetailHeader visual={<LetterTile id={team.name} name={team.name} size={56} letters={1} />} title={team.name} subtitle={team.mission || $t('（未填写使命）')}
            badges={<Tag label={active ? $t('启用@@status') : $t('停用@@status')} tone={active ? 'done' : 'neutral'} />} />
          <GroupedSection title={countTitle($t('成员'), team.members?.length ?? team.memberAgentIds.length)}>
            <MemberRows members={team.members || []} empty={$t('暂无成员')} />
          </GroupedSection>
          {team.createdAt ? <GroupedSection><GroupedRow title={$t('创建时间')} value={formatExactTime(team.createdAt)} /></GroupedSection> : null}
        </>
      ) : null}
    </DetailPage>
  );
}

/** Vertical node timeline: number, title, description, deliverable and inputs. */
function NodeTimeline({ workflow }: { workflow: Workflow }) {
  const { colors } = useTheme();
  const nodes = workflow.nodes || [];
  const titleOf = (nodeId: string) => nodes.find((node) => node.id === nodeId)?.title || nodeId;
  return (
    <GroupedBlock style={{ gap: 0, paddingVertical: 6 }}>
      {nodes.map((node, index) => (
        <View key={node.id} style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ alignItems: 'center', width: 26 }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
              <Txt variant="caption" weight="semibold" color={colors.accentText} numeric>{String(index + 1)}</Txt>
            </View>
            {index < nodes.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: colors.borderSubtle, marginTop: 4 }} /> : null}
          </View>
          <View style={{ flex: 1, minWidth: 0, paddingTop: 10, paddingBottom: 14, gap: 4 }}>
            <Txt weight="medium">{node.title || node.id}</Txt>
            {node.description ? <Txt variant="small" tone="secondary">{node.description}</Txt> : null}
            {node.deliverable ? <Txt variant="small">{$t('交付要求：{0}', [node.deliverable])}</Txt> : null}
            {node.dependsOn?.length ? <Txt variant="small" tone="tertiary">{$t('依赖：{0}', [node.dependsOn.map(titleOf).join('、')])}</Txt> : null}
            {node.staffingGuidance ? <Txt variant="small" tone="tertiary">{node.staffingGuidance}</Txt> : null}
            {node.artifactPaths?.length ? <Txt variant="caption" tone="tertiary" mono>{node.artifactPaths.join('  ')}</Txt> : null}
          </View>
        </View>
      ))}
    </GroupedBlock>
  );
}

export function WorkflowDetail({ id }: { id: string }) {
  useLocale();
  const detail = useDirectoryDetail<Workflow>('workflows', id);
  return (
    <DetailPage title={directoryTitle('workflows')} state={detail}>
      {() => {
        if (!detail.data) return null;
        const workflow = workflowDisplay(detail.data);
        const nodes = workflow.nodes || [];
        const titleOf = (nodeId: string) => nodes.find((node) => node.id === nodeId)?.title || nodeId;
        const edges = (workflow.edges || []).filter((edge) => edge.condition || edge.description || edge.handoff);
        return (
          <>
            <DetailHeader visual={<IconTile icon={WorkflowIcon} size={56} />} title={workflow.name} subtitle={workflow.description}
              badges={(
                <>
                  <Tag label={$t('{0} 个节点', [nodes.length])} tone="outline" />
                  {workflow.system ? <Tag label={$t('系统')} /> : null}
                </>
              )} />
            <GroupedSection title={$t('职责节点')}>
              {nodes.length ? <NodeTimeline workflow={workflow} /> : <GroupedBlock><Txt variant="small" tone="tertiary">{$t('暂无节点')}</Txt></GroupedBlock>}
            </GroupedSection>
            {edges.length ? (
              <GroupedSection title={$t('交接关系')}>
                {edges.map((edge, index) => (
                  <GroupedRow key={edge.id || index} title={titleOf(edge.source) + ' → ' + titleOf(edge.target)} subtitle={edge.condition || edge.description} numberOfLines={3}
                    value={edge.handoff ? $t('交接') : edge.dependency ? $t('依赖') : null} />
                ))}
              </GroupedSection>
            ) : null}
          </>
        );
      }}
    </DetailPage>
  );
}

export function RoleDetail({ id }: { id: string }) {
  useLocale();
  const detail = useDirectoryDetail<Role>('roles', id);
  const catalog = useCatalog();
  const role = detail.data;
  const bound = ((catalog.data?.agents || []) as Member[]).filter((agent) => agent.roleIds?.includes(id));
  const time = role?.updatedAt || role?.createdAt;
  return (
    <DetailPage title={directoryTitle('roles')} state={detail}>
      {() => role ? (
        <>
          <DetailHeader visual={<IconTile icon={IdCard} size={56} />} title={role.name}
            subtitle={time ? (role.updatedAt ? $t('更新于') : $t('创建于')) + ' ' + formatRelativeTime(time) : null}
            badges={<Tag label={$t('{0} 位员工', [bound.length])} tone="outline" />} />
          <GroupedSection title={$t('提示词')}><Prompt content={role.prompt} /></GroupedSection>
          <GroupedSection title={countTitle($t('工具'), (role.extensionSelection?.pluginIds?.length || 0) + (role.extensionSelection?.mcpIds?.length || 0))}>
            <ExtensionRows pluginIds={role.extensionSelection?.pluginIds || []} mcpIds={role.extensionSelection?.mcpIds || []} empty={$t('未选择插件或 MCP。')} />
          </GroupedSection>
          <GroupedSection title={countTitle($t('绑定员工'), bound.length)}>
            <MemberRows members={bound} empty={$t('未绑定员工')} />
          </GroupedSection>
        </>
      ) : null}
    </DetailPage>
  );
}

/** Employees whose selection (own or through roles) includes this plugin / MCP. */
function UsedBy({ kind, id }: { kind: 'plugins' | 'mcp'; id: string }) {
  const agents = useAllAgents();
  const key = kind === 'plugins' ? 'pluginIds' : 'mcpIds';
  const users = (agents.data || []).filter((agent) => selectedExtensions(agent)[key].includes(id));
  const label = kind === 'plugins' ? $t('插件@@item') : 'MCP';
  return (
    <GroupedSection title={agents.data ? countTitle($t('选择此{0}的员工', [label]), users.length) : $t('选择此{0}的员工', [label])}>
      {agents.isPending ? <GroupedBlock><Txt variant="small" tone="tertiary">{$t('正在读取…')}</Txt></GroupedBlock>
        : agents.error ? <GroupedBlock><Txt variant="small" tone="danger">{$t('员工使用情况读取失败。')}</Txt></GroupedBlock>
          : <MemberRows members={users} empty={$t('还没有员工选择此{0}。', [label])} />}
    </GroupedSection>
  );
}

function ComponentSection({ title, items }: { title: string; items: PluginComponent[] }) {
  if (!items.length) return null;
  return (
    <GroupedSection title={countTitle(title, items.length)}>
      {items.map((item, index) => (
        <GroupedRow key={(item.name || item.event || '') + index} title={item.name || item.event || '—'} subtitle={item.description} numberOfLines={3} />
      ))}
    </GroupedSection>
  );
}

export function PluginDetail({ id }: { id: string }) {
  useLocale();
  const { colors } = useTheme();
  const detail = useDirectoryDetail<Extension>('plugins', id);
  return (
    <DetailPage title={directoryTitle('plugins')} state={detail}>
      {() => {
        const item = detail.data;
        if (!item) return null;
        const providers = item.providers || [];
        const list = (key: 'skills' | 'agents' | 'hooks') => (Array.isArray(item.components?.[key]) ? item.components[key] as PluginComponent[] : []);
        return (
          <>
            <DetailHeader visual={<LetterTile id={item.id} name={item.name} size={56} />} title={item.name} subtitle={item.description}
              badges={item.version ? <Tag label={/^v/.test(item.version) ? item.version : 'v' + item.version} tone="outline" /> : null} />
            {item.warnings?.length ? (
              <View style={{ marginHorizontal: 16, marginTop: 16 }}>
                <Notice tone="attention" text={$t('{0} 个组件未能加载', [item.warnings.length]) + '\n' + item.warnings.map((warning) => `${warning.plugin || ''} · ${warning.component || ''}：${warning.message || ''}`).join('\n')} />
              </View>
            ) : null}
            <GroupedSection>
              <GroupedRow title={$t('来源')} subtitle={sourceLabel(item)} numberOfLines={3} />
              <GroupedRow title={$t('安装')} value={installedDate(item.createdAt)} />
            </GroupedSection>
            <GroupedSection title={$t('运行时兼容性') + ' · ' + providers.length + ' / ' + RUNTIME_IDS.length}
              footer={$t('组件静态兼容；依赖与账号需在实际执行时验证')}>
              {providers.length ? (
                <GroupedRow title={$t('兼容')} subtitle={providers.map(runtimeLabel).join('、')} numberOfLines={4} trailing={<Check size={18} color={colors.stDone} />} />
              ) : null}
              {RUNTIME_IDS.filter((provider) => !providers.includes(provider)).map((provider) => (
                <GroupedRow key={provider} title={runtimeLabel(provider)} numberOfLines={4} trailing={<X size={18} color={colors.textTertiary} />}
                  subtitle={item.compatibility?.[provider]?.reasons?.join('；') || $t('此插件的组件与当前 Runtime 不兼容')} />
              ))}
            </GroupedSection>
            <ComponentSection title="Skill" items={list('skills')} />
            <ComponentSection title="Subagent" items={list('agents')} />
            <ComponentSection title="Hook" items={list('hooks')} />
            <UsedBy kind="plugins" id={item.id} />
          </>
        );
      }}
    </DetailPage>
  );
}

const TOOL_PREVIEW = 30;

function McpTools({ id }: { id: string }) {
  const [refresh, setRefresh] = useState(0);
  const [all, setAll] = useState(false);
  const tools = useMcpTools(id, refresh);
  const list = tools.data?.tools || [];
  const shown = all ? list : list.slice(0, TOOL_PREVIEW);
  return (
    <GroupedSection title={tools.data ? countTitle($t('工具'), tools.data.total) : $t('工具')}
      action={<IconButton icon={RotateCw} label={$t('刷新工具列表')} size={28} loading={tools.isFetching} onPress={() => setRefresh((value) => value + 1)} />}>
      {tools.isPending ? <GroupedBlock><Txt variant="small" tone="tertiary">{$t('正在读取工具…')}</Txt></GroupedBlock> : null}
      {tools.error ? (
        <GroupedBlock>
          <Txt weight="medium" tone="danger">{$t('无法读取工具列表')}</Txt>
          <Txt variant="small" tone="secondary" selectable>{tools.error.message}</Txt>
        </GroupedBlock>
      ) : null}
      {tools.data && !list.length ? <GroupedBlock><Txt variant="small" tone="tertiary">{$t('没有匹配的工具。')}</Txt></GroupedBlock> : null}
      {shown.map((tool) => (
        <GroupedRow key={tool.name} icon={Wrench} title={tool.name} subtitle={[tool.title && tool.title !== tool.name ? tool.title : '', tool.description].filter(Boolean).join(' · ')} numberOfLines={3} />
      ))}
      {list.length > shown.length ? <GroupedRow title={$t('显示全部 {0} 个工具', [list.length])} onPress={() => setAll(true)} /> : null}
    </GroupedSection>
  );
}

export function McpDetail({ id }: { id: string }) {
  useLocale();
  const { colors } = useTheme();
  const detail = useDirectoryDetail<Extension>('mcp', id);
  return (
    <DetailPage title={directoryTitle('mcp')} state={detail}>
      {() => {
        const item = detail.data;
        if (!item) return null;
        return (
          <>
            <DetailHeader visual={<LetterTile id={item.id} name={item.name} size={56} />} title={item.name} subtitle={item.description}
              badges={<Tag label={mcpType(item)} tone="outline" />} />
            <GroupedSection>
              <GroupedRow title={$t('安装')} value={installedDate(item.createdAt)} />
              <GroupedRow title={$t('可被选择')} subtitle={(item.providers || []).map(runtimeLabel).join('、') || '—'} numberOfLines={3} />
            </GroupedSection>
            <McpTools id={item.id} />
            <GroupedSection title={$t('连接配置')} footer={(item.redacted ? $t('配置中的鉴权值已隐藏。') : '') + $t('原始 JSON 保存在本机私有配置目录，列表不携带此配置。')}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 14 }} style={{ backgroundColor: colors.codeBg }}>
                <Txt variant="small" mono selectable>{JSON.stringify(item.configuration || {}, null, 2)}</Txt>
              </ScrollView>
            </GroupedSection>
            <UsedBy kind="mcp" id={item.id} />
          </>
        );
      }}
    </DetailPage>
  );
}

export const directoryDetails: Record<DirectoryKind, (props: { id: string }) => ReactNode> = {
  agents: AgentDetail, teams: TeamDetail, workflows: WorkflowDetail, roles: RoleDetail, plugins: PluginDetail, mcp: McpDetail,
};
