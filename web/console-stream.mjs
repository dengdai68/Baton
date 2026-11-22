import { consoleEventWindow, retainsConsoleEvent } from "../client/console-projections.mjs";
import { $t } from "../client/i18n.mjs";
// Console reception and reading position are independent: scrolling up never
// unsubscribes from new records. One reader follows async body/layout growth.
const readers = new WeakMap();
const nearBottom = stream => stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;

function anchorAt(stream) {
  const top = stream.getBoundingClientRect().top;
  const node = [...stream.querySelectorAll('[data-console-row]')].find(node => node.getBoundingClientRect().bottom > top);
  return node ? { node, key: node.dataset.consoleRow, offset: node.getBoundingClientRect().top - top } : null;
}

function reader(stream) {
  let state = readers.get(stream);
  if (state) return state;
  state = { following: true, restoredTop: null, anchor: null, observed: new Set() };
  readers.set(stream, state);
  stream.addEventListener('scroll', () => {
    if (state.restoredTop !== null && Math.abs(state.restoredTop - stream.scrollTop) < 0.5) return;
    state.restoredTop = null;
    const wasFollowing = state.following;
    state.following = nearBottom(stream);
    state.anchor = anchorAt(stream);
    if (!wasFollowing && state.following) state.onLatest?.();
  }, { passive: true });
  stream.addEventListener('wheel', event => { if (event.deltaY < 0) state.following = false; }, { passive: true });
  stream.addEventListener('keydown', event => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) state.following = false;
    if (event.key === 'End') { state.onLatest?.(); followConsoleLatest(stream); }
  });
  if (typeof ResizeObserver !== 'undefined') state.observer = new ResizeObserver(() => {
    if (!stream.isConnected) { state.observer.disconnect(); return; }
    restoreConsoleReading(stream, { following: state.following, top: stream.scrollTop, anchor: state.anchor });
  });
  return state;
}

export function captureConsoleReading(stream) {
  const state = reader(stream), selection = stream.ownerDocument.getSelection?.();
  if (selection && !selection.isCollapsed && stream.contains(selection.anchorNode)) state.following = false;
  return { following: state.following, top: stream.scrollTop, anchor: anchorAt(stream) };
}

export function restoreConsoleReading(stream, reading, { latest = false, prepend = false } = {}) {
  const state = reader(stream);
  state.following = latest || (!prepend && reading.following);
  const anchor = reading.anchor?.node.isConnected ? reading.anchor.node
    : reading.anchor?.key && stream.querySelector(`[data-console-row="${CSS.escape(reading.anchor.key)}"]`);
  if (state.following) stream.scrollTop = stream.scrollHeight;
  else if (anchor) {
    const offset = anchor.getBoundingClientRect().top - stream.getBoundingClientRect().top;
    if (Math.abs(offset - reading.anchor.offset) > 0.5) stream.scrollTop += offset - reading.anchor.offset;
  } else stream.scrollTop = reading.top;
  state.anchor = anchorAt(stream);
  if (state.observer) {
    const nodes = new Set([stream, ...stream.querySelectorAll(':scope > .console-execution')]);
    for (const node of state.observed) if (!nodes.has(node)) state.observer.unobserve(node);
    for (const node of nodes) if (!state.observed.has(node)) state.observer.observe(node);
    state.observed = nodes;
  }
  state.restoredTop = stream.scrollTop;
}

export function followConsoleLatest(stream) {
  restoreConsoleReading(stream, { following: true, top: 0 }, { latest: true });
}

export function onConsoleLatest(stream, callback) { reader(stream).onLatest = callback; }

// before/headId refer to raw archive positions. Only displayable records and
// prompt boundaries consume the reading window. Polls can therefore rejoin a
// previous raw head even when every intervening record was hidden.
export async function readConsoleTail(current, fetchPage, { headId, before, isCurrent = () => true } = {}) {
  const known = headId ? new Set([headId]) : new Set(current.map(event => event.id));
  const cursors = new Set();
  const traces = new Map();
  let cursor = before, first, events = [], pageSize = 50, scanned = 0;
  while (isCurrent()) {
    if (cursors.has(cursor)) throw new Error($t("控制台分页游标未推进，请刷新重试。"));
    cursors.add(cursor);
    const page = await fetchPage(cursor, pageSize);
    first ??= page;
    scanned += page.events.length;
    const overlap = page.events.findIndex(event => known.has(event.id));
    const raw = headId && overlap >= 0 ? page.events.slice(overlap) : page.events;
    const retained = raw.filter(retainsConsoleEvent);
    events = [...retained, ...events];
    const traceIds = new Set(retained.map(event => event.data?.traceId));
    for (const trace of page.traces || []) {
      if ((page === first || traceIds.has(trace.id)) && !traces.has(trace.id)) traces.set(trace.id, trace);
    }
    // An explicit read returns up to one page of useful history. A live
    // reconciliation walks farther only to join the previous verified head.
    const limit = known.size ? 200 : 50;
    // Once a sparse archive yields useful rows, deliver them promptly instead
    // of walking an arbitrarily long history just to fill a 50-event page.
    const sparsePage = !known.size && scanned >= 200 && events.length > 0;
    if (!page.hasMore || overlap >= 0 || events.length >= limit || sparsePage) {
      const trimmed = events.length > limit;
      events = events.slice(-limit);
      return { ...first, events, traces: [...traces.values()], headId: first.events.at(-1)?.id,
        windowStart: (trimmed ? events[0] : page.events[0])?.timestamp, joined: overlap >= 0, hasMore: trimmed || page.hasMore, nextBefore: trimmed ? events[0].id : page.nextBefore };
    }
    if (!page.nextBefore) throw new Error($t("控制台分页游标未推进，请刷新重试。"));
    // Dense status streams are cheap to skip in larger archive batches.
    if (!retained.length) pageSize = 200;
    cursor = page.nextBefore;
  }
  return null;
}

// During history reading new rows can still append while the visible window
// has room. Once an append would evict history, receive into a separate tail.
function setLiveWindow(page, window, holdReading, boundary) {
  if (page.liveEvents || (holdReading && (window.trimmedBefore || window.reset))) {
    page.browsingHistory = true;
    page.liveEvents = window.events;
    return;
  }
  page.events = window.events;
  if (boundary) {
    page.hasMore = boundary.hasMore;
    page.nextBefore = boundary.nextBefore;
    page.windowStart = boundary.windowStart;
  }
  if (window.trimmedBefore) {
    page.hasMore = true;
    page.nextBefore = page.events[0].id;
    page.windowStart = page.events[0].timestamp;
  }
}

export function appendConsoleLive(page, arriving, holdReading) {
  if (!arriving.length) return;
  const window = consoleEventWindow(page.liveEvents || page.events, arriving, { joined: true });
  setLiveWindow(page, window, holdReading || page.browsingHistory);
}

export function applyConsoleRead(page, result, { older = false, latest = false, arriving = [], holdReading = false } = {}) {
  if (older) {
    const current = page.events;
    const window = consoleEventWindow(current, result.events, { older: true });
    if (current.length && window.events.at(-1)?.id !== current.at(-1).id) page.liveEvents ||= current;
    page.events = window.events;
    page.browsingHistory = true;
    page.windowStart = result.windowStart;
    page.nextBefore = result.nextBefore;
    page.hasMore = result.hasMore;
  } else {
    const live = page.liveEvents || page.events;
    const replace = latest || !page.headId || !result.joined;
    // The archive supplies ordering, including same-time events missed on SSE.
    // Concurrent SSE is appended separately after the archive snapshot.
    const incoming = new Set([...result.events, ...arriving].map(event => event.id));
    const prefix = replace ? [] : live.filter(event => !incoming.has(event.id));
    const window = consoleEventWindow(prefix, result.events, { joined: true });
    window.reset = replace && live.length > 0;
    if (latest) { page.liveEvents = null; page.browsingHistory = false; }
    setLiveWindow(page, window, !latest && (holdReading || page.browsingHistory), replace ? result : null);
    page.headId = result.headId;
  }
  appendConsoleLive(page, arriving, !latest && holdReading);
  const traceIds = new Set(page.events.map(event => event.data?.traceId));
  if (page.traceId) traceIds.add(page.traceId);
  page.traces = [...new Map([...(page.traces || []), ...(result.traces || [])].map(trace => [trace.id, trace])).values()].filter(trace => traceIds.has(trace.id));
  page.loaded = true;
}
