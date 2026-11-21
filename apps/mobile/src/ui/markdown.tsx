// Safe Markdown for collaboration, chat and file previews. Parsed with marked
// (the Mac client's parser) and rendered to native views: raw HTML is shown as
// text, only http(s)/mailto links open, @mentions of known members are tinted.
import { type Token, type Tokens, lexer } from 'marked';
import { type ReactNode, useMemo } from 'react';
import { Linking, ScrollView, Text, type TextStyle, View } from 'react-native';

import { useTheme } from '@/theme';

type Props = { content: string; mentions?: string[]; size?: 'read' | 'body' | 'small'; tone?: string };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decodeEntities = (value: string) =>
  value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name as 'amp']);

export function Markdown({ content, mentions = [], size = 'read', tone }: Props) {
  const theme = useTheme();
  const { colors, type } = theme;
  const tokens = useMemo(() => {
    try {
      return lexer(content || '', { gfm: true, breaks: true });
    } catch {
      return [{ type: 'paragraph', raw: content, text: content, tokens: [{ type: 'text', raw: content, text: content }] }] as Token[];
    }
  }, [content]);
  const mentionPattern = useMemo(() => {
    const names = [...new Set(mentions.filter(Boolean))].sort((a, b) => b.length - a.length);
    return names.length ? new RegExp('(@(?:' + names.map(escapeRegExp).join('|') + '))', 'g') : null;
  }, [mentions]);

  const step = type[size];
  const baseText: TextStyle = { color: tone || colors.text, fontSize: step.size, lineHeight: step.line };
  const codeText: TextStyle = { fontFamily: 'Menlo', fontSize: step.size - 2, color: colors.text, backgroundColor: colors.codeBg };

  function textWithMentions(value: string, key: string): ReactNode {
    const text = decodeEntities(value);
    if (!mentionPattern) return text;
    return text.split(mentionPattern).map((part, index) =>
      index % 2 ? (
        <Text key={key + ':' + index} style={{ color: colors.accentText, backgroundColor: colors.accentSoft, fontWeight: '500' }}>{part}</Text>
      ) : (
        part
      ),
    );
  }

  function inline(list: Token[] = [], key: string): ReactNode[] {
    return list.map((token, index) => {
      const id = key + '.' + index;
      switch (token.type) {
        case 'strong':
          return <Text key={id} style={{ fontWeight: '600' }}>{inline((token as Tokens.Strong).tokens, id)}</Text>;
        case 'em':
          return <Text key={id} style={{ fontStyle: 'italic' }}>{inline((token as Tokens.Em).tokens, id)}</Text>;
        case 'del':
          return <Text key={id} style={{ textDecorationLine: 'line-through' }}>{inline((token as Tokens.Del).tokens, id)}</Text>;
        case 'codespan':
          return <Text key={id} style={codeText}>{' ' + decodeEntities((token as Tokens.Codespan).text) + ' '}</Text>;
        case 'br':
          return '\n';
        case 'link': {
          const link = token as Tokens.Link;
          const safe = /^(https?:|mailto:)/i.test(link.href);
          return (
            <Text
              key={id}
              accessibilityRole={safe ? 'link' : undefined}
              style={{ color: colors.textLink, textDecorationLine: safe ? 'underline' : 'none' }}
              onPress={safe ? () => void Linking.openURL(link.href) : undefined}
            >
              {inline(link.tokens, id)}
            </Text>
          );
        }
        case 'image': {
          const image = token as Tokens.Image;
          return <Text key={id} style={{ color: colors.textLink }}>{'[' + (image.text || image.href) + ']'}</Text>;
        }
        case 'text': {
          const text = token as Tokens.Text;
          return text.tokens?.length ? <Text key={id}>{inline(text.tokens, id)}</Text> : <Text key={id}>{textWithMentions(text.text, id)}</Text>;
        }
        case 'escape':
          return (token as Tokens.Escape).text;
        default:
          return <Text key={id}>{textWithMentions((token as { raw?: string }).raw || '', id)}</Text>;
      }
    });
  }

  function block(token: Token, key: string, depth = 0): ReactNode {
    switch (token.type) {
      case 'space':
        return null;
      case 'paragraph':
        return <Text key={key} selectable style={baseText}>{inline((token as Tokens.Paragraph).tokens, key)}</Text>;
      case 'text': {
        const text = token as Tokens.Text;
        return <Text key={key} selectable style={baseText}>{text.tokens ? inline(text.tokens, key) : textWithMentions(text.text, key)}</Text>;
      }
      case 'heading': {
        const heading = token as Tokens.Heading;
        const sizeFor = [0, 21, 19, 17, 16, 15, 15][heading.depth] || 15;
        return (
          <Text key={key} selectable accessibilityRole="header" style={[baseText, { fontSize: sizeFor, lineHeight: sizeFor + 7, fontWeight: '600', marginTop: 4 }]}>
            {inline(heading.tokens, key)}
          </Text>
        );
      }
      case 'code': {
        const code = token as Tokens.Code;
        return (
          <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false} style={{ borderRadius: 6, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.codeBg }} contentContainerStyle={{ padding: 10 }}>
            <Text selectable style={{ fontFamily: 'Menlo', fontSize: 13, lineHeight: 19, color: colors.text }}>{code.text}</Text>
          </ScrollView>
        );
      }
      case 'blockquote':
        return (
          <View key={key} style={{ borderLeftWidth: 3, borderLeftColor: colors.borderStrong, paddingLeft: 10, gap: 6 }}>
            {(token as Tokens.Blockquote).tokens.map((child, index) => block(child, key + '.' + index, depth))}
          </View>
        );
      case 'list': {
        const list = token as Tokens.List;
        const start = typeof list.start === 'number' ? list.start : 1;
        return (
          <View key={key} style={{ gap: 4, paddingLeft: depth ? 14 : 2 }}>
            {list.items.map((item, index) => (
              <View key={key + '.' + index} style={{ flexDirection: 'row', gap: 6 }}>
                <Text style={[baseText, { color: colors.textSecondary, minWidth: list.ordered ? 20 : 12 }]}>
                  {item.task ? (item.checked ? '☑' : '☐') : list.ordered ? start + index + '.' : '•'}
                </Text>
                <View style={{ flex: 1, gap: 4 }}>{item.tokens.map((child, childIndex) => block(child, key + '.' + index + '.' + childIndex, depth + 1))}</View>
              </View>
            ))}
          </View>
        );
      }
      case 'hr':
        return <View key={key} style={{ height: 1, backgroundColor: colors.borderSubtle, marginVertical: 4 }} />;
      case 'table': {
        const table = token as Tokens.Table;
        const cell = (content: Tokens.TableCell, id: string, header = false) => (
          <View key={id} style={{ minWidth: 96, maxWidth: 240, padding: 8, borderRightWidth: 1, borderColor: colors.borderSubtle }}>
            <Text selectable style={[baseText, { fontSize: step.size - 1, fontWeight: header ? '600' : '400' }]}>{inline(content.tokens, id)}</Text>
          </View>
        );
        return (
          <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6 }}>
            <View>
              <View style={{ flexDirection: 'row', backgroundColor: colors.bgSubtle }}>{table.header.map((head, index) => cell(head, key + '.h' + index, true))}</View>
              {table.rows.map((row, rowIndex) => (
                <View key={key + '.r' + rowIndex} style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.borderSubtle }}>
                  {row.map((value, index) => cell(value, key + '.r' + rowIndex + '.' + index))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      }
      case 'html':
        return <Text key={key} selectable style={[baseText, { color: colors.textSecondary }]}>{(token as Tokens.HTML).text}</Text>;
      default:
        return <Text key={key} selectable style={baseText}>{(token as { raw?: string }).raw || ''}</Text>;
    }
  }

  return <View style={{ gap: 8 }}>{tokens.map((token, index) => block(token, 'b' + index))}</View>;
}
