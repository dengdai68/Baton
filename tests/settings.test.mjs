import { formatMessageTime } from '../client/console-projections.mjs';
import { communicationDayLabel } from '../web/communication.js';
import {runtimeLabel,RUNTIME_IDS} from "../client/runtime-providers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ByteCache } from "../client/byte-cache.mjs";
import { applyPreferences, NAVIGATION, normalizePreferences, PREFERENCES_KEY, readPreferences, savePreferences } from "../web/preferences.mjs";
import { SETTINGS_PAGES, createClosePreferenceUI, createCliInstallationUI } from "../web/settings.mjs";
import { createCatalogFixtureStore as createStore } from "./fixture-store.mjs";
import { mkdtemp, mkdir, rm, writeFile, realpath, stat, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join, isAbsolute, normalize, parse } from "node:path";
import { STATUS_TEXT, buildConsoleEntries, taskActionLabel, taskMatchesFilter, taskNeedsAttention } from "../client/console-projections.mjs";
import { collaborationRecords, partyName, workflowDisplay } from "../client/console-projections.mjs";
import { createMarketplaceUI, createMcpMarketplaceUI } from "../web/marketplace.mjs";
import { $t, $tm } from '../client/i18n.mjs';
// Extracted renderer source runs outside its module; expose the translators it imports
// (identity in the source language, so rendered text is unchanged).
Object.assign(globalThis, { $t, $tm });
// Source assertions predate $t(): compare the original wording, not the call form.
const sourceWording = text => text.replace(/\$\{\$t\(("(?:[^"\\]|\\.)*")\)\}/g, (_, literal) => JSON.parse(literal)).replace(/\$t\(("(?:[^"\\]|\\.)*")\)/g, '$1');

function closePanel() {
  const options = ["quit", "tray"].map(value => ({ value, checked: false, disabled: true })), save = { disabled: true }, status = {}, retry = { hidden: true };
  const form = { querySelectorAll: () => options, querySelector: () => save, hidden: false };
  const panel = { hidden: false, querySelector: selector => ({ '[data-close-form]': form, '[data-close-status]': status, '[data-close-retry]': retry })[selector] };
  return { panel, options, save, status, retry, form, selected: () => options.find(option => option.checked)?.value || "", choose(value) { options.forEach(option => { option.checked = option.value === value; }); return form.onchange(); } };
}
test('update settings expose application updates without plugin controls or requests',async()=>{
  const source=await readFile(new URL('../web/settings.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/createPluginUpdateSettingsUI|data-plugin-update|marketplace\/updates|pluginUpdateUI/);
  assert.match(source,/data-app-update-check/);assert.match(source,/createAppUpdateUI/);
});
test('task console defaults to the latest executed known member, not the last finished long call',async()=>{
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const select=runWithCache(source.slice(source.indexOf('function latestExecutedAgentId('),source.indexOf('function workspaceDirectoryDetails('))+';latestExecutedAgentId');
  const agents=[{id:'manager'},{id:'worker'}];
  assert.equal(select(agents,[]),null);
  assert.equal(select(agents,[{agentId:'worker',startedAt:'2026-10-01',endedAt:'2026-10-05'},{agentId:'manager',startedAt:'2026-10-02',endedAt:'2026-10-03'},{agentId:'unknown',startedAt:'2026-10-06'}]),'manager');
  assert.equal(select(agents,[{agentId:'manager',startedAt:'2026-10-02'},{agentId:'worker',startedAt:'2026-10-03',status:'running'}]),'worker');
  assert.match(source,/if \(!consoleAgents.some\(\(agent\) => agent.id === state.selectedAgentId\)\) state.selectedAgentId = tab === 'console' \? latestExecutedAgentId/);
});
test('storage HTTP validates before its single restart request and refuses busy writes',async t=>{
  const {validateStorageDestination}=await import('../server/storage-layout.mjs');
  await mkdir('.data',{recursive:true});const root=await mkdtemp(resolve('.data/storage-route-'));t.after(()=>rm(root,{recursive:true,force:true}));const data=join(root,'source');await mkdir(data);
  const source=await readFile(new URL('../server/index.mjs',import.meta.url),'utf8'),start=source.indexOf('  if (pathname === "/api/settings/workspace" && request.method === "PUT")'),end=source.indexOf('  // CLI paths',start);
  const requests=[];let busy=false;
  async function save(workspaceRoot){let result,finish;await runWithCache(`(async()=>{${source.slice(start,end)}})()`,{pathname:'/api/settings/workspace',request:{method:'PUT'},response:{once(event,callback){assert.equal(event,'finish');finish=callback;}},readJson:async()=>({workspaceRoot}),version:'test',validateStorageDestination,storage:{dataRoot:data,controlRoot:data},updateRestartLease:null,resettingData:false,writeRequests:1,runtimeTestActive:false,taskDeletionLocks:new Set(),pluginUpdates:{status:()=>({running:false})},communications:{isActive:()=>false},store:{pendingCommunications:()=>[],listPatrolRunIds:()=>busy?['active']:[],listRecoveryRunIds:()=>[]},hasActiveExecution:()=>false,randomUUID:()=> 'lease',process:{env:{},send:value=>requests.push(value)},sendJson(response,status,value){result={status,value};}});finish?.();return result;}
  for(const invalid of ['/',root+'/../'.repeat(root.split('/').length),'relative','',null,'/bad\0path'])await assert.rejects(save(invalid));assert.equal(requests.length,0);
  const target=join(root,'任务 根');const result=await save(target);assert.equal(result.status,200);assert.equal(result.value.restarting,true);assert.equal(requests.length,1);assert.equal(requests[0].workspaceRoot,await realpath(target));
  await writeFile(join(target,'keep.txt'),'keep');busy=true;assert.equal((await save(target)).status,409);assert.equal(requests.length,1);assert.equal(await readFile(join(target,'keep.txt'),'utf8'),'keep');
});
test('collaboration aligns by sender, never by the human recipient or human filter',async()=>{
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8'),start=source.indexOf('function confirmTaskOutgoing('),end=source.indexOf('/* ---------- 任务空间数据与动作',start),dock={querySelector(){return null;},querySelectorAll(){return [];}};
  const messages=[{id:'human',createdAt:'2026-01-01T00:00:00Z',sender:{type:'human',name:'操作者'},recipient:{type:'agent',name:'员工'},content:'HUMAN-CONTENT'},{id:'employee',createdAt:'2026-01-01T00:00:01Z',sender:{type:'agent',name:'员工'},recipient:{type:'human',name:'操作者'},content:'AGENT-TO-HUMAN'}];
  const render=runWithCache(`${source.slice(start,end)};renderCollaboration`,{$:selector=>selector==='#collaboration-panel'?dock:{addEventListener(){}},state:{workspace:{pendingQuestions:[]}},workspaceView:()=>({draft:'',collaborationItems:collaborationRecords({messages})}),collaborationRecords,communicationDayLabel,formatMessageTime,acceptanceReview:()=>null,esc:String,exactTime:String,roleColor:()=> 'color-system',initialsOf:agent=>agent.name?.slice(0,1)||'?',collaborationMessageMarkup:content=>content,sendInstruction(){},refreshCollaborationBodies(){},messageAttachments(){return "";},draftAttachments(){return "";},attachmentControls(){return "";},outgoingMessageFeedback(){return '';},outgoingAttachmentMarkup(){return '';},bindTaskAttachments(){},requestAnimationFrame:callback=>callback()});
  render({run:{id:'run',status:'paused',task:{}},messages},[]);
  const articles=dock.innerHTML.match(/<article[\s\S]*?<\/article>/g);assert.equal(articles.length,2);assert.match(articles[0],/class="collaboration-row from-human/);assert.match(articles[1],/AGENT-TO-HUMAN/);assert.doesNotMatch(articles[1],/from-human/);
});
test('collaboration history accumulates pages, preserves failure state and rejects stale pages after latest',async()=>{
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8'),start=source.indexOf('async function loadCollaboration('),end=source.indexOf('async function loadWorkspace(',start);
  const state={currentView:'workspace',selectedRunId:'run'},view={tab:'collaboration'},requests=[];
  const load=runWithCache(source.slice(start,end)+';loadCollaboration',{URLSearchParams,state,workspaceView:()=>view,$:()=>null,renderWorkspace(){},api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))});
  let pending=load('run',{render:false});requests.at(-1).resolve({items:[{id:'new'}],hasMore:true,nextBefore:'new'});await pending;
  pending=load('run',{older:true,render:false});assert.match(requests.at(-1).path,/before=new/);requests.at(-1).resolve({items:[{id:'old'},{id:'new'}],hasMore:true,nextBefore:'old'});await pending;
  assert.equal(JSON.stringify(view.collaborationItems.map(x=>x.id)),JSON.stringify(['old','new']));
  pending=load('run',{older:true,render:false});requests.at(-1).reject(Error('controlled read failure'));await pending;
  assert.equal(JSON.stringify(view.collaborationItems.map(x=>x.id)),JSON.stringify(['old','new']));assert.equal(view.collaborationBefore,'old');assert.equal(view.collaborationError,'controlled read failure');assert.equal(view.collaborationRetryOlder,true);
  pending=load('run',{render:false});requests.at(-1).resolve({items:[{id:'latest'}],hasMore:true,nextBefore:'latest'});await pending;
  assert.equal(JSON.stringify(view.collaborationItems.map(x=>x.id)),JSON.stringify(['old','new']),'background refresh preserves the accumulated range');
  const stale=load('run',{older:true,render:false}),staleRequest=requests.at(-1);
  pending=load('run',{latest:true,render:false});requests.at(-1).resolve({items:[{id:'latest'}],hasMore:true,nextBefore:'latest'});await pending;
  staleRequest.resolve({items:[{id:'ancient'}],hasMore:false,nextBefore:null});await stale;
  assert.equal(JSON.stringify(view.collaborationItems.map(x=>x.id)),JSON.stringify(['latest']));assert.equal(view.collaborationBrowsing,false);
});
test('plugin and MCP empty/error states are outside their card grid, and search transitions remain truthful',async t=>{
  for(const createUI of [createMarketplaceUI,createMcpMarketplaceUI]) {
    const nodes=new Map(),query=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,dataset:{},classList:{toggle(){}},querySelector:query,insertAdjacentHTML(){},setAttribute(key,value){this[key]=value;}});return nodes.get(selector);};
    const root={isConnected:true,querySelector:query};let fail=false;
    const ui=createUI({api:async()=>{if(fail)throw Error('read failed');return {plugins:[],entries:[]};},esc:String});
    t.after(()=>ui.unmount());
    ui.mount(root);assert.equal(query('[data-market-empty]')['aria-busy'],'true');await new Promise(done=>setImmediate(done));
    assert.match(root.innerHTML,/<div data-market-list hidden[^>]*><\/div><div class="directory-empty market-directory-empty"/);
    assert.equal(query('[data-market-list]').innerHTML,'');assert.equal(query('[data-market-list]').hidden,true);assert.match(query('[data-market-empty]').innerHTML,/<strong>尚未安装/);
    assert.equal(query('[data-market-empty]')['aria-busy'],'false');assert.match(root.innerHTML,/<div class="directory-content"><div data-market-list/);
    query('input').oninput({target:{value:'missing'}});await new Promise(done=>setTimeout(done,250));assert.match(query('[data-market-empty]').innerHTML,/<strong>没有匹配的/);
    ui.unmount();fail=true;ui.mount(root);await new Promise(done=>setImmediate(done));assert.equal(query('[data-market-empty]').textContent,'read failed');assert.equal(query('[data-market-empty]').role,'alert');
    query('input').oninput({target:{value:'another search'}});assert.equal(query('[data-market-empty]').textContent,'read failed','typing after a failed read must not imply an empty catalog');
  }
});
function cliPanel() {
  const install = {}, refresh = {}, paths = {};
  // Mimic the DOM: assigning innerHTML updates the visible text (tags stripped).
  const status = { textContent: '', set innerHTML(value) { this.textContent = String(value).replace(/<[^>]*>/g, ''); }, get innerHTML() { return this.textContent; } };
  return { install, refresh, status, paths, panel: { hidden: false, querySelector: key => ({ '[data-cli-install]': install, '[data-cli-refresh]': refresh, '[data-cli-status]': status, '[data-cli-paths]': paths })[key] } };
}
test('General CLI installation needs a desktop bridge and explicit click; cancel, failure, retry and detach are truthful', async () => {
  const web = cliPanel(); await createCliInstallationUI(web.panel).refresh();
  assert.equal(web.install.hidden, true); assert.match(web.status.textContent, /客户端宿主接口不可用/);
  let writes = 0, fail = false, cancelled = true;
  const mac = cliPanel(), value = { supported: true, canInstall: true, installed: false, commandPath: '/fixture/baton', profilePaths: ['/fixture/.zshrc'] };
  const ui = createCliInstallationUI(mac.panel, { getCliInstallation: async () => value, installCli: async () => {
    writes++; if (fail) throw new Error('failure'); return { ...value, cancelled, installed: !cancelled };
  } });
  await ui.refresh(); assert.equal(writes, 0); assert.equal(mac.install.disabled, false); assert.match(mac.paths.textContent, /\.zshrc/);
  await mac.install.onclick(); assert.equal(writes, 1); assert.match(mac.status.textContent, /已取消/);
  fail = true; await mac.install.onclick(); assert.equal(mac.install.disabled, true); assert.match(mac.status.textContent, /失败/);
  fail = false; cancelled = false; await mac.refresh.onclick(); await mac.install.onclick(); assert.match(mac.status.textContent, /已安装/);
  const late = cliPanel(); let finish;
  const detached = createCliInstallationUI(late.panel, { getCliInstallation: () => new Promise(resolve => { finish = resolve; }), installCli() {} });
  const pending = detached.refresh(); detached.dispose(); finish(value); await pending;
  assert.equal(late.paths.textContent, undefined);
});
test("General settings keeps Web separate and does not choose a Mac close default", async () => {
  const web = closePanel();
  await createClosePreferenceUI(web.panel, undefined).refresh();
  assert.equal(web.form.hidden, true); assert.match(web.status.textContent, /客户端宿主接口不可用/);
  const mac = closePanel(); let writes = 0;
  const ui = createClosePreferenceUI(mac.panel, { getPreferences: async () => ({ platform: "darwin", closeMode: null }), setCloseMode: async () => { writes++; } });
  await ui.refresh();
  assert.equal(mac.selected(), ""); assert.equal(mac.options.every(option => !option.checked), true); assert.equal(mac.save.disabled, true); assert.equal(writes, 0);
  assert.match(mac.status.textContent, /首次关闭/);
});
test("General settings saves immediately, restores a failed change and ignores detached reads", async () => {
  const mac = closePanel(); let fail = true, reads = 0, saved = "quit";
  const desktop = { getPreferences: async () => { reads++; return { platform: "darwin", closeMode: saved }; }, setCloseMode: async mode => {
    if (fail) throw new Error("disk unavailable"); saved = mode; return { platform: "darwin", closeMode: mode };
  } };
  const ui = createClosePreferenceUI(mac.panel, desktop);
  await ui.refresh(); await mac.choose("tray");
  assert.equal(saved,"quit");assert.equal(mac.selected(),"quit");assert.equal(mac.save.hidden,true);assert.match(mac.status.textContent,/保存失败/);
  fail=false;await mac.choose("tray");
  assert.equal(saved,"tray");assert.equal(mac.save.disabled,true);assert.match(mac.status.textContent,/已保存/);
  let finish; const late = closePanel();
  const detached = createClosePreferenceUI(late.panel, { getPreferences: () => new Promise(resolve => { finish = resolve; }) });
  const pending = detached.refresh(); detached.dispose(); finish({ platform: "darwin", closeMode: "tray" }); await pending;
  assert.equal(late.selected(), "");
  const broken = closePanel(); let brokenRead = true;
  const retryUI = createClosePreferenceUI(broken.panel, { getPreferences: async () => { if (brokenRead) throw new Error("unavailable"); return { platform: "darwin", closeMode: null }; } });
  await retryUI.refresh(); assert.equal(broken.retry.hidden, false); assert.equal(broken.options.every(option => option.disabled), true);
  brokenRead = false; await broken.retry.onclick(); assert.equal(broken.retry.hidden, true); assert.equal(broken.options.every(option => !option.disabled), true);
});

test("Runtime headings stay subordinate and General uses an explicit native radio group", async () => {
  const settings = sourceWording(await readFile(new URL("../web/settings.mjs", import.meta.url), "utf8"));
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const desktop = (await Promise.all(["../web/tokens.css","../web/styles.css","../apps/electron/compact.css"].map(path=>readFile(new URL(path,import.meta.url),"utf8")))).join("\n");
  assert.doesNotMatch(settings, /本机执行说明与版本|data-control-version|<select[^>]*name="closeMode"/);
  for (const mode of ["quit", "tray"]) assert.match(settings, new RegExp(`type="radio" name="closeMode" value="${mode}" disabled`));
  assert.match(settings, /fieldset class="settings-radio-group settings-segmented"><legend class="visually-hidden">关闭主窗口时/);
  assert.match(css, /\.settings-section h4 \{/);
  assert.match(desktop, /\.settings-section h4 \{ font-size:13px; font-weight:600/);
  assert.doesNotMatch(settings, /profile && !profile\.system/);
});

test("team edits preserve inactive members and allow an empty manager-free roster", async () => {
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const controller=source.slice(source.indexOf('async function teamModal('),source.indexOf('const newTeamModal ='));
  const agents=[{id:'active',status:'active',kind:'business',name:'员工'},{id:'inactive',status:'inactive',kind:'business',name:'停用员工'}];
  const handlers={},calls=[],errors=[],enabledToggle={};let selected=['active','inactive'],picker;
  const form={name:{value:'更新团队名'},mission:{value:'使命'},elements:{status:{value:'inactive'}},querySelector:selector=>selector==='[data-enabled-toggle]'?enabledToggle:null,closest:()=>({classList:{add(){}}}),addEventListener:(name,handler)=>{handlers[name]=handler;}};
  const context={loadCatalogReferences:async()=>{},state:{agents},esc:String,openModal(){},$:selector=>selector==='#team-form'?form:{},createEmployeeMultiSelect:(host,options)=>{picker=options;return{value:()=>selected};},clearInvalid(){},setInvalid:(field,error)=>errors.push(error),api:async(path,options)=>calls.push({path,input:JSON.parse(options.body)}),closeModal(){},toast(){},refresh:async()=>{}};
  await runWithCache(`${controller};teamModal({id:'team',memberAgentIds:['active','inactive']});`,context);
  assert.deepEqual(Array.from(picker.selectedIds),['active','inactive']);assert.equal(picker.items,agents);
  enabledToggle.onchange({target:{checked:true}});assert.equal(form.elements.status.value,'active');enabledToggle.onchange({target:{checked:false}});assert.equal(form.elements.status.value,'inactive');
  await handlers.submit({preventDefault(){}});assert.deepEqual(calls[0],{path:'/api/teams/team',input:{name:'更新团队名',mission:'使命',status:'inactive',memberAgentIds:['active','inactive']}});
  selected=[];await handlers.submit({preventDefault(){}});assert.deepEqual(calls[1].input.memberAgentIds,[]);
  form.name.value=' ';await handlers.submit({preventDefault(){}});assert.equal(calls.length,2);assert.equal(errors.length,1);
});

test("configuration deletion responses cannot close or contaminate a replacement modal", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const controller = source.slice(source.indexOf("function configurationDeletionModal("), source.indexOf("async function teamModal("));
  const fixture = () => {
    const button = { isConnected: true, disabled: false }, originalError = {}, replacementError = {}, requests = [], notices = [];
    let callback, resolve, reject, closed = 0, refreshed = 0, currentError = originalError;
    button.addEventListener = (_event, handler) => { callback = handler; };
    const context = {
      state: { agents: [{ id: "employee/1", name: "员工" }] }, toast: (...args) => notices.push(args), esc: String, openModal() {},
      $: selector => selector === "[data-confirm-configuration-delete]" ? button : currentError,
      api: (path, options) => { requests.push({ path, options }); return new Promise((yes, no) => { resolve = yes; reject = no; }); },
      closeModal: () => { closed++; }, refresh: async () => { refreshed++; },
    };
    runWithCache(`${controller}; configurationDeletionModal('agent','employee/1');`, context);
    return { button, originalError, replacementError, requests, notices,
      click: () => callback(), resolve: () => resolve({}), reject: () => reject(new Error("仍被团队使用")),
      replace() { button.isConnected = false; currentError = replacementError; }, closed: () => closed, refreshed: () => refreshed };
  };
  const success = fixture(), pendingSuccess = success.click();
  assert.equal(success.button.disabled, true);
  assert.equal(success.requests[0].path, "/api/agents/employee%2F1");
  success.replace(); success.resolve(); await pendingSuccess;
  assert.equal(success.closed(), 0, "an old successful delete must not close the new modal");
  assert.equal(success.refreshed(), 1, "the accepted deletion still refreshes the directory");
  assert.equal(success.replacementError.textContent, undefined);

  const staleFailure = fixture(), pendingFailure = staleFailure.click();
  staleFailure.replace(); staleFailure.reject(); await pendingFailure;
  assert.equal(staleFailure.closed(), 0);
  assert.equal(staleFailure.replacementError.textContent, undefined, "the error is not written to a new modal's feedback element");
  assert.match(staleFailure.notices.at(-1)[0], /仍被团队使用/);
  assert.equal(staleFailure.notices.at(-1)[1], true);

  const currentFailure = fixture(), pendingCurrent = currentFailure.click();
  currentFailure.reject(); await pendingCurrent;
  assert.equal(currentFailure.button.disabled, false, "the original modal can retry a rejected delete");
  assert.match(currentFailure.originalError.textContent, /仍被团队使用/);
  assert.equal(currentFailure.refreshed(), 0);
});

test("sidebar counts only human attention and unread replies rather than inventory", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const shell = source.slice(source.indexOf("function renderShell()"), source.indexOf("let navigationRequest"));
  const nodes = new Map();
  const headers = ['tasks','inbox','agents'].map(headerView => ({dataset:{headerView},hidden:true}));
  const context = { state: { currentView: "tasks", communicationUnreadCount: 3, runs: [{ taskId: "a", status: "running" }, { taskId: "b", status: "paused" }, { taskId: "b", status: "failed" }, { taskId: "archived", status: "failed", task: { archivedAt: "yesterday" } }] }, taskNeedsAttention,
    $$: () => headers,
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, { style: {}, setAttribute() {} }); return nodes.get(selector); } };
  runWithCache(`${shell}; renderShell();`, context);
  assert.deepEqual(headers.map(host=>host.hidden),[false,true,true], 'only the active page exposes its header actions');
  assert.equal(nodes.get("#nav-inbox-count").textContent, 1, "the attention count lives on 待我处理 only");
  assert.equal(nodes.has("#nav-task-count"), false, "任务中心 no longer duplicates the count");
  assert.equal(nodes.get("#nav-communication-count").textContent, 3);
  for (const id of ["team", "workflow", "agent"]) assert.equal(nodes.has(`#nav-${id}-count`), false);
  context.state.navigationNotifications = { taskAttentionCount: 0, communicationUnreadCount: 0 };
  runWithCache("renderShell();", context);
  assert.equal(nodes.get("#nav-inbox-count").hidden, true);
  assert.equal(nodes.get("#nav-communication-count").hidden, true);
});

test("overview presents execution facts without inferred completion percentages", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const renderSource = source.slice(source.indexOf("function renderOverview()"), source.indexOf("/* ---------- 任务中心 ---------- */"));
  const escape = value => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  function render(runs, tasks = []) {
    const panels = new Map();
    const context = {
      state: { runs, tasks, agents: [], events: [], teams: [],overviewCounts:{tasks:Object.fromEntries([...new Set(tasks.map(t=>t.status))].map(status=>[status,tasks.filter(t=>t.status===status).length])),runs:Object.fromEntries([...new Set(runs.map(r=>r.status))].map(status=>[status,runs.filter(r=>r.status===status).length])),artifacts:runs.reduce((total,r)=>total+(r.artifactCount||0),0)} },
      $: selector => { if (!panels.has(selector)) panels.set(selector, { innerHTML: "" }); return panels.get(selector); },
      taskMatchesFilter, taskNeedsAttention, taskActionLabel, statusText: STATUS_TEXT, esc: escape,
      pill: status => `<span class="status-pill">${STATUS_TEXT[status]}</span>`,
      workspaceSummary: () => "系统受管目录", timeAgo: () => "刚刚",
    };
    runWithCache(`${renderSource}; renderOverview();`, context);
    assert.doesNotMatch(panels.get("#stats-grid").innerHTML, /已验收/);
    assert.match(panels.get("#stats-grid").innerHTML, /已接纳的 Run 内快照/);
    return { active: panels.get("#active-run-panel").innerHTML, stats: panels.get("#stats-grid").innerHTML };
  }
  const run = status => ({ id: `run-${status}`, status, task: { title: "<unsafe>", objective: "真实目标" }, traceCount: 3, artifactCount: 2 });
  for (const status of ["planning", "running", "awaiting_human", "review", "awaiting_acceptance", "paused", "blocked", "failed"]) {
    const { active } = render([run(status)]);
    assert.match(active, new RegExp(`data-open-run="run-${status}"`));
    assert.ok(active.includes(STATUS_TEXT[status]));
    assert.match(active, /3 条 Trace · 2 个文件/);
    assert.match(active, /&lt;unsafe&gt;/);
    assert.doesNotMatch(active, /<unsafe>|run-progress|width:|%|已完成/);
    assert.ok(active.includes(taskNeedsAttention(status) ? taskActionLabel(status) : "进入任务空间"));
  }
  const zero = render([{ ...run("running"), traceCount: 0, artifactCount: 0 }]);
  assert.match(zero.active, /0 条 Trace · 0 个文件/);
  const priority = render([run("running"), run("awaiting_acceptance")]);
  assert.match(priority.active, /data-open-run="run-awaiting_acceptance"/);
  assert.doesNotMatch(priority.active, /data-open-run="run-running"|已完成/);
  for (const runs of [[], [run("completed")], [run("cancelled")]]) {
    const { active } = render(runs);
    assert.match(active, /没有进行中或待处理任务/);
    assert.doesNotMatch(active, /data-open-run|run-progress|%/);
  }
  const completed = render([run("completed")], [{ title: "已验收任务", status: "done" }]);
  assert.match(completed.stats, /已完成任务[\s\S]*?stat-value">1</);
});

test("workspace removes delivery-version navigation without removing backend Artifact history", async () => {
  const source = sourceWording(await readFile(new URL("../web/app.js", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /data-ws-tab="artifacts"|artifact-snapshots-panel|loadArtifactSnapshot|selectedArtifactId/);
  assert.match(source, /data-open-acceptance-directory/);
  assert.ok(source.includes('>变更</button>'));
  assert.match(source, /data-back-to-tasks aria-label=.*返回触发记录.*返回任务列表/);
  assert.match(source, /data-back-to-tasks.*setView\("automations"\).*return setView\("tasks"\)/);
  const apiSource = await readFile(new URL("../server/index.mjs", import.meta.url), "utf8");
  assert.ok(apiSource.includes('runFiles.readArtifact'));
});

test("acceptance and deletion counts do not claim human-approved Artifacts and retain explicit acknowledgement", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const acceptance = { verified: true, findings: ["checked"], criteria: ["criterion"], artifactCount: 2, reviewTraceId: "trace", legacy: false };
  const run = { id: "run", status: "awaiting_acceptance", task: { title: "task" } };
  const nodes = new Map(), requests = [];
  const context = {
    state: { workspace: { run }, tasks: [{ id: "task", title: "task" }], runs: [{ id: "run", taskId: "task", artifactCount: 2 }] },
    esc: String, acceptance, run, acceptanceReview: () => acceptance, acceptanceCriteriaMarkup: () => "criteria",
    openModal: html => { context.html = html; }, toast: () => {}, api: (...args) => { requests.push(args); },
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, { disabled: true, checked: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } }); return nodes.get(selector); },
  };
  const collaboration = slice("function renderCollaboration(", "/* ---------- 任务空间数据与动作");
  assert.doesNotMatch(collaboration, /acceptancePanel|acceptanceReview|collaboration-review|经理交接说明/);
  assert.doesNotMatch(source, /data-stop-inquiries|停止答疑/);
  for (const [start, end, invocation, ack, confirm] of [
    ["function openCompletionModal(", "async function retryScheduledWorkspace(", "openCompletionModal('run')", "#ack-completion", "#confirm-completion"],
    ["function openDeleteTaskModal(", "function openTerminateModal(", "openDeleteTaskModal('task')", "#delete-task-acknowledged", "#confirm-delete-task"],
  ]) {
    runWithCache(`${slice(start, end)}; ${invocation};`, context);
    assert.doesNotMatch(context.html, /已验收/);
    assert.match(context.html, /2 项已接纳交付快照/);
    assert.match(context.html, /id="confirm-[^"]+" disabled/);
    const checkbox = nodes.get(ack), button = nodes.get(confirm);
    assert.equal(button.disabled, true);
    checkbox.checked = true; checkbox.handlers.change({ target: checkbox });
    assert.equal(button.disabled, false);
    checkbox.checked = false; checkbox.handlers.change({ target: checkbox });
    assert.equal(button.disabled, true);
    assert.deepEqual(requests, []);
  }
  // The completion dialog keeps the frozen standards text for the human's
  // final check against real delivered Artifacts.
  runWithCache(`${slice("function openCompletionModal(", "async function retryScheduledWorkspace(")}; openCompletionModal('run');`, context);
  assert.match(context.html, /任务验收标准/);
  assert.match(context.html, /criteria/);
});

// Timeline unit cases exercise generated rows; persistent DOM is verified by
// scripts/test-collaboration-flow.mjs through the real Electron renderer.
test("console rendering keeps chronological events separate from directory sorting", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const slice = source.slice(source.indexOf("function renderChatStream("), source.indexOf("function rememberDirectoryReading("));
  const stream = { innerHTML: "", scrollHeight: 120, scrollTop: 0 };
  const context = { queueMicrotask: () => {}, updateConsoleRows: (stream, rows) => { stream.innerHTML = rows.map(row => row.html).join(""); stream.scrollTop = stream.scrollHeight; }, $: () => stream, isTransportFrame: () => false, summarizeHistoricalAuditEntries: entries => entries, buildConsoleEntries: events => events.map(event => ({ type: "event", event })), renderChatEvent: event => event.id, state: { selectedRunId: "run", workspace: null } };
  runWithCache(`${slice}; renderChatStream([{id:'later',timestamp:'2026-01-02',actor:{id:'a'}},{id:'earlier',timestamp:'2026-01-01',actor:{id:'a'}}],{id:'a'});`, context);
  assert.equal(stream.innerHTML, "earlierlater");
  assert.equal(stream.scrollTop, 120);
});

test("console does not echo collaboration messages as a second system result", async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const slice = source.slice(source.indexOf('function renderChatStream('), source.indexOf('function rememberDirectoryReading('));
  for (const id of ['employee', 'manager']) {
    const stream = { innerHTML: '', scrollHeight: 100 };
    const events = [
      { id: 'provider-text', type: 'runtime.event', actor: { id }, timestamp: '2026-01-01' },
      { id: 'duplicate-handoff', type: 'message.sent', actor: { id }, timestamp: '2026-01-02' },
      { id: 'failure', type: 'trace.failed', actor: { id }, timestamp: '2026-01-03' },
    ];
    const context = { queueMicrotask: () => {}, updateConsoleRows: (stream, rows) => { stream.innerHTML = rows.map(row => row.html).join(""); stream.scrollTop = stream.scrollHeight; }, $: () => stream, isTransportFrame: () => false, summarizeHistoricalAuditEntries: rows => rows, buildConsoleEntries: rows => rows.map(event => ({ type: 'event', event })), renderChatEvent: event => `[${event.id}]`, state: { selectedRunId: 'run', workspace: null }, events, agent: { id } };
    runWithCache(`${slice}; renderChatStream(events, agent);`, context);
    assert.equal(stream.innerHTML, '[provider-text][failure]');
    assert.equal(events.length, 3, 'stored collaboration facts are not mutated');
  }
});

test('CHANGE shares complete workspace hierarchy and retains deleted files and gitlinks', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const { workingDirectoryIcon } = await import('../client/console-projections.mjs');
  const context = vm.createContext({ $t, $tm, workingDirectoryIcon, esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') });
  vm.runInContext(source.slice(source.indexOf('function directoryNodeIcon('), source.indexOf('function renderWorkingDirectory(')) + source.slice(source.indexOf('function workingChangesTree('), source.indexOf('function rememberDiffReading(')), context);
  const view = { directoryOpen: {}, directory: { directories: [{ path: 'docs/content', type: 'files' }] } };
  const repo = { path: '', changes: [{ path: 'docs/content/nested/a.js', status: 'M' }, { path: 'docs/content/deleted.md', status: 'D' }] };
  const current = context.workingFileTree([{type:'directory',path:'docs',name:'docs',children:[{ type: 'directory', path: 'docs/content', name: 'content', children: [{ type: 'directory', path: 'docs/content/nested', name: 'nested', children: [{ type: 'file', path: 'docs/content/nested/a.js', name: 'a.js' }] }] }]}], view, 'vscode-light');
  const change = context.workingChangesTree(repo, view, 'vscode-light');
  assert.deepEqual([...current.matchAll(/<summary>(.*?)<\/summary>/g)].map(match => match[1]), [...change.matchAll(/<summary>(.*?)<\/summary>/g)].map(match => match[1]));
  assert.match(change, /data-diff-directory="docs\/content"/);
  assert.match(change, /data-diff-directory="docs"/);
  assert.match(change, /data-select-diff="docs\/content\/deleted.md"/);
  assert.doesNotMatch(current, /deleted.md|source-status/);
  view.changes = { repositories: [{ path: '', changes: [{ path: 'repos/app', submodule: true, status: 'M' }] }] };
  const gitlink = context.workingChangesTree({changes:[{path:'repos/app',submodule:true,status:'M'}]}, view, 'classic');
  assert.match(gitlink, /data-select-diff="repos\/app"/);
  assert.match(gitlink, /查看仓库提交变化/);
});

test('CHANGE is independent of the current-file directory page and can show deleted paths', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const view = { changesRequest: 0, changes: null };
  const load = runWithCache(`${source.slice(source.indexOf('async function loadWorkingChanges('), source.indexOf('async function loadWorkingDiff('))}; loadWorkingChanges`, {
    workspaceView: () => view, renderWorkingChanges: () => {}, api: async () => ({ repositories: [] }), loadWorkingDirectory: async () => { view.directoryError = '工作目录不可读取'; }
  });
  await load('run');
  assert.deepEqual(view.changes,{repositories:[]});assert.equal(view.changesLoading, false);assert.equal(view.changesError,null);
});

test('CHANGE keeps its tree free of explanatory text and surfaces read errors outside it', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const view = { changes: { repositories: [] } }, tree = { scrollTop: 0 };
  const host = { innerHTML: '', dataset: {}, querySelector: () => tree };
  const render = runWithCache(`${source.slice(source.indexOf('function workingFileSources('), source.indexOf('function renderWorkingDirectory('))}${source.slice(source.indexOf('function renderWorkingChanges('), source.indexOf('async function loadWorkingChanges('))}; renderWorkingChanges;`, {
    state: { selectedRunId: 'run' }, $: () => host, workspaceView: () => view,
    syncWorkingRefresh: () => {}, workingRefreshMarkup: () => '<button class="workspace-refresh">刷新</button>', rememberDiffReading: () => {}, presentationPreferences: {}, esc: String,
    workingChangesTree: repo => `<ul>${repo.path || 'docs'}</ul>`, workingDiffMarkup: () => ''
  });
  const repo = (path, changes = [], rest = {}) => ({ path, initialized: true, changes, ...rest });
  const check = (repositories, count, extras = {}) => {
    Object.assign(view, { changes: { repositories }, changesError: null, changesLoading: false }, extras);
    render('run');
    assert.equal((host.innerHTML.match(/没有更改/g) || []).length, count);
    assert.ok([...host.innerHTML.matchAll(/<section class="artifact-root">(.*?)<\/section>/g)].every(match => !match[1].includes('没有更改')));
  };
  check([repo(''), repo('repos/clean'), repo('repos/changed', [{ path: 'repos/changed/a.js', status: 'M' }])], 0);
  check([repo(''), repo('repos/clean')], 0);
  assert.doesNotMatch(host.innerHTML, /data-changes-empty/);
  check([repo(''), repo('repos/broken', [], { error: '读取失败' })], 0); assert.match(host.innerHTML, /读取失败/);
  check([repo('', [], { initialized: false })], 0); assert.doesNotMatch(host.innerHTML, /尚未初始化 Git/);
  check([repo('')], 0, { changesLoading: true });
  check([repo('')], 0, { changesError: '请求失败' });
  check([], 0);
  check([repo('', [{ path: 'repos/clean', submodule: true, status: 'M' }]), repo('repos/clean')], 0);
});

test('file downloads capture the selected path, avoid duplicate clicks and surface errors in place', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function downloadWorkingFile('), source.indexOf('async function loadWorkingFile('));
  const view = { selectedPath: null }, links = [], errors = [], revoked = [];
  let fetches = 0, respond, cleanup;
  const context = {
    workspaceView: () => view, renderWorkingDirectory: () => {}, toast: (...args) => errors.push(args),
    fetch: () => { ++fetches; return new Promise(resolve => { respond = resolve; }); },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) },
    setTimeout: fn => { cleanup = fn; },
    document: { body: { append: link => links.push(link) }, createElement: () => ({ click() { this.clicked = true; }, remove() { this.removed = true; } }) }
  };
  const download = runWithCache(`${body}; downloadWorkingFile;`, context);
  await download('run'); assert.equal(fetches, 0);
  view.selectedPath = 'docs/原文.md';
  const pending = download('run');
  await download('run'); assert.equal(fetches, 1);
  view.selectedPath = 'docs/another.md';
  respond({ ok: true, blob: async () => ({}) }); await pending;
  assert.equal(links[0].download, '原文.md'); assert.equal(links[0].clicked, true); assert.equal(links[0].removed, true);
  assert.equal(view.downloadingPath, null); cleanup(); assert.deepEqual(revoked, ['blob:fixture']);
  const failed = download('run'); respond({ ok: false, json: async () => ({ error: '文件不存在' }) }); await failed;
  assert.deepEqual(errors, [['下载失败：文件不存在', true]]);
  assert.equal(links.length, 1); assert.equal(view.downloadingPath, null);
  const css = await readFile(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.ok(css.includes(':is(#working-directory-panel, #working-diff-panel) .artifact-root { margin:0; padding:0; min-height:0; }'));
  assert.match(source, /data-download-working-file \$\{!view.selectedPath \|\| view.downloadingPath \? "disabled"/);
});

test("console timeline binds a prompt entry to each invocation's own Trace", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const slice = source.slice(source.indexOf("function tracePromptMarkup("), source.indexOf("function renderConsolePage("))
    + source.slice(source.indexOf("function renderChatStream("), source.indexOf("function rememberDirectoryReading("));
  const stream = { innerHTML: "", scrollHeight: 0, scrollTop: 0 };
  const traces = [
    { id: "trace-old", workflowNodeId: "requirements", startedAt: "t0", promptRef: null },
    { id: "trace-new", workflowNodeId: "development", startedAt: "t1", promptRef: { storagePath: "runs/run-1/traces/trace-new/prompt-snapshot.json" } },
  ];
  const context = {
    queueMicrotask: () => {}, updateConsoleRows: (stream, rows) => { stream.innerHTML = rows.map(row => row.html).join(""); stream.scrollTop = stream.scrollHeight; }, $: () => stream, isTransportFrame: () => false,
    summarizeHistoricalAuditEntries: entries => entries,
    buildConsoleEntries, // the real projection, including Trace-aware tool grouping
    renderChatEvent: event => `<row>${event.id}</row>`,
    renderToolEntry: entry => `<tool>${entry.event.id}</tool>`,
    renderToolGroup: group => `<group>${group.tools.map((tool) => tool.event.id).join(",")}</group>`,
    state: { selectedRunId: "run-1", workspace: { run: { id: "run-1" }, traces } },
    esc: String, exactTime: value => value,
  };
  runWithCache(`${slice}; renderChatStream([
    { id: "e1", timestamp: "2026-01-01", actor: { id: "a" }, data: { traceId: "trace-old" } },
    { id: "e2", timestamp: "2026-01-02", actor: { id: "a" }, data: { traceId: "trace-new" } },
    { id: "e3", timestamp: "2026-01-03", actor: { id: "a" }, data: { traceId: "trace-missing" } },
  ], { id: "a" });`, context);
  const html = stream.innerHTML;
  // Each invocation's prompt entry precedes its own events and binds that Trace.
  const order = ['data-console-key="prompt:trace-old"', "<row>e1</row>", 'data-console-key="prompt:trace-new"', "<row>e2</row>", "<row>e3</row>"];
  assert.deepEqual(order.map((needle) => html.indexOf(needle)).every((index) => index >= 0), true);
  assert.deepEqual([...order.keys()].slice(1).every((index) => html.indexOf(order[index]) > html.indexOf(order[index - 1])), true);
  // Missing snapshot says so honestly; a saved snapshot is fetched on demand.
  assert.match(html, /该次调用未保存提示词快照/);
  assert.match(html, /data-prompt-snapshot="trace-new"/);
  // A Trace outside the current read model is never given fabricated content.
  assert.match(html, /提示词快照不可定位/);
  assert.equal((html.match(/log-row-trace-prompt/g) || []).length, 3);
});

test("prompt entries follow invocation records and tool groups respect Trace boundaries", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const slice = source.slice(source.indexOf("function tracePromptMarkup("), source.indexOf("function renderConsolePage("))
    + source.slice(source.indexOf("function renderChatStream("), source.indexOf("function rememberDirectoryReading("));
  const mkContext = (stream, traces) => ({
    queueMicrotask: () => {}, updateConsoleRows: (stream, rows) => { stream.innerHTML = rows.map(row => row.html).join(""); stream.scrollTop = stream.scrollHeight; }, $: () => stream, isTransportFrame: () => false,
    summarizeHistoricalAuditEntries: entries => entries,
    buildConsoleEntries, // the real projection: same-name tools from different Traces must not merge
    renderChatEvent: event => `<row>${event.id}</row>`,
    renderToolEntry: entry => `<tool>${entry.event.id}</tool>`,
    renderToolGroup: group => `<group>${group.tools.map((tool) => tool.event.id).join(",")}</group>`,
    state: { selectedRunId: "run-1", workspace: { run: { id: "run-1" }, traces } },
    esc: String, exactTime: value => value,
  });
  // A running invocation that has not emitted any visible event yet still
  // exposes its own prompt entry; entries come from Trace records, not events.
  const streamA = { innerHTML: "", scrollHeight: 0, scrollTop: 0 };
  runWithCache(`${slice}; renderChatStream([
    { id: "e1", type: "runtime.event", timestamp: "2026-01-01T00:10:00Z", actor: { id: "a" }, data: { traceId: "trace-done", providerEventType: "assistant" } },
  ], { id: "a" });`, mkContext(streamA, [
    { id: "trace-done", agentId: "a", workflowNodeId: "requirements", startedAt: "2026-01-01T00:00:00Z", status: "completed", promptRef: { storagePath: "runs/run-1/traces/trace-done/prompt-snapshot.json" } },
    { id: "trace-running", agentId: "a", workflowNodeId: "development", startedAt: "2026-01-01T01:00:00Z", status: "running", promptRef: { storagePath: "runs/run-1/traces/trace-running/prompt-snapshot.json" } },
  ]));
  assert.match(streamA.innerHTML, /data-console-key="prompt:trace-done"/);
  assert.match(streamA.innerHTML, /data-console-key="prompt:trace-running"/);
  assert.ok(streamA.innerHTML.indexOf("prompt:trace-running") > streamA.innerHTML.indexOf("<row>e1</row>"), "the fresh invocation's entry follows the older one");
  assert.match(streamA.innerHTML, /data-prompt-snapshot="trace-running"/);
  // A silent call can be recovered as failed on startup without producing a
  // member event. It must remain visible even though it started after the last event.
  const streamRecovered = { innerHTML: "", scrollHeight: 0, scrollTop: 0 };
  runWithCache(`${slice}; renderChatStream([
    { id: "prior", timestamp: "2026-01-01T00:10:00Z", actor: { id: "a" }, data: { traceId: "older" } },
  ], { id: "a" }, { hasMore: true });`, mkContext(streamRecovered, [
    { id: "older", agentId: "a", startedAt: "2026-01-01T00:00:00Z" },
    { id: "recovered", agentId: "a", startedAt: "2026-01-01T01:00:00Z", status: "failed", promptRef: { storagePath: "saved" } },
  ]));
  assert.match(streamRecovered.innerHTML, /data-prompt-snapshot="recovered"/);
  // Two consecutive same-name tools from different invocations: no merged
  // group, and each invocation keeps its own prompt entry before its tool.
  const streamB = { innerHTML: "", scrollHeight: 0, scrollTop: 0 };
  runWithCache(`${slice}; renderChatStream([
    { id: "u1", type: "runtime.event", timestamp: "2026-01-01T00:05:00Z", actor: { id: "a" }, data: { traceId: "t1", presentation: "tool", toolName: "Bash", toolUseId: "u1" } },
    { id: "u2", type: "runtime.event", timestamp: "2026-01-01T01:05:00Z", actor: { id: "a" }, data: { traceId: "t2", presentation: "tool", toolName: "Bash", toolUseId: "u2" } },
  ], { id: "a" });`, mkContext(streamB, [
    { id: "t1", agentId: "a", workflowNodeId: "n", startedAt: "2026-01-01T00:00:00Z", promptRef: { storagePath: "runs/run-1/traces/t1/prompt-snapshot.json" } },
    { id: "t2", agentId: "a", workflowNodeId: "n", startedAt: "2026-01-01T01:00:00Z", promptRef: { storagePath: "runs/run-1/traces/t2/prompt-snapshot.json" } },
  ]));
  const htmlB = streamB.innerHTML;
  assert.equal((htmlB.match(/<group>/g) || []).length, 0, "tools from different invocations are never visually grouped");
  const orderB = ['data-console-key="prompt:t1"', "<tool>u1</tool>", 'data-console-key="prompt:t2"', "<tool>u2</tool>"];
  assert.ok(orderB.every((needle) => htmlB.includes(needle)), "both invocations keep their own prompt entry and tool row");
  assert.ok([...orderB.keys()].slice(1).every((index) => htmlB.indexOf(orderB[index]) > htmlB.indexOf(orderB[index - 1])), "prompt entry precedes its own invocation's tool");
});

test("prompt is a paginated chronological entry, including interleaved invocations", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const slice = source.slice(source.indexOf("function tracePromptMarkup("), source.indexOf("function renderConsolePage("))
    + source.slice(source.indexOf("function renderChatStream("), source.indexOf("function rememberDirectoryReading("));
  const stream = { innerHTML: "", scrollHeight: 0, scrollTop: 0 };
  const traces = [{ id: "long", agentId: "a", startedAt: "2026-01-01T00:00:00Z", status: "running", promptRef: {} }, { id: "short", agentId: "a", startedAt: "2026-01-01T00:03:00Z", promptRef: {} }];
  const context = { queueMicrotask: () => {}, updateConsoleRows: (stream, rows) => { stream.innerHTML = rows.map(row => row.html).join(""); stream.scrollTop = stream.scrollHeight; }, $: () => stream, isTransportFrame: e => e.type === "transport",
    summarizeHistoricalAuditEntries: entries => entries, buildConsoleEntries,
    renderChatEvent: e => `<row>${e.id}</row>`,
    state: { selectedRunId: "r", workspace: { run: { id: "r" }, traces } }, esc: String, exactTime: String };
  const event = (id, minute, traceId, type = "runtime.event") => ({ id, type, actor: { id: "a" }, timestamp: `2026-01-01T00:0${minute}:00Z`, data: { traceId } });
  context.events = [event("tail", 5, "long")];
  runWithCache(`${slice}; renderChatStream(events, {id:"a"}, {hasMore:true})`, context);
  assert.doesNotMatch(stream.innerHTML, /prompt:/, "even a running call's start is not pinned above a partial tail");
  context.events = [event("before", 2), event("first", 4, "long"), event("other", 4, "short"), event("last", 5, "long")];
  runWithCache(`renderChatStream(events, {id:"a"}, {hasMore:true})`, context);
  assert.doesNotMatch(stream.innerHTML, /prompt:long/);
  assert.ok(stream.innerHTML.indexOf("before") < stream.innerHTML.indexOf("prompt:short"));
  context.events.unshift(event("start", 0, "long"));
  context.events.unshift({ id: "pre-call", type: "runtime.event", actor: { id: "a" }, timestamp: "2025-12-31T23:59:00Z", data: {} });
  runWithCache(`renderChatStream(events, {id:"a"}, {hasMore:false})`, context);
  const html = stream.innerHTML;
  assert.equal((html.match(/data-console-key="prompt:long"/g) || []).length, 1, "interleaving never duplicates a prompt");
  const order = ['<row>pre-call</row>', 'data-console-key="prompt:long"', '<row>start</row>', '<row>before</row>', 'data-console-key="prompt:short"', '<row>first</row>', '<row>last</row>'];
  assert.ok(order.every((value, index) => html.indexOf(value) >= 0 && (!index || html.indexOf(value) > html.indexOf(order[index - 1]))));
  context.events = [event("transport-boundary", 0, "long", "transport"), event("tail", 5, "long")];
  runWithCache(`renderChatStream(events, {id:"a"}, {hasMore:true})`, context);
  assert.match(stream.innerHTML, /prompt:long/, "hidden transport frames still establish the loaded page boundary");
});

test("tool audit rows expand safe facts without rendering raw provider fields", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const start = source.indexOf("function renderToolCall("), end = source.indexOf("function renderToolEntry", start);
  const render = new Function("esc", "exactTime", "isCurrentRuntimeAudit", "consoleContentMarkup", "isShellTool", `${source.slice(start, end)}; return renderToolCall;`)(value => String(value).replaceAll("<", "&lt;"), value => value, event => event.data?.auditVersion === 2, () => "", name => name === "Bash");
  const event = { id: "safe-id", timestamp: "now", data: { auditVersion: 2, toolName: "Read", traceId: "trace-1", toolUseId: "call-1", input: "SECRET_SENTINEL", output: "SECRET_SENTINEL" } };
  const html = render({ event, result: null });
  assert.match(html, /<details data-console-key="tool:safe-id"/);
  assert.match(html, /<summary>/);
  assert.doesNotMatch(html, /审计信息|trace-1|call-1/);
  assert.match(html, /参数和输出未保存/);
  assert.doesNotMatch(html, /SECRET_SENTINEL/);
  const structured = render({ event: { ...event, data: { ...event.data, toolName: "StructuredOutput", contentRef: {} } } });
  assert.match(structured, /^<div class="log-row/);
  assert.match(structured, /<div data-console-key="tool:safe-id"/);
  assert.doesNotMatch(structured, /class="tool-audit"/);
  assert.doesNotMatch(source, /执行记录|class="chat-thinking"/);
  assert.match(render({ event: { ...event, data: { ...event.data, status: "failed" } } }), /失败/);
  assert.doesNotMatch(render({ event: { ...event, data: { toolName: "SECRET_SENTINEL" } } }), /SECRET_SENTINEL/);
  // Real Edit records open by default and carry the tool name for the hydrate
  // pass; other tools and historical records stay collapsed.
  const edit = render({ event: { ...event, data: { ...event.data, toolName: "Edit" } } });
  assert.match(edit, /data-tool-name="Edit"/);
  assert.match(edit, /data-default-open open/);
  assert.doesNotMatch(render({ event, result: null }), /data-default-open/);
  assert.doesNotMatch(render({ event: { ...event, data: { toolName: "Edit" } } }), /data-default-open/);
  const completedRead = { ...event, runId: "run-safe", data: { ...event.data, status: "completed", contentRef: {} } };
  assert.match(render({ event: completedRead }), /data-console-summary="safe-id"/);
  assert.match(render({ event: completedRead }), />Done<\/p>/);
  assert.doesNotMatch(render({ event: { ...completedRead, data: { ...completedRead.data, status: "failed" } } }), />Done<\/p>/);
  assert.doesNotMatch(render({ event: { ...completedRead, data: { ...completedRead.data, status: "running" } } }), />Done<\/p>/);
});

test("workspace settings persist and affect only new Tasks with atomic audit", async () => {
  await mkdir(".data", { recursive: true });
  const directory = await mkdtemp(resolve(".data/workspace-settings-test-"));
  const databasePath = join(directory, "state.sqlite");
  const store = createStore({ databasePath, workspaceRoot: join(directory, "original") });
  const input = {managerAgentId:'system_project_manager', title: "目录验收", objective: "保存新任务路径", memberAgentIds: store.listTeams()[0].memberAgentIds, workflowTemplateId: store.listWorkflowTemplates()[0].id };
  const old = store.createTask(input), run = store.createRun(old.id);
  for (const invalid of ["/", "relative", "", null, "/invalid\0path"]) assert.throws(() => store.updateWorkspaceSettings({ workspaceRoot: invalid }));
  assert.equal(store.getWorkspaceSettings().source, "startup");
  assert.throws(() => store.transaction(() => { store.updateWorkspaceSettings({ workspaceRoot: join(directory, "rolled-back") }); throw new Error("rollback fixture"); }), /rollback fixture/);
  assert.equal(store.getWorkspaceSettings().source, "startup");
  assert.equal(store.snapshot().events.some(e => e.type === "settings.workspace_updated"), false);
  const nextRoot = join(directory, "new");
  store.updateWorkspaceSettings({ workspaceRoot: nextRoot });
  const next = store.createTask(input);
  assert.equal(next.workspacePath, join(nextRoot, "tasks", next.id));
  assert.equal(store.snapshot().tasks.find(t => t.id === old.id).workspacePath, old.workspacePath);
  assert.equal(store.listRuns().find(r => r.id === run.id).workspacePath, run.workspacePath);
  const restored = createStore({ databasePath, workspaceRoot: join(directory, "other-startup-default") });
  assert.deepEqual(restored.getWorkspaceSettings(), { workspaceRoot: nextRoot, source: "saved" });
  const audit = restored.snapshot().events.filter(e => e.type === "settings.workspace_updated");
  assert.equal(audit.length, 1);
  assert.doesNotMatch(JSON.stringify(audit), /workspace-settings-test-/);
  store.addEvent({ type: "trace.failed", runId: run.id, actor: { id: run.manager.id }, message: "LEGACY_SECRET_SENTINEL", data: {} });
  assert.doesNotMatch(JSON.stringify(store.getRunWorkspace(run.id, { summary: true }).failureEvents), /LEGACY_SECRET_SENTINEL/);
  for (let i = 0; i < 24; i++) store.addEvent({ type: "trace.failed", runId: run.id, actor: { id: run.manager.id }, message: "CLI 不可启动", data: { auditVersion: 2 } });
  const failures = store.getRunWorkspace(run.id, { summary: true }).failureEvents;
  assert.equal(failures.length, 20);
  assert.doesNotMatch(JSON.stringify(failures), /LEGACY_SECRET_SENTINEL/);
});

test("overview task titles and metadata form separate lines", async () => {
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const desktop = (await Promise.all(["../web/tokens.css","../web/styles.css","../apps/electron/compact.css"].map(path=>readFile(new URL(path,import.meta.url),"utf8")))).join("\n");
  // Overview rows are scoped to the overview so they never leak into task center rows.
  const rules = selector => css.match(new RegExp(`^(?:#overview-view )?\\.${selector} \\{([^}]+)\\}`, "m"))[1];
  for (const selector of ["task-row-title", "task-row-meta"]) assert.match(rules(selector), /display:block/);
  assert.match(rules("task-row-title"), /overflow:hidden; text-overflow:ellipsis; white-space:nowrap/);
  assert.match(rules("task-row-copy"), /min-width:0/);
  assert.match(rules("task-row-meta"), /margin-top:5px/);
  assert.match(desktop, /\.task-row-title\s*\{[^}]*white-space:\s*normal/);
});

function memoryStorage() {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test("Runtime settings keep the shared card spacing container during loading failure", async () => {
  const source = await readFile(new URL("../web/settings.mjs", import.meta.url), "utf8");
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  assert.match(source, /<div class="repository-access-grid settings-box" data-runtime-config><\/div>/);
  assert.match(css, /\.repository-access-grid\{display:grid;gap:12px\}/);
  const container = { className: "repository-access-grid settings-box", innerHTML: "", isConnected: true };
  const context = {
    root: { querySelector: () => container }, runtimeLoaded: false,
    api: async () => { throw new Error("unavailable"); },
    escape: value => value,
  };
  const start = source.indexOf("  async function loadRuntimes()"), end = source.indexOf("  async function loadWorkspace()", start);
  await runWithCache(`${source.slice(start, end)}; loadRuntimes()`, context);
  assert.equal(container.className, "repository-access-grid settings-box");
  assert.match(container.innerHTML, /role="alert">unavailable/);
  assert.match(container.innerHTML, /data-retry-runtime/);
  assert.equal(context.runtimeLoaded, false);
});

test("task search combines name and exact status without a team relation", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  // Matching is server-side; the client must forward name+status+workflow exactly once
  // and never invent a team/relation parameter.
  assert.match(source, /query\.set\('search',state\.taskSearch\.name\);query\.set\('status',state\.taskSearch\.status\);query\.set\('workflow',state\.taskSearch\.workflow\)/);
  assert.doesNotMatch(source.slice(source.indexOf("if(view==='tasks')"), source.indexOf("const request=++directoryRequest")), /teamId|memberAgentIds/);
  // Chip mapping stays client-side: attention/active/done semantics cannot drift.
  const chips = runWithCache(`const taskNeedsAttention = status => ["awaiting_human","awaiting_acceptance","paused","blocked","failed"].includes(status);${source.slice(source.indexOf("function taskMatchesChip("), source.indexOf("function taskGroupOrder("))}; [taskMatchesChip("awaiting_human","attention"), taskMatchesChip("review","active"), taskMatchesChip("completed","done"), taskMatchesChip("paused","attention"), taskMatchesChip("backlog","active")]`);
  assert.equal(chips.join(","), "true,true,true,true,false");
  assert.match(source, /name="runtimeProfileId"/);
  assert.doesNotMatch(source, /name="executable"/);
  const settings = await readFile(new URL('../web/settings.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /name="executable"/);
  assert.match(settings, /data-test-runtime/);
});

test("presentation choices survive reload without storing credentials or domain state", () => {
  const storage = memoryStorage();
  const choices = { version: 1, theme: "dark", hiddenViews: ["manual", "agents", "roles", "manual", "settings", "unknown"], showGroups: false, showIcons: false, showCounts: false, token: "private-sentinel", task: { status: "done" } };
  assert.equal(savePreferences(choices, () => storage), true);
  const restored = readPreferences(() => storage);
  assert.deepEqual(restored, { version: 2, theme: "dark", hiddenViews: ["agents", "roles", "manual"], showGroups: false, showIcons: false, showCounts: false, showUnread: true, directoryTheme: "vscode-light" });
  // Appearance is light / dark / system; retired themes are not migrated and fall back to light.
  for (const theme of ["light", "dark", "system"]) assert.equal(normalizePreferences({ version: 2, theme }).theme, theme);
  for (const theme of ["warm", "minimal", "injected", undefined]) assert.equal(normalizePreferences({ version: 2, theme }).theme, "light", String(theme));
  assert.doesNotMatch(storage.getItem(PREFERENCES_KEY), /private-sentinel|token|task|settings|unknown/);
  assert.deepEqual(normalizePreferences(null).hiddenViews, ["manual"]);
  assert.deepEqual(normalizePreferences({ version: 2, hiddenViews: [] }).hiddenViews, [], "a deliberate later choice can show overview");
  // The working-directory theme is a local display preference with three
  // honest options; unknown or missing values fall back to the default.
  assert.equal(normalizePreferences({ version: 2, directoryTheme: "vscode-dark" }).directoryTheme, "vscode-dark");
  assert.equal(normalizePreferences({ version: 2, directoryTheme: "classic" }).directoryTheme, "classic");
  assert.equal(normalizePreferences({ version: 2, directoryTheme: "injected" }).directoryTheme, "vscode-light");
  assert.equal(normalizePreferences(null).directoryTheme, "vscode-light");
});

test("broken or unavailable local storage cannot prevent default navigation", () => {
  const defaults = normalizePreferences(null);
  for (const raw of ["{broken", "null", "[]", '"text"', '{"version":3,"theme":"minimal","hiddenViews":["tasks"]}']) {
    const storage = memoryStorage(); storage.setItem(PREFERENCES_KEY, raw);
    assert.deepEqual(readPreferences(() => storage), defaults);
  }
  assert.deepEqual(normalizePreferences({ version: 1, theme: "injected", hiddenViews: "tasks", showIcons: "false" }), defaults);
  const unavailable = () => { throw new Error("storage disabled"); };
  assert.deepEqual(readPreferences(unavailable), defaults);
  assert.equal(savePreferences({ ...defaults, theme: "dark" }, unavailable), false);
  assert.equal(savePreferences(defaults, () => ({ setItem() { throw new Error("quota"); } })), false);
});

test("hiding every optional entry leaves Settings reachable and empty groups hidden", () => {
  const items = [...NAVIGATION.map(({ id }) => ({ dataset: { view: id }, hidden: false })), { dataset: { view: "settings" }, hidden: true }];
  const groups = ["工作", "组织", "扩展"].map((name) => ({ hidden: false, querySelectorAll: () => items.filter((item) => NAVIGATION.some((entry) => entry.id === item.dataset.view && entry.group === name)) }));
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[data-navigation-group]" ? groups : items,
  };
  applyPreferences(document, { version: 2, theme: "dark", hiddenViews: [...NAVIGATION.map(({ id }) => id), "settings"] });
  assert.equal(items.at(-1).hidden, false);
  assert.equal(items.slice(0, -1).every((item) => item.hidden), true);
  assert.equal(groups.every((group) => group.hidden), true);
  assert.equal(document.documentElement.dataset.theme, "dark");
  applyPreferences(document, normalizePreferences(null));
  assert.equal(items.find((item) => item.dataset.view === "inbox").hidden, false);
  assert.equal(items.filter((item) => !["overview", "manual"].includes(item.dataset.view)).every((item) => !item.hidden), true);
  assert.equal(items.find(item => item.dataset.view === "manual").hidden, true);
  assert.deepEqual(groups.map(group => group.hidden), [false, false, false], "扩展 stays visible via 插件/MCP even though 开发手册 is hidden");
  assert.equal(document.documentElement.dataset.theme, "light");
});

test("appearance choice is mirrored to the desktop host and colors native chrome", () => {
  const calls = [], meta = { content: "", setAttribute(name, value) { this[name] = value; } };
  const view = { matchMedia: query => ({ matches: query === "(prefers-color-scheme: dark)" }), batonDesktop: { setAppearance: async theme => { calls.push(theme); } } };
  const document = { defaultView: view, documentElement: { dataset: {} }, querySelector: selector => selector === 'meta[name="theme-color"]' ? meta : null, querySelectorAll: () => [] };
  for (const [theme, color] of [["light", "#ffffff"], ["dark", "#111215"], ["system", "#111215"]]) {
    applyPreferences(document, { version: 2, theme });
    console.log(`theme=${theme} → data-theme=${document.documentElement.dataset.theme}, theme-color=${meta.content}`);
    assert.equal(document.documentElement.dataset.theme, theme);
    assert.equal(meta.content, color, "system follows the OS appearance (dark in this fixture)");
  }
  assert.deepEqual(calls, ["light", "dark", "system"]);
  // A browser without the desktop bridge (or a rejecting host) still applies the theme.
  view.batonDesktop = { setAppearance: async () => { throw new Error("host closed"); } };
  applyPreferences(document, { version: 2, theme: "dark" });
  delete view.batonDesktop;
  applyPreferences(document, { version: 2, theme: "light" });
  assert.equal(document.documentElement.dataset.theme, "light");
});

test("settings categories are refreshable routes and configuration leaves the employee shell", async () => {
  assert.deepEqual(Object.keys(SETTINGS_PAGES), ["general", "appearance", "workspaces", "workspace", "cli", "repositories", "runtime", "devices", "updates", "logs"]);
  const settings = await readFile(new URL("../web/settings.mjs", import.meta.url), "utf8");
  const panel = name => settings.split(`data-settings-panel="${name}"`)[1].split("</section>")[0];
  assert.match(panel("appearance"), /navigation-options/);
  assert.match(panel("workspaces"), /data-reset-all/);
  assert.match(panel("workspaces"), /data-resident-toggle/);
  assert.match(panel("workspaces"), /data-current-workspace/);
  assert.doesNotMatch(settings, /data-phone-address|data-phone-enable/);
  assert.match(panel("cli"), /data-cli-install/);
  assert.doesNotMatch(panel("general"), /data-cli-install/);
  const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const routeSource = app.slice(app.indexOf("function routeFromLocation()"), app.indexOf("const initialRoute"));
  for (const page of Object.keys(SETTINGS_PAGES)) {
    const route = runWithCache(`${routeSource}\nrouteFromLocation()`, { location: { pathname: `/settings/${page}`, hash: "" } });
    assert.equal(route.view, "settings"); assert.equal(route.settingsPage, page);
    const hosted = runWithCache(`${routeSource}\nrouteFromLocation()`, { location: { pathname: `/settings/${page}`, hash: "" }, window: { batonDesktop: {} } });
    assert.equal(hosted.settingsPage, page);
  }
  assert.equal(runWithCache(`${routeSource}\nrouteFromLocation()`, { location: { pathname: "/settings", hash: "" } }).settingsPage, "general");
  const shell = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(shell, /data-view="settings" aria-label="设置"/);
  assert.doesNotMatch(shell, /class="runtime-card"|manage-git-credentials|bypass/);
  assert.doesNotMatch(app, /gitCredentialModal/);
});

test("Console initializes Settings with ready validation helpers", async () => {
  const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const initialization = app.slice(0, app.indexOf("/* ---------- 壳层 ---------- */")).replace(/^import .*;\n/gm, "");
  let dependencies;
  runWithCache(initialization, {
    location: { pathname: "/settings/repositories", hash: "" },
    document: { querySelector(){return {};} }, window: { addEventListener() {} },
    createToast: () => () => {},
    createCommunicationUI: () => ({}), readPreferences: () => normalizePreferences(null), applyPreferences() {},
    createSettingsUI: (value) => { dependencies = value; return {}; },
    createMarketplaceUI: () => ({}), createMcpMarketplaceUI: () => ({}), actionMenu() {}, openModal() {}, closeModal() {},
  });
  assert.equal(typeof dependencies.clearInvalid, "function");
  assert.equal(typeof dependencies.setInvalid, "function");
  assert.equal(typeof dependencies.api, "function");
});

test("in-app confirm dialog resolves on buttons and cancels on modal close", async () => {
  const app = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const slice = app.slice(app.indexOf("function openModal("), app.indexOf("function clearInvalidField"));
  const classList = () => { const set = new Set(); return { add: (...names) => names.forEach(name => set.add(name)), remove: (...names) => names.forEach(name => set.delete(name)), contains: name => set.has(name), toggle(name,force){const enabled=force ?? !set.has(name);if(enabled)set.add(name);else set.delete(name);return enabled;} }; };
  const button = () => ({ handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, click() { this.handlers.click?.(); }, focus() {} });
  const cancelButton = button(), acceptButton = button();
  const modal = { classList: classList(), scrollTop: 5 };
  const backdrop = { open:false, showModal(){ this.open=true; }, close(){ this.open=false; }, classList: classList(), attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key){delete this.attributes[key];} };
  const content = {
    closest: () => modal, replaceChildren() {}, innerHTML: "",
    querySelector(selector) {
      if (selector === "[data-confirm-dialog-cancel]") return cancelButton;
      if (selector === "[data-confirm-dialog-accept]") return acceptButton;
      if (selector.startsWith("input,")) return { focus() {} };
      return null;
    },
  };
  const run = runWithCache(`${slice}\n({ confirmDialog, closeModal })`, {
    disposeWorkflowGraphs() {}, resetRequestActive: false,
    document: { activeElement:null, body:{classList:classList()}, querySelector(){return null;} },
    closeFloatingLists() {},
    esc: (value = "") => String(value),
    $: selector => ({ "#modal-content": content, "#modal-backdrop": backdrop, "#modal-close": {} })[selector],
  });
  const declined = run.confirmDialog({ title: "删除工作流", message: "删除工作流「示例」？该操作不可恢复。", confirmLabel: "删除工作流", danger: true });
  assert.equal(backdrop.classList.contains("open"), true);
  assert.equal(modal.classList.contains("confirm-dialog"), true);
  assert.match(content.innerHTML, /confirm-dialog-actions/);
  assert.match(content.innerHTML, /danger-button danger-solid/);
  assert.equal(modal.classList.contains('detail-drawer'), false, 'confirmation remains centered');
  assert.equal(modal.classList.contains('command-dialog'), false, 'confirmation never inherits command panel sizing');
  assert.doesNotMatch(content.innerHTML, /form-actions/, "confirm dialogs must not use the scrolling form-actions grouping");
  cancelButton.click();
  assert.equal(await declined, false, "cancel button resolves false");
  assert.equal(backdrop.classList.contains("open"), false);
  const accepted = run.confirmDialog({ title: "归档任务", message: "归档？", confirmLabel: "归档任务" });
  acceptButton.click();
  assert.equal(await accepted, true, "accept resolves true");
  const dismissed = run.confirmDialog({ title: "移除拉取 Token", message: "移除？", confirmLabel: "移除 Token", danger: true });
  run.closeModal();
  assert.equal(await dismissed, false, "backdrop/Escape close resolves cancelled without side effects");
});

test("Runtime model picker and effort options follow the real catalog with honest fallbacks", async () => {
  const { runtimeEffortOptions, RUNTIME_EFFORT_LEVELS } = await import("../web/settings.mjs");
  const { CLAUDE_EFFORT_LEVELS, CODEX_EFFORT_LEVELS } = await import("../server/runtime/model-catalog.mjs");
  assert.deepEqual(RUNTIME_EFFORT_LEVELS["claude-code"], CLAUDE_EFFORT_LEVELS, "Web fallback mirrors the server-observed Claude vocabulary");
  assert.deepEqual(RUNTIME_EFFORT_LEVELS.codex, CODEX_EFFORT_LEVELS, "Web fallback mirrors the server-observed Codex vocabulary");

  const codexCatalog = { source:"codex debug models", models: [{ id: "gpt-real", levels: [{ id: "low" }, { id: "high", default: true }] }, { id: "gpt-quiet", levels: [] }] };
  const known = runtimeEffortOptions("codex", "gpt-real", codexCatalog);
  assert.deepEqual(known.options.map(option => option.value), ["", "low", "high"], "catalog levels restrict options to the model's real support");
  assert.equal(known.options.find(option => option.value === "high").label, "High（模型默认）");
  assert.equal(known.options.find(option => option.value === "low").label, "Low");
  assert.match(known.note, /codex debug models/);
  const quiet = runtimeEffortOptions("codex", "gpt-quiet", codexCatalog);
  assert.deepEqual(quiet.options.map(option => option.value), [""], "models without declared levels offer no invalid options");
  const manual = runtimeEffortOptions("codex", "manual-model", codexCatalog);
  assert.deepEqual(manual.options.map(option => option.value), ["", ...CODEX_EFFORT_LEVELS], "manual codex models get the global vocabulary with an honest note");
  assert.match(manual.note, /不在目录中/);
  const noCatalog = runtimeEffortOptions("codex", "gpt-real", null);
  assert.deepEqual(noCatalog.options.map(option => option.value), ["", ...CODEX_EFFORT_LEVELS]);

  const claudeCatalog = { models: [
    { id: "sonnet", levels: CLAUDE_EFFORT_LEVELS, note: "未声明模型能力；档位由 CLI 按模型实际支持解析，不支持时回退" },
    { id: "no-effort-model", levels: [], note: "配置声明该模型不支持思考档位" }
  ] };
  assert.deepEqual(runtimeEffortOptions("claude-code", "sonnet", claudeCatalog).options.map(option => option.value), ["", ...CLAUDE_EFFORT_LEVELS]);
  const declared = runtimeEffortOptions("claude-code", "no-effort-model", claudeCatalog);
  assert.deepEqual(declared.options.map(option => option.value), [""], "declared no-effort capability offers no levels");
  assert.match(declared.note, /不支持思考档位/);
  const claudeManual = runtimeEffortOptions("claude-code", "custom-model", claudeCatalog);
  assert.deepEqual(claudeManual.options.map(option => option.value), ["", ...CLAUDE_EFFORT_LEVELS]);
  assert.match(claudeManual.note, /手工输入/);

  const source = await readFile(new URL("../web/settings.mjs", import.meta.url), "utf8");
  assert.match(source, /class="model-options" role="listbox"/, "model input keeps free text with a themed suggestion list");
  assert.match(source, /\/api\/settings\/runtime-profiles\/models\?provider=/, "the picker queries the real authenticated catalog endpoint");
  assert.match(source, /模型列表加载失败：/, "catalog failure is shown honestly");
  assert.match(source, /模型列表为空/, "empty catalog is shown honestly");
  assert.match(source, /当前值不在列表中（手工输入）/, "manual values are labelled as outside the loaded list");
  assert.match(source, /原思考等级不适用于当前模型，已清除/, "switching models clears an inapplicable saved effort instead of silently keeping it");
  assert.match(source, /'model','effort'/, "effort is submitted with the profile");
});

test("Runtime form initializes the saved effort into the select (QA-RT-01)", async () => {
  const source = await readFile(new URL("../web/settings.mjs", import.meta.url), "utf8");
  const start = source.indexOf("  async function loadRuntimes()"), end = source.indexOf("  async function loadWorkspace()", start);
  const section = source.slice(start, end);
  assert.match(section, /syncEffort\(\);\s*\n\s*\/\/ Setting a select value before its options exist silently no-ops[\s\S]*?if \(value\.effort\) effortSelect\.value = value\.effort;/, "saved effort is applied after the option set exists");
  assert.ok(section.indexOf("effortSelect.value = value.effort") < section.indexOf("form.addEventListener('submit'"), "initialization happens before submit wiring");
  // The value survives a later catalog load only when it remains applicable;
  // syncEffort keeps the control value when it is in the option set.
  assert.match(section, /if \(previous && options\.some\(option => option\.value === previous\)\) effortSelect\.value = previous;/);
});

test("Runtime catalog requests are sequenced so stale responses never overwrite a newer list (PR review)", async () => {
  const source = await readFile(new URL("../web/settings.mjs", import.meta.url), "utf8");
  const start = source.indexOf("  async function loadRuntimes()"), end = source.indexOf("  async function loadWorkspace()", start);
  const section = source.slice(start, end);
  assert.match(section, /const catalog = \{ state: 'idle', data: null, error: '', request: 0 \}/, "per-card request counter");
  assert.match(section, /const request = \+\+catalog\.request;/, "every load is sequenced");
  assert.equal((section.match(/request !== catalog\.request\) return;/g) || []).length, 2, "stale success and failure responses are both ignored");
});

test('Diff explorer nests changed files, preserves collapsed directories and escapes paths', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const {workingDirectoryIcon} = await import('../client/console-projections.mjs');
  const context = vm.createContext({$t,$tm,workingDirectoryIcon, esc: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
  vm.runInContext(source.slice(source.indexOf('function directoryNodeIcon'),source.indexOf('function renderWorkingDirectory')) + source.slice(source.indexOf('function workingChangesTree'),source.indexOf('function renderWorkingChanges')),context);
  const repo = {path:'repos/app',changes:[{path:'repos/app/src/a.js',status:'M'},{path:'repos/app/src/nested/<b>.js',status:'A'},{path:'repos/app/tests/a.js',status:'D'}]};
  const html = context.workingChangesTree(repo,{selectedDiffPath:'repos/app/src/a.js',diffTreeOpen:{'repos/app/src':false}},'vscode-light');
  assert.match(html,/data-diff-directory="repos\/app\/src" >/);
  assert.match(html,/data-diff-directory="repos\/app\/src\/nested" open/);
  assert.match(html,/class="artifact-tree-file selected" data-select-diff="repos\/app\/src\/a.js"/);
  assert.match(html,/data-select-diff="repos\/app\/tests\/a.js"/);
  assert.match(html,/&lt;b>.js/);
  assert.match(html,/icons\/vscode/);
  assert.doesNotMatch(context.workingChangesTree(repo,{},'classic'),/<img/);
});

test('Edit diff separates block rows without extra newline text nodes, retaining source blank lines', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const {editDiff} = await import('../client/console-projections.mjs');
  const context = vm.createContext({$t,$tm,editDiff,esc:String});
  vm.runInContext(source.slice(source.indexOf('function editDiffMarkup'),source.indexOf('async function hydrateConsoleContent')),context);
  const html = context.editDiffMarkup({filePath:'src/a.js',oldText:'a\n\nb',newText:'a\n\nc'});
  assert.doesNotMatch(html,/<\/span>\n/);
  assert.match(html,/<span class="diff-line diff-context">  <\/span>/);
  assert.match(html,/<span class="diff-line diff-del">-b<\/span>/);
  assert.match(html,/<span class="diff-line diff-add">\+c<\/span>/);
});

test('file tool bodies show Write text rather than its JSON envelope and preserve fallback', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const { toolFileInput } = await import('../client/console-projections.mjs');
  const render = runWithCache(`${source.slice(source.indexOf('function fileToolFieldMarkup('), source.indexOf('// Git-style diff for a real Edit'))}; fileToolFieldMarkup`, {
    toolFileInput, esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  });
  const field = { text: JSON.stringify({ file_path: 'a.js', content: '<script>\nconst answer = 42;\n' }), redacted: true, truncated: true };
  const html = render('input', field, 'Write');
  assert.match(html, /写入内容/); assert.match(html, /&lt;script>\nconst answer = 42;\n/);
  assert.match(html, /已脱敏/); assert.match(html, /已截断/);
  assert.doesNotMatch(html, /<script>|file_path|&quot;content/);
  assert.equal(render('input', { text: '{"file_path":"a"}' }, 'Read'), '');
  assert.equal(render('input', { text: '{"file_path":"a","content":""}' }, 'Write').includes('<code></code>'), true);
  assert.equal(render('input', { text: '{"file_path":"a","content":42}' }, 'Write'), null);
  assert.equal(render('input', { text: '{"file_path":"a","content":"unclosed' }, 'Write'), null);
  assert.equal(render('output', { text: 'permission denied' }, 'Write'), null, 'failure output keeps generic rendering');
});

test('split Diff aligns replacements, preserves line numbers and escapes code',async()=>{
 const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
 const context=vm.createContext({$t,$tm,esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')});
 vm.runInContext(source.slice(source.indexOf('function workingDiffMarkup'),source.indexOf('function workingChangesTree')),context);
 const preview={patch:'--- a/a\n+++ b/a\n@@ -1,3 +1,3 @@\n same\n-old\n+<new>\n end\n'};
 const split=context.workingDiffMarkup(preview,'split');
 assert.match(split,/source-diff-split/);assert.match(split,/修改前/);assert.match(split,/&lt;new>/);assert.doesNotMatch(split,/<new>/);
 assert.match(split,/<tr><td class="source-line-number source-diff-del">2<\/td>.*old.*source-diff-add">2<\/td>.*&lt;new>/);
 assert.doesNotMatch(context.workingDiffMarkup(preview),/source-diff-split/);
 assert.match(context.workingDiffMarkup({patch:'@@ -1 +1 @@\n--- content\n+++ content\n'},'split'),/-- content/);
 assert.match(context.workingDiffMarkup({patch:'@@ -1 +1 @@\n--- content\n+++ content\n'},'split'),/\+\+ content/);
});

test('console session labels use the event Trace and never expose a provisional Codex ID as native',async()=>{
 const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
 const context=vm.createContext({$t,$tm,runtimeLabel,RUNTIME_IDS,esc:value=>String(value).replaceAll('<','&lt;')});
 vm.runInContext(source.slice(source.indexOf('function consoleSessionMarkup'),source.indexOf('function renderChatEvent')),context);
 const event={type:'session.created',actor:{id:'agent'},data:{traceId:'trace',sessionId:'allocated'}};
 const trace={id:'trace',agentId:'agent',providerSessionId:'allocated',sessionMode:'new'};
 const claude={runtime:{provider:'claude-code'}},codex={runtime:{provider:'codex'}};
 assert.match(context.consoleSessionMarkup(event,trace,claude),/Claude Code 会话 ID.*allocated/);
 assert.match(context.consoleSessionMarkup(event,trace,codex),/等待 Provider 初始化/);
 assert.doesNotMatch(context.consoleSessionMarkup(event,trace,codex),/allocated/);
 const bound={...trace,providerSessionId:'native-thread'};
 assert.match(context.consoleSessionMarkup(event,bound,codex),/Codex 会话 ID.*native-thread/);
 for(const [agent,data] of [[claude,{providerEventType:'system',subtype:'init'}],[codex,{providerEventType:'thread.started'}]]) {
  assert.match(context.consoleSessionMarkup({...event,type:'runtime.event',data:{...event.data,auditVersion:2,...data}},bound,agent),/native-thread/);
 }
 assert.equal(context.consoleSessionMarkup(event,{...bound,id:'other'},codex),'');
 assert.equal(context.consoleSessionMarkup({...event,type:'trace.completed'},bound,codex),'');
 assert.match(context.consoleSessionMarkup({...event,type:'session.resumed'},bound,codex),/native-thread/);
});

test('console bodies defer closed disclosures and stop queued reads after leaving the task', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function consoleContentVisible('), end = source.indexOf('let consoleContentObserver', start);
  const state = { currentView: 'workspace' }, view = { tab: 'console' };
  const visible = runWithCache(`${source.slice(start, end)}; consoleContentVisible`, { state, workspaceView: () => view });
  const group = { tagName: 'DETAILS', open: false }, tool = { tagName: 'DETAILS', open: true, parentElement: group };
  const node = { isConnected: true, parentElement: tool };
  assert.equal(visible(node), false, 'nested content must wait for outer group');
  group.open = true; assert.equal(visible(node), true);
  tool.open = false; assert.equal(visible(node), false);
  const summary = { parentElement: tool };
  const header = { isConnected: true, dataset: { consoleSummary: 'event-1' }, parentElement: summary };
  tool.dataset = { toolName: 'Bash' };
  assert.equal(visible(header), true, 'tool summary loads while its own disclosure is closed');
  group.open = false; assert.equal(visible(header), false, 'closed outer groups still defer summaries');
  group.open = true;
  tool.open = true; node.isConnected = false; assert.equal(visible(node), false);
  node.isConnected = true; view.tab = 'collaboration'; assert.equal(visible(node), false);
  view.tab = 'console'; state.currentView = 'tasks'; assert.equal(visible(node), false);
  assert.match(source, /if \(tab === "console" && selected\)/);
  assert.doesNotMatch(source, /state.selectedAgentId = executing\?/);
  assert.match(source, /limit: "50"/);
});

test('tool summaries load without opening bodies, deduplicate reads and bound concurrency', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const { toolCommandSummary } = await import('../client/console-projections.mjs');
  let reads = 0, active = 0, peak = 0;
  const cache = new Map();
  const hydrate = runWithCache(`${source.slice(source.indexOf('async function hydrateConsoleContent('), source.indexOf('const promptSnapshotCache'))}; hydrateConsoleContent`, {
    consoleContentVisible: node => node.isConnected, consoleContentCache: cache, toolCommandSummary,
    api: async url => {
      reads++; peak = Math.max(peak, ++active); await Promise.resolve(); active--;
      if (url.endsWith('/broken')) throw new Error('integrity failure');
      return { fields: { input: { text: '{"command":"npm test"}' } } };
    }
  });
  const node = id => ({ isConnected: true, dataset: { consoleSummary: id, contentRun: 'run' }, closest: selector => selector === '[data-tool-name]' ? { dataset: { toolName: 'Bash' } } : null });
  const first = node('same'), second = node('same'), failed = node('broken');
  await hydrate([first, second, failed, ...Array.from({ length: 8 }, (_, i) => node(String(i)))]);
  assert.equal(reads, 10, 'the same content reference is fetched only once');
  assert.ok(peak <= 4);
  assert.equal(first.textContent, 'npm test'); assert.equal(second.textContent, 'npm test');
  assert.match(failed.textContent, /不可读取或校验失败/);
  const detached = node('detached'); detached.isConnected = false;
  await hydrate([detached]); assert.equal(reads, 10);
});

test('command and file tool groups expose their rows by default but other groups stay closed', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const { isShellTool } = await import('../client/console-projections.mjs');
  const render = runWithCache(`${source.slice(source.indexOf('function renderToolGroup('), source.indexOf('function consoleSessionMarkup('))}; renderToolGroup`, {
    isCurrentRuntimeAudit: event => event.data.auditVersion === 2, isShellTool, exactTime: String, esc: String, renderToolCall: () => '<tool-row>'
  });
  const group = name => ({ toolName: name, tools: [{ event: { id: 'one', data: { auditVersion: 2 } } }] });
  for (const name of ['Bash', 'Read', 'Write']) assert.match(render(group(name)), /data-default-open open/);
  assert.doesNotMatch(render(group('Grep')), /data-default-open/);
});

test('employee search limits large directories and excludes selected or inactive employees', async () => {
  const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function employeeSearchResults('), end = source.indexOf('function mountEmployeePicker(', start);
  const search = runWithCache(`${source.slice(start, end)}; employeeSearchResults`);
  const agents = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), name: `员工 ${i}`, description: '媒体制作', capabilities: ['字幕'], status: i === 1 ? 'inactive' : 'active' }));
  assert.equal(search(agents, '', new Set()).length, 0);
  const results = search(agents, ' 媒体 ', new Set(['0']));
  assert.equal(results.length, 20);
  assert.equal(results.some(agent => ['0', '1'].includes(agent.id)), false);
  assert.equal(search(agents, '员工 4999', new Set())[0].id, '4999');
  assert.equal(search(agents, '字幕', new Set()).length, 20);
  assert.equal(search(agents, '不匹配', new Set()).length, 0);
});


test("thinking hydration displays recorded public text and explains empty historical records", async () => {
  const source = await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const fields = new Map([['body',{text:'公开思考 <script>unsafe()</script>',redacted:false}],['filtered',{text:'先检查输入\n[REDACTED]\n继续核对',redacted:true}],['empty',{text:'',redacted:true}],['whitespace',{text:' \n ',redacted:false}]]);
  const hydrate = runWithCache(`${source.slice(source.indexOf('async function hydrateConsoleContent('),source.indexOf('const promptSnapshotCache'))};hydrateConsoleContent`,{
    consoleContentVisible:()=>true,consoleContentCache:new Map(),isShellTool:()=>false,
    esc:text=>String(text).replaceAll('<','&lt;').replaceAll('>','&gt;'),
    api:async url=>({fields:{thinking:fields.get(url.split('/').at(-1))}})
  });
  const nodes=[...fields.keys()].map(id=>({isConnected:true,dataset:{consoleContent:id,contentRun:'run'},closest:()=>null}));
  await hydrate([...nodes]);
  assert.match(nodes[0].innerHTML,/公开思考 &lt;script&gt;/);assert.doesNotMatch(nodes[0].innerHTML,/已脱敏|未保存/);
  assert.match(nodes[1].innerHTML,/先检查输入/);assert.match(nodes[1].innerHTML,/继续核对/);assert.match(nodes[1].innerHTML,/敏感片段已隐藏/);
  for(const node of nodes.slice(2)){assert.match(node.innerHTML,/未保存可显示的思考正文/);assert.doesNotMatch(node.innerHTML,/已脱敏|敏感片段已隐藏/);}
});

function runWithCache(source,context={},...options){context.$t=$t;context.$tm=$tm;context.partyName=partyName;context.workflowDisplay=workflowDisplay;context.ByteCache=ByteCache;context.runtimeLabel=runtimeLabel;context.RUNTIME_IDS=RUNTIME_IDS;return vm.runInNewContext(source,context,...options);}

test('work-root reset preserves presentation preferences and reloads the retained login',async()=>{const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');const callback=source.slice(source.indexOf('onDataReset:'),source.indexOf('onWorkspaceSaved:'));assert.doesNotMatch(callback,/removeItem|clear\(/);assert.match(callback,/location.replace/);});

async function inboxHarness(extra = {}) {
  const source = await readFile(new URL('../web/app.js', import.meta.url),'utf8');
  const block = source.slice(source.indexOf('const inboxGroups ='),source.indexOf('/* ---------- 总览 ---------- */'));
  const state = {currentView:'inbox',inboxSelection:'a',inboxErrors:{},inboxResults:{awaiting_human:{tasks:[{id:'a',title:'登录',status:'awaiting_human',runs:[{id:'run/a'}]},{id:'b',title:'导出',status:'awaiting_human',runs:[{id:'run/b'}]}]}},inboxDetails:{}};
  const preview = {dataset:{},isConnected:true,innerHTML:'',querySelector(){return null;}};
  const list={innerHTML:''},host={innerHTML:'',querySelector:selector=>selector==='.inbox-list'?list:selector==='.inbox-layout'?{}:null};
  const context = {state,URLSearchParams,console,Date,CSS:{escape:String},document:{activeElement:null},$:selector=>selector==='#inbox-content'?host:preview,setTitleCount(){},requestAnimationFrame:callback=>callback(),esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),pill:String,statusText:{},statusTone:()=> 'attention',statusShape:()=> '?',exactTime:String,timeAgo:String,roleColor:()=> 'color-blue',initialsOf:()=> 'K',acceptanceReview:()=>({verified:true,criteria:['宽窄布局'],artifactCount:2}),acceptanceCriteriaMarkup:value=>value.criteria.join('；'),toast(){},api:async()=>({}),...extra};
  const controller = runWithCache(block+';({refreshInbox,renderInbox,renderInboxPreview,sendInboxAnswer,inboxFacts,inboxDrafts,inboxAnswered,inboxTasks,advanceInbox})',context);
  return {controller,state:context.state,preview,...context};
}
test('inbox rows derive real question identity, failure text and acceptance from compact facts',async()=>{
  const {controller} = await inboxHarness();
  const question={id:'q',content:'是否调整第三方登录？',sender:{id:'kai',name:'Kai'},recipient:{type:'human'}};
  const workspace={run:{participants:[{id:'kai',name:'Kai · 研发工程师',color:'blue'}]},pendingQuestions:[question]};
  assert.equal(controller.inboxFacts({status:'awaiting_human'},workspace).description,'Kai · 研发工程师 向你提问');
  assert.equal(controller.inboxFacts({status:'awaiting_human'},workspace).summary,question.content);
  assert.equal(controller.inboxFacts({status:'failed'},{run:{failure:{message:'code 127: missing executable'}}}).summary,'code 127: missing executable');
  assert.equal(controller.inboxFacts({status:'awaiting_acceptance'},{run:{manager:{name:'经理'},acceptanceRequest:{summary:'已交付'}}}).description,'经理 提交了验收');
});
test('inbox state previews use exact context, inline reply, acceptance, raw error and pause reason',async()=>{
  const calls=[];
  const h=await inboxHarness({api:async path=>{calls.push(path);return path.endsWith('/timeline')?{events:[{type:'run.paused',data:{reason:'等待录音'}}]}:{items:[{id:'input',from:'Noah',content:'原始交接 <script>'},{id:'unrelated',from:'其他成员',content:'无关消息'}]};}});
  const task={id:'a',title:'登录',status:'awaiting_human'};
  h.state.inboxDetails.a={run:{id:'r',task:{workflowSnapshot:{nodes:[{id:'dev',name:'功能开发'}]}},participants:[]},pendingQuestions:[{id:'q',traceId:'t',workflowNodeId:'dev',content:'问题全文',sender:{name:'Kai'},recipient:{type:'human'}}],traces:[{id:'t',inputMessageId:'input'}]};
  await h.controller.renderInboxPreview(task);
  assert.match(h.preview.innerHTML,/Noah 的交接/);assert.match(h.preview.innerHTML,/原始交接 &lt;script>/);assert.doesNotMatch(h.preview.innerHTML,/无关消息/);
  assert.match(h.preview.innerHTML,/<label[^>]*for="inbox-answer-text"/);assert.match(h.preview.innerHTML,/data-question-id="q"/);assert.match(h.preview.innerHTML,/发送回答/);assert.doesNotMatch(h.preview.innerHTML,/发送并处理下一项|value="stay"/);assert.match(h.preview.innerHTML,/inbox-task-heading/);assert.doesNotMatch(h.preview.innerHTML,/inbox-preview-footer/);
  assert.match(h.preview.innerHTML,/功能开发/);
  h.state.inboxDetails.a={run:{id:'r',artifactCount:2,task:{}},pendingQuestions:[]};
  await h.controller.renderInboxPreview({...task,status:'awaiting_acceptance'});assert.match(h.preview.innerHTML,/宽窄布局/);assert.match(h.preview.innerHTML,/2 项交付文件/);assert.match(h.preview.innerHTML,/data-inbox-confirm="r"/);assert.match(h.preview.innerHTML,/继续咨询/);
  h.state.inboxDetails.a.run.failure={message:'进程退出 code 127 <bad>'};
  await h.controller.renderInboxPreview({...task,status:'failed'});assert.match(h.preview.innerHTML,/<pre class="inbox-error">进程退出 code 127 &lt;bad>/);assert.match(h.preview.innerHTML,/查看恢复选项/);
  await h.controller.renderInboxPreview({...task,status:'paused'});assert.match(h.preview.innerHTML,/等待录音/);assert.match(h.preview.innerHTML,/查看并继续/);
});
test('inbox stale previews and refresh tickets cannot overwrite newer views',async()=>{
  let firstResolve;
  const h=await inboxHarness({api:path=>path.includes('run%2Fa')?new Promise(resolve=>firstResolve=resolve):Promise.resolve({run:{id:'b',task:{}},pendingQuestions:[]})});
  const old=h.controller.renderInboxPreview({id:'a',title:'OLD',status:'done',runs:[{id:'run/a'}]});
  await h.controller.renderInboxPreview({id:'b',title:'NEW',status:'done',runs:[{id:'run/b'}]});
  firstResolve({run:{id:'old'},pendingQuestions:[]});await old;assert.match(h.preview.innerHTML,/NEW/);assert.doesNotMatch(h.preview.innerHTML,/OLD/);
  const resolvers=[];
  const r=await inboxHarness({api:path=>new Promise(resolve=>resolvers.push({path,resolve}))});
  const pending=r.controller.refreshInbox();
  r.state.inboxView='recent';const recent=r.controller.refreshInbox();
  assert.equal(resolvers.length,6);
  resolvers[5].resolve({tasks:[{id:'done',status:'done',updatedAt:'2026-11-12'}],total:1,page:1,totalPages:1});await recent;
  resolvers.slice(0,5).forEach(({resolve})=>resolve({tasks:[],total:0}));await pending;
  assert.equal(r.state.inboxResults.done.tasks[0].id,'done');assert.equal(r.state.inboxLoadedView,'recent');
});
test('inbox recent previews retain original question, task content and completion result',async()=>{
  const h=await inboxHarness();
  h.state.inboxDetails.a={run:{id:'run-a',task:{objective:'原任务内容 <safe>'},acceptanceRequest:{summary:'经理交付结果'}}};
  await h.controller.renderInboxPreview({id:'a',title:'任务',status:'awaiting_human',inboxAnsweredAt:'2026-11-14',inboxQuestion:{content:'原问题 <script>'},inboxContext:{content:'原始交接上下文'},inboxAnswer:'回答结果'});
  for(const text of ['原任务内容 &lt;safe>','原问题 &lt;script>','原始交接上下文','回答结果'])assert.ok(h.preview.innerHTML.includes(text),text);
  assert.doesNotMatch(h.preview.innerHTML,/<script>|inbox-preview-footer|data-inbox-answer/);
  await h.controller.renderInboxPreview({id:'a',title:'任务',status:'done'});
  assert.match(h.preview.innerHTML,/原任务内容 &lt;safe>/);assert.match(h.preview.innerHTML,/经理交付结果/);
});

test('inbox compact polling preserves the current live answer form while metadata reloads',async()=>{
  const h=await inboxHarness();
  h.state.inboxDetails.a={loading:true};h.preview.dataset.taskId='a';h.preview.innerHTML='LIVE ANSWER WITH FAILURE';
  h.preview.querySelector=selector=>selector==='[data-inbox-answer]'?{dataset:{taskId:'a'}}:null;
  await h.controller.renderInboxPreview({id:'a',title:'任务',status:'awaiting_human'});
  assert.equal(h.preview.innerHTML,'LIVE ANSWER WITH FAILURE');
  h.state.inboxDetails.b={loading:true};await h.controller.renderInboxPreview({id:'b',title:'其他任务',status:'awaiting_human'});
  assert.match(h.preview.innerHTML,/正在读取事项详情/);
});

test('inbox advancement crosses status groups, wraps and clears the last selection',async()=>{
  const h=await inboxHarness();
  h.state.inboxResults.awaiting_acceptance={tasks:[{id:'c',status:'awaiting_acceptance'}]};
  h.state.inboxResults.failed={tasks:[{id:'d',status:'failed'}]};
  for(const [current,next]of[['a','b'],['b','c'],['c','d'],['d','a']]){h.controller.advanceInbox(current);assert.equal(h.state.inboxSelection,next);assert.equal(h.state.inboxReceipt,null);}
  h.state.inboxResults={awaiting_human:{tasks:[{id:'a'}]}};h.controller.advanceInbox('a');assert.equal(h.state.inboxSelection,null);
});

test('inbox reply preserves the precise message contract and failure draft, then always selects next',async()=>{
  for(const mode of ['next','stay','failure']) {
    const requests=[];let renders=0;
    const h=await inboxHarness({api:async(path,options)=>{requests.push({path,options});if(options?.method==='POST'){if(mode==='failure')throw Error('发送失败');return {resumed:true};}return {tasks:[],total:0,page:1,totalPages:1};}});
    const input={value:'  只调整 GitHub  ',readOnly:false},error={hidden:true},buttons=[{},{}];
    const form={dataset:{runId:'run/a',questionId:'question/a',taskId:'a'},isConnected:true,querySelector:selector=>selector==='textarea'?input:error,querySelectorAll:()=>buttons};
    form.inboxQuestion={id:'question/a',content:'回答前的原问题'};form.inboxContext={content:'原始上下文'};
    h.controller.inboxDrafts.set('run/a:question/a',input.value);
    // Only rendering is stubbed; execute real send/refresh/query logic.
    const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
    const send=runWithCache(source.slice(source.indexOf('async function sendInboxAnswer('),source.indexOf('/* ---------- 总览 ---------- */'))+';sendInboxAnswer',{
      ...h, inboxTasks:h.controller.inboxTasks,inboxDrafts:h.controller.inboxDrafts,inboxAnswered:h.controller.inboxAnswered,advanceInbox:h.controller.advanceInbox,
      refreshInbox:async()=>{h.state.inboxResults.awaiting_human.tasks.shift();},renderInbox:()=>renders++,toast(){},Date,encodeURIComponent,
    });
    await send({preventDefault(){},currentTarget:form,submitter:{value:mode}});
    assert.equal(requests[0].path,'/api/runs/run%2Fa/messages');
    assert.deepEqual(JSON.parse(requests[0].options.body),{recipientAgentId:null,replyToMessageId:'question/a',content:'只调整 GitHub',attachmentIds:[]});
    if(mode==='failure'){assert.equal(h.controller.inboxDrafts.get('run/a:question/a'),input.value);assert.equal(error.textContent,'发送失败');assert.equal(renders,0);}
    else {assert.equal(h.controller.inboxDrafts.has('run/a:question/a'),false);assert.equal(renders,1);assert.equal(h.state.inboxSelection,'b');assert.equal(h.state.inboxReceipt,null);assert.equal(h.controller.inboxAnswered.get('a').inboxQuestion.content,'回答前的原问题');assert.equal(h.controller.inboxAnswered.get('a').inboxContext.content,'原始上下文');}
    assert.ok(buttons.every(button=>!button.disabled));assert.equal(input.readOnly,false);
  }
});
test('inbox rich grouped rows hide empty groups and retain the live composer on polling',async()=>{
  const h=await inboxHarness();
  const list={innerHTML:''},chips={innerHTML:''},host={innerHTML:'',querySelector:selector=>selector==='.inbox-list'?list:null};
  h.state.inboxDetails.a={run:{id:'r',participants:[{id:'kai',name:'Kai',color:'blue'}]},pendingQuestions:[{id:'q',content:'第三方登录是否在范围内？',sender:{id:'kai',name:'Kai'},recipient:{type:'human'}}]};
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const render=runWithCache(source.slice(source.indexOf('function renderInbox()'),source.indexOf('async function renderInboxPreview('))+';renderInbox',{
    ...h,$:selector=>selector==='#inbox-content'?host:selector==='#inbox-header-actions'?chips:h.preview,inboxTasks:h.controller.inboxTasks,inboxVisibleGroups:()=>[['awaiting_human','等待你的澄清'],['failed','执行中断']],
    inboxFacts:h.controller.inboxFacts,inboxStatusIcon:()=>'<svg width="16"></svg>',renderInboxPreview(){},inboxPreviewRequest:0,setTitleCount(){},
  });
  render();assert.match(list.innerHTML,/Kai 向你提问/);assert.match(list.innerHTML,/第三方登录是否在范围内/);assert.match(list.innerHTML,/<button class="inbox-item selected"/);assert.doesNotMatch(list.innerHTML,/执行中断/);assert.match(chips.innerHTML,/data-inbox-view="recent"/);assert.doesNotMatch(host.innerHTML,/data-inbox-view/);
  const form={dataset:{questionId:'q'}},input={value:'正在输入的回答'};
  h.preview.innerHTML='LIVE COMPOSER';h.preview.dataset.taskId='a';h.preview.querySelector=selector=>selector==='#inbox-answer-text'?input:selector==='[data-question-id]'?form:null;
  h.api=async()=>({items:[]});
  // Re-rendering an updated summary for the same immutable question cannot replace its live input.
  await h.controller.renderInboxPreview({id:'a',title:'登录',status:'awaiting_human'});
  assert.equal(h.preview.innerHTML,'LIVE COMPOSER');assert.equal(input.value,'正在输入的回答');
});
test('inbox Enter sends next, while modified Enter and IME remain editable',async()=>{
  const input={},next={},form={querySelector:selector=>selector==='textarea'?input:next,requestSubmit:button=>{assert.equal(button,next);form.submitted=(form.submitted||0)+1;}};
  const h=await inboxHarness({api:async()=>({items:[]})});
  h.state.inboxDetails.a={run:{id:'r',participants:[],task:{}},pendingQuestions:[{id:'q',content:'问题',sender:{name:'Kai'},recipient:{type:'human'}}]};
  h.preview.querySelector=selector=>selector==='[data-inbox-answer]'?form:null;
  await h.controller.renderInboxPreview({id:'a',title:'登录',status:'awaiting_human'});
  let prevented=0;
  for(const flags of [{shiftKey:true},{ctrlKey:true},{metaKey:true},{altKey:true},{isComposing:true},{keyCode:229}])input.onkeydown({key:'Enter',preventDefault(){prevented++;},...flags});
  assert.equal(form.submitted,undefined);assert.equal(prevented,0);
  input.onkeydown({key:'Enter',preventDefault(){prevented++;}});assert.equal(form.submitted,1);assert.equal(prevented,1);
});
test('inbox recent view merges same-day local answers with the latest 20 done tasks without duplicates',async()=>{
  const calls=[],h=await inboxHarness({api:async path=>{calls.push(path);return {tasks:[{id:'done',status:'done',updatedAt:'2020-01-01'},{id:'answered',status:'done',updatedAt:'2020-01-01'}],total:80,totalPages:4,page:1};}});
  h.state.inboxView='recent';
  h.controller.inboxAnswered.set('answered',{id:'answered',inboxAnsweredAt:new Date().toISOString(),inboxAnswer:'已回答'});
  h.controller.inboxAnswered.set('yesterday',{id:'yesterday',inboxAnsweredAt:new Date(Date.now()-86400000).toISOString()});
  await h.controller.refreshInbox();
  assert.equal(calls.length,1);assert.match(calls[0],/status=done/);assert.match(calls[0],/pageSize=20/);
  assert.equal(h.state.inboxResults.done.tasks.length,2);assert.equal(h.state.inboxResults.done.tasks[0].id,'answered');assert.equal(h.state.inboxResults.done.totalPages,1);
});

test('market chips use server filtering and paging while retaining truthful source, components and use counts',async t=>{
  const nodes=new Map(),query=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,dataset:{},classList:{toggle(){}},querySelector:query,setAttribute(key,value){this[key]=value;}});return nodes.get(selector);};
  const root={isConnected:true,querySelector:query},headerActions={querySelector:query},calls=[];
  const catalog=Array.from({length:25},(_,i)=>({id:'p'+i,name:'Plugin '+i,description:'Description',version:'1.2.0',components:{skills:2,agents:1,hooks:0},source:{url:'file:///tmp/plugin-source'},createdAt:'2026-11-01'}));
  const ui=createMarketplaceUI({esc:String,headerActions,api:async path=>{
    calls.push(path);const url=new URL(path,'http://fixture');const page=Number(url.searchParams.get('page')),pageSize=Number(url.searchParams.get('pageSize') || 20);
    if(url.pathname==='/api/agents')return {agents:[{status:'inactive',runtime:{extensionSelection:{pluginIds:['p24']}}}],page:1,totalPages:1};
    const items=url.searchParams.get('usage')==='unused'?catalog.filter(item=>item.id!=='p24'):catalog;
    return {plugins:items.slice((page-1)*pageSize,page*pageSize),page,pageSize,total:items.length,totalPages:Math.ceil(items.length/pageSize),hasMore:page<Math.ceil(items.length/pageSize)};
  }});t.after(()=>ui.unmount());ui.mount(root);
  await new Promise(done=>setImmediate(done));
  assert.match(query('[data-market-chips]').innerHTML,/全部 <span>25/);assert.match(query('[data-market-chips]').innerHTML,/未被使用 <span>24/);
  assert.doesNotMatch(root.innerHTML,/data-install-plugin/);assert.match(headerActions.innerHTML,/data-install-plugin/);assert.match(headerActions.innerHTML,/data-extension-update="all"/);assert.doesNotMatch(query('[data-market-chips]').innerHTML,/data-market-filter="attention"/,'the API has no pending update candidates');
  assert.equal((query('[data-market-list]').innerHTML.match(/<article /g)||[]).length,20);
  assert.match(query('[data-market-list]').innerHTML,/2 Skill · 1 Subagent/);assert.doesNotMatch(query('[data-market-list]').innerHTML,/0 Hook/);assert.match(query('[data-market-list]').innerHTML,/本地目录 · \/tmp\/plugin-source/);
  query('[data-market-pager]').onclick({target:{closest:()=>({dataset:{page:'2'}})}});
  await new Promise(done=>setImmediate(done));
  assert.match(query('[data-market-list]').innerHTML,/Plugin 24/);assert.match(query('[data-market-list]').innerHTML,/1 位员工/);
  query('[data-market-chips]').onclick({target:{closest:()=>({dataset:{marketFilter:'unused'}})}});await new Promise(done=>setImmediate(done));
  assert.match(query('[data-market-chips]').innerHTML,/data-market-filter="unused" aria-pressed="true"/);
  query('[data-market-pager]').onclick({target:{closest:()=>({dataset:{page:'2'}})}});
  await new Promise(done=>setImmediate(done));
  assert.doesNotMatch(query('[data-market-list]').innerHTML,/Plugin 24/);assert.match(query('[data-market-list]').innerHTML,/未被使用/);
  query('[data-market-chips]').onclick({target:{closest:()=>({dataset:{marketFilter:'all'}})}});await new Promise(done=>setImmediate(done));
  assert.equal(query('[data-market-list]').hidden,false);assert.equal((query('[data-market-list]').innerHTML.match(/<article /g)||[]).length,20);
  assert.ok(calls.some(path=>path.includes('usage=unused')&&path.includes('page=2')));
});

test('market current page paints before auxiliary reads, never scans later catalog pages and keeps rows on auxiliary failure',async t=>{
  const nodes=new Map(),query=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,dataset:{},classList:{toggle(){}},querySelector:query,setAttribute(key,value){this[key]=value;}});return nodes.get(selector);};
  const root={isConnected:true,querySelector:query},calls=[];let rejectCount,rejectEmployees;
  const catalog=Array.from({length:20},(_,i)=>({id:'p'+i,name:'Plugin '+i,components:{skills:1}}));
  const ui=createMarketplaceUI({esc:String,api:path=>{
    calls.push(path);const url=new URL(path,'http://fixture');
    if(url.pathname==='/api/agents')return new Promise((_,reject)=>rejectEmployees=reject);
    assert.ok([...url.searchParams.keys()].every(key=>['page','search','usage'].includes(key)),'market queries use only the existing HTTP fields');
    if(url.searchParams.get('usage')==='unused')return new Promise((_,reject)=>rejectCount=reject);
    return Promise.resolve({plugins:catalog,page:1,pageSize:20,total:120,totalPages:6});
  }});t.after(()=>ui.unmount());ui.mount(root);await new Promise(done=>setImmediate(done));
  assert.equal((query('[data-market-list]').innerHTML.match(/<article /g)||[]).length,20);
  assert.equal(query('[data-market-list]').hidden,false);assert.match(query('[data-market-chips]').innerHTML,/全部 <span>120/);
  assert.ok(!calls.some(path=>new URL(path,'http://fixture').searchParams.get('page')==='2'));
  rejectCount(Error('count offline'));rejectEmployees(Error('employee offline'));await new Promise(done=>setImmediate(done));
  assert.equal((query('[data-market-list]').innerHTML.match(/<article /g)||[]).length,20);
  assert.match(query('[data-market-chips]').innerHTML,/计数读取失败/);assert.match(query('[data-market-list]').innerHTML,/使用情况读取失败/);
});

test('inbox paints confirmed rows before compact details and ignores a late detail after leaving the view',async()=>{
  let resolveDetail;const calls=[];
  const h=await inboxHarness({api:path=>{
    calls.push(path);
    if(path.includes('/workspace?'))return new Promise(resolve=>resolveDetail=resolve);
    const tasks=new URL(path,'http://fixture').searchParams.get('status')==='awaiting_acceptance'?[{id:'fast',title:'目录先显示',status:'awaiting_acceptance',runs:[{id:'slow-run'}]}]:[];
    return Promise.resolve({tasks,total:tasks.length,page:1,totalPages:1});
  }});
  const pending=h.controller.refreshInbox();await new Promise(done=>setImmediate(done));
  assert.equal(h.state.inboxLoading,false);assert.equal(h.state.inboxDetails.fast.loading,true);
  assert.match(h.$('#inbox-content').querySelector('.inbox-list').innerHTML,/目录先显示/);
  assert.match(h.preview.innerHTML,/正在读取事项详情/);assert.equal(calls.filter(path=>path.includes('/workspace?')).length,1);
  h.state.currentView='agents';resolveDetail({run:{id:'slow-run',task:{}}});await pending;
  assert.equal(h.state.inboxDetails.fast.loading,true,'old detail cannot update a departed view');
});

test('role rows expose the editor from the row and menu while capping bound avatars',async()=>{
  const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
  const nodes={'#roles-search':{value:''},'#roles-grid':{},'#roles-empty':{}};
  const employees=Array.from({length:7},(_,i)=>({id:'a'+i,name:'Employee '+i,roleIds:['role']}));
  const role={id:'role',name:'规范',prompt:'One long prompt',createdAt:'2026-11-01'};
  const render=runWithCache(source.slice(source.indexOf('function renderRoles()'),source.indexOf('function roleModal('))+';renderRoles',{
    $:selector=>nodes[selector],state:{roles:[role],listPages:{},directoryPages:{roles:{items:[role],page:1}},catalogReferences:{agents:employees}},paginate:()=>({}),esc:String,roleColor:()=> 'color-blue',initialsOf:()=> 'E',exactTime:String,timeAgo:()=> '昨天',renderListPager(){},setTitleCount(){},actionMenu:content=>`<details class="action-menu">${content}</details>`
  });render();
  const html=nodes['#roles-grid'].innerHTML;
  assert.equal((html.match(/data-edit-role=/g)||[]).length,2);assert.equal((html.match(/title="Employee/g)||[]).length,5);assert.match(html,/directory-avatar-overflow">\+2/);
  assert.match(html,/<details class="action-menu"><button[^>]*data-edit-role=[\s\S]*data-delete-role=/);assert.match(html,/创建于 2026-11-01/);assert.match(html,/role-row-prompt/);
});
