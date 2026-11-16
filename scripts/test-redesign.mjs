// UI 重设计审查：隔离 Electron 截图采集（仅展示夹具，不调用 Provider，不触碰操作者实例）。
// 运行：node scripts/test-redesign.mjs；BATON_REDESIGN_APP 可指定安装包。
// 产物：.data/ui-redesign-audit/run-<随机>/shots/*.png 与 evidence.json（均被 git 忽略）。
import assert from 'node:assert/strict';
import { writeStorageLocation } from '../server/storage-layout.mjs';
import { _electron as electron } from 'playwright-core';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';
import { createRunFiles } from '../server/run-files.mjs';
import { createAuth } from '../server/auth.mjs';
import { executionContent, promptSnapshot } from '../server/runtime/local-cli.mjs';

const log = (...items) => console.log(new Date().toISOString().slice(11, 19), ...items);
await mkdir('.data/ui-redesign-audit',{recursive:true});
const root = await mkdtemp(resolve('.data/ui-redesign-audit/run-'));
const shots = join(root, 'shots');
await mkdir(shots, { recursive: true });
const home = join(root, 'home');
const bundle=process.env.BATON_REDESIGN_APP;
const data = bundle?join(home, '.baton'):join(root, 'client');
await mkdir(home, { recursive: true });
process.env.BATON_LOG_DIR = join(root, 'logs');

// 1) 隔离 PATH：claude/codex/dsh 均为立即失败的假命令，任何意外派工都不会调用真实模型。
const bin = join(home, 'test-bin');
await mkdir(bin);
for (const name of ['claude', 'codex', 'dsh']) await writeFile(join(bin, name), '#!/bin/sh\nprintf "UI audit fixture: provider disabled\\n" >&2\nexit 127\n', { mode: 0o700 });
for (const name of ['.zprofile', '.zshrc']) await writeFile(join(home, name), 'export PATH=' + JSON.stringify(bin) + ':"$PATH"\n');

// 2) 认证与展示数据（Store 夹具）。
const password = randomBytes(24).toString('hex');
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('design-audit', password); auth.close();
const s = createCatalogFixtureStore({ databasePath: join(root, 'work', 'records', 'baton.sqlite'), configurationDirectory: data, workspaceRoot: join(root, 'work') });
const files = createRunFiles({ root: join(root, 'work', 'records') });
const seeded = { tasks: {}, chats: {}, notes: [] };
const attempt = async (label, action) => { try { return await action(); } catch (error) { seeded.notes.push(`${label}: ${error.message}`); log('SEED WARN', label, error.message); return null; } };

const roleIds = {};
for (const [key, name, prompt] of [
  ['review', '代码评审规范', '评审时先确认需求与测试证据，再给出按严重程度排序的问题清单。'],
  ['writing', '中文写作风格', '使用简洁、具体的中文，避免空泛形容词；结论先行。'],
  ['security', '安全基线', '不输出凭据；涉及外部调用时说明数据流向。'],
]) roleIds[key] = (await attempt('role ' + name, () => s.createRole({ name, prompt })))?.id;

const extraAgents = {};
for (const [key, input] of Object.entries({
  editor: { name: 'Mira · 内容编辑', description: '负责长文结构、事实核对与中文润色。', systemPrompt: '按简报完成内容初稿，标注所有未核实事实。', roleIds: [roleIds.writing].filter(Boolean) },
  data: { name: 'Theo · 数据分析师', description: '处理 CSV/SQL 数据，输出可复现的分析脚本与图表。', status: 'inactive' },
  growth: { name: 'Iris · 增长运营', description: '设计增长实验，跟踪转化漏斗并撰写复盘。' },
})) extraAgents[key] = await attempt('agent ' + key, () => s.createAgent(input));
await attempt('bind roles', () => s.updateAgent('agent_engineer', { roleIds: [roleIds.review, roleIds.security].filter(Boolean), description: '负责前端与 Node 服务实现，提交前运行单元测试。' }));
await attempt('analyst desc', () => s.updateAgent('agent_analyst', { description: '把模糊需求整理为可验收的条目与边界条件。' }));

await attempt('team content', () => s.createTeam({ name: '内容工作室', mission: '选题、写作、审校一条龙交付长文。', memberAgentIds: ['agent_analyst', extraAgents.editor?.id, 'agent_tester'].filter(Boolean) }));
await attempt('team growth', () => s.createTeam({ name: '增长实验组', mission: '围绕注册转化设计与复盘实验。', memberAgentIds: [extraAgents.growth?.id, extraAgents.data?.id].filter(Boolean) }));

const members = ['system_project_manager', 'agent_analyst', 'agent_designer', 'agent_engineer', 'agent_tester'];
const createTask = (title, objective, extra = {}) => s.createTask({ managerAgentId: 'system_project_manager', title, objective, memberAgentIds: members, workflowTemplateId: 'software_delivery', ...extra });
const actor = agent => ({ type: 'agent', id: agent.id, name: agent.name });

// 主演示任务：带协作记录、待回答澄清、工作目录文件与控制台日志。
await attempt('main task', async () => {
  const task = createTask('重构登录页并补齐单元测试', '登录页在窄窗口下错位、错误提示不可读；请重构布局并为表单校验补齐单元测试，交付前给出截图与测试报告。');
  const run = s.createRun(task.id);
  seeded.tasks.main = run.id;
  const analyst = s.getRunAgent(run.id, 'agent_analyst'), engineer = s.getRunAgent(run.id, 'agent_engineer'), tester = s.getRunAgent(run.id, 'agent_tester');
  const trace = (dispatch, agent) => { const t = s.createTrace(run.id, { workflowNodeId: dispatch.workflowNodeId, agentId: agent.id, type: dispatch.purpose }); s.attachDispatchTrace(dispatch.id, t.id); return t; };
  const initial = s.enqueueDispatch(run.id, { recipientAgentId: run.manager.id, workflowNodeId: 'requirements', purpose: 'manager', dedupeKey: 'initial-manager' });
  s.claimDispatch(run.id);
  const t0 = trace(initial, run.manager);
  s.attachTracePrompt(t0.id, await files.writePromptSnapshot(run.id, t0.id, promptSnapshot('任务目标：重构登录页并补齐单元测试。请拆分职责并派工。')));
  s.addMessage({ runId: run.id, traceId: t0.id, sender: actor(run.manager), kind: 'manager_decision', content: '已拆分为三步：\n\n1. **Noah** 明确窄窗口与错误提示的验收标准；\n2. **Kai** 重构布局并补齐表单校验单测；\n3. **Sora** 在 760px 与 1320px 下回归并出具报告。\n\n先由 Noah 开始。' });
  s.completeTrace(t0.id); s.completeDispatch(initial.id);
  const work = s.enqueueDispatch(run.id, { recipientAgentId: analyst.id, workflowNodeId: 'requirements', purpose: 'node', dedupeKey: 'handoff:' + initial.id });
  s.claimDispatch(run.id); const t1 = trace(work, analyst);
  await mkdir(join(run.workspacePath, 'docs', 'requirements'), { recursive: true });
  await mkdir(join(run.workspacePath, 'src', 'login'), { recursive: true });
  const before = await files.snapshotWorkspace(run.workspacePath);
  await writeFile(join(run.workspacePath, 'docs', 'requirements', 'login-acceptance.md'), '# 登录页验收标准\n\n- 760px 宽度下表单不出现横向滚动\n- 错误提示与字段关联，读屏可读\n- 密码错误 3 次后显示找回入口\n');
  await writeFile(join(run.workspacePath, 'src', 'login', 'validate.js'), "export function validate({ username, password }) {\n  const errors = {};\n  if (!username?.trim()) errors.username = '请输入用户名';\n  if (!password || password.length < 8) errors.password = '密码至少 8 位';\n  return errors;\n}\n");
  await writeFile(join(run.workspacePath, 'src', 'login', 'validate.test.js'), "import { validate } from './validate.js';\n\ntest('空用户名', () => {\n  expect(validate({ username: '', password: '12345678' }).username).toBe('请输入用户名');\n});\n");
  const captured = await files.captureWorkspaceChanges({ runId: run.id, traceId: t1.id, workspacePath: run.workspacePath, before });
  s.acceptNodeResult(run.id, 'requirements', t1.id, { summary: '验收标准已交付' }, captured.artifacts);
  for (const content of [executionContent({ thinking: '先读取现有登录页结构，再列出窄窗口下的错位点与可访问性问题。' })]) {
    const contentRef = await files.writeConsoleContent(run.id, t1.id, content);
    s.addEvent({ type: 'runtime.event', runId: run.id, actor: actor(analyst), message: '模型正在整理验收标准', data: { auditVersion: 2, traceId: t1.id, presentation: 'thinking', providerEventType: 'assistant', contentRef } });
  }
  for (let i = 0; i < 6; i++) s.addEvent({ type: 'runtime.event', runId: run.id, actor: actor(analyst), message: ['读取 web/login.html', '读取 web/login.css', '检查 760px 断点', '整理错误提示文案', '写入 docs/requirements/login-acceptance.md', '核对验收条目'][i], data: { traceId: t1.id, auditVersion: 2, providerEventType: 'assistant', presentation: 'text' } });
  const handoffResult = { status: 'completed', node: 'requirements', handoff: 'docs/requirements/login-acceptance.md' };
  const report = '## 验收标准已交付\n\n已写入 `docs/requirements/login-acceptance.md`，覆盖：\n\n- 760px 宽度无横向滚动\n- 错误提示与字段关联（`aria-describedby`）\n- 连续 3 次失败后显示找回入口\n\n**未覆盖**：第三方登录按钮的样式，需要人类确认是否在范围内。';
  s.addMessage({ runId: run.id, traceId: t1.id, sender: actor(analyst), recipientAgentId: run.manager.id, kind: 'handoff', content: JSON.stringify({ ...handoffResult, rawResponse: report + '\n\n```json\n' + JSON.stringify(handoffResult) + '\n```' }) });
  s.completeTrace(t1.id); s.completeDispatch(work.id);
  s.addMessage({ runId: run.id, kind: 'instruction', content: '补充：登录按钮保持品牌蓝，不要改动注册流程。@Kai · 研发工程师 实现时请同时覆盖中文输入法回车。' });
  const dev = s.enqueueDispatch(run.id, { recipientAgentId: engineer.id, workflowNodeId: 'development', purpose: 'node', dedupeKey: 'dev-1' });
  s.claimDispatch(run.id); const t2 = trace(dev, engineer);
  s.attachTracePrompt(t2.id, await files.writePromptSnapshot(run.id, t2.id, promptSnapshot('请依据 docs/requirements/login-acceptance.md 重构登录页布局，并补齐表单校验单元测试。')));
  for (const message of ['读取 docs/requirements/login-acceptance.md', '运行 npm test -- login', '修改 web/login.css：改为单列栅格', '新增 src/login/validate.test.js']) s.addEvent({ type: 'runtime.event', runId: run.id, actor: actor(engineer), message, data: { traceId: t2.id, auditVersion: 2, providerEventType: 'assistant', presentation: 'text' } });
  s.askQuestion(dev.id, { audience: 'human', question: '第三方登录（GitHub / 企业微信）按钮是否也要按新布局调整？如果要，需要提供企业微信的品牌规范。' }, t2.id);
  s.completeTrace(t2.id);
  void tester;
});

const simpleRun = async (key, title, objective, finish) => attempt('task ' + key, async () => {
  const task = createTask(title, objective);
  const run = s.createRun(task.id);
  seeded.tasks[key] = run.id;
  await finish(run, task);
});
await simpleRun('acceptance', 'Q4 竞品调研报告', '对比 5 款多 Agent 协作工具的定价、协作模型与交付证据，输出 Markdown 报告。', async run => {
  const trace=s.createTrace(run.id,{workflowNodeId:'requirements',agentId:'agent_analyst',type:'node'});
  await mkdir(run.workspacePath,{recursive:true});
  const before=await files.snapshotWorkspace(run.workspacePath);
  await mkdir(join(run.workspacePath,'docs'),{recursive:true});
  await writeFile(join(run.workspacePath,'docs','comparison.md'),'# 竞品调研交付\n\n这是隔离界面验收的已保存快照。');
  const captured=await files.captureWorkspaceChanges({runId:run.id,traceId:trace.id,workspacePath:run.workspacePath,before});
  s.acceptNodeResult(run.id,'requirements',trace.id,{summary:'调研交付快照'},captured.artifacts);s.completeTrace(trace.id);
  s.requestHumanAcceptance(run.id,{summary:'报告与数据表已交付，请核对结论。'});
});
await simpleRun('done', '官网博客：多 Agent 协作实践', '撰写一篇 2000 字左右的实践文章，附 3 张示意图。', run => { s.requestHumanAcceptance(run.id); s.confirmRunCompletion(run.id); });
await simpleRun('failed', '修复导出 CSV 编码问题', 'Excel 打开导出的 CSV 出现乱码，需要输出 UTF-8 BOM 并补充回归测试。', run => s.failRun(run.id, 'Claude Code 进程退出（code 127）：未找到可执行文件，请在设置 → Runtime 检查安装。', 'runtime'));
await simpleRun('paused', '整理客户访谈纪要', '把 12 份访谈录音转写整理为主题聚类与原话摘录。', run => s.pauseRun(run.id, '等待补充录音'));
await attempt('draft', () => { const task = createTask('设计系统 Token 梳理', '盘点现有颜色、字号、圆角与间距，输出统一 Token 方案。'); seeded.tasks.draft = task.id; });
await simpleRun('archived', '发布说明 v0.1.8', '汇总 v0.1.8 的功能变化与已知问题。', (run, task) => { s.requestHumanAcceptance(run.id); s.confirmRunCompletion(run.id); s.archiveTask(task.id); });

// 自动化：一条启用规则 + 触发记录。
await attempt('automation', () => {
  const automation = s.saveAutomation({ managerAgentId: 'system_project_manager', title: '每日竞品动态简报', objective: '每个工作日 9:00 汇总竞品官网、博客与更新日志的变化，输出 300 字以内简报。', memberAgentIds: ['system_project_manager', 'agent_analyst'], workflowTemplateId: 'content_delivery', cron: '0 9 * * 1-5', enabled: false });
  seeded.automation = automation.id;
  const first = s.triggerAutomation(automation.id);
  if (first.runId) s.requestHumanAcceptance(first.runId);
  s.saveAutomation({ managerAgentId: 'system_project_manager', title: '每周依赖安全巡检', objective: '每周一检查 npm 依赖漏洞并给出升级建议。', memberAgentIds: ['system_project_manager', 'agent_engineer'], cron: '30 10 * * 1', enabled: false });
});

// 沟通：私聊与群聊。
await attempt('chat direct', () => {
  const chat = s.openCommunication({ kind: 'agent', targetId: 'agent_engineer' });
  seeded.chats.direct = chat.id;
  s.sendCommunication(chat.id, { content: '登录页重构大概需要多久？有没有需要我提前确认的范围？', clientRequestId: 'audit-direct-1' });
  const delivery = s.claimCommunication(chat.id);
  s.completeCommunication(chat.id, delivery.id, '预计半天。需要你确认两点：\n\n1. 第三方登录按钮是否在范围内；\n2. 错误提示是否沿用现有红色语义。\n\n其余按验收标准执行。');
});
await attempt('chat group', () => {
  const group = s.openCommunication({ kind: 'group', name: '登录页改版讨论', memberAgentIds: ['agent_analyst', 'agent_designer', 'agent_engineer'] });
  seeded.chats.group = group.id;
  s.sendCommunication(group.id, { content: '@Lena · 产品设计师 窄窗口下的表单布局给个建议？', mentionAgentIds: ['agent_designer'], clientRequestId: 'audit-group-1' });
  const delivery = s.claimCommunication(group.id);
  s.completeCommunication(group.id, delivery.id, '建议改为单列：标签在上、输入在下，按钮通栏。错误提示紧贴字段下方，不要用 toast。');
});
s.close();
assert.deepEqual(seeded.notes,[], 'all required UI fixtures must be available');

await writeStorageLocation(data, { version: 1, workspaceRoot: join(root, 'work'), previousRuntimeRoots: [] });
const pluginSource = join(root, 'plugin');
await mkdir(join(pluginSource, '.claude-plugin'), { recursive: true });
await mkdir(join(pluginSource, 'skills', 'review'), { recursive: true });
await writeFile(join(pluginSource, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: 代码评审清单（展示夹具，不执行）\n---\nNo execution.');
await writeFile(join(pluginSource, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'code-review-kit', description: '代码评审清单与提交前检查 Skill（展示夹具，不执行）。', version: '1.2.0', settings: {} }));

// 3) 启动隔离 Electron 并截图。
const app = await electron.launch({ ...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/Baton'),args:[]}:{args:['apps/electron/main.mjs']}), env: { ...process.env, HOME: home, BATON_DESKTOP_DATA_ROOT: data, BATON_LOG_DIR: join(root, 'logs') }, timeout: 120000 });
const evidence = { root, seeded, shots: [], errors: [], metrics: {} };
try {
  const page = await app.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 90000 });
  const origin = new URL(page.url()).origin;
  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(size.origin)).setContentSize(size.width, size.height), { origin, width, height });
    await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, { width, height });
  };
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const shot = async (name, note = '') => { await page.waitForFunction(()=>!document.querySelector('.collaboration-plain')); const path = join(shots, name + '.png'); await page.screenshot({ path }); evidence.shots.push({ name, note, width: await page.evaluate(() => innerWidth) }); log('shot', name); };
  // Code-reviewed Graphite structure, checked independently of screenshots.
  const inspectPageStructure = async (path, name) => {
    if (!/^\/(inbox|tasks|teams|workflows|agents|roles|marketplace|mcp-marketplace|automations)$/.test(path)) return;
    const frame = await page.evaluate(() => {
      const box = node => { if(!node)return null; const r=node.getBoundingClientRect(),s=getComputedStyle(node); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,fontSize:s.fontSize,fontWeight:s.fontWeight,position:s.position,clipPath:s.clipPath,overflowY:s.overflowY,display:s.display}; };
      const active=document.querySelector('.view.active');
      return {width:innerWidth,height:innerHeight,header:box(document.querySelector('.topbar')),semanticHeading:box(active.querySelector('.page-heading')),title:box(document.querySelector('#breadcrumb-current')),titleText:document.querySelector('#breadcrumb-current').textContent,count:box(document.querySelector('#topbar-count')),countText:document.querySelector('#topbar-count').textContent,expectedCount:active.dataset.titleCount,icon:box(document.querySelector('#topbar-icon')),toolbar:box(active.querySelector('.directory-toolbar')),sidebar:box(document.querySelector('.sidebar')),search:box(active.querySelector('.directory-toolbar input[type=search]')),toolbarButtons:active.querySelectorAll('.directory-toolbar > .primary-button').length,actions:box(document.querySelector('.page-header-actions:not([hidden])')),inboxScope:!!document.querySelector('.topbar [data-inbox-view]')};
    });
    evidence.metrics[name]=frame;
    assert.equal(frame.header.height,48,`${path} titlebar follows the shared 48px frame`);
    assert.equal(frame.sidebar.width,frame.width<=1000?60:232,`${path} sidebar width`);
    assert.equal(frame.title.fontSize,'15px',`${path} titlebar title size`);
    assert.equal(frame.title.fontWeight,'600',`${path} titlebar title weight`);
    assert.ok(frame.titleText.trim() && frame.title.height>0 && frame.icon.width===16,`${path} visible title and icon`);
    assert.equal(frame.count.fontSize,'12px',`${path} titlebar count size`);
    assert.equal(frame.countText,frame.expectedCount,`${path} count follows the active directory`);
    assert.ok(frame.count.width>0,`${path} directory count is visible`);
    if(frame.semanticHeading)assert.deepEqual([frame.semanticHeading.width,frame.semanticHeading.height,frame.semanticHeading.position,frame.semanticHeading.clipPath],[1,1,'absolute','inset(50%)'],`${path} document heading remains screen-reader only`);
    if(frame.toolbar)assert.equal(frame.toolbar.height,44,`${path} toolbar height`);
    assert.equal(frame.toolbarButtons,0,`${path} main actions belong to the titlebar`);
    assert.ok(frame.actions?.bottom<=48,`${path} titlebar action stays in its own row`);
    if(frame.search)assert.equal(frame.search.width,frame.width<=860?150:220,`${path} search width`);
    if(path==='/inbox')assert.equal(frame.inboxScope,true,'pending/recent lives in the titlebar');
    if (path === '/inbox' || path === '/tasks') {
      const groups = await page.locator(path === '/inbox' ? '.inbox-list section' : '.task-list-group').evaluateAll(nodes => nodes.map(group => {
        const heading = group.querySelector('h3'), row = group.querySelector('.inbox-item, .task-row');
        if (!heading || !row) return null;
        const icon = node => node.querySelector('.inbox-state-icon, .task-state-icon');
        return { inset: icon(row).getBoundingClientRect().x - icon(heading).getBoundingClientRect().x, sticky: getComputedStyle(heading).position, overflow: row.scrollWidth > row.clientWidth };
      }).filter(Boolean));
      assert.ok(groups.length > 0, `${path}: grouped fixtures are visible`);
      assert.ok(groups.every(group => group.inset === 24 && group.sticky === 'sticky' && !group.overflow), `${path}: child rows indent below sticky group headings without overflow`);
      evidence.metrics[name].groups = groups;
    }
  };
  const visit = async (path, ready, name, note) => { try { await page.goto(origin + path); if (ready) await page.locator(ready).first().waitFor(); await settle(); await inspectPageStructure(path,name); await shot(name, note); } catch (error) { evidence.errors.push(`${name}: ${error.message.split('\n')[0]}`); log('MISS', name, error.message.split('\n')[0]); } };
  const step = async (name, action) => { try { await action(); } catch (error) { evidence.errors.push(`${name}: ${error.message.split('\n')[0]}`); log('MISS', name, error.message.split('\n')[0]); } };

  await resize(1440, 900);
  await page.goto(origin + '/login'); await page.locator('#username').waitFor(); await settle(); await shot('01-login-wide', '登录页');
  await page.locator('#username').fill('design-audit'); await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('#account-name').waitFor();
  const api = (path, body) => page.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }, { path, body });
  await step('plugin import', async () => log('plugin', (await api('/api/runtime/marketplace', { path: pluginSource })).status));
  await step('mcp import', async () => log('mcp', (await api('/api/runtime/mcp-marketplace', { name: 'GitHub Issues MCP', description: '读取与创建 GitHub Issue（展示夹具，不连接服务）。', content: JSON.stringify({ mcpServers: { github: { command: 'node', args: ['--version'], cwd: root } } }) })).status));

  // Directory drawers dismiss on a real outside pointer click, including role forms.
  // Inner controls and popovers remain usable; centered forms retain their drafts.
  for (const theme of ['light', 'dark']) {
    await page.goto(origin + '/settings/appearance');
    await page.locator(`[name=theme][value=${theme}]`).check();
    for (const width of [1440, 760]) {
      await resize(width, 900);
      await page.goto(origin + '/settings/general');
      await page.locator('.settings-entry.active').waitFor();
      const settingsEntry = await page.locator('.settings-entry').evaluate(button => {
        const box = button.getBoundingClientRect(), style = getComputedStyle(button);
        const centers = [...button.querySelectorAll('.nav-icon,.nav-text')].filter(node => node.getClientRects().length).map(node => {
          const bounds = node.getBoundingClientRect(); return bounds.y + bounds.height / 2 - (box.y + box.height / 2);
        });
        return { border: style.borderTopWidth, height: box.height, centers };
      });
      assert.equal(settingsEntry.border, '0px', 'settings entry has no decorative line above its selection background');
      assert.equal(settingsEntry.height, 28, 'settings entry uses the navigation row height');
      assert.ok(settingsEntry.centers.every(offset => Math.abs(offset) <= .5), 'settings icon and label center vertically in the active background');
      evidence.metrics[`settings-entry-${theme}-${width}`] = settingsEntry;
      for (const [path, trigger] of [['agents', '[data-agent-detail]'], ['roles', '.role-row-open'], ['marketplace', '[data-extension-detail]'], ['mcp-marketplace', '[data-extension-detail]']]) {
        await page.goto(origin + '/' + path);
        await page.locator(trigger).first().click();
        await page.locator('.detail-drawer').waitFor();
        await page.locator('.detail-drawer h2').click();
        assert.equal(await page.locator('#modal-backdrop').evaluate(node => node.open), true, `${path}: inside click preserves drawer`);
        let savedRoleName;
        if (path === 'roles') {
          savedRoleName = await page.locator('#role-form [name=name]').inputValue();
          await page.locator('#role-form [name=name]').fill('关闭抽屉时不自动保存');
          await page.locator('#employee-plugin-search').click();
          await page.locator('#employee-plugin-search').fill('code-review');
          await page.locator('#employee-plugin-search-options button').first().click();
          assert.equal(await page.locator('#modal-backdrop').evaluate(node => node.open), true, 'role popover selection stays inside the drawer');
          assert.match(await page.locator('#role-market-selection .extension-picked').allTextContents().then(items => items.join(' ')), /code-review-kit/);
        }
        await page.locator('#breadcrumb-current').click();
        assert.equal(await page.locator('#modal-backdrop').evaluate(node => node.open), false, `${path} ${theme} ${width}: outside click closes drawer`);
        await page.locator(trigger).first().click();
        await page.locator('.detail-drawer').waitFor();
        if (path === 'roles') assert.equal(await page.locator('#role-form [name=name]').inputValue(), savedRoleName, 'dismissal does not persist a role draft');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#modal-backdrop').evaluate(node => node.open), false, `${path}: Escape closes drawer`);
      }
    }
  }
  await resize(1440, 900);
  await page.goto(origin + '/agents');
  await page.locator('[data-agent-detail]').first().click();
  await page.locator('.detail-drawer').waitFor();
  await page.locator('#agents-search').click();
  assert.equal(await page.locator('#modal-backdrop').evaluate(node => node.open), false, 'outside search closes the drawer');
  assert.equal(await page.locator('#agents-search').evaluate(node => node === document.activeElement), true, 'outside control receives focus in the same click');
  await page.locator('[data-action=new-agent]').click();
  await page.locator('#agent-form').waitFor();
  await page.mouse.click(10, 100);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal-backdrop').evaluate(node => node.open), true, 'centered employee configuration still requires explicit dismissal');
  await page.locator('#modal-close').click();

  for (const theme of (process.env.BATON_REDESIGN_INTERACTION_ONLY ? [] : ['light', 'dark'])) {
    await step('theme ' + theme, async () => { await page.goto(origin + '/settings/appearance'); await page.locator(`[name=theme][value=${theme}]`).check(); await settle(300); });
    const sizes = [[1440,900,'wide'],[760,640,'narrow']];
    for (const [width, height, label] of sizes) {
      await resize(width, height);
      const tag = `${theme}-${label}`;
      await visit('/inbox', '#inbox-content', `01-inbox-${tag}`, '待我处理');
      await step('graphite shell ' + tag, async () => {
        const search = page.locator('.sidebar [data-command-palette]');
        assert.equal(await search.isVisible(), true, 'command entry stays reachable in the sidebar');
        const bounds = await search.boundingBox();
        const sidebar = await page.locator('.sidebar').boundingBox();
        assert.ok(bounds.x >= sidebar.x && bounds.x + bounds.width <= sidebar.x + sidebar.width + 1);
        assert.equal(await page.locator('html').evaluate(node => getComputedStyle(node).getPropertyValue('--pad-page').trim()), width <= 860 ? '16px' : '24px', 'narrow page padding must resolve on the actual root');
        assert.equal(await page.locator('[data-navigation-group=ext] [data-view=marketplace]').count(), 1);
        assert.equal(await page.locator('[data-navigation-group=ext] [data-view=mcp-marketplace]').count(), 1);
        await search.click(); await page.locator('#command-query').waitFor();
        assert.equal(await page.locator('.command-dialog').evaluate(node=>getComputedStyle(node).minHeight),'0px','palette has no artificial empty height');
        assert.equal(await page.locator('#command-results').evaluate(node=>node.matches(':popover-open')),false,'results remain inside the command panel');
        await page.keyboard.press('Escape');
        assert.equal(await search.evaluate(node => node === document.activeElement), true, 'closing search restores keyboard focus');
        if(width>1000){await page.keyboard.press('Meta+Backslash');assert.equal(await page.locator('.sidebar').evaluate(node=>node.getBoundingClientRect().width),60,'sidebar shortcut collapses to the rail');await page.keyboard.press('Meta+Backslash');assert.equal(await page.locator('.sidebar').evaluate(node=>node.getBoundingClientRect().width),232,'sidebar shortcut restores the wide frame');}
      });
      await visit('/tasks', '#tasks-table .task-list, #tasks-table .directory-empty', `02-tasks-${tag}`, '任务中心');
      if (seeded.tasks.main) {
        await visit('/runs/' + seeded.tasks.main, '.collaboration-row', `03-workspace-collab-${tag}`, '任务工作区 · 协作记录');
        assert.equal(await page.locator('.workspace-summary .status-pill').evaluate(n=>n.scrollWidth<=n.clientWidth),true,'task status is fully readable');
        await step('details ' + tag, async () => { await page.locator('[data-toggle-task-details]').first().click(); await settle(); await shot(`04-workspace-details-${tag}`, '任务详情展开'); await page.locator('[data-toggle-task-details]').first().click(); });
        await step('directory ' + tag, async () => { await page.locator('#directory-mode').click(); await settle(1200); const file = page.locator('#working-directory-panel button, #working-directory-panel [role=treeitem]').filter({ hasText: 'docs' }).first(); if (await file.count()) { await file.click(); await settle(600); } await shot(`05-workspace-files-${tag}`, '任务工作区 · 工作目录'); });
        await step('diff ' + tag, async () => { await page.locator('[data-ws-tab="diff"]').first().click(); await settle(1200); await shot(`06-workspace-change-${tag}`, '任务工作区 · CHANGE'); });
        await step('console ' + tag, async () => { await page.locator('#console-mode').click(); await settle(1500); assert.ok((await page.locator('#run-workspace .role-card').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height))).every(height=>height<80),'console member rows retain compact height'); await shot(`07-workspace-console-${tag}`, '任务工作区 · 控制台'); await page.locator('[data-ws-tab="collaboration"]').first().click(); });
      }
      if (seeded.tasks.failed) await visit('/runs/' + seeded.tasks.failed, '.workspace-summary', `08-workspace-failed-${tag}`, '失败任务');
      await visit('/tasks', '#tasks-table .task-list', `09-tasks-again-${tag}`, '');
      await step('new task ' + tag, async () => { await page.locator('[data-action="new-task"]').first().click(); await page.locator('#task-form').waitFor(); await settle(); await shot(`10-new-task-${tag}`, '新建任务弹窗'); await page.locator('#task-form').getByRole('button', { name: '取消' }).first().click().catch(async () => page.locator('#modal-close').click()); await settle(300); });
      await visit('/automations', '[data-auto-new]', `11-automations-${tag}`, '自动化列表');
      if (seeded.automation) {
        await visit('/automations/' + seeded.automation, '#automations-root', `12-automation-detail-${tag}`, '自动化详情');
        await step('automation config ' + tag,async()=>{await page.locator('[data-auto-tab=config]').click();await page.locator('.automation-config-member').first().waitFor();
          const geometry=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect();return {left:box('.automation-facts').x,tab:box('[data-auto-tab=records]').x,edit:box('.automation-detail-header [data-auto-edit]').height,trigger:box('.automation-detail-header [data-auto-trigger]').height,avatars:[...document.querySelectorAll('.automation-config-member .agent-card-avatar')].map(n=>[n.getBoundingClientRect().width,n.getBoundingClientRect().height,Array.from(n.textContent.trim()).length])};});
          assert.equal(geometry.tab,geometry.left);assert.equal(geometry.edit,28);assert.equal(geometry.trigger,28);assert.ok(geometry.avatars.every(([w,h,count])=>w===24&&h===24&&count===1));await shot(`12-automation-tab_config-${tag}`,'自动化配置');});
      }
      if (seeded.chats.direct) await visit('/communication/' + seeded.chats.direct, '#communication-root', `13-chat-direct-${tag}`, '私聊');
      if (seeded.chats.group) await visit('/communication/' + seeded.chats.group, '#communication-root', `14-chat-group-${tag}`, '群聊');
      await step('chat console ' + tag, async () => {
        const memberConsole = page.locator('[data-chat-member-console]').first();
        if (!(await memberConsole.isVisible())) await page.locator('[data-toggle-chat-members]').click();
        await memberConsole.click();
        await page.locator('[data-communication-console]').waitFor();
        await settle(900);
        await shot(`15-chat-console-${tag}`, '群聊 + 控制台');
        await page.locator('[data-close-chat-console]').click();
      });
      await visit('/teams', '#teams-grid', `16-teams-${tag}`, '团队');
      await step('team modal ' + tag, async () => { await page.locator('[data-action="new-team"]').click(); await settle(); await shot(`17-team-modal-${tag}`, '创建团队'); await page.locator('#modal-close').click(); await settle(300); });
      await visit('/workflows', '#workflows-grid', `18-workflows-${tag}`, '工作流');
      await step('workflow editor ' + tag, async () => { await page.locator('#workflows-grid .action-menu summary').first().click(); await page.locator('#workflows-grid [data-edit-workflow]').first().click(); await page.locator('.workflow-editor-canvas svg').first().waitFor(); await settle(300); await shot(`19-workflow-editor-${tag}`, '工作流画布编辑器'); await page.locator('#workflow-form').getByRole('button', {name:'放弃',exact:true}).click(); await settle(300); });
      await visit('/agents', '#agents-grid .agent-card', `20-agents-${tag}`, '数字员工');
      await step('employee card geometry ' + tag, async () => {
        const cards = page.locator('#agents-grid .employee-card');
        const geometry = () => cards.evaluateAll(nodes => nodes.map(node => {
          const card = node.getBoundingClientRect(), footer = node.querySelector('.employee-card-footer').getBoundingClientRect();
          const description = node.querySelector('p').getBoundingClientRect(), role = node.querySelector('.role').getBoundingClientRect();
          return { x:card.x, y:card.y, height:card.height, footerTop:footer.top-card.top, footerBottom:footer.bottom-card.top, descriptionTop:description.top-card.top, descriptionBottom:description.bottom-card.top, roleBottom:role.bottom-card.top, overflow:node.scrollWidth>node.clientWidth };
        }));
        const before = await geometry();
        assert.ok(before.length > 1, 'employee fixtures cover different descriptions and roles');
        for (const key of ['height', 'footerTop']) assert.ok(Math.max(...before.map(card => card[key])) - Math.min(...before.map(card => card[key])) < 2, `employee ${key} stays aligned with or without roles`);
        assert.ok(before.every(card => !card.overflow && card.roleBottom <= card.descriptionTop && card.footerTop >= card.descriptionBottom && card.footerBottom < card.height), 'role, description and permanent actions never overlap or overflow');
        await cards.first().hover();
        assert.deepEqual(await geometry(), before, 'hover never moves employee content or actions');
      });
      await step('agent modal ' + tag, async () => { await page.locator('[data-action="new-agent"]').click(); await settle(900); await shot(`21-agent-modal-${tag}`, '创建数字员工'); await page.locator('#modal-close').click(); await settle(300); });
      await visit('/roles', '#roles-grid', `22-roles-${tag}`, '角色');
      await visit('/marketplace', '[data-market-list] .agent-card, [data-market-empty]', `23-plugins-${tag}`, '插件市场');
      await step('plugin detail ' + tag, async () => { await page.locator('[data-extension-detail]').first().click(); await settle(800); await shot(`24-plugin-detail-${tag}`, '插件详情'); await page.locator('.directory-detail-header [data-close-modal]').click(); await settle(300); });
      await visit('/mcp-marketplace', '[data-market-list] .agent-card, [data-market-empty]', `25-mcp-${tag}`, 'MCP 市场');
      for (const section of ['general', 'appearance', 'runtime', 'workspace', 'cli', 'repositories', 'updates', 'logs']) await visit('/settings/' + section, '#settings-root', `26-settings-${section}-${tag}`, '设置 · ' + section);
      if (theme === 'light' && label === 'wide') {
        await visit('/tasks/archive', '#tasks-table', `27-archive-${tag}`, '归档历史');
        await step('task empty ' + tag, async () => { await page.goto(origin + '/tasks'); await page.locator('#task-search-form input[name=name]').fill('不存在的任务'); await settle(); await shot(`28-tasks-empty-${tag}`, '任务搜索空态'); });
        await step('delete confirm ' + tag, async () => { await page.goto(origin + '/tasks'); await page.locator('#tasks-table .action-menu summary').first().click(); await page.locator('[data-delete-task]').first().click(); await settle(); await shot(`29-confirm-${tag}`, '删除确认'); await page.keyboard.press('Escape'); });
        await step('overview', async () => { await page.goto(origin + '/overview'); await settle(900); await shot('30-overview-light-wide', '总览（默认隐藏）'); });
      }
    }
  }
  // Real interaction regressions, in the same isolated client.
  await resize(1440,900);
  await page.goto(origin+'/inbox'); await page.locator('.inbox-item').first().waitFor();
  await page.locator('.inbox-preview [data-open-run]').click();
  await page.waitForURL(/\/runs\//); await page.locator('#instruction-text').waitFor();
  await page.locator('[data-clear-reply]').click();
  assert.equal(await page.locator('[name=replyToMessageId]').inputValue(),'');
  await page.locator('[data-answer-message]').last().click();
  assert.ok(await page.locator('[name=replyToMessageId]').inputValue());
  await page.goto(origin+'/tasks'); await page.locator('#tasks-table .task-list').waitFor();
  await page.locator('[data-task-layout=board]').click(); assert.equal(await page.locator('.task-board > section').count(),4);
  await page.locator('[data-task-layout=list]').click();
  await page.locator('.action-menu summary').first().focus(); await page.keyboard.press('ArrowDown'); await settle(200);
  await shot('interaction-menu');
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('role')),'menuitem');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('.action-menu[open]').count(),0);
  await page.keyboard.press('ArrowUp'); await page.waitForFunction(()=>document.activeElement===document.querySelector('.action-menu[open] .action-menu-list button:last-child')); await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k'); await page.locator('#command-query').fill('数字员工'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForURL(/\/agents$/); await page.locator('[data-agent-detail]').first().click(); await page.locator('.detail-drawer').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal-backdrop').evaluate(node=>node.open),false);
  await page.goto(origin+'/inbox');
  await page.locator('[data-inbox-select]').filter({hasText:'Q4 竞品调研报告'}).click();
  await page.locator('[data-inbox-artifact]').first().click();
  await page.locator('.inbox-artifact-content').waitFor();
  assert.match(await page.locator('.inbox-artifact-content').textContent(),/隔离界面验收的已保存快照/);
  await page.keyboard.press('Escape');
  await page.locator('[data-inbox-confirm]').click();
  assert.equal(await page.locator('#confirm-completion').isDisabled(),true,'human acknowledgement remains required');
  await page.locator('#ack-completion').check();
  const failCompletion=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'隔离测试：暂不可确认'})});
  await page.route('**/confirm-completion',failCompletion);await page.locator('#confirm-completion').click();
  await page.waitForFunction(()=>!document.querySelector('#confirm-completion').disabled);
  assert.equal(await page.locator('#ack-completion').isChecked(),true,'failed completion retains the review');
  await page.unroute('**/confirm-completion',failCompletion);await page.locator('#confirm-completion').click();
  await page.waitForFunction(()=>!document.querySelector('#modal-backdrop').open);
  assert.equal(await page.evaluate(async id=>(await (await fetch('/api/runs/'+id+'/workspace?view=compact')).json()).run.status,seeded.tasks.acceptance),'completed');
  await page.goto(origin+'/roles');
  const failSelection=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'目录暂不可读（隔离测试）'})});
  await page.route(/\/api\/runtime\/marketplace\?/,failSelection);
  await page.locator('[data-action=new-role]').click();await page.locator('#role-form [name=name]').fill('保留的角色草稿');
  await page.locator('[data-selection-retry]').waitFor();assert.equal(await page.locator('#role-form [type=submit]').isDisabled(),true);
  await page.unroute(/\/api\/runtime\/marketplace\?/,failSelection);await page.locator('[data-selection-retry]').click();
  await page.waitForFunction(()=>!document.querySelector('#role-form [type=submit]').disabled);
  assert.equal(await page.locator('#role-form [name=name]').inputValue(),'保留的角色草稿');await page.locator('#role-form').getByRole('button',{name:'取消',exact:true}).click();
  await resize(760,640); await page.goto(origin+'/communication/'+seeded.chats.group); await page.locator('#communication-input').waitFor();
  const composer=await page.locator('.communication-composer [type=submit]').boundingBox();assert.ok(composer.y+composer.height<=640,'send remains inside narrow viewport');
  await page.locator('[data-toggle-conversation-list]').click();assert.equal(await page.locator('.communication-sidebar').isVisible(),true);
  await page.getByRole('button',{name:'关闭会话列表',exact:true}).click();
  assert.equal(await page.locator('.communication-sidebar').isVisible(),false);
  assert.equal(await page.locator('[data-toggle-conversation-list]').evaluate(node=>node===document.activeElement),true,'closing the overlay restores its entry focus');
  await page.locator('[data-toggle-chat-members]').click();await page.locator('[data-chat-member-console]').first().click();
  await page.locator('[data-communication-console]').waitFor();assert.equal(await page.locator('.communication-sidebar').isVisible(),false);
  await page.locator('[data-close-chat-console]').click();assert.equal(await page.locator('#communication-input').isVisible(),true);
  await page.goto(origin+'/settings/updates');await page.locator('[data-settings-panel="updates"]:not([hidden])').waitFor();
  assert.equal(await page.locator('[name=intervalMinutes], [data-plugin-update-note]').count(),0,'settings contains no retired plugin automatic-update controls');
  await page.goto(origin+'/marketplace');await page.locator('[data-extension-update="all"]').waitFor();
  assert.equal(await page.getByRole('button',{name:'更新全部',exact:true}).count(),1,'plugins expose one explicit manual update entry');
  // 量化：主要页面的 computed style 采样（字号/控件高度/圆角），用于审查依据。
  await resize(1440, 900);
  await page.goto(origin + '/tasks'); await page.locator('#tasks-table .task-list').waitFor();
  evidence.metrics.tasks = await page.evaluate(() => {
    const pick = selector => { const node = document.querySelector(selector); if (!node) return null; const c = getComputedStyle(node), r = node.getBoundingClientRect(); return { selector, fontSize: c.fontSize, fontWeight: c.fontWeight, height: Math.round(r.height), radius: c.borderRadius, color: c.color, background: c.backgroundColor, padding: c.padding }; };
    return ['.topbar', '#breadcrumb-current', '#topbar-count', '.sidebar .nav-item.active', '#task-search-form', '#task-search-form input', '#task-header-actions .primary-button', '#tasks-table .task-group-heading', '#tasks-table .task-row', '#tasks-table .task-title-link', '#tasks-table .task-row-step', '#tasks-table .task-row-actions > .small-button'].map(pick);
  });
  assert.ok(evidence.metrics.tasks.every(sample=>sample&&sample.height>0),'task metrics sample visible Graphite elements');
} catch (error) {
  evidence.errors.push(error.message);
  throw error;
} finally {
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  const cleanup = setTimeout(() => { log('Cleanup timeout; terminating only the isolated test process.'); app.process().kill('SIGKILL'); }, 10000);
  cleanup.unref();
  try { await app.close().catch(() => {}); } finally { clearTimeout(cleanup); }
  log('DONE', root, 'shots:', evidence.shots.length, 'errors:', evidence.errors.length);
}

assert.deepEqual(evidence.errors,[],"all routes and states must render without errors");
