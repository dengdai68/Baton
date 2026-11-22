import { Alert } from 'react-native';
import { router, Stack } from 'expo-router';
import { Cpu, FolderTree, KeyRound, ScrollText, SlidersHorizontal, SquareTerminal, SunMoon } from 'lucide-react-native';

import { themeName } from '@/features/settings';
import { $t, LOCALE_NAMES, useLocale } from '@/i18n';
import { usePreferences } from '@/theme';
import { GroupedPage, GroupedRow, GroupedSection } from '@/ui/grouped';
import { useSession } from '@/workspace/session';

export default function Settings() {
  const locale = useLocale();
  const { leave } = useSession();
  const { preferences } = usePreferences();
  const go = (path: Parameters<typeof router.push>[0]) => () => router.push(path);
  return (
    <GroupedPage>
      <Stack.Screen options={{ title: $t('设置') }} />
      <GroupedSection title={$t('通用')}>
        <GroupedRow icon={SlidersHorizontal} title={$t('常规')} value={LOCALE_NAMES[locale] || locale} onPress={go('/settings/general')} />
        <GroupedRow icon={SunMoon} title={$t('外观')} value={themeName(preferences.theme)} onPress={go('/settings/appearance')} />
        <GroupedRow icon={FolderTree} title={$t('工作空间')} onPress={go('/settings/connection')} />
      </GroupedSection>
      <GroupedSection title={$t('集成')}>
        <GroupedRow icon={Cpu} title={$t('运行时')} onPress={go('/settings/runtime')} />
        <GroupedRow icon={SquareTerminal} title="CLI" onPress={go('/settings/cli')} />
        <GroupedRow icon={KeyRound} title={$t('仓库访问')} onPress={go('/settings/repositories')} />
      </GroupedSection>
      <GroupedSection title={$t('系统')} footer={$t('Mac 的设置在手机上只读；修改、数据目录更换、Shell 命令安装与应用更新请在 Mac 上进行。')}>
        <GroupedRow icon={ScrollText} title={$t('运行日志')} onPress={go('/settings/logs')} />
      </GroupedSection>
    <GroupedSection><GroupedRow title={$t('退出登录')} chevron={false} onPress={() => Alert.alert($t('退出登录'), $t('确定退出当前账号？'), [
        { text: $t('取消'), style: 'cancel' },
        { text: $t('退出登录'), style: 'destructive', onPress: async () => {
          try { await leave(); router.dismissAll(); router.replace('/connect'); }
          catch (error) { Alert.alert($t('退出登录'), (error as Error).message); }
        } },
      ])} /></GroupedSection>
    </GroupedPage>
  );
}
