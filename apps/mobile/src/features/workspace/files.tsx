// Files of a task Run: working directory (drill-down like the Files app),
// Git changes and saved delivery snapshots as collapsible folder trees (as on the Mac); previews render Markdown, images
// and highlighted code (server highlight.js classes → Graphite syntax tokens).
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ChevronDown, ChevronRight, Code, Eye, FileText, Folder, FolderOpen, GitCompareArrows, Package, Share } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { formatExactTime, formatRelativeTime } from '@shared/console-projections.mjs';
import { useWorkspaceKey } from '@/api/queries';
import { $t } from '@/i18n';
import { formatBytes } from '@/lib/attachments';
import { fileTreeRows } from '@/lib/file-tree';
import { type Colors, monoFont, useTheme } from '@/theme';
import { IconButton } from '@/ui/icon-button';
import { Segmented } from '@/ui/form';
import { EmptyState, ErrorState, LoadingState } from '@/ui/states';
import { Markdown } from '@/ui/markdown';
import { Txt } from '@/ui/text';
import { useToast } from '@/ui/toast';
import { useClient } from '@/workspace/session';

type Entry = { name: string; path: string; type: 'file' | 'directory'; bytes?: number; modifiedAt?: string; mediaType?: string };
type Listing = { path: string; entries: Entry[]; nextOffset: number | null; workspacePath?: string };
type Artifact = { id: string; name: string; bytes?: number; createdAt?: string; ownerAgentId?: string; deleted?: boolean; mediaType?: string; version?: number };
type Repository = { path: string; label: string; initialized: boolean; changes: Array<{ path: string; status?: string; index?: string; workingTree?: string }> };

const encodePath = (path: string) => encodeURIComponent(path);

function Row({ icon, title, meta, onPress }: { icon: React.ReactNode; title: string; meta?: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle })}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt numberOfLines={1}>{title}</Txt>
        {meta ? <Txt variant="caption" tone="tertiary" numberOfLines={1}>{meta}</Txt> : null}
      </View>
      <ChevronRight size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

/** One folder of the working directory; folders push another level. */
export function DirectoryList({ taskId, runId, path, inset }: { taskId: string; runId: string; path: string; inset?: boolean }) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const { colors } = useTheme();
  const listing = useQuery({
    queryKey: [...scope, 'directory', runId, path],
    queryFn: () => client.get<Listing>(`/api/runs/${encodeURIComponent(runId)}/working-directory`, { path }),
  });
  if (listing.isPending) return <LoadingState label={$t('正在读取工作目录…')} />;
  if (listing.error) return <ErrorState message={listing.error.message} onRetry={() => void listing.refetch()} />;
  return (
    <FlatList
      contentInsetAdjustmentBehavior={inset ? 'automatic' : 'never'}
      data={listing.data.entries}
      keyExtractor={(entry) => entry.path}
      onRefresh={() => void listing.refetch()}
      refreshing={listing.isRefetching}
      renderItem={({ item }) => item.type === 'directory' ? (
        <Row icon={<Folder size={20} color={colors.accentText} strokeWidth={1.6} />} title={item.name}
          onPress={() => router.push({ pathname: '/task/browse', params: { taskId, runId, path: item.path } })} />
      ) : (
        <Row icon={<FileText size={20} color={colors.textTertiary} strokeWidth={1.6} />} title={item.name}
          meta={[formatBytes(item.bytes), item.modifiedAt ? formatRelativeTime(item.modifiedAt) : ''].filter(Boolean).join(' · ')}
          onPress={() => router.push({ pathname: '/task/file', params: { taskId, runId, path: item.path, source: 'working' } })} />
      )}
      ListEmptyComponent={<EmptyState icon={FolderOpen} title={$t('文件夹为空')} />}
    />
  );
}

/** Collapsible folder tree of files (Mac: changes and snapshots by directory); folders start open. */
function FileTree<T>({ items, pathOf, keyOf, fileIcon, meta, onOpen, empty }: {
  items: T[]; pathOf: (item: T) => string; keyOf: (item: T) => string; fileIcon: (item: T) => React.ReactNode;
  meta?: (item: T) => string; onOpen: (item: T) => void; empty: React.ReactElement;
}) {
  const { colors } = useTheme();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const rows = fileTreeRows(items, pathOf, keyOf, closed);
  const toggle = (path: string) => setClosed((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => (row.kind === 'directory' ? 'd:' + row.path : 'f:' + row.key)}
      renderItem={({ item: row }) => {
        const indent = 12 + row.depth * 18;
        if (row.kind === 'directory') {
          const open = !closed.has(row.path);
          const Chevron = open ? ChevronDown : ChevronRight;
          return (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={row.name} onPress={() => toggle(row.path)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: indent, paddingRight: 16, minHeight: 44, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas })}>
              <Chevron size={15} color={colors.textTertiary} />
              {open ? <FolderOpen size={18} color={colors.accentText} strokeWidth={1.6} /> : <Folder size={18} color={colors.accentText} strokeWidth={1.6} />}
              <Txt numberOfLines={1} style={{ flex: 1 }}>{row.name}</Txt>
              <Txt variant="caption" tone="tertiary" numeric>{row.files}</Txt>
            </Pressable>
          );
        }
        const detail = meta?.(row.item);
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={row.path} onPress={() => onOpen(row.item)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: indent + 21, paddingRight: 16, minHeight: detail ? 52 : 44, backgroundColor: pressed ? colors.bgHover : colors.bgCanvas })}>
            {fileIcon(row.item)}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt numberOfLines={1}>{row.name}</Txt>
              {detail ? <Txt variant="caption" tone="tertiary" numberOfLines={1}>{detail}</Txt> : null}
            </View>
          </Pressable>
        );
      }}
      ListEmptyComponent={empty}
    />
  );
}

/** Git change letter as a small tinted badge (A added, D deleted, R renamed, M/other modified). */
function ChangeBadge({ status }: { status: string }) {
  const { colors } = useTheme();
  const letter = (status.trim()[0] || 'M').toUpperCase();
  const color = letter === 'A' || letter === '?' ? colors.stDone : letter === 'D' ? colors.stFailed : letter === 'R' ? colors.stRunning : colors.stAttention;
  return <View style={{ width: 18, alignItems: 'center' }}><Txt variant="caption" weight="semibold" mono color={color}>{letter === '?' ? 'U' : letter}</Txt></View>;
}

function Changes({ taskId, runId }: { taskId: string; runId: string }) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const { colors } = useTheme();
  const changes = useQuery({
    queryKey: [...scope, 'changes', runId],
    queryFn: () => client.get<{ repositories: Repository[] }>(`/api/runs/${encodeURIComponent(runId)}/working-directory/changes`),
  });
  if (changes.isPending) return <LoadingState />;
  if (changes.error) return <ErrorState message={changes.error.message} onRetry={() => void changes.refetch()} />;
  const rows = changes.data.repositories.flatMap((repo) => repo.changes.map((change) => ({ repo, change })));
  const uninitialized = changes.data.repositories.every((repo) => !repo.initialized);
  const statusOf = (row: (typeof rows)[number]) => row.change.status || row.change.workingTree || row.change.index || 'M';
  return (
    <FileTree items={rows} pathOf={(row) => row.change.path} keyOf={(row) => row.repo.path + ':' + row.change.path}
      fileIcon={(row) => <ChangeBadge status={statusOf(row)} />}
      meta={changes.data.repositories.length > 1 ? (row) => row.repo.label : undefined}
      onOpen={(row) => router.push({ pathname: '/task/file', params: { taskId, runId, path: row.change.path, repo: row.repo.path, source: 'diff' } })}
      empty={<EmptyState icon={GitCompareArrows} title={uninitialized ? $t('工作目录尚未初始化 Git') : $t('没有未提交的变更')} description={uninitialized ? $t('员工在工作目录初始化 Git 后，可在这里查看累计变更与差异。') : undefined} />} />
  );
}

function Snapshots({ taskId, runId }: { taskId: string; runId: string }) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const { colors } = useTheme();
  const artifacts = useQuery({
    queryKey: [...scope, 'artifacts', runId],
    queryFn: () => client.get<{ items: Artifact[] }>(`/api/runs/${encodeURIComponent(runId)}/artifacts`, { limit: 100 }),
  });
  if (artifacts.isPending) return <LoadingState />;
  if (artifacts.error) return <ErrorState message={artifacts.error.message} onRetry={() => void artifacts.refetch()} />;
  return (
    <FileTree items={artifacts.data.items.filter((item) => item.name)} pathOf={(item) => item.name} keyOf={(item) => item.id}
      fileIcon={(item) => <Package size={18} color={item.deleted ? colors.textTertiary : colors.stDone} strokeWidth={1.6} />}
      meta={(item) => [item.version ? 'v' + item.version : '', formatBytes(item.bytes), item.createdAt ? formatExactTime(item.createdAt) : '', item.deleted ? $t('已删除') : ''].filter(Boolean).join(' · ')}
      onOpen={(item) => router.push({ pathname: '/task/file', params: { taskId, runId, path: item.name, artifactId: item.id, source: 'artifact' } })}
      empty={<EmptyState icon={Package} title={$t('暂无交付快照')} description={$t('员工交接时保存的文件快照会出现在这里。')} />} />
  );
}

export function FilesPanel({ taskId, runId, artifactCount }: { taskId: string; runId: string; artifactCount?: number }) {
  const [view, setView] = useState<'directory' | 'changes' | 'snapshots'>('directory');
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, paddingBottom: 8 }}>
        <Segmented value={view} onChange={setView} options={[
          { value: 'directory', label: $t('工作目录') },
          { value: 'changes', label: $t('变更') },
          { value: 'snapshots', label: $t('交付快照'), count: artifactCount },
        ]} />
      </View>
      {view === 'directory' ? <DirectoryList taskId={taskId} runId={runId} path="" /> : view === 'changes' ? <Changes taskId={taskId} runId={runId} /> : <Snapshots taskId={taskId} runId={runId} />}
    </View>
  );
}

// highlight.js class → Graphite syntax token.
function syntaxColor(colors: Colors, classes: string[]): { color?: string; italic?: boolean } {
  const has = (...names: string[]) => classes.some((name) => names.includes(name.replace(/^hljs-/, '')));
  if (has('comment', 'quote', 'meta')) return { color: colors.textTertiary, italic: true };
  if (has('keyword', 'selector-tag', 'built_in', 'literal', 'type', 'doctag')) return { color: colors.synKeyword };
  if (has('string', 'regexp', 'addition', 'template-string')) return { color: colors.synString };
  if (has('title', 'function', 'section', 'name', 'selector-id', 'selector-class')) return { color: colors.synFunc };
  if (has('number', 'symbol', 'bullet', 'link')) return { color: colors.synNumber };
  if (has('attr', 'attribute', 'variable', 'template-variable', 'params', 'property')) return { color: colors.accentText };
  if (has('deletion')) return { color: colors.codeDelText };
  return {};
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' };
/** Parse highlight.js output (escaped text and nested spans only) into styled segments. */
export function highlightSegments(html: string): Array<{ text: string; classes: string[] }> {
  const segments: Array<{ text: string; classes: string[] }> = [];
  const stack: string[][] = [[]];
  const pattern = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    if (match[1] !== undefined) stack.push([...stack[stack.length - 1], ...match[1].split(/\s+/)]);
    else if (match[0] === '</span>') { if (stack.length > 1) stack.pop(); }
    else segments.push({ text: match[2].replace(/&(#?\w+);/g, (all, name) => entities[name] ?? all), classes: stack[stack.length - 1] });
  }
  return segments;
}

export function CodeView({ html, text }: { html?: string | null; text: string }) {
  const { colors } = useTheme();
  const segments = html ? highlightSegments(html) : [{ text, classes: [] }];
  return (
    <ScrollView horizontal style={{ backgroundColor: colors.codeBg }} contentContainerStyle={{ padding: 14 }}>
      <Text selectable style={{ fontFamily: monoFont, fontSize: 13, lineHeight: 20, color: colors.text }}>
        {segments.map((segment, index) => {
          const style = syntaxColor(colors, segment.classes);
          return <Text key={index} style={{ color: style.color, fontStyle: style.italic ? 'italic' : 'normal' }}>{segment.text}</Text>;
        })}
      </Text>
    </ScrollView>
  );
}

type Preview = { path?: string; name?: string; bytes?: number; modifiedAt?: string; mediaType?: string; image?: boolean; binary?: boolean; content?: string; language?: string; highlightedHtml?: string; truncated?: boolean };
type DiffLine = { type?: string; kind?: string; content?: string; text?: string; line?: string };

/** Preview of a working file, a saved snapshot, or a Git diff. */
export function FilePreview({ runId, path, source, artifactId, repo }: { runId: string; path: string; source: 'working' | 'artifact' | 'diff'; artifactId?: string; repo?: string }) {
  const client = useClient();
  const scope = useWorkspaceKey();
  const toast = useToast();
  const { colors } = useTheme();
  const [rendered, setRendered] = useState(true);
  const [sharing, setSharing] = useState(false);
  const base = `/api/runs/${encodeURIComponent(runId)}`;
  const previewPath = source === 'artifact' ? `${base}/artifacts/${encodeURIComponent(artifactId || '')}/content`
    : source === 'diff' ? `${base}/working-directory/diff?path=${encodePath(path)}${repo ? '&repo=' + encodePath(repo) : ''}`
      : `${base}/working-directory/content?path=${encodePath(path)}`;
  const rawPath = source === 'artifact' ? `${base}/artifacts/${encodeURIComponent(artifactId || '')}/raw` : `${base}/working-directory/content?path=${encodePath(path)}&raw=1`;
  const preview = useQuery({ queryKey: [...scope, 'preview', previewPath], queryFn: () => client.get<any>(previewPath) });
  const name = path.split('/').pop() || path;
  const image = Boolean(preview.data?.image) || /^image\//.test(preview.data?.mediaType || '');
  const imageFile = useQuery({
    queryKey: [...scope, 'raw', rawPath],
    queryFn: () => client.file(rawPath, { fileName: name }),
    enabled: image && source !== 'diff',
  });

  async function share() {
    setSharing(true);
    try {
      const uri = await client.file(source === 'artifact' ? rawPath : `${base}/working-directory/content?path=${encodePath(path)}&download=1`, { fileName: name });
      await Sharing.shareAsync(uri, { dialogTitle: name });
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setSharing(false);
    }
  }

  if (preview.isPending) return <LoadingState screen label={$t('正在读取文件…')} />;
  if (preview.error) return <ErrorState message={preview.error.message} onRetry={() => void preview.refetch()} />;
  const data = preview.data as Preview & { lines?: DiffLine[]; hunks?: Array<{ header?: string; lines?: DiffLine[] }>; diff?: string; patch?: string };
  const markdown = /\.(md|markdown)$/i.test(name) && typeof data.content === 'string';
  const toolbar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
      <Txt variant="small" tone="tertiary" style={{ flex: 1 }} numberOfLines={1}>{[formatBytes(data.bytes), data.language, data.modifiedAt ? formatExactTime(data.modifiedAt) : ''].filter(Boolean).join(' · ')}</Txt>
      {markdown ? <IconButton icon={rendered ? Code : Eye} label={rendered ? $t('源码') : $t('预览')} tone="neutral" size={32} onPress={() => setRendered(!rendered)} /> : null}
      {source !== 'diff' ? <IconButton icon={Share} label={$t('分享')} size={32} loading={sharing} onPress={() => void share()} /> : null}
    </View>
  );
  if (source === 'diff') {
    const text = typeof data.diff === 'string' ? data.diff : typeof data.patch === 'string' ? data.patch
      : (data.hunks || [{ lines: data.lines }]).flatMap((hunk) => [hunk.header, ...(hunk.lines || []).map((line) => (line.type === 'add' || line.kind === 'add' ? '+' : line.type === 'del' || line.kind === 'delete' || line.type === 'delete' ? '-' : ' ') + (line.content ?? line.text ?? line.line ?? ''))]).filter((line) => line !== undefined).join('\n');
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <ScrollView horizontal contentContainerStyle={{ padding: 12 }}>
          <View>
            {text.split('\n').map((line, index) => (
              <Text key={index} selectable style={{ fontFamily: monoFont, fontSize: 12.5, lineHeight: 20, paddingHorizontal: 4, color: line.startsWith('+') ? colors.codeAddText : line.startsWith('-') ? colors.codeDelText : colors.text, backgroundColor: line.startsWith('+') ? colors.codeAdd : line.startsWith('-') ? colors.codeDel : 'transparent' }}>{line || ' '}</Text>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    );
  }
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 40 }}>
      {toolbar}
      {image ? (
        imageFile.data ? <Image source={{ uri: imageFile.data }} style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" /> : imageFile.error ? <ErrorState message={imageFile.error.message} /> : <LoadingState />
      ) : data.binary ? (
        <EmptyState icon={FileText} title={$t('二进制文件')} description={$t('无法预览此文件，可通过「分享」下载后打开。')} />
      ) : markdown && rendered ? (
        <View style={{ padding: 16 }}><Markdown content={data.content || ''} /></View>
      ) : (
        <CodeView html={data.highlightedHtml} text={data.content || ''} />
      )}
      {data.truncated ? <Txt variant="caption" tone="tertiary" style={{ padding: 16 }}>{$t('内容较长，已截断显示；完整文件请通过「分享」下载。')}</Txt> : null}
    </ScrollView>
  );
}
