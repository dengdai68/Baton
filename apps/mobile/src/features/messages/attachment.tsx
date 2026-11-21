// Attachments inside messages: image thumbnails (pinned transport, cached by id)
// and file chips; tapping downloads the original and opens the share sheet.
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { FileText } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { $t } from '@/i18n';
import { formatBytes } from '@/lib/attachments';
import { useTheme } from '@/theme';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export type MessageAttachment = { id: string; name: string; bytes?: number; mediaType?: string; sha256?: string };
const imageName = (name: string) => /\.(png|jpe?g|gif|webp|avif|bmp|heic)$/i.test(name);

function useOpenAttachment(scope: 'runs' | 'communications', ownerId: string) {
  const client = useClient();
  const toast = useToast();
  const [opening, setOpening] = useState<string | null>(null);
  async function open(item: MessageAttachment) {
    setOpening(item.id);
    try {
      const uri = await client.file(`/api/${scope}/${encodeURIComponent(ownerId)}/attachments/${encodeURIComponent(item.id)}`, { fileName: item.name, cacheKey: 'attachment:' + (item.sha256 || item.id) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: item.name });
      else toast($t('已下载到 App 缓存：{0}', [item.name]));
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setOpening(null);
    }
  }
  return { open, opening };
}

function Thumbnail({ scope, ownerId, item, onPress }: { scope: 'runs' | 'communications'; ownerId: string; item: MessageAttachment; onPress: () => void }) {
  const client = useClient();
  const key = useWorkspaceKey();
  const { colors, metrics } = useTheme();
  const thumbnail = useQuery({
    queryKey: [...key, 'thumbnail', scope, ownerId, item.id],
    queryFn: () => client.file(`/api/${scope}/${encodeURIComponent(ownerId)}/attachments/${encodeURIComponent(item.id)}?preview=1&thumbnail=1`, { fileName: 'thumb.png', cacheKey: 'thumbnail:' + (item.sha256 || item.id) }),
    staleTime: Infinity,
  });
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={item.name} onPress={onPress}
      style={{ width: 132, height: 100, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSubtle, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      {thumbnail.data ? <Image source={{ uri: thumbnail.data }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : thumbnail.error ? (
        <Txt variant="caption" tone="tertiary" style={{ padding: 6, textAlign: 'center' }}>{item.name}</Txt>
      ) : <ActivityIndicator color={colors.textTertiary} />}
    </Pressable>
  );
}

export function MessageAttachments({ items, scope, ownerId }: { items?: MessageAttachment[]; scope: 'runs' | 'communications'; ownerId: string }) {
  const { colors, metrics } = useTheme();
  const { open, opening } = useOpenAttachment(scope, ownerId);
  if (!items?.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {items.map((item) =>
        imageName(item.name) || /^image\//.test(item.mediaType || '') ? (
          <Thumbnail key={item.id} scope={scope} ownerId={ownerId} item={item} onPress={() => void open(item)} />
        ) : (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={$t('打开附件 {0}', [item.name])} onPress={() => void open(item)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: metrics.radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.bgHover : colors.bgRaised, maxWidth: 260 })}>
            {opening === item.id ? <ActivityIndicator size="small" color={colors.textTertiary} /> : <FileText size={15} color={colors.textTertiary} />}
            <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>{item.name}</Txt>
            {item.bytes ? <Txt variant="caption" tone="tertiary">{formatBytes(item.bytes)}</Txt> : null}
          </Pressable>
        ),
      )}
    </View>
  );
}
