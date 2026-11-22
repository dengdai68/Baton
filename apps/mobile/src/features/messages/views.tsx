// Shared message presentation for task collaboration and chats (Graphite 4.10):
// agents left with a 28pt avatar, humans right in a soft accent bubble, day
// dividers, collapsible long bodies and amber question cards.
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { formatMessageTime } from '@shared/console-projections.mjs';
import { $t } from '@/i18n';
import { useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Markdown } from '@/ui/markdown';
import { Txt } from '@/ui/text';

export function DayDivider({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 16 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.borderSubtle }} />
      <Txt variant="caption" weight="medium" tone="tertiary">{label}</Txt>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.borderSubtle }} />
    </View>
  );
}

/** Long bodies collapse to ~10 lines with an explicit expand control. */
export function CollapsibleBody({ content, mentions, tone }: { content: string; mentions?: string[]; tone?: string }) {
  const { colors } = useTheme();
  const long = content.length > 900 || content.split('\n').length > 16;
  const [expanded, setExpanded] = useState(!long);
  return (
    <View>
      <View style={expanded ? undefined : { maxHeight: 240, overflow: 'hidden' }}>
        <Markdown size="body" content={content} mentions={mentions} tone={tone} />
      </View>
      {long ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} hitSlop={6} style={{ paddingTop: 6 }}>
          <Txt variant="small" weight="medium" color={colors.textLink}>{expanded ? $t('收起') : $t('展开全文')}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

type Sender = { id?: string | null; name?: string | null; color?: string | null };

/** One agent/system message: avatar, name · kind → recipient · time, body, extras. */
export function AgentMessage({ sender, name, kind, to, time, status, children, attention, accessory }: {
  sender: Sender; name: string; kind?: string; to?: string | null; time: string; status?: string; children: ReactNode; attention?: boolean;
  /** Small icon actions at the end of the header (console, reply). */
  accessory?: ReactNode;
}) {
  const { colors, metrics } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
      <Avatar member={sender} size={28} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 6 }}>
            <Txt weight="semibold" numberOfLines={1}>{name}</Txt>
            {kind ? <Txt variant="small" tone="tertiary">{kind}{to ? ' → ' + to : ''}</Txt> : null}
            <Txt variant="caption" tone="tertiary" numeric>{formatMessageTime(time)}</Txt>
          </View>
          {accessory ? <View style={{ flexDirection: 'row', marginTop: -6, marginRight: -6 }}>{accessory}</View> : null}
        </View>
        {status ? <Txt variant="caption" tone={attention ? 'attention' : 'tertiary'}>{status}</Txt> : null}
        {attention ? (
          <View style={{ marginTop: 4, padding: 12, gap: 8, borderRadius: metrics.radius.md, borderWidth: 1, borderColor: colors.stAttentionBorder, backgroundColor: colors.stAttentionBg }}>
            <Txt variant="small" weight="semibold" tone="attention">{$t('需要你回答')}</Txt>
            {children}
          </View>
        ) : <View style={{ gap: 6 }}>{children}</View>}
      </View>
    </View>
  );
}

/** Human message: right aligned, soft accent bubble (max 82%), header right aligned. */
export function HumanMessage({ name, kind, to, time, children, footer, testID }: { name: string; kind?: string; to?: string | null; time: string; children: ReactNode; footer?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID ? 'human:' + testID : undefined} accessibilityLabel={$t('你发送的消息')} style={{ alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, gap: 4 }}>
      <Txt variant="caption" tone="tertiary" numberOfLines={1}>
        {[kind, to ? '→ ' + to : null, formatMessageTime(time)].filter(Boolean).join(' · ')}{'  '}
        <Txt variant="caption" weight="semibold" tone="secondary">{name}</Txt>
      </Txt>
      <View style={{ maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.accentSoft, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 14, borderBottomRightRadius: 4 }}>
        {children}
      </View>
      {footer}
    </View>
  );
}
