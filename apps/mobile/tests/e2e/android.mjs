// Android counterpart of BatonE2ETests.swift: runs the same step JSON against the installed
// app on a USB device or emulator through adb (uiautomator dumps, input events, screencap).
// Entry: node tests/e2e/run.mjs <steps.json> <out-dir> android[:serial]
// Elements match on content-desc (accessibilityLabel), text or resource-id, with the same
// query rules as iOS: "a|b" alternatives, "^" prefix, "~" contains, otherwise exact or prefix.
// Typing goes through `adb shell input text`, which only carries ASCII.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = 'com.dengdai68.baton.mobile';
const ACTIVITY = PACKAGE + '/.MainActivity';
const DUMP_PATH = '/sdcard/baton-e2e-window.xml';
const DEFAULT_TIMEOUT_S = 10;
const POLL_MS = 400;
const LONG_PRESS_MS = 1000;
const SYSTEM_ALLOW = ['允许', '仅在使用该应用时允许', '仅限这一次', 'Allow', 'While using the app', 'Only this time', '允許'];
const stamp = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class StepError extends Error {}

const LOCKSCREEN_TITLES = ['滑动解锁', 'Swipe', '指纹', 'Fingerprint', '输入密码', 'Enter password', '输入 PIN', 'Enter PIN'];

/** adb from ANDROID_HOME (or the default SDK location), falling back to PATH. */
function adbPath() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Library/Android/sdk');
  const candidate = join(sdk, 'platform-tools/adb');
  return spawnSync(candidate, ['version']).status === 0 ? candidate : 'adb';
}

const decode = (value) => value.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Flatten a uiautomator dump into nodes with label, text, id and center point. `actionable`
 * marks nodes that are clickable or inside a clickable ancestor (a button's label text).
 */
export function parseNodes(xml) {
  const nodes = [];
  const ancestors = [];
  for (const match of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (match[0] === '</node>') { ancestors.pop(); continue; }
    const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
    const clickable = attributes.clickable === 'true';
    const actionable = clickable || ancestors.some(Boolean);
    if (!match[2]) ancestors.push(clickable);
    const bounds = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attributes.bounds || '');
    if (!bounds) continue;
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
    if (x2 <= x1 || y2 <= y1) continue;
    nodes.push({
      label: attributes['content-desc'] || '', text: attributes.text || '', id: (attributes['resource-id'] || '').replace(/^.*:id\//, ''),
      className: attributes.class || '', clickable, actionable, packageName: attributes.package || '',
      x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2),
    });
  }
  return nodes;
}

/** iOS-compatible query: alternatives split by "|" (or ","), "^" prefix, "~" contains. */
export function matcher(query, { exactOnly = false } = {}) {
  const alternatives = (query.includes('|') ? query.split('|') : query.split(',')).map((value) => value.trim()).filter(Boolean);
  return (node) => alternatives.some((value) => [node.label, node.text, node.id].some((field) => {
    if (!field) return false;
    if (value.startsWith('^')) return field.startsWith(value.slice(1));
    if (value.startsWith('~')) return field.includes(value.slice(1));
    if (exactOnly) return field === value;
    return field === value || field.startsWith(value);
  }));
}

/** Text for `adb shell input text`: spaces become %s, shell metacharacters are escaped. */
export function inputText(value) {
  if (/[^\x20-\x7e]/.test(value)) throw new StepError('Android input supports ASCII only: ' + JSON.stringify(value));
  return value.replace(/[\\'"`$&|;<>()*?~!#[\]{}]/g, (char) => '\\' + char).replace(/ /g, '%s');
}

export async function runAndroid(stepsPath, out, serial) {
  const adb = adbPath();
  const base = serial ? ['-s', serial] : [];
  const run = (args, options = {}) => {
    const result = spawnSync(adb, [...base, ...args], { encoding: options.binary ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0 && !options.allowFailure) throw new StepError(`adb ${args.join(' ')} failed: ${String(result.stderr || result.stdout).trim().slice(0, 300)}`);
    return result.stdout;
  };
  const device = run(['get-state'], { allowFailure: true }).trim();
  if (device !== 'device') { console.error('No authorized Android device (adb get-state: ' + (device || 'none') + ').'); return 2; }
  const [width, height] = (/(\d+)x(\d+)/.exec(run(['shell', 'wm', 'size'])) || []).slice(1).map(Number);
  // Composition IMEs (e.g. Chinese AI keyboards) swallow injected text: switch to a Latin IME
  // for the run and restore the user's choice afterwards.
  const LATIN_IME = process.env.BATON_E2E_IME || 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME';
  const originalIme = run(['shell', 'settings', 'get', 'secure', 'default_input_method'], { allowFailure: true }).trim();
  if (originalIme !== LATIN_IME && run(['shell', 'ime', 'list', '-s'], { allowFailure: true }).includes(LATIN_IME)) {
    run(['shell', 'ime', 'set', LATIN_IME], { allowFailure: true });
    process.on('exit', () => spawnSync(adb, [...base, 'shell', 'settings', 'put', 'secure', 'default_input_method', originalIme]));
  }
  // The handset locks within seconds of touch inactivity; uiautomator polling does not count
  // as activity. Stay awake while USB-connected for the run, and restore the setting on exit.
  const originalStayon = run(['shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'], { allowFailure: true }).trim();
  run(['shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '7'], { allowFailure: true });
  process.on('exit', () => spawnSync(adb, [...base, 'shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', originalStayon || '0']));

  async function dump() {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const output = run(['shell', 'uiautomator', 'dump', DUMP_PATH], { allowFailure: true });
      if (/dumped to/i.test(output)) return run(['exec-out', 'cat', DUMP_PATH]);
      await sleep(POLL_MS * attempt);
    }
    throw new StepError('uiautomator dump failed (UI never idle)');
  }
  async function find(query, { index = 0, timeout = DEFAULT_TIMEOUT_S, prefer } = {}) {
    const deadline = Date.now() + timeout * 1000;
    const match = matcher(query);
    do {
      const nodes = parseNodes(await dump()).filter(match);
      // Every match ranks by: preferred predicate first, actionable nodes before plain text.
      const rank = (node) => (prefer?.(node) ? 0 : 1) + (node.actionable ? 0 : 2);
      const ranked = nodes.slice().sort((a, b) => rank(a) - rank(b));
      if (ranked[index]) return ranked[index];
      await sleep(POLL_MS);
    } while (Date.now() < deadline);
    return null;
  }
  const tapAt = (x, y) => run(['shell', 'input', 'tap', String(x), String(y)]);
  const shot = (name) => writeFileSync(join(out, name + '.png'), run(['exec-out', 'screencap', '-p'], { binary: true }));
  const swipe = (fromX, fromY, toX, toY, ms = 300) => run(['shell', 'input', 'swipe', ...[fromX, fromY, toX, toY].map((value) => String(Math.round(value))), String(ms)]);

  /** Turn the screen on and dismiss the keyguard before interacting. */
  function ensureInteractive() {
    run(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
    const dreaming = /mDreamingLockscreen=true/.test(run(['shell', 'dumpsys', 'window'], { allowFailure: true }));
    if (dreaming) {
      run(['shell', 'input', 'keyevent', 'KEYCODE_MENU']);
      sleepSync(1500);
      if (/mDreamingLockscreen=true/.test(run(['shell', 'dumpsys', 'window'], { allowFailure: true }))) {
        run(['shell', 'input', 'swipe', String(Math.round(width * 0.5)), String(Math.round(height * 0.85)), String(Math.round(width * 0.5)), String(Math.round(height * 0.2)), '400']);
        sleepSync(1500);
      }
      // A swipe-up lands on the keyguard; if it is still up, swipe the lock icon itself.
      if (/mDreamingLockscreen=true/.test(run(['shell', 'dumpsys', 'window'], { allowFailure: true }))) {
        const unlock = parseNodes(run(['exec-out', 'cat', DUMP_PATH])).find((node) =>
          LOCKSCREEN_TITLES.some((title) => node.label.includes(title) || node.text.includes(title)));
        if (unlock) {
          swipe(unlock.x, unlock.y, unlock.x, Math.max(0, unlock.y - Math.round(height * 0.6)), 400);
          sleepSync(1500);
        }
      }
      if (/mDreamingLockscreen=true/.test(run(['shell', 'dumpsys', 'window'], { allowFailure: true }))) {
        throw new StepError('无法解锁手机屏幕：请先手动解锁或关闭锁屏密码');
      }
    }
  }
  function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
  async function step(item) {
    const timeout = item.timeout ?? DEFAULT_TIMEOUT_S;
    const value = item.value ?? '';
    switch (item.action) {
      case 'launch':
        run(['shell', 'am', 'force-stop', PACKAGE]);
        ensureInteractive();
        run(['shell', 'am', 'start', '-W', '-n', ACTIVITY]);
        return;
      case 'activate':
        ensureInteractive();
        run(['shell', 'am', 'start', '-W', '-n', ACTIVITY]);
        return;
      case 'terminate':
        run(['shell', 'am', 'force-stop', PACKAGE]);
        return;
      case 'open':
        if (!value) throw new StepError('open needs a URL');
        run(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', "'" + value.replace(/'/g, "'\\''") + "'", PACKAGE]);
        return;
      case 'alert': {
        const button = await find(item.value || SYSTEM_ALLOW.join('|'), { timeout: Math.min(timeout, 3), prefer: (node) => node.actionable });
        if (button) tapAt(button.x, button.y);
        else if (!item.optional) throw new StepError('no system dialog button ' + (item.value || ''));
        return;
      }
      case 'tap':
      case 'tab':
      case 'sheet': {
        // Rank: exact label on an actionable node wins (heading texts share words with buttons);
        // fall back to the first actionable, then any match, like the iOS driver's button-first rule.
        const exact = matcher(value, { exactOnly: true });
        const target = await find(value, {
          index: item.index ?? 0, timeout,
          prefer: (node) => exact(node) && node.actionable,
        });
        if (!target) throw new StepError('not found: ' + value);
        tapAt(target.x, target.y);
        return;
      }
      case 'longPress': {
        const target = await find(value, { index: item.index ?? 0, timeout });
        if (!target) throw new StepError('not found: ' + value);
        swipe(target.x, target.y, target.x, target.y, LONG_PRESS_MS);
        return;
      }
      case 'back':
        run(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
        return;
      case 'hideKeyboard': {
        // Android only: Back closes a shown keyboard; when none is shown Back would navigate
        // (on the root screen it even finishes the activity), so verify ours survives.
        const keyboardShown = () => /mInputShown=true|isInputViewShown=true/.test(run(['shell', 'dumpsys', 'input_method'], { allowFailure: true }));
        if (!keyboardShown()) return;
        run(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
        await sleep(400);
        const resumed = run(['shell', 'dumpsys', 'activity', 'activities'], { allowFailure: true });
        if (!resumed.includes(PACKAGE)) throw new StepError('hideKeyboard 发送返回键时键盘已收起，应用已被退出');
        return;
      }
      case 'set':
      case 'type': {
        const field = await find(item.into ?? '', { index: item.index ?? 0, timeout, prefer: (node) => node.className.endsWith('EditText') });
        if (!field) throw new StepError('field not found: ' + (item.into ?? ''));
        tapAt(field.x, field.y);
        await sleep(500);
        // set replaces the content (select all, delete); type appends like XCUITest typeText.
        if (item.action === 'set') { run(['shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A']); run(['shell', 'input', 'keyevent', 'KEYCODE_DEL']); }
        // Gboard's Chinese composition drops everything after an adb-injected %s space, so
        // type word by word with real KEYCODE_SPACE between. Then verify the text actually
        // reached the field's accessibility node: composition keyboards can leave the native
        // buffer empty while looking fine on screen.
        // Keyboards commit a word only on a terminator, so follow EVERY word with a real
        // KEYCODE_SPACE; the field keeps one trailing space (senders trim or keep it harmlessly).
        // A Delete after the space races the commit and eats characters, so never send one.
        const words = value.split(' ').filter(Boolean);
        for (const word of words) {
          run(['shell', 'input', 'text', inputText(word)]);
          await sleep(200);
          run(['shell', 'input', 'keyevent', '62']);
          await sleep(250);
        }
        await sleep(300);
        const needle = value.toLowerCase().slice(0, 24);
        const norm = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
        const entered = parseNodes(await dump()).some((node) => node.className.endsWith('EditText') && norm(node.text).includes(needle));
        if (!entered) throw new StepError('输入未完整进入输入框（当前内容未被键盘提交），请检查输入法状态');
        return;
      }
      case 'wait':
        if (!(await find(value, { index: item.index ?? 0, timeout }))) throw new StepError('timed out waiting for ' + value);
        return;
      case 'gone': {
        const deadline = Date.now() + timeout * 1000;
        while (parseNodes(await dump()).some(matcher(value))) {
          if (Date.now() > deadline) throw new StepError('still visible: ' + value);
          await sleep(POLL_MS);
        }
        return;
      }
      case 'shot':
        shot(value || 'screen');
        return;
      case 'dump':
        writeFileSync(join(out, (value || 'tree') + '.xml'), await dump());
        return;
      case 'swipe': {
        const [cx, cy] = [width / 2, height / 2];
        const vectors = { up: [cx, height * 0.75, cx, height * 0.25], down: [cx, height * 0.3, cx, height * 0.8], left: [width * 0.85, cy, width * 0.15, cy], right: [width * 0.15, cy, width * 0.85, cy] };
        swipe(...(vectors[value] || vectors.up));
        return;
      }
      case 'tapPoint':
        tapAt(Math.round(width * (item.x ?? 0.5)), Math.round(height * (item.y ?? 0.5)));
        return;
      case 'sleep':
        await sleep(Number(value || 1) * 1000);
        return;
      default:
        throw new StepError('unknown action ' + item.action);
    }
  }

  const steps = JSON.parse(readFileSync(stepsPath, 'utf8'));
  console.log(stamp(), 'android device', serial || '(default)', `${width}x${height}`, 'running', stepsPath);
  ensureInteractive();
  const deadline = Date.now() + Number(process.env.BATON_E2E_DEADLINE_MS || 300000);
  for (const [index, item] of steps.entries()) {
    if (Date.now() > deadline) { console.log(stamp(), 'E2E deadline reached; stopping'); return 1; }
    console.log(stamp(), `E2E step ${index + 1}/${steps.length}: ${item.action} ${item.value ?? ''} ${item.into ?? ''}`.trimEnd());
    try {
      await step(item);
    } catch (error) {
      if (item.optional) { console.log(stamp(), 'E2E optional step skipped:', error.message); continue; }
      const name = 'failure-' + String(index + 1).padStart(2, '0');
      try { shot(name); writeFileSync(join(out, 'failure-tree.xml'), await dump()); } catch (saveError) { console.log(stamp(), 'could not save failure evidence:', saveError.message); }
      console.log(stamp(), 'StepError:', error.message);
      console.log(stamp(), 'FAIL', '→', out);
      return 1;
    }
  }
  console.log(stamp(), 'PASS', '→', out);
  return 0;
}
