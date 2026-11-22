// Detail of one 更多 entry (read-only); the section decides the layout.
import { Stack, useLocalSearchParams } from 'expo-router';

import { directoryDetails } from '@/features/directory/views';
import { isDirectoryKind } from '@/features/directory/api';
import { $t, useLocale } from '@/i18n';
import { ErrorState } from '@/ui/states';

export default function DirectoryDetailScreen() {
  useLocale();
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  if (!isDirectoryKind(kind) || !id) return <><Stack.Screen options={{ title: '' }} /><ErrorState message={$t('未找到')} /></>;
  const Detail = directoryDetails[kind];
  return <Detail id={id} />;
}
