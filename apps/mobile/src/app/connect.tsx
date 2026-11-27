import { Redirect, router } from 'expo-router';
import { useState, useEffect } from 'react';
import { Alert, AppState, Keyboard, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Transport from 'baton-transport';
import { $t, useLocale } from '@/i18n';
import { Check, ChevronDown, Minus, Plus } from 'lucide-react-native';
import { workspaceStore } from '@/workspace/store';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/form';
import { Notice } from '@/ui/states';
import { Txt } from '@/ui/text';
import { useTheme } from '@/theme';
import { loginOrigin } from '@/workspace/link';
import { useSession } from '@/workspace/session';

type Health = 'ready' | 'offline' | 'unavailable';
function HealthDot({state}: {state?: Health}) {
  const { colors } = useTheme();
  const backgroundColor = state === undefined ? colors.textDisabled : state === 'ready' ? colors.stDone : colors.stFailed;
  return <View style={{width:7,height:7,borderRadius:4,backgroundColor}}/>;
}

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
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState(false);
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
        let state: Health = 'offline';
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
  function startAdd() { setChoosing(false); Keyboard.dismiss(); setDraft(''); setAddressError(''); setAdding(true); }
  async function addAddress() {
    try {
      const origin = loginOrigin(draft);
      setAddresses(await workspaceStore.remember(origin));
      setAddress(origin); setAdding(false);
    } catch { setAddressError($t('请输入有效的工作空间地址')); }
  }
  async function removeAddress(origin: string) {
    setRemoving(true);
    try {
      const remaining = await workspaceStore.forget(origin);
      setAddresses(remaining);
      setAddress(current => current === origin ? remaining[0] || '' : current);
      setHealth(current => { const next = {...current}; delete next[origin]; return next; });
      setError('');
    } catch { setError($t('保存失败，已恢复原设置；请重新选择。')); }
    finally { setRemoving(false); }
  }
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ready) return null;
  if (active) return <Redirect href="/tasks" />;
  async function submit() {
    if (busy || !address || !name.trim() || !password) return;
    Keyboard.dismiss(); setChoosing(false);
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
      <View style={{flexDirection:'row',gap:12}}>
        <Button label={$t('扫码配对')} onPress={()=>router.push('/scan')}/>
        <Button label={$t('输入配对地址')} onPress={()=>router.push('/pair')}/>
      </View>
      <Txt>{$t('用户名')}</Txt><TextField accessibilityLabel={$t('用户名')} value={name} onFocus={()=>setChoosing(false)} onChangeText={setName} autoCapitalize="none" autoCorrect={false} textContentType="username" />
      <Txt>{$t('密码')}</Txt><TextField accessibilityLabel={$t('密码')} value={password} onFocus={()=>setChoosing(false)} onChangeText={setPassword} secureTextEntry textContentType="password" returnKeyType="go" onSubmitEditing={submit}/>
      {error ? <Notice tone="failed" text={error}/> : null}
      <Button variant="primary" size="lg" label={$t(busy?'正在登录…':'登录')} disabled={busy||removing||!address.trim()||!name.trim()||!password} onPress={submit}/>
      <Pressable accessibilityRole="button" accessibilityLabel={$t('选择工作空间')}
        accessibilityState={{expanded:choosing,disabled:busy || removing}}
        accessibilityValue={{text:address ? address+' · '+status(address) : ''}} disabled={busy || removing}
        onPress={()=>{ Keyboard.dismiss(); setChoosing(open=>!open); }}
        style={{alignSelf:'center',maxWidth:'100%',flexDirection:'row',alignItems:'center',gap:6,minHeight:44,paddingHorizontal:8}}>
        <Txt variant="small" tone="secondary" numberOfLines={1}>{$t('工作空间')}</Txt>
        {address ? <HealthDot state={health[address]}/> : null}
        <Txt variant="small" color={colors.accentText} numberOfLines={1} style={{flexShrink:1}}>{address || $t('选择工作空间')}</Txt>
        <ChevronDown size={14} color={colors.textSecondary}/>
      </Pressable>
      {choosing && <View style={{backgroundColor:colors.bgRaised,borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:6}}>
        {addresses.map(origin => <View key={origin} style={{flexDirection:'row',alignItems:'center'}}>
          <Pressable accessibilityRole="button" accessibilityLabel={origin+' · '+status(origin)} accessibilityState={{selected:address===origin}}
            disabled={removing} onPress={()=>{setAddress(origin);setError('');setChoosing(false);}}
            style={{flex:1,minWidth:0,minHeight:44,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:7}}>
            <HealthDot state={health[origin]}/>
            <Txt variant="small" numberOfLines={1} style={{flexShrink:1}}>{origin}</Txt>
            {origin===address && <Check size={14} color={colors.accentText}/>}
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={$t('移除')+' '+origin} disabled={removing}
            onPress={()=>void removeAddress(origin)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}>
            <Minus size={16} color={colors.textSecondary}/>
          </Pressable>
        </View>)}
        <Pressable accessibilityRole="button" disabled={removing} onPress={startAdd}
          style={{minHeight:44,paddingHorizontal:8,flexDirection:'row',alignItems:'center',gap:7,borderTopWidth:addresses.length ? 1 : 0,borderTopColor:colors.border}}>
          <Plus size={16} color={colors.accentText}/><Txt variant="small" tone="accent" numberOfLines={1}>{$t('添加工作空间')}</Txt>
        </Pressable>
      </View>}
      <Modal visible={adding} transparent animationType="fade" onRequestClose={()=>setAdding(false)}>
        <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.32)',justifyContent:'center',padding:24}}>
          <View accessibilityViewIsModal style={{width:'100%',maxWidth:420,alignSelf:'center',backgroundColor:colors.bgRaised,borderRadius:14,padding:20,gap:12}}>
            <Txt variant="titleSm" weight="semibold">{$t('添加工作空间')}</Txt>
            <Txt variant="small">{$t('工作空间地址')}</Txt>
            <TextField autoFocus accessibilityLabel={$t('工作空间地址')} value={draft} onChangeText={setDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://www.baton.com" onSubmitEditing={addAddress}/>
            {addressError ? <Notice tone="failed" text={addressError}/> : null}
            <View style={{flexDirection:'row',justifyContent:'flex-end',gap:8}}>
              <Button label={$t('取消')} onPress={()=>setAdding(false)}/><Button variant="primary" label={$t('添加')} disabled={!draft.trim()} onPress={addAddress}/>
            </View>
          </View>
        </View>
      </Modal>

    </View></ScrollView>;
}
