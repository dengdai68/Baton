// Isolated Electron request-order regression. Fixtures never dispatch a Provider.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';
import { writeStorageLocation } from '../server/storage-layout.mjs';
import { testEnvironment } from './run-tests.mjs';

await mkdir('.data', { recursive: true });
const root = await mkdtemp(resolve('.data/progressive-loading-')), home = join(root, 'home');
await mkdir(home);
const bundle = process.env.BATON_PACKAGED_APP;
const data = bundle ? join(home, '.baton') : join(root, 'client'), work = join(root, 'work');
const password = randomBytes(24).toString('hex'), auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('loading-qa', password); auth.close();
const store = createCatalogFixtureStore({ databasePath: join(work, 'records/baton.sqlite'), configurationDirectory: data, workspaceRoot: work });
const input = { managerAgentId: 'system_project_manager', objective: '仅隔离加载验证，不执行 Provider', memberAgentIds: ['system_project_manager', 'agent_analyst'], workflowTemplateId: 'software_delivery' };
const task = store.createTask({ ...input, title: '渐进加载 A' }), run = store.createRun(task.id);
const trace = store.createTrace(run.id, { agentId: 'agent_analyst', workflowNodeId: 'requirements' });
store.acceptNodeResult(run.id, 'requirements', trace.id, { summary: '展示夹具' }, Array.from({ length: 3196 }, (_, index) => ({ name: `docs/fixture-${index}.md`, storagePath: `test-only/${index}`, sha256: '0'.repeat(64), bytes: 1024 })));
store.completeTrace(trace.id);
store.transaction(() => { for (let index = 0; index < 160; index++) store.addMessage({ runId: run.id, sender: { type: 'agent', id: 'agent_analyst', name: '分析员工' }, recipientAgentId: run.manager.id, kind: 'handoff', content: `记录 ${index} ` + '加载验证正文。'.repeat(300) }); });
store.requestHumanAcceptance(run.id);
const second = store.createTask({ ...input, title: '渐进加载 B' }), runB = store.createRun(second.id); store.requestHumanAcceptance(runB.id);
for (let index = 0; index < 42; index++) store.createTask({ ...input, title: '目录加载 ' + String(index).padStart(2, '0') });
let lastAgent;
for (let index = 0; index < 22; index++) lastAgent = store.createAgent({ name: '延迟引用员工 ' + index });
const automation = store.saveAutomation({ ...input, title: '渐进加载自动化', cron: '0 9 * * 1-5', enabled: false });
const summary = store.getRunSummary(run.id);
const evidence = { root, packaged: Boolean(bundle), fixture: { tasks: 44, run: run.id, runB: runB.id, automation: automation.id, compactBytes: Buffer.byteLength(JSON.stringify(summary)), artifactCount: summary.run.artifactCount, compactArtifacts: summary.artifacts.length }, cases: [], requests: [], errors: [] };
store.close();
await writeStorageLocation(data, { version: 1, workspaceRoot: work, previousRuntimeRoots: [] });
const app = await electron.launch({ ...(bundle ? { executablePath: resolve(bundle, 'Contents/MacOS/Baton') } : {}), args: bundle ? ['--user-data-dir=' + join(root, 'browser')] : ['apps/electron/main.mjs'], env: { ...testEnvironment(), HOME: home, BATON_DESKTOP_DATA_ROOT: data, BATON_LOG_DIR: join(root, 'logs') }, timeout: 90000 });
let gate = null;
try {
  const page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(20000);
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/);
  const origin = new URL(page.url()).origin;
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(origin + '/login'); await page.locator('#username').fill('loading-qa'); await page.locator('#password').fill(password); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('#account-name').waitFor();
  const started = Date.now();
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/')) evidence.requests.push({ at: Date.now() - started, path: url.pathname + url.search, method: request.method() }); });
  await page.route('**/api/**', async route => {
    const held = gate, url = new URL(route.request().url());
    if (!held || !held.matches(url)) return route.continue();
    const response = await route.fetch(); held.hits++; await held.wait;
    await route.fulfill(held.fail ? { status: 503, json: { error: '隔离读取失败' } } : { response });
  });
  const hold = (matches, fail = false) => { assert.equal(gate, null); let release; gate = { matches, fail, hits: 0, wait: new Promise(resolve => release = resolve), release }; return gate; };
  const release = held => { if (gate === held) gate = null; held.release(); };
  const waitHit = async held => { const deadline = Date.now() + 20000; while (!held.hits) { if (Date.now() > deadline) throw Error('Delayed request not observed'); await new Promise(resolve => setTimeout(resolve, 25)); } };
  const spa = path => page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
  const rowCount = count => page.waitForFunction(count => document.querySelectorAll('#tasks-table .task-row').length === count, count);
  const closeModal = () => page.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
  const check = (name, details = {}) => { evidence.cases.push({ name, ...details }); console.log('PASS ' + name); };
  const consoleReads = () => evidence.requests.filter(item => /\/console(?:\?|$)|\/console-content\//.test(item.path));

  let delayed = hold(url => url.pathname === '/api/catalog-references', true);
  const taskRequestStart = evidence.requests.length;
  await page.goto(origin + '/tasks'); await waitHit(delayed); await rowCount(20);
  const scans = evidence.requests.slice(taskRequestStart).filter(item => item.path.startsWith('/api/tasks?') && item.path.includes('pageSize=100'));
  assert.equal(scans.length, 1); assert.match(await page.locator('[data-task-chip="all"]').innerText(), /44/);
  await page.locator('[data-pagination="tasks"] [data-page="2"]').click();
  await page.waitForFunction(() => document.querySelector('[data-pagination="tasks"] .list-pagination-page')?.textContent === '2 / 3');
  await rowCount(20);
  await page.locator('[data-action="new-task"]').click(); await page.locator('[data-task-catalog-loading][aria-busy="true"]').waitFor();
  assert.equal(await page.locator('#task-form').count(), 0); assert.equal(delayed.hits, 1, 'form shares the pending complete catalog request');
  release(delayed); await page.locator('[data-retry-task-catalog]').waitFor(); assert.equal(await page.locator('#task-form').count(), 0);
  await page.locator('[data-retry-task-catalog]').click(); await page.locator('#task-form').waitFor();
  await page.locator('#task-members').fill(lastAgent.name); await page.locator(`[data-add-extension="${lastAgent.id}"]`).waitFor();
  assert.ok(await page.locator('#task-workflow option').count() > 1); await closeModal();
  check('task rows and pagination precede catalog; creation waits, fails visibly, retries with all references', { initialRows: 20, total: 44, taskPageSize: 100 });

  delayed = hold(url => url.pathname === '/api/catalog-references');
  await page.locator('[data-action="new-task"]').click(); await waitHit(delayed); await closeModal(); release(delayed);
  await page.waitForTimeout(100); assert.equal(await page.locator('#task-form').count(), 0, 'cancelled reference load must not reopen the form');
  check('cancelled form reference load stays closed');

  delayed = hold(url => /\/api\/runs\/[^/]+\/workspace$/.test(url.pathname));
  await page.goto(origin + '/inbox'); await waitHit(delayed); await page.locator('.inbox-item').first().waitFor();
  assert.equal(await page.locator('#inbox-preview-content [aria-busy="true"]').count(), 1);
  assert.match(await page.locator('#inbox-content').innerText(), /渐进加载/);
  release(delayed);
  await page.waitForFunction(() => !document.querySelector('#inbox-preview-content [aria-busy="true"]'));
  check('inbox confirmed directory rows precede compact details and selected preview stays explicitly loading');
  // An idle inbox must not repeat per-task workspace reads on navigation polls.
  const settledRequests = evidence.requests.length;
  await page.waitForTimeout(6500);
  const idleWorkspaceReads = evidence.requests.slice(settledRequests).filter(item => /\/workspace(\?|$)/.test(item.path));
  console.log('IDLE inbox window requests:', evidence.requests.length - settledRequests, 'workspace reads:', idleWorkspaceReads.length);
  assert.equal(idleWorkspaceReads.length, 0, 'idle inbox polls reuse cached details');
  check('idle inbox polls skip unchanged workspace details', { windowMs: 6500 });
  await page.goto(origin + '/tasks'); await rowCount(20);

  const search = page.locator('#task-search-form input[name="name"]');
  delayed = hold(url => url.pathname === '/api/tasks' && url.searchParams.get('search') === '目录加载 01');
  await search.fill('目录加载 01'); await waitHit(delayed); await search.fill('目录加载 41'); await rowCount(1);
  await page.waitForFunction(() => document.querySelector('#tasks-table .task-row')?.textContent.includes('目录加载 41'));
  release(delayed); await page.waitForTimeout(100); assert.match(await page.locator('#tasks-table').innerText(), /目录加载 41/);
  check('late task search cannot overwrite current query');

  delayed = hold(url => url.pathname === '/api/tasks', true); await page.goto(origin + '/tasks'); await waitHit(delayed);
  assert.equal(await page.locator('#tasks-table .task-row').count(), 0); assert.match(await page.locator('#tasks-table').innerText(), /正在读取/);
  release(delayed); await page.locator('[data-retry-directory]').waitFor(); await page.locator('[data-retry-directory]').click(); await rowCount(20);
  check('initial task query failure has retry and never claims an empty completed list');

  delayed = hold(url => url.pathname === `/api/runs/${run.id}/collaboration`);
  await page.goto(origin + '/runs/' + run.id); await waitHit(delayed); await page.locator('#collaboration-mode').waitFor();
  assert.equal(await page.locator('.workspace-title h3').innerText(), task.title);
  assert.equal(await page.locator('#directory-mode .tab-count').innerText(), '3196'); assert.equal(consoleReads().length, 0);
  assert.ok(await page.locator('.task-member-row').count() >= 2);
  await spa('/runs/' + runB.id); await page.waitForFunction(title => document.querySelector('.workspace-title h3')?.textContent === title, second.title);
  release(delayed); await page.waitForTimeout(100); assert.equal(await page.locator('.workspace-title h3').innerText(), second.title);
  await spa('/runs/' + run.id); await page.waitForFunction(title => document.querySelector('.workspace-title h3')?.textContent === title, task.title);
  await page.locator('[data-collaboration-record]').first().waitFor();
  check('compact Meta and true snapshot count precede collaboration; stale run cannot replace current run', { artifactCount: 3196, consoleReadsBeforeClick: consoleReads().length });

  delayed = hold(url => url.pathname === `/api/runs/${run.id}/workspace`, true); await page.goto(origin + '/runs/' + run.id); await waitHit(delayed); release(delayed);
  await page.locator('[data-reload-workspace]').waitFor(); await page.locator('[data-reload-workspace]').click(); await page.locator('#collaboration-mode').waitFor();
  check('Meta failure recovers through existing workspace retry');

  delayed = hold(url => url.pathname === `/api/runs/${run.id}/collaboration`, true); await page.goto(origin + '/runs/' + run.id); await waitHit(delayed);
  assert.equal(await page.locator('#collaboration-mode').count(), 1); release(delayed);
  await page.locator('[data-retry-collaboration]').waitFor(); await page.locator('[data-retry-collaboration]').click(); await page.locator('[data-collaboration-record]').first().waitFor();
  assert.equal(consoleReads().length, 0);
  await Promise.all([page.waitForRequest(request => /\/console\?/.test(request.url())), page.locator('#console-mode').click()]);
  check('collaboration failure preserves Meta and retries; console history loads only on explicit selection');

  delayed = hold(url => url.pathname === '/api/automations' && ['enabled', 'disabled'].includes(url.searchParams.get('status')), true);
  await page.goto(origin + '/automations'); await waitHit(delayed); await page.locator('#automation-search').waitFor(); await page.locator('[data-auto-nav]').first().waitFor();
  assert.equal(await page.locator('[data-auto-nav]').count(), 1); assert.equal(await page.locator('[data-auto-status="enabled"] span').innerText(), '—');
  release(delayed); await page.locator('[data-auto-refresh]').waitFor(); await page.locator('[data-auto-refresh]').click();
  await page.waitForFunction(() => document.querySelector('[data-auto-status="disabled"] span')?.textContent === '1');
  check('automation rows precede other status counts; count failure keeps rows and offers retry');

  delayed = hold(url => url.pathname === `/api/automations/${automation.id}/triggers`, true);
  await page.locator(`[data-auto-open="${automation.id}"]`).click(); await waitHit(delayed); await page.locator('.automation-detail-header').waitFor();
  assert.match(await page.locator('.automation-facts').innerText(), /执行规则/); release(delayed);
  await page.locator('[data-auto-detail] [data-auto-refresh]').waitFor(); await page.locator('[data-auto-detail] [data-auto-refresh]').click();
  await page.getByText('暂无符合条件的触发记录', { exact: true }).waitFor();
  delayed = hold(url => url.pathname === '/api/catalog-references', true); await page.locator(`[data-auto-header-actions] > [data-auto-edit="${automation.id}"]`).click(); await waitHit(delayed);
  assert.equal(await page.locator('#task-form').count(), 0); release(delayed); await page.locator('[data-retry-task-catalog]').waitFor();
  await page.locator('[data-retry-task-catalog]').click(); await page.locator('#task-form').waitFor();
  assert.equal(await page.locator('#task-title').inputValue(), automation.title); assert.equal(await page.locator('#task-workflow').inputValue(), input.workflowTemplateId); await closeModal();
  check('automation Meta precedes trigger history; edit waits for complete references and preserves fields');

  let releaseCount, countHits = 0;
  const countGate = new Promise(resolve => releaseCount = resolve), marketStart = evidence.requests.length;
  const marketRoute = async route => {
    const url = new URL(route.request().url()), unused = url.searchParams.get('usage') === 'unused';
    assert.ok([...url.searchParams.keys()].every(key=>['page','search','usage'].includes(key)), 'market query stays within the existing HTTP contract');
    const pageNumber = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 20);
    if (unused) { countHits++; await countGate; }
    const total = unused ? 119 : 120;
    const plugins = Array.from({length:Math.max(0,Math.min(pageSize,total-(pageNumber-1)*pageSize))},(_,index)=>({id:'perf-plugin-'+((pageNumber-1)*pageSize+index),name:'性能插件 '+((pageNumber-1)*pageSize+index),description:'隔离分页展示夹具',components:{skills:1},providers:['claude-code']}));
    await route.fulfill({json:{plugins,page:pageNumber,pageSize,total,totalPages:Math.ceil(total/pageSize),hasMore:pageNumber<Math.ceil(total/pageSize)}});
  };
  await page.route('**/api/runtime/marketplace?*', marketRoute);
  try {
    await page.goto(origin + '/marketplace'); await page.locator('[data-market-list] .agent-card').first().waitFor();
    assert.equal(await page.locator('[data-market-list] .agent-card').count(), 20);
    assert.ok(countHits > 0); assert.equal(await page.locator('[data-market-filter="unused"] span').innerText(), '—');
    assert.equal(evidence.requests.slice(marketStart).filter(item=>/\/api\/runtime\/marketplace\?/.test(item.path)&&item.path.includes('usage=all')).length, 1, 'initial display reads only the requested catalog page');
    releaseCount(); await page.waitForFunction(()=>document.querySelector('[data-market-filter="unused"] span')?.textContent==='119');
    await page.locator('[data-pagination="marketplace"] [data-page="2"]').click();
    await page.getByRole('button',{name:'性能插件 20',exact:true}).waitFor();
    await page.locator('[data-market-filter="unused"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-market-filter="unused"]')?.getAttribute('aria-pressed')==='true');
    assert.equal(await page.locator('[data-market-list] .agent-card').count(),20);
    assert.equal(await page.locator('[data-market-filter="unused"] span').innerText(),'119');
    check('market current page precedes auxiliary counts; paging and usage filtering query bounded server pages');
  } finally { releaseCount(); await page.unroute('**/api/runtime/marketplace?*', marketRoute); }

  delayed = hold(url => url.pathname === '/api/catalog-references');
  await page.goto(origin + '/automations/' + automation.id); await waitHit(delayed); await page.locator('[data-auto-tab="config"]').click();
  await page.getByText('正在读取工作流', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-auto-detail]').getByText('默认协作', { exact: true }).count(), 0, 'unresolved reference is not an empty workflow selection');
  release(delayed); await page.locator(`[data-auto-workflow="${input.workflowTemplateId}"]`).waitFor();
  check('delayed automation references are visibly pending, then resolve the saved workflow');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(760, 760));
  await page.goto(origin + '/tasks'); await rowCount(20); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goto(origin + '/runs/' + run.id); await page.locator('#collaboration-mode').waitFor(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(evidence.errors, []); check('narrow task/workspace layout and renderer errors'); evidence.status = 'passed';
} catch (error) { evidence.status = 'failed'; evidence.error = error.stack; throw error; }
finally { gate?.release(); await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log('Evidence: ' + root); await app.close(); }
