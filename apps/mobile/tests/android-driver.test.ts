import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error plain ESM test tooling without type declarations
import { inputText, matcher, parseNodes } from './e2e/android.mjs';

// A trimmed uiautomator dump: a tab button with content-desc, a text field and an off-screen node.
const dump = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.dengdai68.baton.mobile" content-desc="" clickable="false" bounds="[0,0][1080,2424]">
<node index="1" text="" resource-id="com.dengdai68.baton.mobile:id/tasks-tab" class="android.view.ViewGroup" content-desc="任务, tab, 1 of 4" clickable="true" bounds="[0,2200][270,2340]" />
<node index="2" text="https://127.0.0.1:9543" resource-id="" class="android.widget.EditText" content-desc="工作空间地址" clickable="true" bounds="[60,800][1020,932]" />
<node index="3" text="R&amp;D &quot;群&quot;" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" bounds="[0,0][0,0]" />
<node index="4" text="登录" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" bounds="[60,300][300,380]" />
<node index="5" text="" resource-id="" class="android.view.ViewGroup" content-desc="" clickable="true" bounds="[60,1000][1020,1132]"><node index="0" text="登录" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" bounds="[480,1040][600,1092]" /></node>
</node></hierarchy>`;

test('uiautomator dumps become labelled nodes with tap centers', () => {
  const nodes = parseNodes(dump);
  console.log('parsed nodes:', nodes.map((node: { label: string; text: string; x: number; y: number }) => `${node.label || node.text}@${node.x},${node.y}`).join(' | '));
  assert.equal(nodes.length, 6, 'zero-size nodes are skipped');
  assert.deepEqual([nodes[1].id, nodes[1].x, nodes[1].y, nodes[1].clickable], ['tasks-tab', 135, 2270, true]);
  assert.equal(nodes[2].className, 'android.widget.EditText');
});

test('a button label inside a clickable parent is actionable; a heading with the same text is not', () => {
  const titles = parseNodes(dump).filter(matcher('登录'));
  console.log('"登录" matches:', titles.map((node: { y: number; actionable: boolean }) => `y=${node.y} actionable=${node.actionable}`).join(' | '));
  assert.deepEqual(titles.map((node: { actionable: boolean }) => node.actionable), [false, true]);
});

test('queries follow the iOS driver: exact or prefix, ^ prefix, ~ contains, | alternatives', () => {
  const [, tab, field] = parseNodes(dump);
  assert.equal(matcher('任务')(tab), true, 'prefix of "任务, tab, 1 of 4"');
  assert.equal(matcher('^任务')(tab), true);
  assert.equal(matcher('~tab, 1')(tab), true);
  assert.equal(matcher('沟通|任务')(tab), true);
  assert.equal(matcher('tasks-tab')(tab), true, 'resource-id (testID) matches');
  assert.equal(matcher('~9543')(field), true, 'field text matches');
  assert.equal(matcher('沟通')(tab), false);
});

test('typed text is escaped for adb input and limited to ASCII', () => {
  assert.equal(inputText('https://127.0.0.1:9543'), 'https://127.0.0.1:9543');
  assert.equal(inputText('a b&c'), 'a%sb\\&c');
  assert.equal(inputText("it's"), "it\\'s");
  assert.throws(() => inputText('中文'), /ASCII only/);
});
