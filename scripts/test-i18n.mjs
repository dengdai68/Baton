// 多语言验收：隔离 Electron 中逐页检查英文/繁体界面、宿主菜单、语言切换与持久化。
// 运行：node scripts/test-i18n.mjs；BATON_I18N_APP=/path/Baton.app 可验收打包版本。
// 只用展示夹具：Provider 为立即失败的假命令，不调用真实模型，不触碰操作者实例。
// 产物：.data/i18n-acceptance/run-<随机>/shots/*.png 与 evidence.json（均被 git 忽略）。
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';
import { createAuth } from '../server/auth.mjs';
import { writeStorageLocation } from '../server/storage-layout.mjs';

const log = (...items) => console.log(new Date().toISOString().slice(11, 19), ...items);
await mkdir('.data/i18n-acceptance', { recursive: true });
const root = await mkdtemp(resolve('.data/i18n-acceptance/run-'));
const shots = join(root, 'shots'), home = join(root, 'home');
const bundle = process.env.BATON_I18N_APP;
const data = bundle ? join(home, '.baton') : join(root, 'client');
await mkdir(shots, { recursive: true });
await mkdir(home, { recursive: true });
log('isolated root', root, bundle ? `bundle ${bundle}` : 'source app');

// 1) 隔离 PATH：任何意外派工都只会命中立即失败的假 Provider。
const bin = join(home, 'test-bin');
await mkdir(bin);
for (const name of ['claude', 'codex', 'dsh']) await writeFile(join(bin, name), '#!/bin/sh\nprintf "i18n fixture: provider disabled\\n" >&2\nexit 127\n', { mode: 0o700 });
for (const name of ['.zprofile', '.zshrc']) await writeFile(join(home, name), 'export PATH=' + JSON.stringify(bin) + ':"$PATH"\n');

// 2) 管理员与展示数据（业务数据保持中文，用于确认业务内容不被翻译）。
const password = randomBytes(24).toString('hex');
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('i18n-audit', password); auth.close();
const store = createCatalogFixtureStore({ databasePath: join(root, 'work', 'records', 'baton.sqlite'), configurationDirectory: data, workspaceRoot: join(root, 'work') });
const members = ['system_project_manager', 'agent_analyst', 'agent_designer', 'agent_engineer', 'agent_tester'];
const task = store.createTask({ managerAgentId: 'system_project_manager', title: '多语言验收任务', objective: '检查界面文字随语言切换，业务内容保持原文。', memberAgentIds: members, workflowTemplateId: 'software_delivery' });
const run = store.createRun(task.id);
store.addMessage({ runId: run.id, sender: { type: 'agent', id: run.manager.id, name: run.manager.name }, kind: 'manager_decision', content: '业务消息正文保持原文。' });
try { store.pauseRun(run.id, '用户在任务空间暂停'); } catch (error) { log('pause skipped', error.message); }
store.createTask({ managerAgentId: 'system_project_manager', title: '草稿任务', objective: '尚未启动的草稿。', memberAgentIds: members });
// Platform wording saved in records: the default workflow (frozen without a template id),
// the operator's own instruction and chat message ("你"). Display translates them.
const defaultTask = store.createTask({ managerAgentId: 'system_project_manager', title: '默认流程任务', objective: '使用默认工作流。', memberAgentIds: members });
const defaultRun = store.createRun(defaultTask.id);
store.addMessage({ runId: defaultRun.id, recipientAgentId: defaultRun.manager.id, kind: 'human_instruction', content: '请先给出摘要。' });
try { store.pauseRun(defaultRun.id, '用户在任务空间暂停'); } catch (error) { log('pause skipped', error.message); }
const chat = store.openCommunication({ kind: 'group', name: '多语言讨论组', memberAgentIds: ['agent_analyst', 'agent_designer'] });
store.sendCommunication(chat.id, { content: '请说明进度。', mentionAgentIds: ['agent_analyst'], clientRequestId: 'i18n_chat' });
const delivery = store.claimCommunication(chat.id);
store.completeCommunication(chat.id, delivery.id, '进度正常。');
store.close?.();
await writeStorageLocation(data, { version: 1, workspaceRoot: join(root, 'work'), previousRuntimeRoots: [] });

const evidence = { root, pages: {}, leftovers: {}, menus: {}, platformWording: {}, shots: [], errors: [] };
// Server wording saved in records is not business content: it must appear translated.
const PLATFORM_WORDING = ['默认协作', '完成任务', '全体团队', '本机用户'];
const launch = locale => electron.launch({ ...(bundle ? { executablePath: resolve(bundle, 'Contents/MacOS/Baton'), args: [] } : { args: ['apps/electron/main.mjs'] }),
  env: { ...process.env, HOME: home, BATON_DESKTOP_DATA_ROOT: data, BATON_LOG_DIR: join(root, 'logs'), BATON_LOCALE: locale }, timeout: 120000 });

async function open(app) {
  const page = await app.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 90000 });
  return { page, origin: new URL(page.url()).origin };
}
const resize = (app, page, origin, width, height) => app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(size.origin)).setContentSize(size.width, size.height), { origin, width, height })
  .then(() => page.waitForFunction(size => innerWidth === size.width, { width }));
const menus = app => app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items || []).map(item => ({ label: item.label, items: (item.submenu?.items || []).map(entry => entry.label).filter(Boolean) })));
const shot = async (page, name) => { const path = join(shots, `${name}.png`); await page.screenshot({ path }); evidence.shots.push(name); log('shot', name); };

/** All Han strings from authenticated API data: business content that must stay as written. */
async function businessTexts(page) {
  return page.evaluate(async ({ runIds, chatIds }) => {
    const texts = new Set();
    const walk = value => { if (typeof value === 'string') { if (/[一-鿿]/.test(value)) texts.add(value.trim()); } else if (value && typeof value === 'object') Object.values(value).forEach(walk); };
    for (const path of ['/api/agents', '/api/teams', '/api/workflow-templates', '/api/roles', '/api/tasks', '/api/automations', '/api/communications', ...chatIds.map(id => `/api/communications/${id}`), ...runIds.map(id => `/api/runs/${id}/workspace`)]) {
      try { const response = await fetch(path); if (response.ok) walk(await response.json()); } catch { /* optional endpoint */ }
    }
    return [...texts].filter(text => text.length >= 2);
  }, { runIds: [run.id, defaultRun.id], chatIds: [chat.id] }).then(texts => texts.filter(text => !PLATFORM_WORDING.includes(text)));
}

/** Visible interface text left in the source language: any Han text in English, Simplified-only characters in zh-TW. */
async function leftovers(page, business, locale) {
  return page.evaluate(({ business, locale }) => {
    const han = locale === 'en' ? /[一-鿿]/ : /[这们个为时设数据务员话发记录应关开页项进运动选择认证错误让过还没对间]/, found = new Set();
    const isBusiness = text => business.some(item => item.includes(text) || text.includes(item));
    const visible = element => element && element.getClientRects().length > 0 && !element.closest('[hidden], code, pre, .path-mono, .markdown-body, .collaboration-body');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue.trim();
      if (text && han.test(text) && visible(walker.currentNode.parentElement) && !isBusiness(text)) found.add(text);
    }
    for (const element of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
      if (!visible(element)) continue;
      for (const name of ['title', 'aria-label', 'placeholder']) {
        const value = element.getAttribute(name)?.trim();
        if (value && han.test(value) && !isBusiness(value)) found.add(`@${name} ${value}`);
      }
    }
    return [...found];
  }, { business, locale });
}

/** Navigation and titlebar labels must fit; long English labels may not overflow their box. */
const overflow = page => page.evaluate(() => [...document.querySelectorAll('.sidebar a, .sidebar button, .settings-nav a, .settings-nav button, .topbar button')]
  .filter(node => node.getClientRects().length && getComputedStyle(node).overflow !== 'visible' && node.scrollWidth > node.clientWidth + 1)
  .map(node => node.textContent.trim().slice(0, 40)));

const PAGES = ['/inbox', '/tasks', '/automations', '/teams', '/workflows', '/agents', '/roles', '/marketplace', '/mcp-marketplace', '/communication',
  '/settings/general', '/settings/appearance', '/settings/workspace', '/settings/cli', '/settings/repositories', '/settings/runtime', '/settings/updates', '/settings/logs', '/manual/data-model', `/runs/${run.id}`,
  `/runs/${defaultRun.id}`, `/communication/${chat.id}`];

/** The default workflow and the operator's own name are shown in the interface language. */
async function auditPlatformWording(page, origin, locale) {
  const expected = { en: { you: 'You', workflow: 'Default collaboration', step: 'Complete the task' }, 'zh-TW': { you: '你', workflow: '預設協作', step: '完成任務' } }[locale];
  const text = locator => locator.first().innerText().then(value => value.trim());
  await page.goto(origin + '/tasks'); await page.waitForTimeout(600);
  const listed = await page.locator('.task-workflow').allInnerTexts();
  await page.goto(origin + `/runs/${defaultRun.id}`); await page.locator('#collaboration-panel').waitFor();
  await page.locator('.collaboration-row.from-human header strong').first().waitFor();
  const seen = {
    taskList: listed.map(value => value.trim()),
    instructionSender: await text(page.locator('.collaboration-row.from-human header strong')),
    workflowLink: await text(page.locator('.task-workflow-link')),
    focusStep: await text(page.locator('.workflow-focus-title')),
  };
  await page.goto(origin + `/communication/${chat.id}`); await page.locator('.communication-message.from-human header strong').first().waitFor();
  seen.chatSender = await text(page.locator('.communication-message.from-human header strong'));
  evidence.platformWording[locale] = seen;
  log(locale, 'platform wording', JSON.stringify(seen));
  assert.ok(seen.taskList.includes(expected.workflow), `${locale}: task list shows the default workflow as ${expected.workflow}`);
  assert.equal(seen.instructionSender, expected.you, `${locale}: the operator's instruction sender`);
  assert.equal(seen.workflowLink, `${expected.workflow} ↗`, `${locale}: overview workflow`);
  assert.equal(seen.focusStep, expected.step, `${locale}: default workflow step`);
  assert.equal(seen.chatSender, expected.you, `${locale}: the operator's chat messages`);
}

async function auditLocale(app, page, origin, locale) {
  const business = await businessTexts(page);
  log(locale, 'business strings', business.length);
  for (const path of PAGES) {
    await page.goto(origin + path);
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => document.documentElement.lang), locale, `${path}: document language`);
    const remaining = await leftovers(page, business, locale);
    const tight = await overflow(page);
    evidence.pages[`${locale} ${path}`] = { leftovers: remaining.length, overflow: tight };
    if (remaining.length) evidence.leftovers[`${locale} ${path}`] = remaining;
    log(locale, path, `leftovers=${remaining.length}`, tight.length ? `overflow=${tight.join(' | ')}` : '');
  }
}

let app = await launch('en');
try {
  let { page, origin } = await open(app);
  await resize(app, page, origin, 1440, 900);
  // Login page translates before sign-in.
  await page.goto(origin + '/login'); await page.locator('#username').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  assert.equal((await page.locator('h1').textContent()).trim(), 'Sign in to Baton');
  await shot(page, 'en-01-login');
  await page.locator('#username').fill('i18n-audit'); await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.locator('#account-name').waitFor();
  evidence.menus.en = await menus(app);
  log('en menus', JSON.stringify(evidence.menus.en.map(menu => menu.label)));
  assert.ok(evidence.menus.en.some(menu => menu.items.includes('Quit Baton') || menu.items.some(label => /Quit/.test(label))), 'host menu is English');

  await auditLocale(app, page, origin, 'en');
  await auditPlatformWording(page, origin, 'en');
  for (const [path, name] of [['/tasks', 'tasks'], ['/inbox', 'inbox'], [`/runs/${run.id}`, 'workspace'], ['/settings/general', 'settings'], ['/agents', 'agents']]) {
    await page.goto(origin + path); await page.waitForTimeout(800); await shot(page, `en-wide-${name}`);
  }
  await resize(app, page, origin, 760, 900);
  for (const [path, name] of [['/tasks', 'tasks'], [`/runs/${run.id}`, 'workspace'], ['/settings/general', 'settings']]) {
    await page.goto(origin + path); await page.waitForTimeout(800); await shot(page, `en-narrow-${name}`);
    evidence.pages[`en narrow ${path}`] = { overflow: await overflow(page) };
  }
  await resize(app, page, origin, 1440, 900);

  // Business content and server-originated reasons: the task title stays as written, the pause reason is translated for display.
  await page.goto(origin + '/tasks'); await page.waitForTimeout(800);
  assert.ok((await page.locator('body').innerText()).includes('多语言验收任务'), 'business task title is not translated');

  // Switch to Traditional Chinese in Settings → General; the page reloads and the host saves the choice.
  await page.goto(origin + '/settings/general');
  const select = page.locator('#settings-language'); await select.waitFor();
  await Promise.all([page.waitForEvent('load'), select.selectOption('zh-TW')]);
  await page.waitForFunction(() => document.documentElement.lang === 'zh-TW');
  const preferences = JSON.parse(await readFile(join(data, 'desktop-preferences.json'), 'utf8'));
  log('saved preferences', JSON.stringify(preferences));
  assert.equal(preferences.language, 'zh-TW');
  evidence.menus['zh-TW'] = await menus(app);
  assert.ok(JSON.stringify(evidence.menus['zh-TW']).includes('結束 Baton'), 'host menu rebuilt in Traditional Chinese');
  await auditLocale(app, page, origin, 'zh-TW');
  await auditPlatformWording(page, origin, 'zh-TW');
  for (const [path, name] of [['/tasks', 'tasks'], [`/runs/${run.id}`, 'workspace']]) { await page.goto(origin + path); await page.waitForTimeout(800); await shot(page, `zh-TW-wide-${name}`); }
  await app.close();

  // An explicit choice outlives the system language; "Follow system" returns to it.
  app = await launch('en');
  ({ page, origin } = await open(app));
  await page.goto(origin + '/tasks');
  await page.waitForFunction(() => document.documentElement.lang === 'zh-TW');
  log('relaunch keeps explicit zh-TW despite BATON_LOCALE=en');
  await page.goto(origin + '/settings/general');
  await Promise.all([page.waitForEvent('load'), page.locator('#settings-language').selectOption('system')]);
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(JSON.parse(await readFile(join(data, 'desktop-preferences.json'), 'utf8')).language, 'system');
  log('follow system returns to en');
} finally {
  await app.close().catch(() => {});
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
}

const pending = Object.entries(evidence.leftovers);
for (const [page, texts] of pending) log('LEFTOVER', page, texts.slice(0, 12).join(' ‖ '));
log('page errors', evidence.errors.length ? evidence.errors.join(' | ') : 'none');
assert.deepEqual(evidence.errors, [], 'no renderer errors');
assert.deepEqual(pending, [], 'no untranslated interface text');
log('i18n acceptance passed', root);
