// Run: npm test   (node --test with built-in TypeScript type stripping)
import assert from 'node:assert/strict';
import test from 'node:test';

import { fileTreeRows } from '../src/lib/file-tree.ts';

type Change = { path: string; status: string };
const changes: Change[] = [
  { path: 'web/login.css', status: 'M' },
  { path: 'tests/login.test.ts', status: 'A' },
  { path: 'web/icons/new.svg', status: 'A' },
  { path: 'README.md', status: 'M' },
];
const describe = (rows: ReturnType<typeof fileTreeRows<Change>>) =>
  rows.map((row) => '  '.repeat(row.depth) + (row.kind === 'directory' ? row.name + '/ (' + row.files + ')' : row.name));

test('flat change paths nest into folders, folders first, with file counts', () => {
  const rows = fileTreeRows(changes, (item) => item.path, (item) => item.path, new Set());
  console.log(describe(rows).join('\n'));
  assert.deepEqual(describe(rows), ['tests/ (1)', '  login.test.ts', 'web/ (2)', '  icons/ (1)', '    new.svg', '  login.css', 'README.md']);
});

test('a closed folder hides everything below it but keeps its count', () => {
  const rows = fileTreeRows(changes, (item) => item.path, (item) => item.path, new Set(['web']));
  console.log(describe(rows).join('\n'));
  assert.deepEqual(describe(rows), ['tests/ (1)', '  login.test.ts', 'web/ (2)', 'README.md']);
});

test('edge cases: no files, root-level files only, and two versions of one path stay distinct', () => {
  assert.deepEqual(fileTreeRows<Change>([], (item) => item.path, (item) => item.path, new Set()), []);
  const flat = fileTreeRows([{ path: 'b.md', status: 'M' }, { path: 'a.md', status: 'M' }], (item) => item.path, (item) => item.path, new Set());
  assert.deepEqual(flat.map((row) => row.kind + ':' + row.name), ['file:a.md', 'file:b.md']);
  const versions = fileTreeRows([{ id: 'v1', name: 'docs/r.md' }, { id: 'v2', name: 'docs/r.md' }], (item) => item.name, (item) => item.id, new Set());
  console.log('versions:', versions.map((row) => row.kind === 'file' ? row.key : row.path));
  assert.deepEqual(versions.map((row) => (row.kind === 'file' ? row.key : 'dir:' + row.path)), ['dir:docs', 'v1', 'v2']);
});
