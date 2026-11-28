import { Redirect, router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Clock, LayoutGrid, ListChecks, MessagesSquare, ShieldAlert } from 'lucide-react-native';
import { View } from 'react-native';

import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Txt } from '@/ui/text';
import { useSession } from '@/workspace/session';

function Expired() {
  const { colors } = useTheme();
  const { active, leave } = useSession();
  // A Relay channel only ends when the Mac removed this phone; a new invitation is the way back.
  const relay = Boolean(active?.relay);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas, justifyContent: 'center', padding: 24, gap: 14 }}>
      <ShieldAlert size={36} color={colors.stAttention} strokeWidth={1.6} />
      <Txt variant="title" weight="semibold">{relay ? $t('此设备已被移除') : $t('此设备的授权已失效')}</Txt>
      <Txt tone="secondary">{relay ? $t('请在 Mac 上点「添加手机」，再扫码或输入新的配对地址。') : $t('请重新输入工作空间地址和账号登录。')}</Txt>
      <Button variant="primary" size="lg" label={relay ? $t('重新配对') : $t('重新登录')} onPress={async () => { await leave(); router.replace('/connect'); }} />
    </View>
  );
}

export default function WorkspaceLayout() {
  useLocale();
  const { active, expired } = useSession();
  const { colors } = useTheme();
  if (!active) return <Redirect href="/connect" />;
  if (expired) return <Expired />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarLabelPosition: 'below-icon',
      tabBarActiveTintColor: colors.accentText,
      tabBarInactiveTintColor: colors.textTertiary,
      tabBarLabelStyle: {color: colors.textSecondary},
      tabBarActiveBackgroundColor: 'transparent',
      tabBarStyle: {backgroundColor: colors.bgCanvas, borderTopColor: colors.borderSubtle},
    }}>
      <Tabs.Screen name="tasks" options={{title:$t('任务'), tabBarIcon: ({color,size}) => <ListChecks color={color} size={size}/>}} />
      <Tabs.Screen name="chats" options={{title:$t('沟通'), tabBarIcon: ({color,size}) => <MessagesSquare color={color} size={size}/>}} />
      <Tabs.Screen name="automations" options={{title:$t('自动化'), tabBarIcon: ({color,size}) => <Clock color={color} size={size}/>}} />
      <Tabs.Screen name="more" options={{title:$t('更多'), tabBarIcon: ({color,size}) => <LayoutGrid color={color} size={size}/>}} />
    </Tabs>
  );
}
