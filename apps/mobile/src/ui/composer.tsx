// Message composer shared by task collaboration and chats: reply context,
// attachments, images, @mentions with suggestions and a round send arrow.
import { Image } from 'expo-image';
import { ArrowUp, AtSign, Image as ImageIcon, Paperclip, X } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';

import { $t } from '@/i18n';
import { fileExtension, isImageName, type LocalAttachment } from '@/lib/attachments';
import { useTheme } from '@/theme';
import { Avatar } from './avatar';
import { Txt } from './text';

export type Mentionable = { id: string; name: string; color?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  reply?: { label: string; onCancel: () => void } | null;
  attachments: LocalAttachment[];
  onAttach?: (kind: 'file' | 'image') => void;
  onRemoveAttachment?: (key: string) => void;
  mentionables?: Mentionable[];
};

/** The "@query" being typed at the end of the draft, if any. */
function mentionQuery(text: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
  return match ? match[1] : null;
}

export function Composer({ value, onChange, onSend, sending, disabled, placeholder, reply, attachments, onAttach, onRemoveAttachment, mentionables = [] }: Props) {
  const { colors, metrics } = useTheme();
  const [focused, setFocused] = useState(false);
  const query = mentionQuery(value);
  const suggestions = query === null ? [] : mentionables.filter((member) => member.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const canSend = !disabled && !sending && (value.trim().length > 0 || attachments.length > 0);

  function insertMention(member: Mentionable) {
    onChange(value.replace(/@([^\s@]*)$/, '@' + member.name + ' '));
  }

  const iconButton = (Icon: typeof Paperclip, label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled || sending} hitSlop={6}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.bgHover : 'transparent', opacity: disabled || sending ? 0.45 : 1 })}>
      <Icon size={20} color={colors.textSecondary} strokeWidth={1.7} />
    </Pressable>
  );

  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.bgCanvas, borderTopWidth: 1, borderTopColor: colors.borderSubtle }}>
      {suggestions.length ? (
        <View style={{ marginBottom: 6, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgRaised, overflow: 'hidden' }}>
          {suggestions.map((member) => (
            <Pressable key={member.id} accessibilityRole="button" onPress={() => insertMention(member)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 44, backgroundColor: pressed ? colors.bgHover : 'transparent' })}>
              <Avatar member={member} size={24} />
              <Txt numberOfLines={1}>{member.name}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ borderRadius: metrics.radius.lg, borderWidth: 1, borderColor: focused ? colors.accent : colors.border, backgroundColor: colors.bgInput, overflow: 'hidden' }}>
        {reply ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 6, marginBottom: 0, paddingHorizontal: 10, paddingVertical: 6, borderRadius: metrics.radius.sm, backgroundColor: colors.stAttentionBg }}>
            <Txt variant="small" color={colors.stAttention} numberOfLines={2} style={{ flex: 1 }}>{reply.label}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={$t('取消当前回复')} onPress={reply.onCancel} hitSlop={8}>
              <X size={16} color={colors.stAttention} />
            </Pressable>
          </View>
        ) : null}
        {attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 8, paddingBottom: 0, alignItems: 'flex-start' }}>
            {attachments.map((item) => {
              const remove = onRemoveAttachment ? (
                <Pressable accessibilityRole="button" accessibilityLabel={$t('移除附件 {0}', [item.name])} onPress={() => onRemoveAttachment(item.key)} hitSlop={8}
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.bgCanvas, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                  <X size={12} color={colors.textSecondary} strokeWidth={2.2} />
                </Pressable>
              ) : null;
              // Mac draft rule: images show a square preview, other files a named chip.
              return isImageName(item.name) ? (
                <View key={item.key} style={{ width: 56, height: 56, marginTop: 6, marginRight: 6 }}>
                  <Image source={{ uri: item.uri }} style={{ width: 56, height: 56, borderRadius: metrics.radius.sm }} contentFit="cover" accessibilityLabel={item.name} />
                  {remove}
                </View>
              ) : (
                <View key={item.key} style={{ marginTop: 6, marginRight: 6, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 10, height: 44, borderRadius: metrics.radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSubtle, maxWidth: 200 }}>
                  <Paperclip size={15} color={colors.textTertiary} />
                  <View style={{ flexShrink: 1 }}>
                    <Txt variant="small" numberOfLines={1}>{item.name}</Txt>
                    <Txt variant="caption" tone="tertiary">{fileExtension(item.name) || $t('文件')}</Txt>
                  </View>
                  {remove}
                </View>
              );
            })}
          </ScrollView>
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChange}
          editable={!disabled}
          multiline
          placeholder={placeholder || $t('输入消息…')}
          placeholderTextColor={colors.textTertiary}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={$t('消息内容')}
          style={{ minHeight: 44, maxHeight: 160, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, fontSize: 16, lineHeight: 22, color: colors.text }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 4 }}>
          {onAttach ? iconButton(Paperclip, $t('添加附件'), () => onAttach('file')) : null}
          {onAttach ? iconButton(ImageIcon, $t('添加图片'), () => onAttach('image')) : null}
          {mentionables.length ? iconButton(AtSign, $t('提及成员'), () => onChange(value + (value && !/\s$/.test(value) ? ' @' : '@'))) : null}
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" accessibilityLabel={$t('发送')} accessibilityState={{ disabled: !canSend, busy: Boolean(sending) }}
            onPress={onSend} disabled={!canSend} hitSlop={6}
            style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: canSend || sending ? colors.accent : colors.bgActive, opacity: pressed ? 0.8 : 1 })}>
            {sending ? <ActivityIndicator size="small" color={colors.onSolid} /> : <ArrowUp size={19} color={canSend ? colors.onSolid : colors.textDisabled} strokeWidth={2.4} />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
