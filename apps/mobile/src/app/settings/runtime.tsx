// Runtime profiles: view, and set the default provider / model / effort.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { ChoiceRow } from '@/ui/form';
import { SectionTitle } from '@/ui/layout';
import { LoadingState, ErrorState, Notice } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

type Profile = { id: string; name?: string; provider: string; model?: string; effort?: string; default?: boolean };
const MODELS = ['', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-5.4', 'codex-mini-latest'];
const EFFORTS = ['', 'low', 'medium', 'high'];

export default function RuntimeProfiles() {
  const client = useClient();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const profiles = useQuery({ queryKey: [...scope, 'settings-profiles'], queryFn: () => client.get<{ profiles: Profile[] }>('/api/settings/runtime-profiles') });
  const save = useMutation({
    mutationFn: (profile: Profile) => client.put(`/api/settings/runtime-profiles/${encodeURIComponent(profile.id)}`, { model: profile.model || null, effort: profile.effort || null }),
    onSuccess: async (_d, profile) => { await queryClient.invalidateQueries({ queryKey: scope }); toast($t('已保存：{0}', [profile.name || profile.provider])); },
    onError: (error) => toast((error as Error).message, true),
  });
  if (profiles.isPending) return <LoadingState />;
  if (profiles.error) return <ErrorState message={profiles.error.message} onRetry={() => void profiles.refetch()} />;
  const rows = profiles.data?.profiles || [];
  const def = rows.find((row) => row.default) || rows[0];
  return (
    <>
      <Stack.Screen options={{ title: $t('Runtime 配置') }} />
      <View style={{ padding: 16 }}>
        {rows.map((profile) => (
          <View key={profile.id} style={{ marginBottom: 16, padding: 14, gap: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Txt weight="semibold" style={{ flex: 1 }}>{profile.name || profile.provider}</Txt>
              {profile.id === def?.id ? <Notice text={$t('默认')} /> : <Button size="sm" label={$t('设为默认')} onPress={() => save.mutate({ ...profile })} />}
            </View>
            <Txt variant="small" tone="tertiary">{[profile.provider, profile.model || $t('CLI 默认模型'), profile.effort || $t('默认')].join(' · ')}</Txt>
            <SectionTitle title={$t('模型')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {MODELS.map((model) => <ChoiceRow key={model || 'default'} selected={(profile.model || '') === model} onPress={() => save.mutate({ ...profile, model })}><Txt variant="small" mono>{model || $t('CLI 默认模型')}</Txt></ChoiceRow>)}
            </View>
            <SectionTitle title={$t('思考等级')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {EFFORTS.map((effort) => <ChoiceRow key={effort || 'default'} selected={(profile.effort || '') === effort} onPress={() => save.mutate({ ...profile, effort })}><Txt variant="small">{effort || $t('默认')}</Txt></ChoiceRow>)}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}
