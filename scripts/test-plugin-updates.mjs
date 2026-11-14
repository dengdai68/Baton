// Real localhost HTTPS Git + manual update-all UI/API/CLI. Model calls are opt-in.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {_electron as electron} from 'playwright-core';
import {createAuth} from '../server/auth.mjs';
import {createStore} from '../server/store.mjs';
import {writeStorageLocation} from '../server/storage-layout.mjs';
import {testEnvironment} from './run-tests.mjs';
import {gitOrigin} from '../tests/plugin-git-fixture.mjs';

const cleanups=[],origin=await gitOrigin({after:fn=>cleanups.push(fn)},{keep:true}),root=origin.root;
const packaged=process.env.BATON_PLUGIN_UPDATES_APP,real=process.env.BATON_PLUGIN_UPDATE_TASK_REAL==='1';
const before=randomBytes(16).toString('hex'),after=randomBytes(16).toString('hex');
await mkdir(join(origin.source,'.claude-plugin'));await mkdir(join(origin.source,'skills/current'),{recursive:true});
await writeFile(join(origin.source,'.claude-plugin/plugin.json'),JSON.stringify({name:'release-check',version:'1.0.0'}));
await writeFile(join(origin.source,'skills/current/SKILL.md'),'---\nname: current-facts\ndescription: 核验本机当前事实，生成可追溯简报。\n---\n实际读取此技能目录中的 facts.txt，将完整原值写入用户要求的交付文档，并注明真实读取来源。不能猜测。');
await writeFile(join(origin.source,'skills/current/facts.txt'),before);await origin.commit();await origin.git('-C',join(root,'repos/repo.git'),'symbolic-ref','HEAD','refs/heads/main');
const home=join(root,'home'),data=packaged?join(home,'.baton/desktop'):join(root,'client');await mkdir(home);
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('update-qa',password);auth.close();
const store=createStore({databasePath:join(root,'work/records/baton.sqlite'),configurationDirectory:data,workspaceRoot:join(root,'work')});store.close();
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
let app,page,base;
const evidence={root,packaged:Boolean(packaged),real,result:'RUNNING'};
const wait=async(label,check,timeout=300000)=>{const start=Date.now();let last=0;while(Date.now()-start<timeout){const value=await check();if(value)return value;if(Date.now()-last>30000){console.log('WAIT',label);last=Date.now()}await new Promise(done=>setTimeout(done,500))}throw Error('timeout: '+label)};
try{
  const env={...testEnvironment(),HOME:home,CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR || join(homedir(),'.claude'),BATON_LOG_DIR:join(root,'logs')};
  app=await electron.launch({...(packaged?{executablePath:resolve(packaged,'Contents/MacOS/Baton')}:{}),args:packaged?[]:['apps/electron/main.mjs'],env:{...env,BATON_DESKTOP_DATA_ROOT:data},timeout:90000});page=await app.firstWindow();await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:60000});base=new URL(page.url()).origin;
  console.log('EVIDENCE',root);
  const api=(path,body,method=body?'POST':'GET')=>page.evaluate(async({path,body,method})=>{const r=await fetch(path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value},{path,body,method});
  await page.goto(base+'/login');await page.locator('#username').fill('update-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
  await page.goto(base+'/marketplace');await page.locator('[data-install-plugin]').waitFor();assert.equal(await page.locator('[data-plugin-updates], [data-check-plugin-updates]').count(),0);
  await page.locator('[data-install-plugin]').click();await page.locator('#market-source').fill(origin.url);await page.locator('#market-entry-form [type=submit]').click();await page.locator('#market-entry-form').waitFor({state:'detached'});await page.locator('.installed-extension-card').first().waitFor();
  const installed=(await api('/api/runtime/marketplace')).plugins[0];
  await page.goto(base+'/settings/updates');await page.locator('[data-app-update-check]').waitFor();assert.equal(await page.locator('[data-plugin-update-form],[data-check-plugin-updates]').count(),0);
  let profile=(await api('/api/settings/runtime-profiles')).profiles.find(item=>item.provider==='claude-code');
  if(real){const actual=process.env.BATON_PLUGIN_UPDATE_CLAUDE || execFileSync('/usr/bin/which',['claude'],{encoding:'utf8'}).trim(),wrapper=join(root,'real-claude');await writeFile(wrapper,'#!/bin/sh\nHOME='+JSON.stringify(homedir())+' exec '+JSON.stringify(actual)+' "$@"\n',{mode:0o700});profile=await api('/api/settings/runtime-profiles',{name:'Real scheduled plugin validation',provider:'claude-code',executable:wrapper});}
  const employee=(await api('/api/agents',{name:'事实编辑',systemPrompt:'使用所选原生 Skill 读取真实事实并完成交付，不猜测，不编排流程。',runtime:{profileId:profile.id,extensionSelection:{pluginIds:[installed.id],mcpIds:[]}}})).agent;
  let team,flow,frozen;
  if(real){
    const manager=(await api('/api/agents',{name:'知识经理',kind:'manager',systemPrompt:'只有 facts 一个节点。首次 managerDecision(nextNodeId=facts,nextAgentId=事实编辑真实ID) 派工；实际收到交接后 managerDecision(nextNodeId=null,nextAgentId=null) 提交人类验收。不得自己执行业务。',runtime:{profileId:profile.id}})).agent;
    team=(await api('/api/teams',{name:'定时更新验收组',memberAgentIds: [...new Set([employee.id, manager.id])]})).team;
    flow=(await api('/api/workflow-templates',{name:'事实简报',nodes:[{id:'facts',title:'核验当前事实',staffingGuidance:'选择事实编辑',deliverable:'使用 current-facts 原生 Skill，实际读取其事实文件，将原值和真实读取来源写入 docs/facts/brief.md。不要猜测，不读取数据库或凭据。',artifactPaths:['docs/facts/'],dependsOn:[]}]})).workflowTemplate;
    frozen=(await api('/api/tasks',{managerAgentId:'system_project_manager',title:'更新前冻结，不执行',objective:'只冻结原插件版本',memberAgentIds: team.memberAgentIds,workflowTemplateId:flow.id})).task;
  }
  await writeFile(join(origin.source,'skills/current/facts.txt'),after);const revision=await origin.commit();
  await page.goto(base+'/marketplace');await page.getByRole('button',{name:'更新全部',exact:true}).click();
  const checked=await wait('manual update completion',async()=>{const status=await api('/api/runtime/marketplace/updates');if(status.lastResult?.errors?.length)throw Error(JSON.stringify(status.lastResult.errors));return !status.running && status.lastResult?.updatedPlugins?status:null});evidence.check=checked;
  const current=(await api('/api/runtime/marketplace')).plugins;assert.equal(current.length,1);assert.notEqual(current[0].id,installed.id);assert.equal(current[0].version,'1.0.0');assert.equal(current[0].source.revision,revision);
  assert.deepEqual((await api('/api/agents')).agents.find(item=>item.id===employee.id).runtime.extensionSelection.pluginIds,[current[0].id]);
  await page.getByRole('button',{name:'更新全部',exact:true}).click();await wait('manual no-change check',async()=>{const value=await api('/api/runtime/marketplace/updates');return !value.running && value.lastCheckedAt!==checked.lastCheckedAt && value.lastResult.updatedPlugins===0});
  await page.getByRole('button',{name:'更新全部',exact:true}).waitFor();
  await page.screenshot({path:join(root,'updated-wide.png')});if(app)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,600));else await page.setViewportSize({width:760,height:600});await page.waitForFunction(()=>innerWidth===760);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(root,'updated-narrow.png')});
  await writeFile(join(root,'endpoint.json'),JSON.stringify({origin:base,instanceId:(await api('/api/health')).instanceId}),{mode:0o600});
  const cli=(args,input='')=>new Promise((done,reject)=>{const child=spawn(process.execPath,['cli/main.mjs',...args,'--json','--endpoint-file',join(root,'endpoint.json'),'--session-file',join(root,'cli/session.json')]);let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('close',code=>code?reject(Error(err||out)):done(JSON.parse(out).data));child.stdin.end(input)});
  await cli(['auth','login','--username','update-qa','--password-stdin'],password+'\n');const prior=await cli(['plugins','updates']);assert.equal('enabled' in prior,false);await cli(['plugins','check-updates']);await wait('CLI manual receipt',async()=>{const value=await cli(['plugins','updates']);return !value.running && value.lastCheckedAt!==prior.lastCheckedAt});
  if(real){
    const old=(await api('/api/tasks')).tasks.find(item=>item.id===frozen.id);assert.ok(JSON.stringify(old.memberSnapshots).includes(installed.id));assert.ok(!JSON.stringify(old.memberSnapshots).includes(current[0].id));
    const task=(await api('/api/tasks',{managerAgentId:'system_project_manager',title:'PLUGIN-UPDATE｜真实事实简报',objective:'实际使用已选择的当前事实技能产出完整简报，交付后等待人类确认。',memberAgentIds: team.memberAgentIds,workflowTemplateId:flow.id})).task;
    const run=(await api('/api/tasks/'+task.id+'/run',{})).run;
    const state=()=>api('/api/runs/'+run.id+'/workspace?view=summary');
    const final=await wait('real updated Skill task',async()=>{const w=await state();if(['failed','awaiting_human'].includes(w.run.status))throw Error('unexpected '+w.run.status);return w.run.status==='awaiting_acceptance'?w:null},900000);
    const report=await readFile(join(final.run.task.workspacePath,'docs/facts/brief.md'),'utf8');assert.ok(report.includes(after));assert.ok(!report.includes(before));
    await page.goto(base+'/runs/'+run.id);await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();const done=await wait('human confirmation',async()=>{const w=await state();return w.run.status==='completed'?w:null});assert.equal(done.run.confirmedBy,'human_operator');evidence.task={taskId:task.id,runId:run.id,traceCount:done.traces.length,humanConfirmation:done.run.confirmedBy};
    await page.locator('[data-ws-tab=console]').click();
    const latest=[...done.traces].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0];
    await page.locator(`[data-select-agent="${latest.agentId}"].selected`).waitFor();await page.locator(`[data-select-agent="${employee.id}"]`).click();
    await page.locator('[data-console-latest]').click();assert.equal(await page.locator(`[data-select-agent="${employee.id}"].selected`).count(),1);evidence.consoleDefault=latest.agentId;
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1320,800));await page.waitForFunction(()=>innerWidth===1320);
  const second=(await api('/api/agents',{name:'备用会话',runtime:{profileId:profile.id}})).agent;
  const chatA=(await api('/api/communications',{kind:'agent',targetId:employee.id})).conversation;
  const chatB=(await api('/api/communications',{kind:'agent',targetId:second.id})).conversation;
  const chats=(await api('/api/communications')).conversations,latestChat=chats.reduce((latest,item)=>Date.parse(item.updatedAt)>Date.parse(latest.updatedAt)?item:latest);
  await page.goto(base+'/communication');await page.locator(`[data-chat-id="${latestChat.id}"].selected`).waitFor();evidence.conversationDefault=latestChat.id;
  const explicit=latestChat.id===chatA.id?chatB:chatA;await page.locator(`[data-chat-id="${explicit.id}"]`).click();await page.locator(`[data-chat-id="${explicit.id}"].selected`).waitFor();
  for(let index=0;index<2;index++)await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/communications' && response.request().method()==='GET');
  assert.equal(await page.locator('.communication-contact.selected').getAttribute('data-chat-id'),explicit.id);
  evidence.result='PASS';console.log('PASS',root);
}catch(error){evidence.result='FAIL';evidence.error=error.message;throw error;}
finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app?.close();for(const cleanup of cleanups.reverse())await cleanup();}
