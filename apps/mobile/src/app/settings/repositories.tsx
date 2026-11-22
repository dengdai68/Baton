// 仓库访问 (read-only): which code hosts have a token configured on the Mac.
import { Stack } from 'expo-router';
import { GitBranch } from 'lucide-react-native';

import { useGitProviders } from '@/features/settings';
import { $t, useLocale } from '@/i18n';
import { GroupedPage, GroupedRow, GroupedSection, IconTile } from '@/ui/grouped';
import { ErrorState, LoadingState } from '@/ui/states';
import { Tag } from '@/ui/status';

export default function RepositorySettings() {
  useLocale();
  const providers = useGitProviders();
  const rows = (providers.data?.providers || []).filter((provider) => ['github', 'gitlab'].includes(provider.id));
  return (
    <>
      <Stack.Screen options={{ title: $t('仓库访问') }} />
      {providers.isPending ? <LoadingState /> : providers.error ? <ErrorState title={$t('仓库访问配置读取失败')} message={providers.error.message} onRetry={() => void providers.refetch()} /> : (
        <GroupedPage>
          <GroupedSection footer={$t('Token 仅用于拉取私有仓库，保存后不回显；在 Mac 的 设置 → 仓库访问 中配置。')}>
            {rows.map((provider) => (
              <GroupedRow key={provider.id} leading={<IconTile icon={GitBranch} tone={provider.configured ? 'accent' : 'neutral'} size={34} />} title={provider.label}
                subtitle={provider.host} mono trailing={<Tag label={provider.configured ? $t('已配置') : $t('未配置')} tone={provider.configured ? 'done' : 'neutral'} />} />
            ))}
          </GroupedSection>
        </GroupedPage>
      )}
    </>
  );
}
