// Tab root top bar (tab titles are intentionally not shown): a short search
// field and icon actions in one row, below the status bar.
import { Search, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, type StyleProp, TextInput, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { $t } from '@/i18n';
import { useTheme } from '@/theme';

export function SearchField({ value, onChangeText, placeholder, style }: {
  value: string; onChangeText: (value: string) => void; placeholder?: string; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }, style]}>
      <Search size={16} color={colors.textTertiary} strokeWidth={1.8} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || $t('搜索')}
        placeholderTextColor={colors.textTertiary}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={placeholder || $t('搜索')}
        style={{ flex: 1, height: 38, fontSize: 16, color: colors.text, paddingVertical: 0 }}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={$t('清除')} hitSlop={10} onPress={() => onChangeText('')}>
          <X size={16} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function TabToolbar({ search, onSearchChange, placeholder, children }: {
  search?: string; onSearchChange?: (value: string) => void; placeholder?: string; children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <View style={{ paddingTop: insets.top + 6, paddingLeft: 16, paddingRight: 10, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: colors.bgCanvas }}>
      {onSearchChange ? <SearchField value={search || ''} onChangeText={onSearchChange} placeholder={placeholder} style={{ flex: 1, marginRight: 6 }} /> : <View style={{ flex: 1 }} />}
      {children}
    </View>
  );
}
