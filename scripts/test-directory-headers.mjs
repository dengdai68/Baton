import {writeStorageLocation} from '../server/storage-layout.mjs';
// Visible, isolated directory header regression; no Provider execution.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuth } from '../server/auth.mjs';
import { createCatalogFixtureStore } from '../tests/fixture-store.mjs';

const baseline = process.env.BATON_DIRECTORY_HEADERS_BASELINE === '1';
const packaged = process.env.BATON_DIRECTORY_HEADERS_PACKAGED === '1';
await mkdir('.data', { recursive: true });
const root = await mkdtemp(resolve('.data/directory-headers-')), home = join(root, 'home');
await mkdir(home, { mode: 0o700 });
const data = packaged ? join(home, '.baton') : join(root, 'client');
const password = randomBytes(24).toString('hex');
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') });
await auth.setAdministrator('directory-qa', password); auth.close();
const store = createCatalogFixtureStore({ databasePath:join(root,'work','records','baton.sqlite'),configurationDirectory:data, workspaceRoot: join(root, 'work') });
store.updateWorkspaceSettings({ workspaceRoot: join(root, 'work') });
const seedTeam = store.listTeams()[0], seedFlow = store.listWorkflowTemplates()[0];
for (let i = 0; i < 22; i++) {
  store.createTeam({ name: '目录搜索团队 ' + i, mission: 'Search boundary ' + i, memberAgentIds: seedTeam.memberAgentIds });
  store.createWorkflowTemplate({ name: '目录搜索流程 ' + i, description: 'Search boundary ' + i, nodes: seedFlow.nodes });
}
store.createTask({managerAgentId:'system_project_manager', title: '目录工具栏验收', objective: '仅检查列表展示，不启动执行。', memberAgentIds: store.listTeams()[0].memberAgentIds, workflowTemplateId: 'software_delivery' });
const taskFlow = store.createWorkflowTemplate({ name: '任务筛选流程旧名', nodes: seedFlow.nodes });
for (let i = 0; i < 23; i++) store.createTask({managerAgentId:'system_project_manager', title: '工作流筛选任务 ' + i, objective: '仅检查列表，不运行模型。', memberAgentIds: seedTeam.memberAgentIds, workflowTemplateId: taskFlow.id });
store.updateWorkflowTemplate(taskFlow.id, { name: '任务筛选流程新名', nodes: seedFlow.nodes });
store.createRole({name:'布局验收角色',prompt:'用于检查角色目录。'});
// Explicit presentation fixture; never invokes a Provider or changes operator history.
const chat = store.openCommunication({kind:'group',name:'消息日期与身份验收',memberAgentIds:seedTeam.memberAgentIds});
for (let i=0;i<2;i++) {
  store.sendCommunication(chat.id,{content:'日期展示夹具 '+i,mentionAgentIds:[seedTeam.memberAgentIds[0]],clientRequestId:'directory-date-fixture-'+i});
  const delivery=store.claimCommunication(chat.id);
  store.completeCommunication(chat.id,delivery.id,'@'+store.listAgents().find(agent=>agent.id===seedTeam.memberAgentIds[1]).name+' 成员展示夹具 '+i);
}
const chatFixture=store.getCommunication(chat.id);
chatFixture.messages.forEach((message,index)=>{const date=new Date();date.setDate(date.getDate()-(index<2?1:0));date.setHours(10,index,0,0);message.createdAt=date.toISOString();});
store.close();
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
const app = await electron.launch({ ...(packaged ? { executablePath: resolve('release/mac-arm64/Baton.app/Contents/MacOS/Baton') } : {}), args: packaged ? [] : ['apps/electron/main.mjs'], env: { ...process.env, HOME: home, BATON_DESKTOP_DATA_ROOT: data, BATON_LOG_DIR: join(root, 'logs') }, timeout: 60000 });
const errors = [], evidence = { baseline, packaged, root, views: [] };
try {
  const page = await app.firstWindow({ timeout: 60000 }); await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 60000 }); await page.waitForLoadState('load');
  const origin = new URL(page.url()).origin;
  await app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith(origin)).setContentSize(1440, 900), origin);
  await page.waitForFunction(() => innerWidth === 1440);
  const login = async p => { p.on('pageerror', e => errors.push(e.message)); await p.goto(origin + '/login'); await p.locator('#username').fill('directory-qa'); await p.locator('#password').fill(password); await p.getByRole('button', { name: '登录', exact: true }).click(); await p.locator('#account-name').waitFor(); };
  await login(page);
  await page.route(`**/api/communications/${chat.id}*`,route=>{
    if(route.request().method()==='GET' && new URL(route.request().url()).pathname===`/api/communications/${chat.id}`)return route.fulfill({json:chatFixture});
    return route.continue();
  });
  await page.evaluate(async () => { const r = await fetch('/api/runtime/mcp-marketplace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '目录验收 MCP', description: '只用于卡片参考，不执行服务。', content: JSON.stringify({ mcpServers: { fixture: { command: 'node', args: ['--version'] } } }) }) }); if (!r.ok) throw Error(await r.text()); });
  const views = { tasks: '#tasks-table .task-row, #tasks-table tr', communication: '.communication-header', teams: '#teams-grid .team-directory-row', workflows: '#workflows-grid .workflow-directory-card', agents: '#agents-grid .agent-card', roles: '#roles-grid .role-directory-row', automations: '#automation-search', marketplace: '#marketplace-root .directory-toolbar', 'mcp-marketplace': '.installed-extension-card' };
  const inspect = async (p, mode) => {
    let taskControlHeight, employeeGeometry;
    for (const [view, ready] of Object.entries(views)) {
      await p.goto(origin + '/' + view + (view==='communication' ? '/'+chat.id : '')); await p.locator(`#${view}-view.active`).waitFor(); await p.locator(ready).first().waitFor();
      await p.waitForFunction(() => document.querySelector('.application-icon')?.naturalWidth > 0);
      const geometry = await p.locator(`#${view}-view`).evaluate(node => {
        const toolbar = node.querySelector('.directory-toolbar, .page-heading:has(> button)'), list = node.querySelector('#teams-grid, #workflows-grid, #agents-grid, #roles-grid');
        const rect = el => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } : null; };
        return { firstItem:rect(list?.querySelector('.team-directory-row, .workflow-directory-card, .role-directory-row')), listClientWidth:list?.clientWidth, listPadding:list ? {left:parseFloat(getComputedStyle(list).paddingLeft),top:parseFloat(getComputedStyle(list).paddingTop),right:parseFloat(getComputedStyle(list).paddingRight)} : null, columns:list ? getComputedStyle(list).gridTemplateColumns : null, toolbar: rect(toolbar), button: rect(document.querySelector(`.page-header-actions[data-header-view="${node.id.replace('-view','')}"]:not([hidden]) .primary-button`)), list: rect(list), borderTop: list ? getComputedStyle(list).borderTopWidth : null, controls: [...node.querySelectorAll('.directory-toolbar input,.directory-toolbar select,.task-search-form input,.task-filter-panel:not([hidden]) select')].map(el=>({id:el.id||el.name||el.getAttribute('aria-label'),...rect(el)})), top:node.getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      if(view!=='communication') {
        await p.waitForFunction(() => document.querySelector('.view.active').dataset.titleCount !== undefined);
        const titlebar=await p.locator('.topbar').evaluate(node=>{const title=node.querySelector('#breadcrumb-current'),count=node.querySelector('#topbar-count'),active=document.querySelector('.view.active');return {title:title.textContent,size:getComputedStyle(title).fontSize,weight:getComputedStyle(title).fontWeight,count:count.textContent,expected:active.dataset.titleCount,countVisible:count.getBoundingClientRect().width>0,icon:node.querySelector('#topbar-icon').getBoundingClientRect().width};});
        assert.equal(titlebar.title,{tasks:'任务',teams:'团队',workflows:'工作流',agents:'数字员工',roles:'角色',automations:'自动化',marketplace:'插件','mcp-marketplace':'MCP'}[view]);assert.equal(titlebar.size,'15px');assert.equal(titlebar.weight,'600');assert.equal(titlebar.icon,16);assert.equal(titlebar.count,titlebar.expected);assert.equal(titlebar.countVisible,true);
        const heading=p.locator(`#${view}-view .page-heading`).first();
        if(await heading.count())assert.deepEqual(await heading.evaluate(node=>{const r=node.getBoundingClientRect(),c=getComputedStyle(node);return [r.width,r.height,c.clipPath];}),[1,1,'inset(50%)']);
      }
      if(view==='tasks')taskControlHeight=geometry.controls[0].height;
      if(view==='agents')employeeGeometry=geometry;
      if (!baseline) {
        if(view==='communication') {
          await p.locator('.communication-message:not(.from-human) .communication-message-avatar').first().waitFor();
          assert.deepEqual(await p.locator('.communication-day-divider').allTextContents(),['昨天','今天']);
          assert.equal(await p.locator('.communication-message.from-human .agent-card-avatar').count(),0);
          assert.equal(await p.locator('.communication-message:not(.from-human) .member-mention').count(),2,'member mentions retain highlighting');
          const avatar=await p.locator('.communication-message-avatar').first().evaluate(node=>{const css=getComputedStyle(node);return {width:css.width,height:css.height,radius:css.borderRadius};});
          assert.deepEqual(avatar,{width:'28px',height:'28px',radius:'30%'});
        }
        for(const control of geometry.controls)assert.equal(control.height,taskControlHeight,`${mode}/${view}/${control.id} matches task controls`);
        if(view==='roles'){
          assert.equal(geometry.toolbar.y-geometry.top,employeeGeometry.toolbar.y-employeeGeometry.top,'role toolbar top matches employee directory');
          assert.equal(geometry.controls[0].y-geometry.top,employeeGeometry.controls[0].y-employeeGeometry.top,'role search top matches employee directory');
          assert.equal(geometry.list.y-geometry.top,employeeGeometry.list.y-employeeGeometry.top,'role rows keep the shared toolbar-to-list spacing');
          assert.ok(Math.abs(geometry.firstItem.width-geometry.listClientWidth)<1,'role row spans the directory');
          assert.equal(await p.locator('#roles-grid .role-row-prompt').first().evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
          await p.locator('#roles-grid .role-row-prompt').first().click();await p.locator('#role-form').waitFor();await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
        }
        if(view==='automations'){
          assert.equal(await p.locator('#automation-search select').count(),0);
          assert.equal(await p.locator('#automation-search [data-auto-status]').count(),3);
          const chip=await p.locator('[data-auto-status=all]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,pressed:el.getAttribute('aria-pressed')}));
          assert.equal(chip.pressed,'true');assert.notEqual(chip.background,'rgba(0, 0, 0, 0)');
        }

        assert.equal(geometry.overflow, false, `${mode}/${view} fits`);
        if (['teams', 'workflows'].includes(view)) {
          assert.equal(geometry.borderTop, '0px', `${mode}/${view} has no toolbar/list divider`);
          assert.equal(await p.locator(`#${view}-view > .directory-toolbar > .primary-button`).count(), 0);
          assert.equal(await p.locator(`#${view}-header-actions .primary-button`).count(), 1);
          assert.ok(geometry.list.y >= geometry.toolbar.bottom, 'directory content follows its toolbar');
          assert.ok(Math.abs(geometry.firstItem.x - geometry.list.x - geometry.listPadding.left) < 1, 'first row/card aligns with the list content edge');
          assert.ok(Math.abs(geometry.firstItem.y - geometry.list.y - geometry.listPadding.top) < 1, 'first row/card starts at the list content top');
          assert.ok(geometry.firstItem.x + geometry.firstItem.width <= geometry.list.x + geometry.listClientWidth - geometry.listPadding.right + 1, 'row/card fits the directory');
          if (view === 'teams') assert.ok(Math.abs(geometry.firstItem.width - geometry.listClientWidth) < 1, `team row spans the usable directory width: ${JSON.stringify(geometry)}`);
          if (view === 'workflows') assert.equal(geometry.columns.split(' ').length, mode === 'desktop-wide' ? 3 : 1, 'workflow cards adapt from three columns to one');
          assert.ok(geometry.button.bottom <= geometry.toolbar.y, 'create action stays in the titlebar above filtering');
          assert.ok(geometry.button.x + geometry.button.width <= await p.evaluate(() => innerWidth));
          await p.locator(`#${view}-header-actions .primary-button`).click(); await p.locator('#modal-backdrop.open').waitFor(); await p.locator('#modal-content h2').waitFor();
          await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
          const search = p.locator(`#${view}-search`);
          await search.fill('目录搜索' + (view === 'teams' ? '团队 21' : '流程 21'));
          const rows = p.locator(view === 'teams' ? '#teams-grid .team-directory-row' : '#workflows-grid .workflow-directory-card');
          await p.waitForFunction(selector=>document.querySelectorAll(selector).length===1, view === 'teams' ? '#teams-grid .team-directory-row' : '#workflows-grid .workflow-directory-card');
          assert.equal(await rows.count(), 1, 'filter includes entries outside initial 20-row page');
          await search.fill('不存在的目录名称'); await p.waitForFunction(selector=>document.querySelectorAll(selector).length===0, view === 'teams' ? '#teams-grid .team-directory-row' : '#workflows-grid .workflow-directory-card'); assert.equal(await rows.count(), 0);
          assert.match(await p.locator(`#${view}-grid`).innerText(), /没有匹配/);
          await search.clear(); await p.waitForFunction(selector=>document.querySelectorAll(selector).length===20, view === 'teams' ? '#teams-grid .team-directory-row' : '#workflows-grid .workflow-directory-card'); assert.equal(await rows.count(), 20);
          await p.locator(`[data-pagination="${view}"] [data-page="2"]`).click();
          await search.fill('目录搜索' + (view === 'teams' ? '团队 21' : '流程 21'));
          await p.waitForFunction(selector=>document.querySelectorAll(selector).length===1, view === 'teams' ? '#teams-grid .team-directory-row' : '#workflows-grid .workflow-directory-card');
          assert.equal(await rows.count(), 1, 'query resets pagination');
          const item=rows.first();
          await item.locator('.action-menu summary').click();
          await item.getByRole('menuitem',{name:view==='teams'?'编辑团队':'编辑',exact:true}).click();
          await p.locator(view==='teams'?'#team-form':'#workflow-form').waitFor();
          await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
          await item.locator('.action-menu summary').click();
          await item.getByRole('menuitem',{name:view==='teams'?'删除团队':'删除',exact:true}).click();
          await p.locator('#modal-backdrop.open').waitFor();
          await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
          if(view==='workflows') {
            assert.ok(await item.locator('.flow-mini-node').count()>0);
            await item.locator('.action-menu summary').click();
            await item.getByRole('menuitem',{name:'查看详情',exact:true}).click();
            await p.locator('#workflow-node-detail').waitFor();
            await p.getByRole('button',{name:'编辑工作流',exact:true}).click();
            await p.locator('#workflow-form').waitFor();await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
          } else {
            assert.equal(await item.locator('[data-chat-team]').count(),1,'only the explicit chat button opens communication');
            await item.getByRole('button',{name:'群聊',exact:true}).click();
            await p.locator('#communication-view.active').waitFor();
            assert.equal(await p.locator('#team-form').count(),0,'chat does not open the team editor');
            await p.goto(origin+'/teams');await p.locator('.team-directory-row').first().waitFor();
            // The row opens the existing editor; the explicit chat button is separate.
            const teamRow=p.locator('.team-directory-row').first(),rowButton=teamRow.locator('.team-row-open');
            const teamId=await rowButton.getAttribute('data-edit-team');
            const original=await p.evaluate(async id=>(await(await fetch('/api/teams/'+id)).json()).team,teamId);
            assert.equal(await rowButton.getAttribute('aria-label'),'编辑团队 '+original.name);
            const mission=await teamRow.locator('.team-row-copy p').boundingBox();
            await p.mouse.click(mission.x+mission.width/2,mission.y+mission.height/2);
            const form=p.locator('#team-form');await form.waitFor();
            assert.equal(new URL(p.url()).pathname,'/teams','row click keeps the directory route');
            assert.equal(await form.locator('[name=name]').inputValue(),original.name);
            assert.equal(await form.locator('[name=mission]').inputValue(),original.mission);
            assert.equal(await form.locator('[name=status]').inputValue(),original.status);
            assert.deepEqual((await form.locator('#team-members-picker [data-remove-extension]').evaluateAll(nodes=>nodes.map(node=>node.dataset.removeExtension))).sort(),[...original.memberAgentIds].sort());
            await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
            for(const key of ['Enter','Space']) {
              await rowButton.focus();await p.keyboard.press(key);await form.waitFor();
              assert.equal(await form.locator('[name=name]').inputValue(),original.name,'native row button supports '+key);
              await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
            }
            assert.deepEqual(await p.evaluate(async id=>(await(await fetch('/api/teams/'+id)).json()).team,teamId),original,'opening and cancelling preserves the team');
            await teamRow.getByRole('button',{name:'群聊',exact:true}).click();await p.locator('#communication-view.active').waitFor();
            const chatPath=new URL(p.url()).pathname;
            await p.goto(origin+'/teams');await p.locator('.team-directory-row').first().waitFor();
            await p.locator('.team-directory-row').first().getByRole('button',{name:'群聊',exact:true}).focus();await p.keyboard.press('Enter');await p.locator('#communication-view.active').waitFor();
            assert.notEqual(new URL(p.url()).pathname,chatPath,'explicit chat preserves the existing independent-group creation contract');
            const conversation=await p.evaluate(async()=>{const id=location.pathname.split('/').at(-1);return (await(await fetch('/api/communications/'+id)).json()).conversation;});
            assert.equal(conversation.kind,'group');
            assert.deepEqual(conversation.members.map(member=>member.id).sort(),[...original.memberAgentIds].sort(),'explicit chat uses the current team members');
            await p.goto(origin+'/teams');await p.locator('.team-directory-row').first().waitFor();
            evidence[mode+'-team-actions']={row:'edit',keyboard:['Enter','Space'],chat:'explicit button',independentGroup:true,members:original.memberAgentIds.length,status:original.status};
          }
          await search.clear();
          evidence[mode + '-' + view + '-search'] = 'PASS';
        }
        if (view === 'tasks') {
          assert.deepEqual(await p.locator('#task-search-form [data-task-chip]').evaluateAll(nodes=>nodes.map(node=>node.dataset.taskChip)), ['all','attention','active','backlog','done']);
          assert.equal(await p.locator('#task-search-form [type=submit], #task-search-form [type=reset]').count(), 0);
          assert.equal(await p.locator('#task-header-actions [data-action=new-task]').count(), 1);
          assert.equal(await p.locator('#task-filter-panel').isVisible(), false);
          assert.equal(await p.locator('#tasks-heading button').count(), 0);
          assert.equal(await p.locator('.topbar').isVisible(), true);
          assert.equal(await p.locator('#breadcrumb-current').textContent(), '任务');
          // The titlebar carries the visual title/count; the document heading stays accessible.
          const heading = await p.locator('#tasks-heading').evaluate(node => { const c=getComputedStyle(node),r=node.getBoundingClientRect();return {position:c.position,width:r.width,height:r.height,clip:c.clipPath}; });
          assert.deepEqual(heading, {position:'absolute',width:1,height:1,clip:'inset(50%)'}, 'semantic heading is screen-reader only');
          assert.equal(await p.locator('#tasks-heading h2').evaluate(node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim()), '任务');
          await p.locator('[data-task-chip=attention]').click();
          await p.locator('#tasks-table .directory-empty').waitFor();
          assert.equal(await p.locator('[data-task-chip=attention]').getAttribute('aria-pressed'), 'true');
          await p.locator('[data-task-chip=backlog]').click();
          await p.locator('#tasks-table .task-row').first().waitFor();
          assert.equal(await p.locator('#tasks-table [data-task-group=backlog]').count(), 1);
          assert.equal(await p.locator('#tasks-table [data-task-group=attention]').count(), 0);
          // Row actions stay visible without hover and start at the action column's left edge.
          await p.mouse.move(1, 1);
          const rowActions = await p.locator('#tasks-table .task-row-actions').evaluateAll(nodes => nodes.map(node => {
            const box = node.getBoundingClientRect(), first = node.firstElementChild.getBoundingClientRect();
            return { offset: Math.round(first.left - box.left), justify: getComputedStyle(node).justifyContent, labels: [...node.querySelectorAll(':scope > .small-button, .action-menu > summary')].map(item => [item.textContent.trim(), getComputedStyle(item).opacity]) };
          }));
          console.log(`${mode} task row actions`, JSON.stringify(rowActions.slice(0, 3)));
          assert.ok(rowActions.length > 0);
          for (const row of rowActions) {
            assert.equal(row.offset, 0, 'row actions start at the column left edge');
            assert.equal(row.justify, 'flex-start');
            assert.deepEqual(row.labels.map(([label]) => label), ['启动', '⋯'], 'draft rows show the next action and the more menu');
            assert.ok(row.labels.every(([, opacity]) => opacity === '1'), 'row actions are visible without hover');
          }
          evidence[mode + '-task-row-actions'] = { rows: rowActions.length, alignment: 'left', visibleWithoutHover: true };
          // Title opens the existing draft editor; the more menu retains deletion confirmation.
          await p.locator('#tasks-table .task-title-link').first().click();
          await p.locator('#task-form').waitFor(); await p.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
          await p.locator('#tasks-table .action-menu summary').first().click();
          await p.locator('#tasks-table [data-delete-task]').first().click();
          await p.locator('#confirm-delete-task').waitFor();
          assert.equal(await p.locator('#confirm-delete-task').isDisabled(), true);
          await p.locator('#modal-content [data-close-modal]').click();
          await p.locator('[data-task-chip=all]').click();
          await p.locator('[data-task-filters]').click();
          const workflow = p.locator('#task-search-form [name=workflow]');
          await workflow.selectOption(taskFlow.id);
          await p.waitForFunction(() => document.querySelectorAll('#tasks-table .task-workflow').length >= 20 && [...document.querySelectorAll('#tasks-table .task-workflow')].every(node=>node.textContent === '任务筛选流程旧名'), null, { timeout: 20000 });
          await p.locator('[data-task-filters]').click();
          assert.equal(await p.locator('#tasks-table .task-row').count(), 20);
          assert.deepEqual(await p.locator('#tasks-table .task-workflow').allTextContents(), Array(20).fill('任务筛选流程旧名'));
          await p.locator('[data-pagination="tasks"] [data-page="2"]').click();
          await p.waitForFunction(() => document.querySelectorAll("#tasks-table .task-row").length === 3);
          assert.equal(await p.locator('#tasks-table .task-row').count(), 3);
          await p.locator('[data-pagination="tasks"] [data-page="1"]').click(); await p.waitForTimeout(400);
          await p.locator('#task-search-form [name=name]').fill('工作流筛选任务 22');
          await p.waitForFunction(() => document.querySelectorAll('#tasks-table .task-row').length === 1 && document.querySelector('#tasks-table .task-title-link')?.textContent === '工作流筛选任务 22', null, { timeout: 15000 });
          assert.equal(await p.locator('#tasks-table .task-row').count(), 1, 'combined filter searches before pagination');
          assert.equal(await p.locator('#tasks-table .task-title-link').first().innerText(), '工作流筛选任务 22');
          await p.locator('[data-task-filters]').click();
          await p.locator('#task-search-form [name=status]').selectOption('running');
          await p.locator('#tasks-table .directory-empty').waitFor();
          assert.match(await p.locator('#tasks-table').innerText(), /没有匹配/);
          await p.locator('#task-search-form [name=status]').selectOption('all');
          await workflow.selectOption('all');
          await p.locator('[data-task-filters]').click();
          const name = p.locator('#task-search-form [name=name]'); await name.fill('目录工具栏验收');
          await p.locator('[data-task-center-page=archive]').click();
          assert.equal(await p.locator('#breadcrumb-current').textContent(), '归档历史');
          assert.equal(await p.locator('#tasks-heading h2').evaluate(node=>[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent).join('').trim()), '归档历史');
          assert.equal(await name.inputValue(), '目录工具栏验收');
          await p.locator('[data-task-center-page=current]').click();
          assert.equal(await p.locator('#breadcrumb-current').textContent(), '任务');
          await name.clear();
        }
      }
      evidence.views.push({ mode, view, ...geometry }); await p.screenshot({ path: join(root, `${mode}-${view}.png`) });
    }
  };
  await page.goto(origin + '/settings/appearance');
  await page.locator('[name=theme][value=light]').check();
  await inspect(page, 'desktop-wide');
  await page.goto(origin + '/settings/appearance');
  await page.locator('[name=theme][value=dark]').check();
  await app.evaluate(({ BrowserWindow }, origin) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith(origin)).setContentSize(760, 600), origin); await page.waitForFunction(() => innerWidth === 760);
  await inspect(page, 'desktop-narrow');
  assert.deepEqual(errors, []); evidence.result = 'PASS'; await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS directory headers:', root);
} catch (error) { console.error('Evidence root:', root); throw error; }
finally { await app.close(); }
