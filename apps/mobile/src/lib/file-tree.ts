// Folder tree rows from flat file paths (task changes and delivery snapshots),
// pure so it can be unit-tested without React Native.

export type TreeRow<T> = { kind: 'directory'; path: string; name: string; depth: number; files: number } | { kind: 'file'; key: string; path: string; name: string; depth: number; item: T };

/** Nest flat paths into folders (folders first, then names), skipping closed folders. */
export function fileTreeRows<T>(items: T[], pathOf: (item: T) => string, keyOf: (item: T) => string, closed: Set<string>): TreeRow<T>[] {
  type Node = { name: string; path: string; directories: Map<string, Node>; files: Array<{ name: string; item: T }> };
  const root: Node = { name: '', path: '', directories: new Map(), files: [] };
  for (const item of items) {
    const parts = pathOf(item).split('/').filter(Boolean);
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? node.path + '/' + part : part;
      if (!node.directories.has(part)) node.directories.set(part, { name: part, path, directories: new Map(), files: [] });
      node = node.directories.get(part)!;
    }
    node.files.push({ name: parts.at(-1) || pathOf(item), item });
  }
  const count = (node: Node): number => node.files.length + [...node.directories.values()].reduce((sum, child) => sum + count(child), 0);
  const rows: TreeRow<T>[] = [];
  const visit = (node: Node, depth: number) => {
    for (const child of [...node.directories.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ kind: 'directory', path: child.path, name: child.name, depth, files: count(child) });
      if (!closed.has(child.path)) visit(child, depth + 1);
    }
    for (const file of [...node.files].sort((a, b) => a.name.localeCompare(b.name))) rows.push({ kind: 'file', key: keyOf(file.item), path: pathOf(file.item), name: file.name, depth, item: file.item });
  };
  visit(root, 0);
  return rows;
}
