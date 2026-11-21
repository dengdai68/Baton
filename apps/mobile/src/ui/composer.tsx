// Message composer shared by task collaboration and chats: reply context,
// attachments, images, @mentions with suggestions and a primary Send.
import { AtSign, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { $t } from '@/i18n';
import { formatBytes, type LocalAttachment } from '@/lib/attachments';
import { useTheme } from '@/theme';
import { Avatar } from './avatar';
import { Button } from './button';
import { Txt } from './text';

export type Mentionable = { id: string; name: string; color?: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  note?: string | null;
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

export function Composer({ value, onChange, onSend, sending, disabled, placeholder, note, reply, attachments, onAttach, onRemoveAttachment, mentionables = [] }: Props) {
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, padding: 8, paddingBottom: 0 }}>
            {attachments.map((item) => (
              <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 4, minHeight: 30, borderRadius: metrics.radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSubtle, maxWidth: 220 }}>
                {item.image ? <ImageIcon size={14} color={colors.textTertiary} /> : <FileText size={14} color={colors.textTertiary} />}
                <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>{item.name}</Txt>
                {item.size ? <Txt variant="caption" tone="tertiary">{formatBytes(item.size)}</Txt> : null}
                {onRemoveAttachment ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={$t('移除附件 {0}', [item.name])} onPress={() => onRemoveAttachment(item.key)} hitSlop={8} style={{ padding: 4 }}>
                    <X size={14} color={colors.textTertiary} />
                  </Pressable>
                ) : null}
              </View>
            ))}
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
          <Button variant="primary" size="sm" label={$t('发送')} loading={sending} disabled={!canSend} onPress={onSend} style={{ minHeight: 34, paddingHorizontal: 16 }} />
        </View>
      </View>
      {note ? <Txt variant="caption" tone="tertiary" style={{ paddingHorizontal: 4, paddingTop: 6 }}>{note}</Txt> : null}
    </View>
  );
}
