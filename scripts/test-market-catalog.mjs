import {writeStorageLocation} from '../server/storage-layout.mjs';
// Isolated full HTTP/CLI/renderer catalog acceptance. No Provider or operator data.
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdir,mkdtemp,writeFile,readFile,rename } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
await mkdir('.data',{recursive:true});
const root=await mkdtemp(resolve('.data/market-catalog-')),home=join(root,'home'),data=join(root,'client'),source=join(root,'source');await mkdir(home,{recursive:true});await mkdir(join(source,'.claude-plugin'),{recursive:true});
const plugins=[];for(let i=0;i<45;i++){
 const name='catalog-'+String(i).padStart(2,'0'),folder=join(source,name);plugins.push({name,source:'./'+name});await mkdir(join(folder,'.claude-plugin'),{recursive:true});
 await writeFile(join(folder,'.claude-plugin/plugin.json'),JSON.stringify({name,description:'数据库目录验收 '+name,mcpServers:{probe:{command:'node',args:['--version']}}}));
 for(let j=0;j<10;j++){const path=join(folder,'skills','skill-'+j);await mkdir(path,{recursive:true});await writeFile(join(path,'SKILL.md'),'---\nname: skill-'+j+'\ndescription: isolated catalog fixture\n---\nOnly used for catalog acceptance.');}
}
await writeFile(join(source,'.claude-plugin/marketplace.json'),JSON.stringify({name:'catalog-benchmark',plugins}));
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('catalog-qa',password);auth.close();
const store=createStore({databasePath:join(root,'work','records','agentforge.sqlite'),configurationDirectory:data,workspaceRoot:join(root,'work')});const manager=store.createAgent({name:'目录验收经理',kind:'manager'});store.setPluginUpdateSettings({enabled:false});store.close();
await writeStorageLocation(data,{version:1,workspaceRoot:join(root,'work'),previousRuntimeRoots:[]});
const app=await electron.launch({args:['apps/electron/main.mjs'],env:{...process.env,HOME:home,AGENTFORGE_DESKTOP_DATA_ROOT:data,AGENTFORGE_LOG_DIR:join(root,'logs')},timeout:180000});const evidence={root};console.log('EVIDENCE '+root);
try{
 const page=await app.firstWindow({timeout:180000});await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;
 await page.goto(origin+'/login');await page.locator('#username').waitFor();
 for(const theme of ['light','dark'])for(const width of [1440,760]){
  await app.evaluate(({BrowserWindow},{origin,width})=>{const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin));if(win.isMinimized())win.restore();if(win.isMaximized())win.unmaximize();win.setContentSize(width,900);},{origin,width});
  await page.waitForFunction(width=>innerWidth===width,width);
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const layout=await page.locator('.login-card').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {border:s.borderTopWidth,shadow:s.boxShadow,background:s.backgroundColor,width:r.width,centerX:r.x+r.width/2,centerY:r.y+r.height/2,text:s.textAlign,icon:el.querySelector('.login-icon').getBoundingClientRect().width};});
  assert.equal(layout.border,'0px');assert.equal(layout.shadow,'none');assert.equal(layout.background,'rgba(0, 0, 0, 0)');assert.equal(layout.text,'left');assert.equal(layout.width,360);assert.equal(layout.icon,52);
  assert.ok(Math.abs(layout.centerX-width/2)<1);assert.ok(Math.abs(layout.centerY-450)<1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(root,`login-${theme}-${width}.png`)});
 }
 await page.locator('#toggle-password').click();assert.equal(await page.locator('#password').getAttribute('type'),'text');await page.locator('#toggle-password').click();
 await page.locator('#username').fill('catalog-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor({state:'attached'});assert.equal(await page.locator('#account-name').textContent(),'catalog-qa');
 const api=(path,body,method=body===undefined?'GET':'POST',status=200)=>page.evaluate(async({path,body,method,status})=>{const r=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(r.status!==status)throw Error(`${r.status} expected ${status}: ${JSON.stringify(v)}`);return v;},{path,body,method,status});
 assert.equal((await fetch(origin+'/api/runtime/marketplace')).status,401);
 const imported=await api('/api/runtime/marketplace',{path:source},'POST',201);assert.equal(imported.plugins.length,45);assert.equal(imported.mcps.length,45);
 const plugin=imported.plugins.find(p=>p.name==='catalog-00'),mcp=imported.mcps.find(m=>m.name.startsWith('catalog-00'));
 const profile=(await api('/api/settings/runtime-profiles')).profiles.find(p=>p.provider==='claude-code');
 const employees=[];for(const status of ['active','inactive'])employees.push((await api('/api/agents',{name:'绑定目录 '+status,status,runtime:{profileId:profile.id,extensionSelection:{pluginIds:[plugin.id],mcpIds:[mcp.id]}}},'POST',201)).agent);
 const task=(await api('/api/tasks',{managerAgentId:manager.id,title:'冻结目录',objective:'仅保存冻结引用',memberAgentIds:[manager.id,employees[0].id]},'POST',201)).task;
 const times=[];for(let i=0;i<4;i++){const start=Date.now(),result=await api('/api/runtime/marketplace');times.push(Date.now()-start);assert.equal(result.plugins.length,20);assert.equal(result.total,45);assert.equal(result.totalPages,3);}
 evidence.httpListMs=times;
 for(const path of ['/api/runtime/marketplace','/api/runtime/mcp-marketplace']){const result=await api(path+'?page=3');assert.equal((result.plugins||result.entries).length,5);await api(path+'?page=0',undefined,'GET',400);await api(path+'?unknown=1',undefined,'GET',400);}
 // A list page must not touch plugin content. Detail must still validate/read it.
 const pluginRoot=dirname(dirname(employees[0].runtime.extensionManifest.find(ref=>ref.kind==='plugin').path)),held=pluginRoot+'.held';await rename(pluginRoot,held);
 try{assert.equal((await api('/api/runtime/marketplace')).total,45);await api('/api/runtime/marketplace/'+plugin.id,undefined,'GET',400);}finally{await rename(held,pluginRoot);}
 for(const [theme,width] of [['light',1440],['dark',1440],['light',760],['dark',760]]){
  await app.evaluate(({BrowserWindow},{origin,width})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(width,800),{origin,width});await page.waitForFunction(w=>innerWidth===w,width);await page.goto(origin+'/settings/appearance');await page.locator(`[name=theme][value=${theme}]`).check();
  for(const route of ['marketplace','mcp-marketplace']){
   await page.goto(origin+'/'+route);const catalog=page.locator('#'+route+'-root');await catalog.locator('.installed-extension-card').first().waitFor();assert.equal(await catalog.locator('.installed-extension-card').count(),20);
   await catalog.getByRole('button',{name:'下一页',exact:true}).click();await catalog.locator('[data-market-pager]').filter({hasText:/2\s*\/\s*3/}).waitFor();
   await catalog.locator('.directory-toolbar input').fill('catalog-00');await page.waitForFunction(route=>document.querySelectorAll('#'+route+'-root .installed-extension-card').length===1,route);
   assert.equal(await catalog.locator('[data-market-pager] button').count(),0);
   assert.equal(await catalog.locator('select[data-market-usage]').count(),0);
   assert.equal(await catalog.locator('[data-market-filter]').count(),route==='marketplace'?2:3);
   await catalog.locator('.extension-source').first().waitFor();assert.ok((await catalog.locator('.extension-source').first().textContent()).trim());
   assert.match(await catalog.locator('.extension-card-footer').first().textContent(),route==='marketplace'?/10 Skill.*2 位员工/:/工具尚未读取.*2 位员工/);
   if(route==='mcp-marketplace')await catalog.locator('.extension-tag').filter({hasText:'stdio'}).waitFor();
   await catalog.locator('[data-market-filter=unused]').click();await catalog.locator('[data-market-empty]').filter({hasText:'没有匹配'}).waitFor();
   await catalog.locator('[data-market-filter=all]').click();await catalog.locator('.installed-extension-card').waitFor();
   if(route==='mcp-marketplace'){await catalog.locator('[data-market-filter=attention]').click();await catalog.locator('[data-market-empty]').filter({hasText:'没有匹配'}).waitFor();}
   await catalog.locator('[data-market-filter=all]').click();await catalog.locator('.installed-extension-card').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({animations:'disabled',path:join(root,`${route}-${theme}-${width}.png`)});
  }
 }
 // Discovery state comes from the existing explicit tools command, then powers
 // the client-only failure chip and retry action across directory remounts.
 await page.goto(origin+'/mcp-marketplace');await page.locator('#mcp-marketplace-root input[type=search]').fill('catalog-00');
 let discoveryAttempts=0;const toolsPath=`**/api/runtime/mcp-marketplace/${mcp.id}/tools`;
 await page.route(toolsPath,route=>{discoveryAttempts++;return route.fulfill({status:discoveryAttempts===1?400:200,json:discoveryAttempts===1?{error:'隔离工具读取失败'}:{total:1,tools:[{name:'proof',description:'隔离界面工具'}]}});});
 await page.locator(`[data-extension-detail="${mcp.id}"]`).first().click();await page.locator('[data-mcp-tools][role=alert]').filter({hasText:'隔离工具读取失败'}).waitFor();await page.locator('#modal-close:visible, #modal-content [data-close-modal]:visible').first().click();
 await page.locator('[data-market-filter=attention]').click();const failedCard=page.locator(`[data-extension-id="${mcp.id}"]`);await failedCard.locator('.extension-error').waitFor();
 await failedCard.locator('.extension-card-footer > [data-extension-retry]').click();await page.locator('[data-market-empty]').filter({hasText:'没有匹配'}).waitFor();
 await page.locator('[data-market-filter=all]').click();await page.locator('.extension-card-footer').filter({hasText:'1 个工具'}).waitFor();assert.equal(discoveryAttempts,2);await page.unroute(toolsPath);
 const cli=async(args,value)=>{const result=await new Promise((done,reject)=>{const child=spawn(process.execPath,[resolve('cli/main.mjs'),...args,'--endpoint-file',join(data,'desktop-endpoint.json'),'--session-file',join(root,'session.json'),'--json'],{stdio:['pipe','pipe','pipe']});let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);child.once('error',reject);child.once('close',code=>done({code,stdout}));child.stdin.end(value||'');});assert.equal(result.code,0,result.stdout);return JSON.parse(result.stdout).data;};
 await cli(['auth','login','--username','catalog-qa','--password-stdin'],password+'\n');assert.equal((await cli(['plugins','list','--all'])).items.length,45);assert.equal((await cli(['mcps','list','--page','3'])).items.length,5);assert.equal((await cli(['plugins','list','--search','CATALOG-00'])).total,1);
 await page.goto(origin+'/marketplace');await page.locator('#marketplace-root .directory-toolbar input').fill('catalog-00');await page.locator(`[data-extension-detail="${plugin.id}"]`).first().click();await page.locator('[data-plugin-tab]').first().waitFor();await page.locator('.directory-detail-header .action-menu summary').click();await page.locator('[data-delete-extension]').click();await page.getByRole('button',{name:'删除插件',exact:true}).click();await page.waitForFunction(async()=> (await(await fetch('/api/runtime/marketplace')).json()).total===44);
 let current=(await api('/api/agents')).agents;for(const employee of employees){const r=current.find(e=>e.id===employee.id).runtime;assert.deepEqual(r.extensionSelection,{pluginIds:[],mcpIds:[mcp.id]});assert.equal(r.pluginPaths.length,0);assert.equal(r.skillPaths.length,0);}
 const removed=await cli(['mcps','delete',mcp.id,'--yes']);assert.equal(removed.employees.length,2);assert.equal(removed.historyRetained,true);
 current=(await api('/api/agents')).agents;for(const employee of employees){const r=current.find(e=>e.id===employee.id).runtime;assert.deepEqual(r.extensionSelection,{pluginIds:[],mcpIds:[]});assert.equal(r.extensionManifest.length,0);assert.equal(r.mcpConfigPaths.length,0);}
 await api('/api/runtime/marketplace/'+plugin.id,undefined,'GET',404);await api('/api/runtime/mcp-marketplace/'+mcp.id,undefined,'GET',404);
 await api('/api/agents/'+employees[0].id,{runtime:{profileId:profile.id,extensionSelection:{pluginIds:[plugin.id],mcpIds:[]}}},'PUT',400);
 const frozen=(await api('/api/tasks')).tasks.find(item=>item.id===task.id);assert.deepEqual(frozen.memberSnapshots,task.memberSnapshots);
 for(const ref of employees[0].runtime.extensionManifest)assert.ok((await readFile(ref.path)).length);
 assert.equal((await api('/api/runtime/marketplace')).total,44);assert.equal((await api('/api/runtime/mcp-marketplace')).total,44);
 evidence.status='passed';evidence.counts={plugins:45,mcps:45,affectedEmployees:2};console.log(JSON.stringify(evidence));
}catch(error){evidence.error=error.message;throw error;}finally{await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await app.close();}
