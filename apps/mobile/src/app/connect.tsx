// Workspace list: saved workspaces, scan a pairing code from the Mac, or paste a link.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Ellipsis, Monitor, QrCode, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatRelativeTime } from '@shared/console-projections.mjs';
import { $t, $tm } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/form';
import { SectionTitle } from '@/ui/layout';
import { Notice } from '@/ui/states';
import { Tag } from '@/ui/status';
import { Txt } from '@/ui/text';
import { parseWorkspaceInput } from '@/workspace/link';
import { useSession } from '@/workspace/session';
import type { SavedWorkspace } from '@/workspace/store';

export default function Connect() {
  const { colors, metrics } = useTheme();
  const insets = useSafeAreaInsets();
  const { workspaces, open, forget } = useSession();
  const [address, setAddress] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function enter(item: SavedWorkspace) {
    setFailure('');
    setBusy(item.id);
    try {
      await open(item.id);
      router.replace('/inbox');
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function submit() {
    setFailure('');
    try {
      parseWorkspaceInput(address);
      router.push({ pathname: '/pair', params: { link: address.trim() } });
      setAddress('');
    } catch (error) {
      setFailure($tm((error as Error).message));
    }
  }

  function remove(item: SavedWorkspace) {
    Alert.alert($t('移除这个工作空间？'), $t('将删除此 iPhone 上的授权，并尝试在 Mac 上撤销此设备。以后需要重新扫码配对。'), [
      { text: $t('取消'), style: 'cancel' },
      { text: $t('移除'), style: 'destructive', onPress: () => void forget(item.id) },
    ]);
  }

  function more(item: SavedWorkspace) {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: item.name, message: item.origin, options: [$t('取消'), $t('移除工作空间')], cancelButtonIndex: 0, destructiveButtonIndex: 1 },
        (index) => index === 1 && remove(item),
      );
    } else remove(item);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgSubtle }}
      contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: insets.bottom + 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ paddingHorizontal: 20, gap: 10, marginBottom: 8 }}>
        <Image source={require('../../assets/icon.png')} style={{ width: 60, height: 60, borderRadius: 14 }} accessibilityIgnoresInvertColors />
        <Txt variant="display" weight="semibold" accessibilityRole="header">Baton</Txt>
        <Txt tone="secondary">{$t('在 iPhone 上跟进任务、回答澄清、参与沟通并完成验收。')}</Txt>
      </View>

      {workspaces.length ? (
        <>
          <SectionTitle title={$t('工作空间')} />
          <View style={{ marginHorizontal: 16, borderRadius: metrics.radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised, overflow: 'hidden' }}>
            {workspaces.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.name + ' ' + item.origin}
                onPress={() => void enter(item)}
                onLongPress={() => more(item)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? colors.bgHover : 'transparent', borderTopWidth: index ? 1 : 0, borderTopColor: colors.borderSubtle })}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Monitor size={20} color={colors.accentText} strokeWidth={1.7} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Txt weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.name}</Txt>
                    <Tag label={item.mode === 'cloud' ? $t('云端') : $t('本机')} tone={item.mode === 'cloud' ? 'accent' : 'neutral'} />
                  </View>
                  <Txt variant="small" tone="tertiary" mono numberOfLines={1}>{item.origin.replace(/^https:\/\//, '')}</Txt>
                  <Txt variant="caption" tone="tertiary">{$t('上次使用 {0}', [formatRelativeTime(new Date(item.lastUsedAt).toISOString())])}</Txt>
                </View>
                {busy === item.id ? <Txt variant="small" tone="tertiary">{$t('正在连接…')}</Txt> : (
                  <Pressable accessibilityRole="button" accessibilityLabel={$t('更多操作')} hitSlop={10} onPress={() => more(item)}>
                    <Ellipsis size={20} color={colors.textTertiary} />
                  </Pressable>
                )}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <SectionTitle title={$t('添加工作空间')} />
      <View style={{ marginHorizontal: 16, padding: 16, gap: 14, borderRadius: metrics.radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised }}>
        <View style={{ gap: 6 }}>
          <Txt weight="semibold">{$t('连接 Mac 上的 Baton')}</Txt>
          <Txt variant="small" tone="secondary">{$t('在 Mac 的 Baton 菜单选择「连接 iPhone…」并生成配对码，然后在这里扫描。配对码 5 分钟内有效，只能使用一次。')}</Txt>
        </View>
        <Button variant="primary" size="lg" block icon={QrCode} label={$t('扫描配对码')} onPress={() => router.push('/scan')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.borderSubtle }} />
          <Txt variant="caption" tone="tertiary">{$t('或粘贴配对链接')}</Txt>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.borderSubtle }} />
        </View>
        <TextField
          value={address}
          onChangeText={setAddress}
          placeholder="baton://pair#…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={submit}
          accessibilityLabel={$t('配对链接')}
        />
        <Button label={$t('连接')} block disabled={!address.trim()} onPress={submit} />
        {failure ? <Notice tone="failed" text={failure} /> : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 16 }}>
        <ShieldCheck size={16} color={colors.textTertiary} style={{ marginTop: 2 }} />
        <Txt variant="small" tone="tertiary" style={{ flex: 1 }}>{$t('连接全程使用 HTTPS，并校验配对时记录的 Mac 证书指纹。可随时在 Mac 上撤销此设备。')}</Txt>
      </View>
    </ScrollView>
  );
}
