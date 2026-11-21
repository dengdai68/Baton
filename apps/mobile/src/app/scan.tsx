// QR scanner for one-time pairing codes shown by the Mac ("连接 iPhone…").
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { useRef } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Txt } from '@/ui/text';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const close = (
    <Pressable accessibilityRole="button" accessibilityLabel={$t('关闭')} onPress={() => router.back()} hitSlop={12}
      style={{ position: 'absolute', top: insets.top + 12, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,.45)', alignItems: 'center', justifyContent: 'center' }}>
      <X size={20} color="#fff" />
    </Pressable>
  );

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bgCanvas, padding: 24, justifyContent: 'center', gap: 14 }}>
        <Txt variant="title" weight="semibold">{$t('需要相机权限')}</Txt>
        <Txt tone="secondary">{$t('Baton 只用相机扫描 Mac 上显示的配对码。')}</Txt>
        {permission.canAskAgain ? (
          <Button variant="primary" size="lg" label={$t('允许使用相机')} onPress={() => void requestPermission()} />
        ) : (
          <Button variant="primary" size="lg" label={$t('打开系统设置')} onPress={() => void Linking.openSettings()} />
        )}
        <Button size="lg" label={$t('取消')} onPress={() => router.back()} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current || !data.startsWith('baton://pair#')) return;
          handled.current = true;
          router.replace({ pathname: '/pair', params: { link: data } });
        }}
      />
      <View pointerEvents="none" style={{ ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 240, height: 240, borderRadius: 24, borderWidth: 3, borderColor: 'rgba(255,255,255,.9)' }} />
        <Txt style={{ color: '#fff', marginTop: 24, textAlign: 'center', paddingHorizontal: 32 }}>{$t('对准 Mac 上显示的 Baton 配对码')}</Txt>
      </View>
      {close}
    </View>
  );
}
