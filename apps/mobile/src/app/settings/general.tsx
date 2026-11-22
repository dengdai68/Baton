// 常规: this iPhone's interface language, and the versions in use.
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { Check } from 'lucide-react-native';

import { useWorkspacePaths } from '@/features/settings';
import { $t, LANGUAGE_PREFERENCES, LOCALE_NAMES, useLocale } from '@/i18n';
import { usePreferences, useTheme } from '@/theme';
import { GroupedPage, GroupedRow, GroupedSection } from '@/ui/grouped';

export default function General() {
  useLocale();
  const { colors } = useTheme();
  const { preferences, setLanguage } = usePreferences();
  const paths = useWorkspacePaths();
  return (
    <GroupedPage>
      <Stack.Screen options={{ title: $t('常规') }} />
      <GroupedSection title={$t('界面语言')} footer={$t('切换后界面立即更新；跟随系统使用 iPhone 的首选语言。')}>
        {LANGUAGE_PREFERENCES.map((value) => (
          <GroupedRow key={value} title={value === 'system' ? $t('跟随系统') : LOCALE_NAMES[value] || value} onPress={() => void setLanguage(value)}
            trailing={preferences.language === value ? <Check size={18} color={colors.accentText} /> : undefined} chevron={false} />
        ))}
      </GroupedSection>
      <GroupedSection title={$t('关于')}>
        <GroupedRow title={$t('iPhone 应用')} value={Constants.expoConfig?.version || '—'} />
        <GroupedRow title={$t('Mac 上的 Baton')} value={paths.data?.version || (paths.error ? $t('读取失败') : '…')} />
      </GroupedSection>
    </GroupedPage>
  );
}
