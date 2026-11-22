// CLI (display only): what the baton command does and how to start; it is
// installed from the Mac's settings.
import { Stack } from 'expo-router';
import { SquareTerminal } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';

import { $t, useLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { CopyButton, DetailHeader, GroupedPage, GroupedSection, IconTile } from '@/ui/grouped';
import { Txt } from '@/ui/text';

const QUICK_START = 'baton help\nbaton schema agents\nbaton tasks list --json';

export default function CliSettings() {
  useLocale();
  const { colors } = useTheme();
  return (
    <GroupedPage>
      <Stack.Screen options={{ title: 'CLI' }} />
      <DetailHeader visual={<IconTile icon={SquareTerminal} size={56} />} title="baton" subtitle={$t('在终端中使用 baton 配置员工、团队、工作流、插件与 MCP，创建和查询任务。')} />
      <GroupedSection title={$t('快速开始')} action={<CopyButton value={QUICK_START} label={$t('复制命令')} />}
        footer={$t('CLI 安装在 Mac 上：设置 → CLI → 安装 CLI；与客户端共用登录授权。')}>
        <View style={{ backgroundColor: colors.codeBg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 14 }}>
            <Txt variant="small" mono selectable>{QUICK_START}</Txt>
          </ScrollView>
        </View>
      </GroupedSection>
    </GroupedPage>
  );
}
