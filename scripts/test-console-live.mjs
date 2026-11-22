// Isolated presentation acceptance. Events/transport faults are fixtures, no Provider calls.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {_electron as electron} from 'playwright-core';
import {createAuth} from '../server/auth.mjs';
import {createFixtureStore} from '../tests/fixture-store.mjs';
import {writeStorageLocation} from '../server/storage-layout.mjs';
import {testEnvironment} from './run-tests.mjs';
const root=await mkdtemp(join(tmpdir(),'baton-console-live-')),home=join(root,'home'),data=join(home,'.baton'),work=join(root,'workspace');await mkdir(home,{mode:0o700});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('console-preview',password);auth.close();
const store=createFixtureStore({databasePath:join(work,'records/baton.sqlite'),configurationDirectory:data,workspaceRoot:work});
const run=store.createRun(store.listTasks()[0].id),agent=store.getRunAgent(run.id,'agent_engineer'),trace=store.createTrace(run.id,{agentId:agent.id,type:'node',workflowNodeId:'requirements'});store.completeTrace(trace.id);store.pauseRun(run.id,'控制台优化预览：隔离演示，不启动员工。');
const chat=store.openCommunication({kind:'agent',targetId:agent.id});
store.sendCommunication(chat.id,{content:'控制台分页验收',clientRequestId:'persisted-console-test'});
const delivery=store.claimCommunication(chat.id);
store.transaction(()=>{
 for(let i=0;i<340;i++){
  const visible=i<60, type=visible?'assistant':'message_update';
  const message=visible?`持久化控制台验收 ${i}`:'Provider 执行状态';
  const data={auditVersion:2,presentation:visible?'text':'system',providerEventType:type};
  store.addEvent({runId:run.id,type:'runtime.event',actor:{type:'agent',id:agent.id,name:agent.name},message:`${agent.name} · ${type}: ${message}`,data:{...data,traceId:trace.id}});
  store.appendCommunicationEvent(chat.id,delivery.id,{providerEventType:type,message,data});
 }
 store.completeCommunication(chat.id,delivery.id,'隔离验收完成');
});
store.close();await writeStorageLocation(data,{version:1,workspaceRoot:work,previousRuntimeRoots:[]});
await writeFile(join(data,'desktop-preferences.json'),JSON.stringify({language:'zh-CN'}));
const bundle=process.env.BATON_CONSOLE_LIVE_APP;
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/Baton')}:{args:[resolve('apps/electron/main.mjs')]}),env:{...testEnvironment({...process.env,HOME:home}),BATON_DESKTOP_DATA_ROOT:data,BATON_LOG_DIR:join(root,'logs')},timeout:120000});
const evidence={root,bundle:bundle||'source',cases:[],rendererErrors:[]};console.log('EVIDENCE '+root);let page,releaseBody,releasePage,leaveOpen=false;
try{
 page=await app.firstWindow({timeout:120000});page.setDefaultTimeout(20000);page.on('pageerror',error=>evidence.rendererErrors.push(error.message));await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;await page.locator('#username').waitFor();await page.waitForLoadState('load');await page.locator('#username').fill('console-preview');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
 if(process.env.BATON_CONSOLE_SOURCE==='1')await page.route('**/client/console-projections.mjs',route=>route.fulfill({contentType:'text/javascript',path:resolve('client/console-projections.mjs')}));
 if(process.env.BATON_CONSOLE_SOURCE==='1')for(const file of ['app.js','communication.js','console-stream.mjs','styles.css'])await page.route('**/'+file,async route=>route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:await readFile(resolve('web',file),'utf8')}));
 await page.addInitScript(()=>{const Native=window.EventSource;window.__consoleSources=[];window.EventSource=function(...args){const source=new Native(...args);window.__consoleSources.push(source);return source;};});
 // Real SQLite, authenticated archive endpoints and renderer; no intercepted
 // requests in this phase. The stored events are deterministic UI fixtures.
 for(const kind of ['task','chat']){
  await page.goto(origin+(kind==='task'?'/runs/'+run.id:'/communication/'+chat.id));
  await page.locator(kind==='task'?'#console-mode':'[data-toggle-communication-console]').click();
  const stream=page.locator(kind==='task'?'#trace-stream':'[data-communication-stream]');
  await stream.getByText('持久化控制台验收 59',{exact:true}).waitFor();
  await page.locator(kind==='task'?'[data-console-older]':'[data-communication-console-older]').click();
  await stream.getByText('持久化控制台验收 0',{exact:true}).waitFor();
  assert.equal(await stream.getByText('持久化控制台验收 59',{exact:true}).count(),1);
  evidence.cases.push(kind+' persisted archive: 280 status events after 60 outputs; latest and older both readable');
  console.log('PASS '+evidence.cases.at(-1));
 }
 let events=[],sequence=0,slowId=null,failNext=false,holdNext=false,failOlder=false,holdOlder=false,requests=0;const body=new Map();
 const add=(count=1)=>{const added=[];for(let i=0;i<count;i++){const id='preview-'+String(++sequence).padStart(5,'0');const event={id,type:'runtime.event',runId:run.id,timestamp:new Date(Date.parse(trace.startedAt)+sequence*1000).toISOString(),actor:{type:'agent',id:agent.id,name:agent.name},message:'控制台增量记录 '+sequence,data:{auditVersion:2,providerEventType:'assistant',presentation:'text',traceId:trace.id,contentRef:{fixture:true}}};events.push(event);body.set(id,'记录 '+sequence+'：'+('增量追加保持旧记录、展开状态与阅读位置。'.repeat(5)));added.push(event);}return added;};
 const addNoise=(kind, prefix, count)=>{
  const last=events.at(-1);
  const rows=Array.from({length:count},(_,i)=>({...last,id:`${prefix}-${i}`,
    message:kind==='task'?'message_update: Provider 执行状态':'Provider 执行状态',
    data:{auditVersion:2,providerEventType:'message_update',presentation:'system',traceId:trace.id}}));
  events.push(...rows);return rows;
 };
 const response=url=>{const params=new URL(url).searchParams,before=params.get('before');const end=before?events.findIndex(e=>e.id===before):events.length,start=Math.max(0,end-50);return {events:events.slice(start,end),traces:[trace],agents:[{...agent,running:false}],hasMore:start>0,nextBefore:start?events[start].id:null};};
 for(const path of [`**/api/runs/${run.id}/console?*`,`**/api/communications/${chat.id}/console?*`])await page.route(path,async route=>{requests++;const before=new URL(route.request().url()).searchParams.get('before');
 if(failNext || before && failOlder){failNext=false;failOlder=false;await route.fulfill({status:503,json:{error:'隔离网络故障'}});return;}const value=response(route.request().url());if(holdNext || before && holdOlder){holdNext=false;holdOlder=false;await new Promise(r=>releasePage=r);}await route.fulfill({json:value});});
 await page.route('**/console-content/*',async route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1);if(id===slowId)await new Promise(r=>releaseBody=r);await route.fulfill({json:{version:1,fields:{text:{text:body.get(id)||'隔离记录',redacted:false,truncated:false}}}}).catch(()=>{});});
 const gap=stream=>stream.evaluate(n=>n.scrollHeight-n.scrollTop-n.clientHeight);
 const append=async(kind,rows)=>{if(kind==='task')await page.evaluate(rows=>{const source=window.__consoleSources.findLast(s=>s.readyState!==2);for(const row of rows){source.dispatchEvent(new MessageEvent('run-event',{data:JSON.stringify(row)}));source.dispatchEvent(new MessageEvent('run-event',{data:JSON.stringify(row)}));}},rows);};
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const verifyPiNoise=async(kind,stream,latest)=>{
  const piNoise=['thread.started','agent_start','turn_start','message_start','message_update','message_end','turn_end','agent_end','agent_settled','tool_execution_update'].map((type,index)=>({...events.at(-1),id:`pi-state-${index}`,message:kind==='task'?`${type}: Provider 执行状态`:'Provider 执行状态',data:{auditVersion:2,presentation:'system',providerEventType:type,traceId:trace.id}}));
  const piFailure={...events.at(-1),id:'pi-error',message:'Pi upstream request failed',data:{auditVersion:2,presentation:'error',providerEventType:'error',traceId:trace.id}};
  events.push(...piNoise,piFailure);const afterNoise=add()[0];await append(kind,[...piNoise,piFailure,afterNoise]);
  await stream.locator(`[data-console-row="${afterNoise.id}"]`).waitFor();
  assert.equal(await stream.locator('[data-console-row^="pi-state-"]').count(),0,'Pi lifecycle/delta notifications are hidden in the live console');
  await stream.locator('[data-console-row="pi-error"]').waitFor();await latest.click();await stream.locator(`[data-console-row="${afterNoise.id}"]`).waitFor();
  assert.equal(await stream.locator('[data-console-row^="pi-state-"]').count(),0,'saved Pi notifications remain hidden after reloading the latest page');
  await stream.locator('[data-console-row="pi-error"]').waitFor();
 };
 for(const [theme,width] of [['light',1320],['dark',760]])for(const kind of ['task','chat']){
  console.log('CASE '+kind+'/'+theme+'/'+width);events=[];sequence=0;slowId=null;add(70);addNoise(kind,"history-noise",150);add(50);addNoise(kind,"tail-noise",260);
  await app.evaluate(({BrowserWindow},{origin,width})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin));w.setContentSize(width,820);},{origin,width});
  await page.goto(origin+(kind==='task'?'/runs/'+run.id:'/communication/'+chat.id));await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  if(kind==='task')await page.locator('#console-mode').click();else await page.locator('[data-toggle-communication-console]').click();
  const stream=page.locator(kind==='task'?'#trace-stream':'[data-communication-stream]'),older=page.locator(kind==='task'?'[data-console-older]':'[data-communication-console-older]'),latest=page.locator(kind==='task'?'[data-console-latest]':'[data-communication-console-latest]');
  await stream.locator('[data-console-row="preview-00120"]').waitFor({timeout:10000});await page.waitForFunction(sel=>{const n=document.querySelector(sel);return n.scrollHeight-n.scrollTop-n.clientHeight<5;},kind==='task'?'#trace-stream':'[data-communication-stream]');
  if(process.env.BATON_CONSOLE_NOISE_ONLY==='1'){
   await verifyPiNoise(kind,stream,latest);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:join(root,`${kind}-${theme}-${width}.png`)});evidence.cases.push(`${kind}/${theme}/${width}: Pi live and saved status rows hidden; body and failure retained`);console.log('PASS '+evidence.cases.at(-1));
   if(kind==='chat')await page.locator('[data-close-chat-console]').click();continue;
  }
  await older.scrollIntoViewIfNeeded();await settle();const center=await older.evaluate(n=>{const container=n.closest('#trace-stream')||n.parentElement;return Math.abs(n.getBoundingClientRect().left+n.offsetWidth/2-container.getBoundingClientRect().left-container.clientWidth/2);});assert.ok(center<3,`older centered: ${kind} ${center}`);
  await latest.click();await settle();
  const preserved=await stream.locator('[data-console-row="preview-00120"]').elementHandle();
  const first=add()[0];await append(kind,[first]);await stream.locator(`[data-console-row="${first.id}"]`).waitFor();await settle();assert.ok(await gap(stream)<5,'tail follows live appended content');assert.equal(await stream.locator(`[data-console-row="${first.id}"]`).count(),1);assert.equal(await preserved.evaluate(n=>n.isConnected),true,'unchanged row DOM preserved');
  await stream.evaluate(n=>n.scrollTop=Math.max(0,n.scrollTop-350));await settle();
  const anchor=await stream.evaluateHandle(n=>[...n.querySelectorAll('[data-console-row]')].find(x=>x.getBoundingClientRect().bottom>n.getBoundingClientRect().top));const anchorTop=await anchor.evaluate(n=>n.getBoundingClientRect().top);
  const up=add()[0];await append(kind,[up]);await stream.locator(`[data-console-row="${up.id}"]`).waitFor();await settle();assert.ok(await gap(stream)>200,'new records do not steal historical reading');assert.ok(Math.abs(await anchor.evaluate(n=>n.getBoundingClientRect().top)-anchorTop)<3,'reading anchor stable');
  await latest.click();await settle();const slow=add()[0];slowId=slow.id;body.set(slow.id,'异步正文\n\n'+Array.from({length:70},(_,i)=>`第 ${i+1} 段：异步正文展开后继续跟随最新。`).join('\n\n'));await append(kind,[slow]);await stream.locator(`[data-console-row="${slow.id}"]`).waitFor();await page.waitForFunction(()=>Boolean(document.querySelector('[data-console-content][data-content-loading="1"]')));for(let spin=0;!releaseBody&&spin<500;spin++)await new Promise(r=>setTimeout(r,20));assert.ok(releaseBody,'delayed body was requested');releaseBody();releaseBody=null;await stream.locator(`[data-console-row="${slow.id}"] .console-markdown`).waitFor();await settle();assert.ok(await gap(stream)<5,'delayed large body follows bottom');slowId=null;
  await older.scrollIntoViewIfNeeded();await settle();
  const beforeOlder=await stream.locator('[data-console-row^="preview-"]').first().getAttribute('data-console-row');
  const oldRow=await stream.locator('[data-console-row^="preview-"]').first().elementHandle();
  failOlder=true;await older.click();
  const error=page.locator(kind==='task'?'.console-history-controls [role=alert]':'[data-communication-console-error]');
  await error.filter({hasText:'隔离网络故障'}).waitFor();
  assert.ok(await oldRow.evaluate(node=>node.isConnected));
  holdOlder=true;
  await page.locator(kind==='task'?'[data-console-retry]':'[data-communication-console-refresh]').click();
  for(let spin=0;!releasePage&&spin<500;spin++)await new Promise(r=>setTimeout(r,20));
  assert.ok(releasePage,'retry reads the earlier cursor');
  const noisyBurst=addNoise(kind,'during-older',255),concurrent=add()[0];
  await append(kind,[...noisyBurst,concurrent]);
  assert.equal(await stream.locator('.console-empty-state').count(),0);
  releasePage();releasePage=null;
  await page.waitForFunction(({selector,before})=>document.querySelector(selector)?.querySelector('[data-console-row^="preview-"]')?.dataset.consoleRow < before,{selector:kind==='task'?'#trace-stream':'[data-communication-stream]',before:beforeOlder});
  await stream.locator(`[data-console-row="${concurrent.id}"]`).waitFor();
  assert.equal(await stream.locator(`[data-console-row="${concurrent.id}"]`).count(),1);
  assert.ok(await oldRow.evaluate(node=>node.isConnected),'simultaneous output and history preserve existing row');
  await latest.click();await page.waitForFunction(sel=>{const n=document.querySelector(sel);return n.scrollHeight-n.scrollTop-n.clientHeight<5;},kind==='task'?'#trace-stream':'[data-communication-stream]');
  const burst=add(75);if(kind==='task')await page.evaluate(()=>window.__consoleSources.findLast(s=>s.readyState!==2).dispatchEvent(new Event('open')));await stream.locator(`[data-console-row="${burst.at(-1).id}"]`).waitFor({timeout:15000});for(const event of burst)assert.equal(await stream.locator(`[data-console-row="${event.id}"]`).count(),1,'burst catchup has no gaps');
  // Once an explicitly paged history window is full, keep that window stable
  // while receiving new records into the bounded tail; scrolling to its end resumes live.
  const more=add(105);if(kind==='task')await page.evaluate(()=>window.__consoleSources.findLast(s=>s.readyState!==2).dispatchEvent(new Event('open')));await stream.locator(`[data-console-row="${more.at(-1).id}"]`).waitFor({timeout:15000});
  await older.scrollIntoViewIfNeeded();const retained=await stream.locator('[data-console-row]').first().getAttribute('data-console-row');await older.click();await stream.locator(`[data-console-row="${retained}"]`).waitFor();await settle();
  const historyFirst=await stream.locator('[data-console-row]').first().getAttribute('data-console-row');const duringHistory=add()[0];await append(kind,[duringHistory]);await page.waitForTimeout(kind==='task'?5500:2600);assert.equal(await stream.locator(`[data-console-row="${historyFirst}"]`).count(),1,'live reconciliation preserves the explicitly paged window');
  await stream.evaluate(n=>n.scrollTop=n.scrollHeight);await stream.locator(`[data-console-row="${duringHistory.id}"]`).waitFor({timeout:15000});await settle();assert.ok(await gap(stream)<5,'scrolling to the end resumes the live tail without refresh');
  if(kind==='task'){
   await older.scrollIntoViewIfNeeded();await older.click();await settle();holdNext=true;await latest.click();for(let spin=0;!releasePage&&spin<500;spin++)await new Promise(r=>setTimeout(r,20));assert.ok(releasePage,'latest response is held');
   const concurrent=add()[0];await append(kind,[concurrent]);await page.waitForTimeout(200);assert.equal(await stream.locator(`[data-console-row="${concurrent.id}"]`).count(),0,'new SSE stays buffered until latest page resolves');releasePage();releasePage=null;await stream.locator(`[data-console-row="${concurrent.id}"]`).waitFor();await settle();assert.ok(await gap(stream)<5,'latest response merges its concurrent live tail');
  }
  await verifyPiNoise(kind,stream,latest);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(root,`${kind}-${theme}-${width}.png`)});evidence.cases.push(`${kind}/${theme}/${width}: sparse pages, failed/held older read with 255 notifications and concurrent output, stable DOM and scroll, delayed body, latest, 75-event gap recovery and history resumption`);console.log('PASS '+evidence.cases.at(-1));
  if(kind==='chat'){
   failNext=true;await page.locator('[data-communication-console-refresh]').click();await page.locator('[data-communication-console-error]').filter({hasText:'隔离网络故障'}).waitFor();assert.equal(await stream.locator(`[data-console-row="${duringHistory.id}"]`).count(),1,'failed refresh retains timeline');await latest.click();await page.locator('[data-communication-console-error]').filter({hasText:'隔离网络故障'}).waitFor({state:'hidden'});
   await page.locator('[data-close-chat-console]').click();await settle();const before=requests;await page.waitForTimeout(2400);assert.equal(requests,before,'closed console does not poll');
  }
 }
 // Differentiate an in-flight member read from a genuinely empty archive.
 events=[];
 for(const kind of ['task','chat']){
  await page.goto(origin+(kind==='task'?'/runs/'+run.id:'/communication/'+chat.id));
  const stream=page.locator(kind==='task'?'#trace-stream':'[data-communication-stream]');
  if(kind==='task'){
   await page.locator('#console-mode').click();
   await stream.locator('.prompt-snapshot').first().waitFor();
   holdNext=true;
   await page.locator(`[data-select-agent]:not([data-select-agent="${agent.id}"])`).first().click();
  }else{
   holdNext=true;await page.locator('[data-toggle-communication-console]').click();
  }
  for(let spin=0;!releasePage&&spin<500;spin++)await new Promise(r=>setTimeout(r,20));
  assert.ok(releasePage,'initial empty archive read is held');
  assert.equal(await stream.locator('.console-empty-state').count(),0,'pending reads never claim empty');
  releasePage();releasePage=null;
  await stream.locator('.console-empty-state').waitFor();
  assert.equal(await stream.locator('[data-console-row]').count(),0);
  evidence.cases.push(kind+' initial loading and confirmed empty archive');console.log('PASS '+evidence.cases.at(-1));
 }
 assert.deepEqual(evidence.rendererErrors,[]);
 evidence.status='passed';console.log(JSON.stringify(evidence));
 if(process.env.BATON_CONSOLE_PREVIEW==='1'){
  await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(origin)).setContentSize(1320,820),origin);await page.goto(origin+'/runs/'+run.id);await page.locator('#console-mode').click();await page.evaluate(()=>document.documentElement.dataset.theme='light');leaveOpen=true;console.log('PREVIEW_READY '+root);await writeFile(join(root,'preview.json'),JSON.stringify({root,data,runId:run.id,bundle}));
 }
}catch(error){evidence.status='failed';evidence.error=error.stack;if(page)await page.screenshot({path:join(root,'failed.png')}).catch(()=>{});throw error;}
finally{releaseBody?.();releasePage?.();await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));if(!leaveOpen)await app.close();}
