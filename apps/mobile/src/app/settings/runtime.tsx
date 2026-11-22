// 运行时 (read-only): each Runtime's availability, model, effort and how many
// employees use it. Enabling and model choice stay on the Mac.
import { Stack } from 'expo-router';
import { Text, View } from 'react-native';

import { runtimeLabel } from '@shared/runtime-providers.mjs';
import { runtimeMark, useRuntimeProfiles } from '@/features/settings';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { GroupedPage, GroupedRow, GroupedSection } from '@/ui/grouped';
import { ErrorState, LoadingState } from '@/ui/states';
import { Txt } from '@/ui/text';

const optionLabel = (value: string) => value.replace(/^[a-z]/, (char) => char.toUpperCase());

export default function RuntimeSettings() {
  useLocale();
  const { colors, metrics } = useTheme();
  const profiles = useRuntimeProfiles();
  const rows = profiles.data?.profiles || [];
  return (
    <>
      <Stack.Screen options={{ title: $t('运行时') }} />
      {profiles.isPending ? <LoadingState /> : profiles.error ? <ErrorState message={profiles.error.message} onRetry={() => void profiles.refetch()} /> : (
        <GroupedPage>
          <GroupedSection footer={$t('启用的运行时可被员工选择。模型与思考等级留空时使用 CLI 默认配置；在 Mac 的 设置 → 运行时 中修改。')}>
            {rows.map((profile) => {
              const label = runtimeLabel(profile.provider);
              const available = Boolean(profile.installed && profile.enabled);
              const availability = profile.installed ? (profile.enabled ? $t('可用') : $t('已停用')) : $t('未安装');
              return (
                <GroupedRow key={profile.id} title={label} numberOfLines={2}
                  leading={(
                    <View style={{ width: 34, height: 34, borderRadius: metrics.radius.sm, backgroundColor: available ? colors.accentSoft : colors.bgActive, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: available ? colors.accentText : colors.textTertiary }}>{runtimeMark(profile.provider, label)}</Text>
                    </View>
                  )}
                  subtitle={[profile.model ? optionLabel(profile.model) : $t('CLI 默认模型'), profile.effort ? optionLabel(profile.effort) : $t('默认思考等级')].join(' · ')}
                  trailing={(
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: available ? colors.stDone : colors.textDisabled }} />
                        <Txt variant="small" tone={available ? 'done' : 'tertiary'}>{availability}</Txt>
                      </View>
                      <Txt variant="caption" tone="tertiary">{$t('{0} 位员工', [profile.employeeCount ?? 0])}</Txt>
                    </View>
                  )} />
              );
            })}
          </GroupedSection>
        </GroupedPage>
      )}
    </>
  );
}
