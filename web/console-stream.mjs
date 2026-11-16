import { $t } from "../client/i18n.mjs";
// Console reception and reading position are independent: scrolling up never
// unsubscribes from new records. One reader follows async body/layout growth.
const readers = new WeakMap();
const nearBottom = stream => stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;

function anchorAt(stream) {
  const top = stream.getBoundingClientRect().top;
  const node = [...stream.querySelectorAll('[data-console-row]')].find(node => node.getBoundingClientRect().bottom > top);
  return node ? { node, offset: node.getBoundingClientRect().top - top } : null;
}

function reader(stream) {
  let state = readers.get(stream);
  if (state) return state;
  state = { following: true, restoring: false, frame: null, anchor: null, observed: new Set() };
  readers.set(stream, state);
  stream.addEventListener('scroll', () => {
    if (state.restoring) return;
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
  state.restoring = true;
  if (state.following) stream.scrollTop = stream.scrollHeight;
  else if (reading.anchor?.node.isConnected) {
    const offset = reading.anchor.node.getBoundingClientRect().top - stream.getBoundingClientRect().top;
    if (Math.abs(offset - reading.anchor.offset) > 0.5) stream.scrollTop += offset - reading.anchor.offset;
  } else stream.scrollTop = reading.top;
  state.anchor = anchorAt(stream);
  if (state.observer) {
    const nodes = new Set([stream, ...stream.querySelectorAll(':scope > .console-execution')]);
    for (const node of state.observed) if (!nodes.has(node)) state.observer.unobserve(node);
    for (const node of nodes) if (!state.observed.has(node)) state.observer.observe(node);
    state.observed = nodes;
  }
  const win = stream.ownerDocument.defaultView;
  if (state.frame !== null) win.cancelAnimationFrame(state.frame);
  state.frame = win.requestAnimationFrame(() => { state.restoring = false; state.frame = null; });
}

export function followConsoleLatest(stream) {
  restoreConsoleReading(stream, { following: true, top: 0 }, { latest: true });
}

export function onConsoleLatest(stream, callback) { reader(stream).onLatest = callback; }

// Existing authenticated endpoints page backwards. Walk only the bounded live
// window until it joins the known tail, so a burst/reconnect cannot leave a gap.
export async function readConsoleTail(current, fetchPage, limit = 200) {
  let page = await fetchPage(), result = page;
  const known = new Set(current.map(event => event.id));
  let events = page.events, traces = page.traces || [];
  const cursors = new Set();
  while (known.size && events.length && !events.some(event => known.has(event.id)) && page.hasMore && page.nextBefore && events.length < limit) {
    if (cursors.has(page.nextBefore)) throw new Error($t("控制台分页游标未推进，请刷新重试。"));
    cursors.add(page.nextBefore);
    page = await fetchPage(page.nextBefore);
    events = [...new Map([...page.events, ...events].map(event => [event.id, event])).values()];
    traces = [...new Map([...(page.traces || []), ...traces].map(trace => [trace.id, trace])).values()];
  }
  return { ...result, events, traces, hasMore: page.hasMore, nextBefore: page.nextBefore };
}
