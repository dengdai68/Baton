import test from 'node:test';
import assert from 'node:assert/strict';
import { readConsoleTail } from '../web/console-stream.mjs';
import { consoleEventWindow } from '../client/console-projections.mjs';

const rows = (start, end) => Array.from({ length: end - start }, (_, i) => ({ id: `event-${start + i}` }));
function pages(all, calls) {
  return async before => {
    calls.push(before);
    const end = before ? all.findIndex(row => row.id === before) : all.length;
    const start = Math.max(0, end - 50);
    return { events: all.slice(start, end), traces: [{ id: 'trace' }], hasMore: start > 0, nextBefore: start > 0 ? all[start].id : null };
  };
}
test('console catches up a burst through adjacent authenticated pages without dropping the known tail', async () => {
  const calls = [], current = rows(80, 120), result = await readConsoleTail(current, pages(rows(0, 240), calls));
  assert.equal(calls.length, 3);
  const merged = consoleEventWindow(current, result.events);
  assert.equal(merged.reset, false);
  assert.deepEqual(merged.events, rows(80, 240));
  assert.equal(result.traces.length, 1);
});
test('console tail reconciliation is bounded after a long sleep and keeps an honest older cursor', async () => {
  const calls = [], result = await readConsoleTail(rows(0, 50), pages(rows(0, 2000), calls));
  assert.equal(calls.length, 4);
  assert.deepEqual(result.events, rows(1800, 2000));
  assert.equal(result.hasMore, true); assert.equal(result.nextBefore, 'event-1800');
});
test('an overlapping or empty console tail costs one request', async () => {
  for (const all of [[], rows(0, 120)]) {
    const calls = []; await readConsoleTail(rows(90, 110), pages(all, calls)); assert.equal(calls.length, 1);
  }
});
test('a stuck cursor or failed console read surfaces the failure without mutating the old records', async () => {
  const current = rows(0, 50), before = structuredClone(current);
  await assert.rejects(readConsoleTail(current, async () => ({ events: rows(100, 110), hasMore: true, nextBefore: 'stuck' })), /游标未推进/);
  await assert.rejects(readConsoleTail(current, async () => { throw Error('offline'); }), /offline/);
  assert.deepEqual(current, before);
});
