import test from 'node:test';
import assert from 'node:assert/strict';
import { readConsoleTail, applyConsoleRead, appendConsoleLive } from '../web/console-stream.mjs';
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

const noise = (from, to) => rows(from, to).map(event => ({
  ...event, type: 'runtime.event', message: 'Provider 执行状态',
  data: { auditVersion: 2, presentation: 'system', providerEventType: 'message_update' }
}));

test('hidden archive heads allow sparse initial, older and live reads without losing visible rows', async () => {
  const all = [...rows(0, 51), ...noise(51, 401)], page = { events: [] };
  const fetch = pages(all, []);
  applyConsoleRead(page, await readConsoleTail([], fetch));
  assert.deepEqual(page.events, rows(1, 51));
  assert.equal(page.headId, 'event-400');
  applyConsoleRead(page, await readConsoleTail([], fetch, { before: page.nextBefore }), { older: true });
  assert.deepEqual(page.events, rows(0, 51));
  all.push(...noise(401, 661), ...rows(661, 663));
  applyConsoleRead(page, await readConsoleTail(page.events, fetch, { headId: page.headId }));
  assert.deepEqual(page.events, [...rows(0, 51), ...rows(661, 663)]);
  assert.equal(page.hasMore, false);
  const calls = [];
  await readConsoleTail(page.events, pages(all, calls), { headId: page.headId });
  assert.equal(calls.length, 1);
});

test('archived order wins over out-of-order or duplicated SSE, even with identical timestamps', async () => {
  const page = { events: [] }, all = rows(0, 8);
  applyConsoleRead(page, await readConsoleTail([], pages(all.slice(0, 2), [])));
  appendConsoleLive(page, [all[4], all[3]], false);
  const batch = await readConsoleTail(page.events, pages(all.slice(0, 6), []), { headId: page.headId });
  applyConsoleRead(page, batch, { arriving: [all[4], all[6], all[6], all[7]] });
  assert.deepEqual(page.events, all);
});

test('upward reading survives a disconnected burst and latest restores the real older cursor', async () => {
  const page = { events: [] }, all = rows(0, 700);
  applyConsoleRead(page, await readConsoleTail([], pages(all.slice(0, 60), [])));
  const shown = page.events, cursor = page.nextBefore;
  applyConsoleRead(page, await readConsoleTail(shown, pages(all, []), { headId: page.headId }), { holdReading: true });
  assert.deepEqual(page.liveEvents, rows(500, 700));
  assert.equal(page.events, shown);
  assert.equal(page.nextBefore, cursor);
  applyConsoleRead(page, await readConsoleTail([], pages(all, [])), { latest: true });
  assert.deepEqual(page.events, rows(650, 700));
  assert.equal(page.nextBefore, 'event-650');
  assert.equal(page.liveEvents, null);
});

test('all-hidden reads prove exhaustion and cancelled scans stop requesting history', async () => {
  const all = noise(0, 251);
  const page = await readConsoleTail([], pages(all, []));
  assert.equal(page.hasMore, false);
  assert.deepEqual(page.events, []);
  const calls = [];
  assert.equal(await readConsoleTail([], pages(all, calls), { isCurrent: () => calls.length === 0 }), null);
  assert.equal(calls.length, 1);
});
