// Native iOS pull-down / context menus (SwiftUI Menu via @expo/ui), replacing
// bottom action sheets: icons + titles, checkmarks for filters, red destructive items.
import { MenuView } from '@expo/ui/community/menu';
import type { MenuAction } from '@expo/ui/community/menu';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';
import { type IconTone, toneTint } from './icon-button';

export type MenuItem = {
  id: string;
  title: string;
  /** SF Symbol name. */
  icon?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Shows a checkmark (filters, single choice). */
  checked?: boolean;
  /** Nested items; with inline they render as a titled section. */
  children?: MenuItem[];
  inline?: boolean;
};

function toAction(item: MenuItem): MenuAction {
  return {
    id: item.id,
    title: item.title,
    image: item.icon as MenuAction['image'],
    attributes: { destructive: item.destructive, disabled: item.disabled },
    state: item.checked === undefined ? undefined : item.checked ? 'on' : 'off',
    subactions: item.children?.map(toAction),
    displayInline: item.inline,
  };
}

export function Menu({ items, onSelect, title, longPress, style, children }: {
  items: MenuItem[]; onSelect: (id: string) => void; title?: string; longPress?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode;
}) {
  return (
    <MenuView title={title} actions={items.map(toAction)} shouldOpenOnLongPress={longPress} style={style}
      onPressAction={({ nativeEvent }) => onSelect(nativeEvent.event)}>
      {children}
    </MenuView>
  );
}

/** An icon that opens a native menu (filters, "more" actions). */
export function MenuButton({ icon: Icon, label, items, onSelect, title, tone = 'accent', active, size = 36 }: {
  icon: LucideIcon; label: string; items: MenuItem[]; onSelect: (id: string) => void; title?: string; tone?: IconTone; active?: boolean; size?: number;
}) {
  const { colors } = useTheme();
  const tint = toneTint(colors, tone);
  return (
    <Menu items={items} onSelect={onSelect} title={title} style={{ width: size, height: size }}>
      <View accessible accessibilityRole="button" accessibilityLabel={label}
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? tint.bg : 'transparent' }}>
        <Icon size={Math.round(size * 0.5)} color={tint.icon} strokeWidth={1.8} />
      </View>
    </Menu>
  );
}
