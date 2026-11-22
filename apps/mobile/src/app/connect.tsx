import { Redirect } from 'expo-router';
import { useState, useEffect } from 'react';
import { Alert, AppState, Keyboard, Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Transport from 'baton-transport';
import { $t, useLocale } from '@/i18n';
import { ChevronDown } from 'lucide-react-native';
import { workspaceStore } from '@/workspace/store';
import { Menu } from '@/ui/menu';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/form';
import { Notice } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useTheme } from '@/theme';
import { loginOrigin } from '@/workspace/link';
import { useSession } from '@/workspace/session';

function addressLabel(origin: string) { return origin.startsWith('http://') ? origin : new URL(origin).host; }

function confirmCertificate(origin: string, fingerprint: string) {
  return new Promise<boolean>(resolve => Alert.alert($t('确认服务器证书'), origin + '\nSHA-256\n' + fingerprint, [
    {text:$t('取消'), style:'cancel', onPress:()=>resolve(false)},
    {text:$t('信任并登录'), onPress:()=>resolve(true)},
  ]));
}
export default function Connect() {
  useLocale();
  const { ready, active, login } = useSession();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [address, setAddress] = useState('');
  const [addresses, setAddresses] = useState<string[]>([]);
  const [health, setHealth] = useState<Record<string, 'ready' | 'offline' | 'unavailable'>>({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [addressError, setAddressError] = useState('');
  useEffect(() => {
    let mounted = true;
    void workspaceStore.addresses().then(list => {
      if (mounted) { setAddresses(list); setAddress(list[0] || ''); }
    });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    let mounted = true, checking = false;
    async function refresh() {
      if (checking || AppState.currentState === 'background') return;
      checking = true;
      await Promise.all(addresses.map(async origin => {
        let state: 'ready' | 'offline' | 'unavailable' = 'offline';
        try {
          const cert = origin.startsWith('https://') ? await Transport.inspectCertificate(origin) : null;
          const response = await Transport.request({url:origin+'/healthz', pin:cert?.fingerprint, timeout:4});
          const data = JSON.parse(response.body || '{}');
          if (data.service === 'baton-workspace') state = response.status === 200 && data.status === 'ready' ? 'ready' : 'unavailable';
        } catch {}
        if (mounted) setHealth(previous => ({...previous,[origin]:state}));
      }));
      checking = false;
    }
    void refresh();
    const timer = setInterval(refresh,15000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { mounted=false; clearInterval(timer); subscription.remove(); };
  }, [addresses]);
  const status = (origin: string) => health[origin] === undefined ? $t('检测中') : health[origin] === 'ready' ? $t('健康') : health[origin] === 'unavailable' ? $t('服务未就绪') : $t('无法连接');
  function startAdd() { Keyboard.dismiss(); setDraft(''); setAddressError(''); setAdding(true); }
  async function addAddress() {
    try {
      const origin = loginOrigin(draft);
      setAddresses(await workspaceStore.remember(origin));
      setAddress(origin); setAdding(false);
    } catch { setAddressError($t('请输入有效的工作空间地址')); }
  }
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ready) return null;
  if (active) return <Redirect href="/tasks" />;
  async function submit() {
    if (busy || !address || !name.trim() || !password) return;
    Keyboard.dismiss();
    setBusy(true); setError('');
    try {
      const origin = loginOrigin(address);
      const cert = origin.startsWith('https://') ? await Transport.inspectCertificate(origin) : null;
      if (cert && !cert.trusted && !await confirmCertificate(origin, cert.fingerprint)) return;
      await login(origin, name.trim(), password, cert?.fingerprint ?? null);
      setPassword('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <ScrollView keyboardShouldPersistTaps="handled" style={{backgroundColor:colors.bgCanvas}} contentContainerStyle={{paddingTop:insets.top+40,paddingHorizontal:24,paddingBottom:32}}>
    <View style={{gap:12,width:'100%',maxWidth:480,alignSelf:'center'}}>
      <Txt variant="display" weight="semibold">{$t('登录')}</Txt>
      <Txt>{$t('用户名')}</Txt><TextField accessibilityLabel={$t('用户名')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} textContentType="username" />
      <Txt>{$t('密码')}</Txt><TextField accessibilityLabel={$t('密码')} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" returnKeyType="go" onSubmitEditing={submit}/>
      {error ? <Notice tone="failed" text={error}/> : null}
      <Button variant="primary" size="lg" label={$t(busy?'正在登录…':'登录')} disabled={busy||!address.trim()||!name.trim()||!password} onPress={submit}/>
      <Menu style={{alignSelf:'center',maxWidth:'100%'}} items={[...addresses.map(origin => ({
        id:origin, title:(health[origin] === undefined ? '⚪️' : health[origin] === 'ready' ? '🟢' : '🔴')+' '+addressLabel(origin), checked:origin===address,
      })), {id:'add',title:$t('添加工作空间'),icon:'plus'}]}
        onSelect={id => { if (id === 'add') startAdd(); else {setAddress(id);setError('');} }}>
        <View accessible accessibilityRole="button" accessibilityLabel={$t('选择工作空间')} accessibilityValue={{text:address ? addressLabel(address)+' · '+status(address) : ''}}
          style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,minHeight:44,paddingHorizontal:8}}>
          <Txt variant="small" tone="secondary">{$t('工作空间')}</Txt>
          {address ? <View style={{width:7,height:7,borderRadius:4,backgroundColor:health[address] === undefined ? colors.textDisabled : health[address] === 'ready' ? colors.stDone : colors.stFailed}}/> : null}
          <Txt variant="small" color={colors.accentText} numberOfLines={1} style={{flexShrink:1}}>{address ? addressLabel(address) : $t('选择工作空间')}</Txt>
          <ChevronDown size={14} color={colors.textSecondary}/>
        </View>
      </Menu>
      <Modal visible={adding} transparent animationType="fade" onRequestClose={()=>setAdding(false)}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.32)',justifyContent:'center',padding:24}}>
          <View accessibilityViewIsModal style={{width:'100%',maxWidth:420,alignSelf:'center',backgroundColor:colors.bgRaised,borderRadius:14,padding:20,gap:12}}>
            <Txt variant="titleSm" weight="semibold">{$t('添加工作空间')}</Txt>
            <Txt variant="small">{$t('工作空间地址')}</Txt>
            <TextField autoFocus accessibilityLabel={$t('工作空间地址')} value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="mac.local:9443" onSubmitEditing={addAddress}/>
            {addressError ? <Notice tone="failed" text={addressError}/> : null}
            <View style={{flexDirection:'row',justifyContent:'flex-end',gap:8}}>
              <Button label={$t('取消')} onPress={()=>setAdding(false)}/><Button variant="primary" label={$t('添加')} disabled={!draft.trim()} onPress={addAddress}/>
            </View>
          </View>
        </View>
      </Modal>

    </View></ScrollView>;
}
