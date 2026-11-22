// 外观: this iPhone's appearance mode, as three previews (Mac: theme options).
import { Stack } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { themeName } from '@/features/settings';
import { $t, useLocale } from '@/i18n';
import { type Colors, usePreferences, useTheme } from '@/theme';
import { darkColors, lightColors } from '@/theme/tokens.generated';
import { GroupedPage, GroupedSection } from '@/ui/grouped';
import { Txt } from '@/ui/text';

type Mode = 'system' | 'light' | 'dark';

/** Miniature window in one palette (the system preview is split light/dark). */
function Preview({ mode }: { mode: Mode }) {
  const { metrics } = useTheme();
  const pane = (palette: Colors) => (
    <View style={{ flex: 1, backgroundColor: palette.bgCanvas, padding: 8, gap: 5 }}>
      <View style={{ height: 6, width: '60%', borderRadius: 3, backgroundColor: palette.text, opacity: 0.8 }} />
      <View style={{ height: 5, width: '85%', borderRadius: 3, backgroundColor: palette.textTertiary, opacity: 0.6 }} />
      <View style={{ height: 5, width: '70%', borderRadius: 3, backgroundColor: palette.textTertiary, opacity: 0.6 }} />
      <View style={{ flex: 1 }} />
      <View style={{ height: 10, width: 26, borderRadius: 5, backgroundColor: palette.accent }} />
    </View>
  );
  return (
    <View style={{ height: 96, borderRadius: metrics.radius.md, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: lightColors.borderStrong }}>
      {mode === 'dark' ? pane(darkColors) : pane(lightColors)}
      {mode === 'system' ? pane(darkColors) : null}
    </View>
  );
}

export default function AppearanceSettings() {
  useLocale();
  const { colors } = useTheme();
  const { preferences, setTheme } = usePreferences();
  return (
    <GroupedPage>
      <Stack.Screen options={{ title: $t('外观') }} />
      <GroupedSection title={$t('外观模式')} footer={$t('外观偏好保存在这台 iPhone，选择后立即生效。')}>
        <View style={{ flexDirection: 'row', gap: 12, padding: 14 }}>
          {(['system', 'light', 'dark'] as Mode[]).map((mode) => {
            const selected = preferences.theme === mode;
            return (
              <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={themeName(mode)} onPress={() => void setTheme(mode)}
                style={({ pressed }) => ({ flex: 1, gap: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
                <View style={{ alignSelf: 'stretch', padding: 3, borderRadius: 14, borderWidth: 2, borderColor: selected ? colors.accent : 'transparent' }}>
                  <Preview mode={mode} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {selected ? <CircleCheck size={15} color={colors.accentText} /> : null}
                  <Txt variant="small" weight={selected ? 'semibold' : 'regular'} tone={selected ? 'primary' : 'secondary'}>{themeName(mode)}</Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
      </GroupedSection>
    </GroupedPage>
  );
}
