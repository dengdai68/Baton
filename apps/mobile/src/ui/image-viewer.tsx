// Full-screen image viewer (Mac: communication-image-viewer): pinch to zoom,
// close, and download/share the original. Loading and failure are explicit.
import { Image } from 'expo-image';
import { Share2, X } from 'lucide-react-native';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, useCompetingGestures, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { $t } from '@/i18n';
import { Txt } from './text';

/** Same zoom range as the iOS zooming ScrollView. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/** Keep a zoomed image covering its frame: the offset may move at most the overflow on each side. */
function clampOffset(offset: number, size: number, zoom: number) {
  'worklet';
  const limit = (size * (zoom - MIN_ZOOM)) / 2;
  return Math.min(limit, Math.max(-limit, offset));
}

/** Android has no zooming ScrollView: pinch 1–4×, drag while zoomed, tap closes (as on iOS). */
function ZoomableImage({ uri, label, onTap }: { uri: string; label: string; onTap: () => void }) {
  const zoom = useSharedValue(MIN_ZOOM);
  const zoomStart = useSharedValue(MIN_ZOOM);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const dragStartX = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const frameWidth = useSharedValue(0);
  const frameHeight = useSharedValue(0);
  const pinch = usePinchGesture({
    onActivate: () => { zoomStart.value = zoom.value; },
    onUpdate: (event) => {
      zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomStart.value * event.scale));
      offsetX.value = clampOffset(offsetX.value, frameWidth.value, zoom.value);
      offsetY.value = clampOffset(offsetY.value, frameHeight.value, zoom.value);
    },
  });
  const drag = usePanGesture({
    onActivate: () => { dragStartX.value = offsetX.value; dragStartY.value = offsetY.value; },
    onUpdate: (event) => {
      if (zoom.value <= MIN_ZOOM) return;
      offsetX.value = clampOffset(dragStartX.value + event.translationX, frameWidth.value, zoom.value);
      offsetY.value = clampOffset(dragStartY.value + event.translationY, frameHeight.value, zoom.value);
    },
  });
  const tap = useTapGesture({ runOnJS: true, onActivate: onTap });
  const gesture = useCompetingGestures(useSimultaneousGestures(pinch, drag), tap);
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: zoom.value }] }));
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View accessible accessibilityLabel={label} style={{ flex: 1, overflow: 'hidden' }}
        onLayout={(event) => { frameWidth.value = event.nativeEvent.layout.width; frameHeight.value = event.nativeEvent.layout.height; }}>
        <Animated.View style={[{ flex: 1 }, transform]}>
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

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
  const label = $t('图片预览：{0}', [name]);
  // Gestures inside an Android Modal need their own root view.
  const Root = Platform.OS === 'android' ? GestureHandlerRootView : View;
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="overFullScreen" transparent onRequestClose={onClose} statusBarTranslucent>
      <Root style={{ flex: 1, backgroundColor: '#000' }}>
        {uri ? (
          Platform.OS === 'android' ? <ZoomableImage uri={uri} label={label} onTap={onClose} /> : (
            <ScrollView maximumZoomScale={MAX_ZOOM} minimumZoomScale={MIN_ZOOM} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Pressable onPress={onClose} accessibilityLabel={label} style={{ width: '100%', height: '100%' }}>
                <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
              </Pressable>
            </ScrollView>
          )
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            {error ? <Txt style={{ color: '#fff', textAlign: 'center' }}>{error}</Txt> : <ActivityIndicator color="#fff" />}
          </View>
        )}
        {bar}
      </Root>
    </Modal>
  );
}
