// Full-screen image viewer (Mac: communication-image-viewer): pinch to zoom,
// close, and download/share the original. Loading and failure are explicit.
import { Image } from 'expo-image';
import { Share2, X } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { $t } from '@/i18n';
import { Txt } from './text';

export function ImageViewer({ visible, uri, name, error, sharing, onClose, onShare }: {
  visible: boolean; uri: string | null; name: string; error?: string | null; sharing?: boolean; onClose: () => void; onShare?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const bar = (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,.45)' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={$t('关闭')} hitSlop={10} onPress={onClose} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <X size={22} color="#fff" />
      </Pressable>
      <Txt numberOfLines={1} style={{ flex: 1, color: '#fff', textAlign: 'center' }}>{name}</Txt>
      {onShare ? (
        <Pressable accessibilityRole="button" accessibilityLabel={$t('下载')} hitSlop={10} onPress={onShare} disabled={sharing} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          {sharing ? <ActivityIndicator color="#fff" /> : <Share2 size={20} color="#fff" />}
        </Pressable>
      ) : <View style={{ width: 36 }} />}
    </View>
  );
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="overFullScreen" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {uri ? (
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Pressable onPress={onClose} accessibilityLabel={$t('图片预览：{0}', [name])} style={{ width: '100%', height: '100%' }}>
              <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
            </Pressable>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            {error ? <Txt style={{ color: '#fff', textAlign: 'center' }}>{error}</Txt> : <ActivityIndicator color="#fff" />}
          </View>
        )}
        {bar}
      </View>
    </Modal>
  );
}
