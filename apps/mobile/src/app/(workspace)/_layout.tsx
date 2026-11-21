// Workspace tabs: native iOS tab bar (Liquid Glass on iOS 26) with live badges.
import { Redirect, router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { ShieldAlert } from 'lucide-react-native';
import { View } from 'react-native';

import { useNotifications } from '@/api/queries';
import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Txt } from '@/ui/text';
import { useSession } from '@/workspace/session';

function Expired() {
  const { colors } = useTheme();
  const { active, forget } = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas, justifyContent: 'center', padding: 24, gap: 14 }}>
      <ShieldAlert size={36} color={colors.stAttention} strokeWidth={1.6} />
      <Txt variant="title" weight="semibold">{$t('此设备的授权已失效')}</Txt>
      <Txt tone="secondary">{$t('Mac 上撤销了这台 iPhone，或授权已过期。请在 Mac 上重新生成配对码后再扫描。')}</Txt>
      <Button variant="primary" size="lg" label={$t('重新配对')} onPress={async () => { if (active) await forget(active.id); router.replace('/connect'); }} />
    </View>
  );
}

export default function WorkspaceLayout() {
  useLocale();
  const { active, expired } = useSession();
  const { colors } = useTheme();
  const { data } = useNotifications();
  if (!active) return <Redirect href="/connect" />;
  if (expired) return <Expired />;
  const attention = data?.taskAttentionCount || 0;
  const unread = data?.communicationUnreadCount || 0;
  return (
    <NativeTabs tintColor={colors.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf={{ default: 'tray', selected: 'tray.fill' }} md="inbox" />
        <NativeTabs.Trigger.Label>{$t('待我处理')}</NativeTabs.Trigger.Label>
        {attention ? <NativeTabs.Trigger.Badge>{String(attention > 99 ? '99+' : attention)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.Icon sf={{ default: 'checklist', selected: 'checklist' }} md="checklist" />
        <NativeTabs.Trigger.Label>{$t('任务')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chats">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="forum" />
        <NativeTabs.Trigger.Label>{$t('沟通')}</NativeTabs.Trigger.Label>
        {unread ? <NativeTabs.Trigger.Badge>{String(unread > 99 ? '99+' : unread)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="automations">
        <NativeTabs.Trigger.Icon sf={{ default: 'clock', selected: 'clock.fill' }} md="schedule" />
        <NativeTabs.Trigger.Label>{$t('自动化')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} md="apps" />
        <NativeTabs.Trigger.Label>{$t('更多')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
