// Settings: appearance, language, the open connection, runtime profiles and logs.
import { useQuery } from '@tanstack/react-query';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { router, Stack } from 'expo-router';
import { Copy, KeyRound, LogOut, Monitor, Smartphone, SunMoon } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import { formatExactTime } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { LANGUAGE_PREFERENCES, LOCALE_NAMES, $t, useLocale, type LanguagePreference } from '@/i18n';
import { useTheme, usePreferences } from '@/theme';
import { Button } from '@/ui/button';
import { ChoiceRow, SwitchRow } from '@/ui/form';
import { SectionTitle } from '@/ui/layout';
import { Fact } from '@/ui/layout';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useSession } from '@/workspace/session';

function Appearance() {
  const { preferences, setTheme } = usePreferences();
  return (
    <>
      <SwitchRow label={$t('跟随系统外观')} description={$t('关闭后按下面选择固定浅色或深色。')} value={preferences.theme === 'system'} onChange={(on) => void setTheme(on ? 'system' : 'light')} />
      {preferences.theme !== 'system' ? (
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          {(['light', 'dark'] as const).map((theme) => (
            <ChoiceRow key={theme} selected={preferences.theme === theme} onPress={() => void setTheme(theme)}>
              <Txt style={{ flex: 1 }}>{theme === 'light' ? $t('浅色') : $t('深色')}</Txt>
            </ChoiceRow>
          ))}
        </View>
      ) : null}
    </>
  );
}

function Language() {
  const { preferences, setLanguage } = usePreferences();
  return (
    <View style={{ paddingHorizontal: 16 }}>
      {LANGUAGE_PREFERENCES.map((value) => (
        <ChoiceRow key={value} selected={preferences.language === value} onPress={() => void setLanguage(value as LanguagePreference)}>
          <Txt style={{ flex: 1 }}>{value === 'system' ? $t('跟随系统') : LOCALE_NAMES[value] || value}</Txt>
        </ChoiceRow>
      ))}
    </View>
  );
}

export default function Settings() {
  useLocale();
  const { colors } = useTheme();
  const insetsTop = useHeaderHeight();
  const { active, client, leave } = useSession();
  const toast = useToast();
  const scope = useWorkspaceKey();
  const bootstrap = useQuery({
    queryKey: [...scope, 'settings-bootstrap'],
    queryFn: () => client!.get<{ installationId?: string; settings?: { workspaceRoot?: string } }>('/api/bootstrap?view=connection'),
    enabled: Boolean(client),
  });
  const profiles = useQuery({
    queryKey: [...scope, 'settings-profiles'],
    queryFn: () => client!.get<{ profiles: Array<{ id: string; name?: string; provider: string; model?: string; effort?: string }> }>('/api/settings/runtime-profiles'),
    enabled: Boolean(client),
  });
  return (
    <>
      <Stack.Screen options={{ title: $t('设置') }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bgCanvas }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SectionTitle title={$t('外观')} />
        <Appearance />
        <SectionTitle title={$t('语言')} />
        <Language />
        <SectionTitle title={$t('连接')} />
        <View style={{ marginHorizontal: 16, padding: 14, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSubtle }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Smartphone size={18} color={colors.accentText} />
            <Txt weight="medium" style={{ flex: 1 }}>{active?.name || 'Baton'}</Txt>
            <Copy size={16} color={colors.textTertiary} />
          </View>
          <Fact label={$t('地址')} value={active?.origin || ''} />
          <Fact label={$t('用户')} value={active?.user || ''} />
          <Fact label={$t('设备')} value={active?.device || ''} />
          {bootstrap.data?.settings?.workspaceRoot ? <Fact label={$t('数据目录')} value={bootstrap.data.settings.workspaceRoot} /> : null}
          <Fact label={$t('配对时间')} value={active?.addedAt ? formatExactTime(new Date(active.addedAt).toISOString()) : ''} />
        </View>
        <View style={{ padding: 16, gap: 8 }}>
          <Button label={$t('管理 Runtime 配置')} icon={Monitor} onPress={() => router.push('/settings/runtime')} />
          <Button label={$t('查看日志')} onPress={() => router.push('/settings/logs')} />
          <Button label={$t('退出登录')} icon={LogOut} onPress={async () => { await leave(); router.replace('/connect'); }} />
        </View>
        {profiles.data?.profiles?.length ? (
          <>
            <SectionTitle title={$t('Runtime 配置')} />
            {profiles.data.profiles.map((profile) => (
              <View key={profile.id} style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
                <Txt weight="medium" numberOfLines={1}>{profile.name || profile.provider}</Txt>
                <Txt variant="small" tone="tertiary">{[profile.provider, profile.model, profile.effort].filter(Boolean).join(' · ')}</Txt>
              </View>
            ))}
          </>
        ) : null}
        <View style={{ padding: 16 }}>
          <Txt variant="caption" tone="tertiary">{$t('数据目录更换、Shell 命令安装与 macOS 应用更新请在 Mac 上进行；工作空间证书在配对时固定，可在 Mac 上撤销此设备。')}</Txt>
        </View>
      </ScrollView>
    </>
  );
}
