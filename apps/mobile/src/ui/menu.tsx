// Native pull-down / context menus via @expo/ui (SwiftUI Menu on iOS, Material 3
// DropdownMenu on Android), replacing bottom action sheets: icons + titles,
// checkmarks for filters, red destructive items. SF Symbol icons show on iOS only.
import { MenuView } from '@expo/ui/community/menu';
import type { MenuAction } from '@expo/ui/community/menu';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActionSheetIOS, Alert, Platform, type StyleProp, View, type ViewStyle } from 'react-native';

import { $t } from '@/i18n';
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

export type SheetAction = { title: string; onPress: () => void; destructive?: boolean };

/** Android dialogs hold at most three buttons; the dialog itself is dismissed by tapping outside. */
const ANDROID_DIALOG_BUTTONS = 3;

/**
 * One-off action list for a row: the iOS action sheet (with Cancel), and on Android the
 * platform dialog with the same actions (tap outside or Back cancels).
 */
export function showActions(title: string, actions: SheetAction[]) {
  if (Platform.OS === 'ios') {
    const destructive = actions.findIndex((action) => action.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [$t('取消'), ...actions.map((action) => action.title)], cancelButtonIndex: 0, destructiveButtonIndex: destructive < 0 ? undefined : destructive + 1 },
      (index) => { if (index > 0) actions[index - 1].onPress(); },
    );
    return;
  }
  if (actions.length > ANDROID_DIALOG_BUTTONS) throw new Error(`showActions: Android dialogs support at most ${ANDROID_DIALOG_BUTTONS} actions`);
  Alert.alert(title, undefined, actions.map((action) => ({ text: action.title, onPress: action.onPress, style: action.destructive ? 'destructive' : 'default' })), { cancelable: true });
}
