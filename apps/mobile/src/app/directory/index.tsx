// One 更多 section: server-side search and a read-only two-line list; rows open
// the detail. Creating and editing stay on the Mac.
import { Stack, useLocalSearchParams } from 'expo-router';
import { IdCard, Workflow as WorkflowIcon } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';

import { workflowDisplay } from '@shared/console-projections.mjs';
import { useManualRefresh } from '@/api/queries';
import { type DirectoryKind, type Extension, isDirectoryKind, type Member, type Role, type Team, useDirectory, type Workflow } from '@/features/directory/api';
import { directoryIcons, directoryTitle, LetterTile, openDirectory, plainPreview } from '@/features/directory/views';
import { $t, useLocale } from '@/i18n';
import { useDebounced } from '@/lib/store';
import { useTheme } from '@/theme';
import { Avatar, GroupAvatar } from '@/ui/avatar';
import { IconTile } from '@/ui/grouped';
import { ListRow } from '@/ui/layout';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Tag } from '@/ui/status';
import { Txt } from '@/ui/text';
import { SearchField } from '@/ui/toolbar';

type Entry = Member & Team & Workflow & Role & Extension;

/** Leading visual, title, one secondary line and an optional state tag per section. */
function rowOf(kind: DirectoryKind, item: Entry) {
  switch (kind) {
    case 'agents':
      return { leading: <Avatar member={item} size={36} />, title: item.name, line: plainPreview(item.description), tag: item.status === 'inactive' ? $t('已停用') : null };
    case 'teams':
      return { leading: <GroupAvatar members={item.members || []} size={36} />, title: item.name, line: item.mission || (item.members || []).map((member) => member.name).join('、'), tag: item.status === 'active' ? null : $t('停用@@status') };
    case 'workflows': {
      const workflow = workflowDisplay(item as Workflow);
      return { leading: <IconTile icon={WorkflowIcon} size={36} />, title: workflow.name, line: [$t('{0} 个节点', [(workflow.nodes || []).length]), workflow.description].filter(Boolean).join(' · '), tag: null };
    }
    case 'roles':
      return { leading: <IconTile icon={IdCard} size={36} tone="neutral" />, title: item.name, line: plainPreview(item.prompt), tag: null };
    default:
      return { leading: <LetterTile id={item.id} name={item.name} size={36} />, title: item.name, line: item.description || (item.version ? 'v' + String(item.version).replace(/^v/, '') : ''), tag: null };
  }
}

export default function DirectoryList() {
  useLocale();
  const { kind: param } = useLocalSearchParams<{ kind: string }>();
  const kind: DirectoryKind = isDirectoryKind(param) ? param : 'agents';
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim(), 250);
  const list = useDirectory<Entry>(kind, search);
  const pull = useManualRefresh(list.refetch);
  const items = list.data || [];
  const title = directoryTitle(kind);
  return (
    <>
      <Stack.Screen options={{ title }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: colors.bgCanvas }}
        contentContainerStyle={{ paddingBottom: 48 }}
        data={items}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
        onEndReached={() => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); }}
        ListHeaderComponent={(
          <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
            <SearchField value={query} onChangeText={setQuery} placeholder={$t('搜索{0}', [title])} />
          </View>
        )}
        renderItem={({ item }) => {
          const row = rowOf(kind, item);
          return (
            <ListRow leading={row.leading} title={row.title} chevron={false} accessibilityLabel={row.title}
              trailing={row.tag ? <Tag label={row.tag} /> : undefined} onPress={() => openDirectory(kind, item.id)}
              meta={row.line ? <Txt variant="small" tone="tertiary" numberOfLines={1}>{row.line}</Txt> : undefined} />
          );
        }}
        ListEmptyComponent={list.isPending ? <LoadingState /> : list.error ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
          : <EmptyState icon={directoryIcons[kind]} title={search ? $t('没有匹配的结果') : $t('暂无{0}', [title])} description={search ? undefined : $t('在 Mac 上新建后会显示在这里。')} />}
        ListFooterComponent={items.length ? <Txt variant="caption" tone="tertiary" style={{ padding: 16, textAlign: 'center' }}>{$t('手机上只读；新建与修改请在 Mac 上进行。')}</Txt> : undefined}
      />
    </>
  );
}
