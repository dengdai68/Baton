// Create / edit a task draft or an automation — the same fields, rules and
// payloads as the Mac form (web/app.js newTaskModal): title and description
// required, up to 20 acceptance criteria (≤500 chars each), teams expand into
// members, one selected member is this task's manager, workflow optional.
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Search, Star } from 'lucide-react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { type Catalog, useCatalog } from '@/features/catalog';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar, GroupAvatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { ChoiceRow, Field, TextField } from '@/ui/form';
import { SectionTitle } from '@/ui/layout';
import { ErrorState, LoadingState, Notice } from '@/ui/states';
import { Tag } from '@/ui/status';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export type TaskSource = {
  id: string; title: string; objective: string; acceptanceCriteria?: string[]; memberAgentIds?: string[]; managerAgentId?: string;
  workflowTemplateId?: string | null; workflowSnapshot?: { name?: string } | null; cron?: string; enabled?: boolean;
  memberSnapshots?: Array<{ id: string; name: string }>; managerSnapshot?: { id: string; name: string };
};

type Errors = Partial<Record<'title' | 'objective' | 'criteria' | 'members' | 'cron', string>>;

export function TaskForm({ automation = false, existing, presetTeamId, onStart }: {
  automation?: boolean; existing?: TaskSource | null; presetTeamId?: string; onStart?: (taskId: string) => Promise<void>;
}) {
  const catalog = useCatalog();
  if (catalog.isPending) return <LoadingState label={$t('正在读取成员与工作流')} />;
  if (catalog.error) return <ErrorState title={$t('配置读取失败')} message={catalog.error.message} onRetry={() => void catalog.refetch()} />;
  return <TaskFormBody catalog={catalog.data} automation={automation} existing={existing} presetTeamId={presetTeamId} onStart={onStart} />;
}

function TaskFormBody({ catalog, automation, existing, presetTeamId, onStart }: { catalog: Catalog; automation: boolean; existing?: TaskSource | null; presetTeamId?: string; onStart?: (taskId: string) => Promise<void> }) {
  const { colors, metrics } = useTheme();
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const candidates = catalog.agents.filter((agent) => agent.status === 'active');
  const teams = catalog.teams.filter((team) => team.status === 'active');
  const expand = (memberIds: string[]) => memberIds.filter((id) => candidates.some((agent) => agent.id === id));
  const presetTeam = presetTeamId ? teams.find((team) => team.id === presetTeamId) : null;
  const [title, setTitle] = useState(existing?.title || '');
  const [objective, setObjective] = useState(existing?.objective || '');
  const [criteria, setCriteria] = useState((existing?.acceptanceCriteria || []).join('\n'));
  const [cron, setCron] = useState(existing?.cron || '0 9 * * 1-5');
  const [members, setMembers] = useState<string[]>(existing?.memberAgentIds || (presetTeam ? expand(presetTeam.memberAgentIds) : []));
  const [manager, setManager] = useState<string | null>(existing?.managerAgentId || null);
  const [workflow, setWorkflow] = useState(existing?.workflowTemplateId || '');
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<string | null>(null);
  const knownWorkflow = !workflow || catalog.workflowTemplates.some((template) => template.id === workflow);
  const unavailable = members.filter((id) => !candidates.some((agent) => agent.id === id));
  const nameOf = (id: string) => catalog.agents.find((agent) => agent.id === id)?.name || existing?.memberSnapshots?.find((agent) => agent.id === id)?.name || $t('已删除员工 {0}', [id.slice(0, 8)]);
  const matches = (text: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase());

  if (!candidates.length) return <View style={{ padding: 16 }}><Notice tone="attention" text={$t('请先创建或启用数字员工。')} /></View>;

  function toggle(id: string) {
    setMembers((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
    if (manager === id) setManager(null);
  }
  function toggleTeam(memberIds: string[]) {
    const ids = expand(memberIds);
    const all = ids.every((id) => members.includes(id));
    setMembers((current) => (all ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]));
    if (all && manager && ids.includes(manager)) setManager(null);
  }

  async function submit(mode: 'draft' | 'start' | 'disabled') {
    const next: Errors = {};
    if (!title.trim()) next.title = $t('请填写任务标题。');
    if (!objective.trim()) next.objective = $t('请描述任务目标、范围或关键约束。');
    const acceptanceCriteria = criteria.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (acceptanceCriteria.length > 20) next.criteria = $t('验收标准最多 20 条。');
    else if (acceptanceCriteria.some((item) => item.length > 500)) next.criteria = $t('每条验收标准不能超过 500 字符。');
    if (!members.length) next.members = $t('请至少选择一位员工。');
    else if (unavailable.length) next.members = $t('已选成员不可用，请移除后重新选择。');
    else if (!manager || !members.includes(manager)) next.members = $t('点击已选员工，指定一位本次经理。');
    if (automation && !cron.trim()) next.cron = $t('请填写 Cron 表达式。');
    setErrors(next);
    if (Object.keys(next).length) return;
    const input: Record<string, unknown> = { title: title.trim(), objective, workflowTemplateId: workflow, acceptanceCriteria, memberAgentIds: members, managerAgentId: manager };
    setSaving(mode);
    try {
      if (automation) {
        input.cron = cron.trim();
        input.enabled = existing ? existing.enabled : mode !== 'disabled';
        await (existing ? client.put(`/api/automations/${existing.id}`, input) : client.post('/api/automations', input));
        await queryClient.invalidateQueries({ queryKey: scope });
        toast(existing ? $t('自动化已保存。') : $t('自动化已创建。'));
        router.back();
        return;
      }
      const saved = await (existing ? client.put<{ task: { id: string } }>(`/api/tasks/${existing.id}`, input) : client.post<{ task: { id: string } }>('/api/tasks', input));
      await queryClient.invalidateQueries({ queryKey: scope });
      if (mode !== 'start') {
        toast(existing ? $t('草稿修改已保存。') : $t('草稿已保存，点击启动开始执行。'));
        router.back();
        return;
      }
      router.back();
      try {
        await onStart?.(saved.task.id);
      } catch (error) {
        // Creating and starting are separate commands: the saved draft stays.
        toast($t('{0}，但未能启动 Run：{1}。任务已保留在任务中心，可再次启动。', [existing ? $t('任务修改已保存') : $t('任务已创建'), (error as Error).message]), true);
      }
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={64}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={{ padding: 16, paddingBottom: 0 }}>
          <Field label={automation ? $t('自动化名称') : $t('任务标题')} required error={errors.title}>
            <TextField value={title} onChangeText={setTitle} placeholder={$t('例如：订单结算页重构')} invalid={Boolean(errors.title)} accessibilityLabel={automation ? $t('自动化名称') : $t('任务标题')} />
          </Field>
          <Field label={$t('内容描述')} required error={errors.objective}>
            <TextField value={objective} onChangeText={setObjective} multiline placeholder={$t('描述要完成的事、背景和要求…')} invalid={Boolean(errors.objective)} accessibilityLabel={$t('内容描述')} style={{ minHeight: 140 }} />
          </Field>
          <Field label={$t('验收标准（每行一条）')} optional error={errors.criteria}>
            <TextField value={criteria} onChangeText={setCriteria} multiline placeholder={$t('每行填写一条，可留空')} invalid={Boolean(errors.criteria)} accessibilityLabel={$t('验收标准（每行一条）')} />
          </Field>
          {automation ? (
            <Field label={$t('Cron · 分 时 日 月 周')} required error={errors.cron} hint={$t('例如 0 9 * * 1-5 表示工作日 9:00。')}>
              <TextField value={cron} onChangeText={setCron} autoCapitalize="none" autoCorrect={false} placeholder="0 9 * * 1-5" invalid={Boolean(errors.cron)} style={{ fontFamily: 'Menlo' }} accessibilityLabel="Cron" />
            </Field>
          ) : null}
        </View>

        <SectionTitle title={$t('流程模板（选填）')} />
        <View style={{ marginHorizontal: 16, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {[{ id: '', name: $t('默认协作') }, ...(!knownWorkflow ? [{ id: workflow, name: $t('{0}（已删除，请重新选择）', [existing?.workflowSnapshot?.name || $t('原流程模板')]) }] : []), ...catalog.workflowTemplates].map((template, index) => (
            <ChoiceRow key={template.id || 'default'} selected={workflow === template.id} onPress={() => setWorkflow(template.id)}>
              <Txt style={{ flex: 1 }} numberOfLines={1}>{template.name}</Txt>
            </ChoiceRow>
          ))}
        </View>

        <SectionTitle title={$t('任务成员') + (members.length ? ' · ' + members.length : '')} />
        {errors.members ? <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}><Notice tone="failed" text={errors.members} /></View> : null}
        {members.length ? (
          <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 12, gap: 8, borderRadius: metrics.radius.md, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
            <Txt variant="small" weight="semibold" tone="secondary">{$t('本次经理（点选一位已选员工）')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {members.map((id) => {
                const selected = manager === id;
                return (
                  <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setManager(id)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 10, borderRadius: metrics.radius.sm, borderWidth: 1, borderColor: selected ? colors.accentBorder : colors.border, backgroundColor: selected ? colors.accentSoft : colors.bgRaised }}>
                    {selected ? <Star size={13} color={colors.stAttention} fill={colors.stAttention} /> : null}
                    <Txt variant="small" weight="medium" color={selected ? colors.accentText : undefined} numberOfLines={1}>{nameOf(id)}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        <View style={{ marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgInput }}>
          <Search size={16} color={colors.textTertiary} />
          <TextField value={query} onChangeText={setQuery} placeholder={$t('添加团队或数字员工')} style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0 }} accessibilityLabel={$t('搜索团队或数字员工')} />
        </View>
        <View style={{ marginHorizontal: 16, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {teams.filter((team) => matches(team.name)).map((team) => {
            const ids = expand(team.memberAgentIds);
            const all = ids.length > 0 && ids.every((id) => members.includes(id));
            return (
              <ChoiceRow key={team.id} selected={all} onPress={() => toggleTeam(team.memberAgentIds)} disabled={!ids.length}>
                <GroupAvatar members={ids.map((id) => candidates.find((agent) => agent.id === id)!).filter(Boolean)} size={28} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt weight="medium" numberOfLines={1}>{team.name}</Txt>
                  <Txt variant="caption" tone="tertiary">{$t('{0} 位员工 · 团队', [ids.length])}</Txt>
                </View>
                <Tag label={$t('团队')} tone="violet" />
              </ChoiceRow>
            );
          })}
          {candidates.filter((agent) => matches(agent.name) || matches(agent.description || '')).map((agent) => (
            <ChoiceRow key={agent.id} selected={members.includes(agent.id)} onPress={() => toggle(agent.id)}>
              <Avatar member={agent} size={28} manager={manager === agent.id} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt weight="medium" numberOfLines={1}>{agent.name}</Txt>
                {agent.description ? <Txt variant="caption" tone="tertiary" numberOfLines={1}>{agent.description}</Txt> : null}
              </View>
            </ChoiceRow>
          ))}
          {unavailable.map((id) => (
            <ChoiceRow key={id} selected onPress={() => toggle(id)}>
              <Txt tone="danger" style={{ flex: 1 }} numberOfLines={1}>{nameOf(id)}</Txt>
              <Tag label={$t('不可用')} tone="outline" />
            </ChoiceRow>
          ))}
        </View>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 28, backgroundColor: colors.bgSubtle, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
        {automation ? (
          <>
            {!existing ? <Button style={{ flex: 1 }} size="lg" label={$t('保存为停用')} loading={saving === 'disabled'} disabled={Boolean(saving)} onPress={() => void submit('disabled')} /> : null}
            <Button style={{ flex: 1 }} size="lg" variant="primary" label={existing ? $t('保存修改') : $t('创建并启用')} loading={saving === 'start'} disabled={Boolean(saving)} onPress={() => void submit('start')} />
          </>
        ) : (
          <>
            {/* Drafts are not listed on the phone, so a new task always starts; an existing draft (from the Mac) can still be saved. */}
            {existing ? <Button style={{ flex: 1 }} size="lg" label={$t('保存修改')} loading={saving === 'draft'} disabled={Boolean(saving)} onPress={() => void submit('draft')} /> : null}
            <Button style={{ flex: 1 }} size="lg" variant="primary" label={existing ? $t('保存并开始') : $t('创建并开始')} loading={saving === 'start'} disabled={Boolean(saving)} onPress={() => void submit('start')} />
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
