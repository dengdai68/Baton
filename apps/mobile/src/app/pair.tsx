import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/form';
import { Txt } from '@/ui/text';
import { takePairingLink } from '@/workspace/link';
import { useSession } from '@/workspace/session';
import { $t } from '@/i18n';

export default function Pair() {
  const {ready, pair} = useSession();
  const [address,setAddress] = useState('');
  const [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const running = useRef(false);
  const insets = useSafeAreaInsets();
  async function redeem(link: string) {
    if (running.current) return;
    running.current = true; setBusy(true); setStatus($t('正在验证 Mac 并登录…'));
    try { await pair(link); setAddress(''); router.replace('/tasks'); }
    catch (error) {setStatus((error as Error).message);}
    finally {running.current = false; setBusy(false);}
  }
  useEffect(() => {
    if (!ready) return;
    const link = takePairingLink();
    if (link) void redeem(link);
  },[ready]);
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingTop:insets.top+36,paddingHorizontal:24,gap:16}}>
    <Txt variant="display">{$t('输入配对地址')}</Txt>
    <TextField accessibilityLabel={$t('配对地址')} autoCapitalize="none" autoCorrect={false} secureTextEntry value={address} onChangeText={setAddress} placeholder="baton://pair?…"/>
    <Button label={$t('配对并登录')} disabled={busy || !ready || !address.trim()} onPress={()=>void redeem(address)}/>
    {status ? <Txt>{status}</Txt> : null}
    <Button label={$t('返回')} disabled={busy} onPress={()=>router.replace('/connect')}/>
  </ScrollView>;
}
