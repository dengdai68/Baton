// Create / edit directory entries (agent, team, role, git credentials).
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { useDetail, type Member, type Role, type Team } from '@/features/directory/api';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Field, TextField } from '@/ui/form';
import { ErrorState, LoadingState } from '@/ui/states';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

function Form({ kind, id }: { kind: string; id?: string }) {
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const headerHeight = useHeaderHeight();
  const resource = ({ agent: 'agents', team: 'teams', role: 'roles', git: 'runtime/git-credentials' } as any)[kind];
  const existing = useDetail<any>(id ? `/api/${resource}/${encodeURIComponent(id)}` : null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const loaded = !id || Boolean(existing.data);
  const value = existing.data;
  const isAgent = kind === 'agent', isTeam = kind === 'team', isRole = kind === 'role', isGit = kind === 'git';
  const title = (isAgent ? $t('数字员工') : isTeam ? $t('团队') : isRole ? $t('角色') : $t('仓库访问')) + (id ? '' : ' · ' + $t('新建'));

  async function save() {
    setSaving(true);
    try {
      let body: any = {};
      if (isAgent) body = { name: name || value?.name, description: description || value?.description, systemPrompt: prompt || value?.systemPrompt };
      else if (isTeam) body = { name: name || value?.name, mission: description || value?.mission, memberAgentIds: value?.memberAgentIds || [] };
      else if (isRole) body = { name: name || value?.name, prompt: prompt || value?.prompt };
      else body = { host: host || value?.host, token: token || value?.token };
      if (id) await client.put(`/api/${resource}/${encodeURIComponent(id)}`, body);
      else await client.post(`/api/${resource}`, body);
      await queryClient.invalidateQueries({ queryKey: scope });
      toast(id ? $t('修改已保存。') : $t('已创建。'));
      router.back();
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <LoadingState />;
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={headerHeight}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 4, paddingBottom: 96 }}>
        <Field label={isRole ? $t('角色名称') : isGit ? $t('主机') : $t('名称')} required>
          <TextField value={name || value?.name || (isGit ? value?.host : '') || ''} onChangeText={setName} placeholder={isGit ? 'github.com' : $t('例如：内容编辑')} />
        </Field>
        {isGit ? (
          <Field label={$t('访问令牌')} required>
            <TextField value={token} onChangeText={setToken} placeholder={$t('粘贴令牌')} autoCapitalize="none" autoCorrect={false} />
          </Field>
        ) : (
          <Field label={isAgent ? $t('职责描述') : isTeam ? $t('团队使命') : $t('提示词')} required>
            <TextField value={description || prompt || value?.description || value?.prompt || value?.mission || ''} onChangeText={isRole || isAgent && !value?.description ? setPrompt : setDescription} multiline style={{ minHeight: 140 }} placeholder={isAgent ? $t('描述职责、产出与边界…') : isTeam ? $t('这个团队一起完成什么…') : $t('系统提示词…')} />
          </Field>
        )}
        {isAgent ? (
          <Field label={$t('系统提示词')}>
            <TextField value={prompt || value?.systemPrompt || ''} onChangeText={setPrompt} multiline style={{ minHeight: 160 }} placeholder={$t('系统提示词…')} />
          </Field>
        ) : null}
        {isTeam && value?.memberAgentIds?.length ? (
          <Field label={$t('成员')}>
            <TextField value={(value.memberAgentIds as string[]).join('\n')} editable={false} multiline />
          </Field>
        ) : null}
        <Button variant="primary" size="lg" label={id ? $t('保存修改') : $t('创建')} loading={saving} onPress={() => void save()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function DirectoryEdit() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id?: string }>();
  const title = ({ agent: $t('数字员工'), team: $t('团队'), role: $t('角色'), git: $t('仓库访问') } as any)[kind] || $t('编辑');
  return (
    <>
      <Stack.Screen options={{ title, headerLeft: () => <Button size="sm" variant="ghost" label={$t('取消')} onPress={() => router.back()} /> }} />
      <Form kind={kind} id={id} />
    </>
  );
}
