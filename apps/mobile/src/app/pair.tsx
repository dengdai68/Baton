// Pairing progress for a scanned or opened link; each link is redeemed once.
import { router, useLocalSearchParams } from 'expo-router';
import { Monitor } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { $t, $tm } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Notice } from '@/ui/states';
import { Txt } from '@/ui/text';
import { parseWorkspaceInput } from '@/workspace/link';
import { useSession } from '@/workspace/session';

const redeemed = new Set<string>();

export default function Pair() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  const { pair } = useSession();
  const { colors } = useTheme();
  const [failure, setFailure] = useState(link ? '' : $t('没有收到配对链接，请重新扫描 Mac 上的配对码。'));
  const host = (() => {
    try { return link ? parseWorkspaceInput(link).address.origin.replace(/^https:\/\//, '') : ''; } catch { return ''; }
  })();

  useEffect(() => {
    if (!link || redeemed.has(link)) return;
    redeemed.add(link);
    (async () => {
      try {
        await pair(parseWorkspaceInput(link));
        router.replace('/inbox');
      } catch (error) {
        setFailure($tm((error as Error).message));
      }
    })();
  }, [link, pair]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas, justifyContent: 'center', padding: 24, gap: 16 }}>
      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Monitor size={26} color={colors.accentText} strokeWidth={1.7} />
      </View>
      <Txt variant="title" weight="semibold">{failure ? $t('无法连接这个工作空间') : $t('正在连接 Mac…')}</Txt>
      {host ? <Txt tone="tertiary" mono>{host}</Txt> : null}
      {failure ? (
        <>
          <Notice tone="failed" text={failure} />
          <Button variant="primary" size="lg" label={$t('重新扫描')} onPress={() => router.replace('/scan')} />
          <Button size="lg" label={$t('返回工作空间列表')} onPress={() => router.replace('/connect')} />
        </>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={colors.textTertiary} />
          <Txt tone="secondary">{$t('正在校验证书并配对此 iPhone')}</Txt>
        </View>
      )}
    </View>
  );
}
