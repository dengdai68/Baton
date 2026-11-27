import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/ui/button';
import { Txt } from '@/ui/text';
import { $t } from '@/i18n';
import { setPairingLink } from '@/workspace/link';
export default function Scan() {
  const [permission,request] = useCameraPermissions();
  const once = useRef(false);
  const insets = useSafeAreaInsets();
  return <View style={{flex:1,paddingTop:insets.top+16,paddingBottom:insets.bottom+16,gap:12}}>
    <Txt variant="title">{$t('扫描 Mac 上的配对二维码')}</Txt>
    {permission?.granted ? <CameraView style={{flex:1}} barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>{
      if (once.current) return;
      once.current=true; setPairingLink(data); router.replace('/pair');
    }}/> : <Button label={$t('允许使用相机')} onPress={()=>void request()}/>}
    <Button label={$t('输入配对地址')} onPress={()=>router.replace('/pair')}/>
    <Button label={$t('返回')} onPress={()=>router.replace('/connect')}/>
  </View>;
}
