// Message attachments with the Mac rules (web/communication.js): images by
// extension are shown inline (max 320 tall on Mac; scaled for the phone) and
// open a full-screen viewer with download; other files are chips that download.
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { Paperclip } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { useWorkspaceKey } from '@/api/queries';
import { $t } from '@/i18n';
import { formatBytes, isImageName, type LocalAttachment } from '@/lib/attachments';
import { useTheme } from '@/theme';
import { ImageViewer } from '@/ui/image-viewer';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

export type MessageAttachment = { id: string; name: string; bytes?: number; mediaType?: string; sha256?: string };
type Scope = 'runs' | 'communications';

const MAX_WIDTH = 240, MAX_HEIGHT = 240;
function fitted(ratio: number) {
  const width = Math.min(MAX_WIDTH, MAX_HEIGHT * ratio);
  return { width, height: width / ratio };
}

/** Inline image + viewer; source is a local file uri or a remote attachment. */
function InlineImage({ name, thumbnailUri, loadFull, share, loading, failed }: {
  name: string; thumbnailUri: string | null; loadFull: () => Promise<string>; share?: () => Promise<void>; loading?: boolean; failed?: boolean;
}) {
  const { colors, metrics } = useTheme();
  const [ratio, setRatio] = useState(4 / 3);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [fullError, setFullError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const size = fitted(ratio);
  async function view() {
    setOpen(true);
    if (full) return;
    try { setFull(await loadFull()); } catch (failure) { setFullError((failure as Error).message || $t('图片无法加载')); }
  }
  async function download() {
    if (!share) return;
    setSharing(true);
    try { await share(); } finally { setSharing(false); }
  }
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={$t('放大查看 {0}', [name])} onPress={() => void view()}
        style={{ width: size.width, height: size.height, borderRadius: metrics.radius.sm, overflow: 'hidden', backgroundColor: colors.bgSubtle, alignItems: 'center', justifyContent: 'center' }}>
        {failed || error ? (
          <Txt variant="small" tone="tertiary" style={{ padding: 8, textAlign: 'center' }}>{$t('图片无法加载')}</Txt>
        ) : thumbnailUri ? (
          <Image source={{ uri: thumbnailUri }} style={{ width: '100%', height: '100%' }} contentFit="contain"
            onLoad={({ source }) => { if (source.width && source.height) setRatio(source.width / source.height); }}
            onError={() => setError(true)} />
        ) : loading ? <ActivityIndicator color={colors.textTertiary} /> : null}
      </Pressable>
      <ImageViewer visible={open} uri={full} name={name} error={fullError} sharing={sharing} onClose={() => setOpen(false)} onShare={share ? () => void download() : undefined} />
    </>
  );
}

function FileChip({ name, bytes, onPress, busy }: { name: string; bytes?: number; onPress?: () => void; busy?: boolean }) {
  const { colors, metrics } = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={$t('下载 {0}', [name])} onPress={onPress} disabled={!onPress || busy}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 10, borderRadius: metrics.radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.bgHover : colors.bgRaised, maxWidth: 260 })}>
      {busy ? <ActivityIndicator size="small" color={colors.textTertiary} /> : <Paperclip size={15} color={colors.textTertiary} />}
      <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Txt>
      {bytes !== undefined ? <Txt variant="caption" tone="tertiary">{formatBytes(bytes)}</Txt> : null}
    </Pressable>
  );
}

function RemoteImage({ scope, ownerId, item }: { scope: Scope; ownerId: string; item: MessageAttachment }) {
  const client = useClient();
  const key = useWorkspaceKey();
  const toast = useToast();
  const base = `/api/${scope}/${encodeURIComponent(ownerId)}/attachments/${encodeURIComponent(item.id)}`;
  const version = item.sha256 || item.id;
  const thumbnail = useQuery({
    queryKey: [...key, 'attachment-thumbnail', scope, ownerId, item.id],
    queryFn: () => client.file(base + '?preview=1&thumbnail=1', { fileName: 'thumbnail.png', cacheKey: 'thumbnail:' + version }),
    staleTime: Infinity,
  });
  return (
    <InlineImage name={item.name} thumbnailUri={thumbnail.data ?? null} loading={thumbnail.isPending} failed={Boolean(thumbnail.error)}
      loadFull={() => client.file(base + '?preview=1', { fileName: item.name, cacheKey: 'preview:' + version })}
      share={async () => {
        try {
          const uri = await client.file(base, { fileName: item.name, cacheKey: 'original:' + version });
          await Sharing.shareAsync(uri, { dialogTitle: item.name });
        } catch (error) { toast((error as Error).message, true); }
      }} />
  );
}

function RemoteFile({ scope, ownerId, item }: { scope: Scope; ownerId: string; item: MessageAttachment }) {
  const client = useClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const uri = await client.file(`/api/${scope}/${encodeURIComponent(ownerId)}/attachments/${encodeURIComponent(item.id)}`, { fileName: item.name, cacheKey: 'original:' + (item.sha256 || item.id) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { dialogTitle: item.name });
      else toast($t('已下载到 App 缓存：{0}', [item.name]));
    } catch (error) {
      toast($t('附件下载失败：{0}', [(error as Error).message]), true);
    } finally { setBusy(false); }
  }
  return <FileChip name={item.name} bytes={item.bytes} busy={busy} onPress={() => void download()} />;
}

export function MessageAttachments({ items, scope, ownerId }: { items?: MessageAttachment[]; scope: Scope; ownerId: string }) {
  if (!items?.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {items.map((item) => (isImageName(item.name)
        ? <RemoteImage key={item.id} scope={scope} ownerId={ownerId} item={item} />
        : <RemoteFile key={item.id} scope={scope} ownerId={ownerId} item={item} />))}
    </View>
  );
}

/** Attachments of a message still being sent: local previews, like the Mac outbox. */
export function LocalAttachments({ items }: { items: LocalAttachment[] }) {
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, justifyContent: 'flex-end' }}>
      {items.map((item) => (isImageName(item.name)
        ? <InlineImage key={item.key} name={item.name} thumbnailUri={item.uri} loadFull={async () => item.uri} />
        : <FileChip key={item.key} name={item.name} bytes={item.size} />))}
    </View>
  );
}
