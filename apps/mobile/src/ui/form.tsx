// Form controls: labelled fields, inputs (16pt so iOS never zooms), segmented
// choice with filled selection, switch rows and checkbox choices.
import { Check } from 'lucide-react-native';
import { type ReactNode, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, Switch, TextInput, type TextInputProps, View } from 'react-native';

import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Button } from './button';
import { Txt } from './text';

// Android autofill reads autoComplete while iOS reads textContentType; derive one from the other.
const ANDROID_AUTOFILL: Partial<Record<NonNullable<TextInputProps['textContentType']>, TextInputProps['autoComplete']>> = {
  username: 'username',
  password: 'password',
};

export function Field({ label, required, optional, hint, error, children }: { label: string; required?: boolean; optional?: boolean; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <View style={{ gap: 6, marginBottom: 16 }}>
      <Txt variant="small" weight="medium" tone="secondary">
        {label}
        {required ? <Txt variant="small" tone="danger"> *</Txt> : null}
        {optional ? <Txt variant="small" tone="tertiary">{'  ' + $t('可选')}</Txt> : null}
      </Txt>
      {children}
      {error ? <Txt variant="small" tone="danger">{error}</Txt> : hint ? <Txt variant="small" tone="tertiary">{hint}</Txt> : null}
    </View>
  );
}

export function TextField({ multiline, style, invalid, ...rest }: TextInputProps & { invalid?: boolean }) {
  const { colors, metrics } = useTheme();
  const autofill = Platform.OS === 'android' && rest.textContentType ? ANDROID_AUTOFILL[rest.textContentType] : undefined;
  return (
    <TextInput
      placeholderTextColor={colors.textTertiary}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      {...rest}
      autoComplete={rest.autoComplete ?? autofill}
      style={[
        {
          minHeight: multiline ? 96 : 44, maxHeight: multiline ? 240 : undefined, paddingHorizontal: 12, paddingVertical: multiline ? 10 : 0,
          borderRadius: metrics.radius.md, borderWidth: 1, borderColor: invalid ? colors.stFailed : colors.border,
          backgroundColor: rest.editable === false ? colors.bgSubtle : colors.bgInput, color: colors.text, fontSize: 16, lineHeight: multiline ? 22 : undefined,
        },
        style,
      ]}
    />
  );
}

/** Segmented control: every selected state is a filled background, never only color. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void }) {
  const { colors, metrics } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 2, padding: 2, borderRadius: metrics.radius.md, backgroundColor: colors.bgSubtle, borderWidth: 1, borderColor: colors.borderSubtle }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{ flex: 1, minHeight: 32, borderRadius: metrics.radius.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, backgroundColor: selected ? colors.bgRaised : 'transparent', borderWidth: selected ? 1 : 0, borderColor: colors.border }}
          >
            <Txt variant="small" weight="medium" tone={selected ? 'primary' : 'secondary'} numberOfLines={1}>{option.label}</Txt>
            {option.count !== undefined ? <Txt variant="caption" tone="tertiary" numeric>{option.count}</Txt> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontal filter chips (task quick views); selected chip is filled. */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; count?: number; attention?: boolean }>; onChange: (value: T) => void }) {
  const { colors, metrics } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{ minHeight: 32, paddingHorizontal: 12, borderRadius: metrics.radius.sm, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: selected ? colors.bgActive : 'transparent' }}
          >
            <Txt variant="small" weight="medium" tone={selected ? 'primary' : 'secondary'}>{option.label}</Txt>
            {option.count !== undefined ? (
              <Txt variant="caption" weight={option.attention && option.count ? 'semibold' : 'regular'} tone={option.attention && option.count ? 'attention' : 'tertiary'} numeric>{option.count}</Txt>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function SwitchRow({ label, description, value, onChange, disabled }: { label: string; description?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt weight="medium">{label}</Txt>
        {description ? <Txt variant="small" tone="secondary">{description}</Txt> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.accent, false: colors.borderStrong }} />
    </View>
  );
}

/** Checkbox-style choice row used by member and team pickers. */
export function ChoiceRow({ selected, onPress, children, disabled }: { selected: boolean; onPress: () => void; children: ReactNode; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: pressed ? colors.bgHover : 'transparent', opacity: disabled ? 0.5 : 1 })}
    >
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: selected ? 0 : 1.5, borderColor: colors.borderStrong, backgroundColor: selected ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <Check size={15} color={colors.textOnAccent} strokeWidth={2.6} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>{children}</View>
    </Pressable>
  );
}

/** One-field text dialog (rename): the Android counterpart of the iOS Alert.prompt. */
export function PromptDialog({ visible, title, label, value: initial, confirmLabel, onCancel, onSubmit }: {
  visible: boolean; title: string; label: string; value: string; confirmLabel: string; onCancel: () => void; onSubmit: (value: string) => void;
}) {
  const { colors, metrics } = useTheme();
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);
  const submit = () => {
    if (value.trim()) onSubmit(value);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: colors.bgOverlay, justifyContent: 'center', padding: 24 }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, alignSelf: 'center', backgroundColor: colors.bgRaised, borderRadius: metrics.radius.lg, padding: 20, gap: 12 }}>
          <Txt variant="titleSm" weight="semibold">{title}</Txt>
          <TextField autoFocus selectTextOnFocus accessibilityLabel={label} value={value} onChangeText={setValue} returnKeyType="done" onSubmitEditing={submit} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <Button label={$t('取消')} onPress={onCancel} />
            <Button variant="primary" label={confirmLabel} disabled={!value.trim()} onPress={submit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
