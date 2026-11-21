// 更多：数字员工、团队、工作流、角色、插件、MCP 与设置。
import { router, Stack } from 'expo-router';
import { Bot, ChevronRight, KeyRound, Plug, Puzzle, Settings, Users, Workflow, SquareUser } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { ListRow } from '@/ui/layout';
import { Txt } from '@/ui/text';
import { useSession } from '@/workspace/session';

const entries = () => [
  { id: 'agents', title: $t('数字员工'), subtitle: $t('职责、提示词、Runtime 与工具'), icon: Bot },
  { id: 'teams', title: $t('团队'), subtitle: $t('常用的成员组合'), icon: Users },
  { id: 'workflows', title: $t('工作流'), subtitle: $t('职责节点、交付要求与交接关系'), icon: Workflow },
  { id: 'roles', title: $t('角色'), subtitle: $t('可共用的系统提示词'), icon: SquareUser },
  { id: 'marketplace', title: $t('插件'), subtitle: $t('Skill 与插件'), icon: Puzzle },
  { id: 'mcp', title: $t('MCP'), subtitle: $t('为员工选择工具'), icon: Plug },
  { id: 'git', title: $t('仓库访问'), subtitle: $t('GitHub / GitLab 凭据'), icon: KeyRound },
];

export default function More() {
  useLocale();
  const { colors } = useTheme();
  const { active } = useSession();
  return (
    <>
      <Stack.Screen options={{ title: $t('更多') }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.bgCanvas }} contentContainerStyle={{ paddingBottom: 96 }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Txt variant="small" weight="semibold" tone="tertiary">{$t('组织')}</Txt>
        </View>
        {entries().map((entry, index) => (
          <ListRow key={entry.id}
            leading={<View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}><entry.icon size={20} color={colors.accentText} strokeWidth={1.7} /></View>}
            title={entry.title} subtitle={entry.subtitle}
            onPress={() => router.push({ pathname: '/directory', params: { kind: entry.id } })} />
        ))}
        <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 12 }}>
          <Txt variant="small" weight="semibold" tone="tertiary">{$t('应用')}</Txt>
        </View>
        <ListRow
          leading={<View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.bgActive, alignItems: 'center', justifyContent: 'center' }}><Settings size={20} color={colors.textSecondary} strokeWidth={1.7} /></View>}
          title={$t('设置')} subtitle={active ? active.origin : ''}
          onPress={() => router.push('/settings')} />
        <View style={{ padding: 16 }}>
          <Txt variant="caption" tone="tertiary">{$t('插件、MCP 与仓库凭据可在手机上查看与配置；本机路径操作请在 Mac 上进行。')}</Txt>
        </View>
      </ScrollView>
    </>
  );
}
