// 更多 (tab root, no title): the connected Mac on top, then the read-only
// organization and extension sections, then settings.
import { router, Stack } from 'expo-router';
import { UserRound, Settings } from 'lucide-react-native';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DirectoryKind } from '@/features/directory/api';
import { directoryIcons, directoryTitle } from '@/features/directory/views';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { GroupedRow, GroupedSection, IconTile } from '@/ui/grouped';
import { useSession } from '@/workspace/session';

const ORGANIZATION: DirectoryKind[] = ['agents', 'teams', 'workflows', 'roles'];
const EXTENSIONS: DirectoryKind[] = ['plugins', 'mcp'];

export default function More() {
  useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { active } = useSession();
  const row = (kind: DirectoryKind) => (
    <GroupedRow key={kind} icon={directoryIcons[kind]} title={directoryTitle(kind)} onPress={() => router.push({ pathname: '/directory', params: { kind } })} />
  );
  return (
    <ScrollView style={{ backgroundColor: colors.bgSubtle }} contentContainerStyle={{ paddingTop: insets.top + 4, paddingBottom: 16 }}>
      <Stack.Screen options={{ headerShown: false }} />
      <GroupedSection style={{ marginTop: 8 }}>
        <GroupedRow leading={<IconTile icon={UserRound} size={44} />} title={active?.user || '—'} subtitle={$t('当前账号')} />
      </GroupedSection>
      <GroupedSection title={$t('组织')}>{ORGANIZATION.map(row)}</GroupedSection>
      <GroupedSection title={$t('扩展')}>{EXTENSIONS.map(row)}</GroupedSection>
      <GroupedSection>
        <GroupedRow leading={<IconTile icon={Settings} tone="neutral" />} title={$t('设置')} onPress={() => router.push('/settings')} />
      </GroupedSection>
    </ScrollView>
  );
}
