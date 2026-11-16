// Real isolated Electron, HTTP and CLI. REAL=1 adds a real model task and chat.
import assert from 'node:assert/strict';
import {_electron as electron} from 'playwright-core';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createStore} from '../server/store.mjs';
import {createAuth} from '../server/auth.mjs';
import {writeStorageLocation} from '../server/storage-layout.mjs';
import {testEnvironment} from './run-tests.mjs';
const real=process.env.BATON_PARITY_REAL==='1',bundle=process.env.BATON_PARITY_APP;
const root=await mkdtemp(join(tmpdir(),'baton-app-cli-parity-')),home=join(root,'home'),data=bundle?join(home,'.baton'):join(home,'.baton','desktop-dev'),work=join(root,'work');
await mkdir(home,{recursive:true,mode:0o700});
const password=randomBytes(24).toString('hex'),auth=createAuth({databasePath:join(data,'auth.sqlite')});await auth.setAdministrator('parity-qa',password);auth.close();
const seed=createStore({databasePath:join(work,'records/baton.sqlite'),workspaceRoot:work,configurationDirectory:data});
const agent=seed.createAgent({name:'对齐验证员',runtime:{profileId:'runtime_codex'},systemPrompt:'作为本次任务经理，自行使用工具完成简单文件操作，读取核对，然后提交人类验收。不要派工或咨询。沟通时简洁回复。'});
const task=seed.createTask({title:'文件与控制台读取',objective:'隔离测试资料',managerAgentId:agent.id,memberAgentIds:[agent.id]});const run=seed.createRun(task.id);seed.pauseRun(run.id);seed.close();
await mkdir(run.workspacePath,{recursive:true});await writeFile(join(run.workspacePath,'readme.txt'),'CLI 与桌面同一文件\n');
await writeStorageLocation(data,{version:1,workspaceRoot:work,previousRuntimeRoots:[]});
const env={...testEnvironment(process.env),HOME:home,BATON_DESKTOP_DATA_ROOT:data,BATON_LOG_DIR:join(root,'logs'),CODEX_HOME:process.env.CODEX_HOME || join(homedir(),'.codex'),CLAUDE_CONFIG_DIR:process.env.CLAUDE_CONFIG_DIR || join(homedir(),'.claude')};
const app=await electron.launch({...(bundle?{executablePath:resolve(bundle,'Contents/MacOS/Baton')}:{}),args:[...(bundle?[]:[resolve('apps/electron/main.mjs')]),'--user-data-dir='+join(root,'browser')],env,timeout:120000});
const evidence={root,real,bundle:bundle || 'source',cases:[]},errors=[];console.log('EVIDENCE '+root);
try {
  const page=await app.firstWindow({timeout:120000});page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.waitForURL(/^http:\/\/127\.0\.0\.1:/,{timeout:90000});const origin=new URL(page.url()).origin;
  await page.locator('#username').waitFor();await page.locator('#username').fill('parity-qa');await page.locator('#password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#account-name').waitFor();
  const flags=['--endpoint-file',join(data,'desktop-endpoint.json')];
  async function cli(args,value) {
    const extra=[];if(value!==undefined){const path=join(root,'input-'+randomBytes(6).toString('hex')+'.json');await writeFile(path,JSON.stringify(value),{mode:0o600});extra.push('--file',path);}
    const result=await promisify(execFile)(bundle?join(resolve(bundle),'Contents/Resources/cli/baton'):process.execPath,[...(bundle?[]:[resolve('cli/main.mjs')]),...args,...extra,...flags,'--json'],{env,timeout:120000});return JSON.parse(result.stdout).data;
  }
  const api=path=>page.evaluate(async path=>{const r=await fetch(path);return {status:r.status,data:await r.json()};},path);
  const flow=(await cli(['workflows','create'],{name:'对齐工作流',nodes:[{id:'a',title:'执行',staffingGuidance:'原人员需求',deliverable:'原交付要求',artifactPaths:['reports/']},{id:'b',title:'交付'}],edges:[{id:'ab',source:'a',target:'b'}]})).workflowTemplate;
  const team=(await cli(['teams','create'],{name:'对齐团队',memberAgentIds:[agent.id]})).team;assert.equal((await api('/api/teams/'+team.id)).data.team.name,'对齐团队');
  await page.goto(origin+'/workflows');await page.getByRole('button',{name:'编辑工作流：对齐工作流',exact:true}).click();await page.locator('.workflow-canvas-editor[data-ready=true]').waitFor();
  const node=page.locator('[data-cell-id=a]');await node.focus();await node.press('Enter');await page.locator('.workflow-advanced-fields summary').click();
  assert.equal(await page.getByLabel('人员需求',{exact:true}).inputValue(),'原人员需求');await page.getByLabel('人员需求',{exact:true}).fill('修改后的人员需求');await page.getByLabel('交付要求',{exact:true}).fill('修改后的交付要求');await page.getByLabel('建议交付路径（每行一条）',{exact:true}).fill('reports/\nmedia/');
  const edge=page.locator('[data-cell-id="edge:ab"]');await edge.focus();await edge.press('Enter');await page.locator('.workflow-advanced-fields summary').click();await page.getByLabel('前置依赖',{exact:true}).check();await page.getByLabel('读取交接上下文',{exact:true}).uncheck();
  await page.getByRole('button',{name:'保存工作流',exact:true}).click();await page.locator('#workflow-form').waitFor({state:'detached'});
  const saved=await cli(['workflows','get',flow.id]);assert.equal(saved.nodes[0].staffingGuidance,'修改后的人员需求');assert.equal(saved.nodes[0].deliverable,'修改后的交付要求');assert.deepEqual(saved.nodes[0].artifactPaths,['reports/','media/']);assert.equal(saved.edges[0].dependency,true);assert.equal(saved.edges[0].handoff,false);console.log('CHECKPOINT '+evidence.cases.length);evidence.cases.push('CLI create → desktop advanced workflow edits → CLI exact round-trip');
  for(const width of [1440,760]) {
    await app.evaluate(({BrowserWindow},width)=>{BrowserWindow.getAllWindows().find(win=>/^http:/.test(win.webContents.getURL())).setContentSize(width,900);},width);
    await page.goto(origin+'/workflows');await page.getByRole('button',{name:'编辑工作流：对齐工作流',exact:true}).click();await page.locator('.workflow-canvas-editor[data-ready=true]').waitFor();await page.locator('[data-cell-id=a]').focus();await page.locator('[data-cell-id=a]').press('Enter');await page.locator('.workflow-advanced-fields summary').click();await page.getByLabel('建议交付路径（每行一条）',{exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.getByLabel('建议交付路径（每行一条）',{exact:true}).inputValue(),'reports/\nmedia/');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(root,`workflow-${width}.png`)});await page.getByRole('button',{name:'放弃',exact:true}).click();
  }
  const serverPath=join(root,'mcp.mjs'),tools=Array.from({length:25},(_,i)=>({name:'lookup_'+i,description:'查询工具',inputSchema:{type:'object',properties:{query:{type:'string'}}}}));
  const moduleUrl=path=>JSON.stringify(pathToFileURL(resolve('node_modules/@modelcontextprotocol/sdk/dist/esm',path)).href);
  await writeFile(serverPath,`import {Server} from ${moduleUrl('server/index.js')};import {StdioServerTransport} from ${moduleUrl('server/stdio.js')};import {ListToolsRequestSchema} from ${moduleUrl('types.js')};const s=new Server({name:'parity',version:'1.0.0'},{capabilities:{tools:{}}});s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:${JSON.stringify(tools)}}));await s.connect(new StdioServerTransport());`);
  const mcp=await cli(['mcps','create'],{name:'对齐工具服务',content:JSON.stringify({mcpServers:{parity:{command:process.execPath,args:[serverPath]}}})});
  await page.goto(origin+'/mcp-marketplace');await page.getByRole('button',{name:'对齐工具服务',exact:true}).click();await page.locator('[data-tool-search]').waitFor();assert.equal(await page.locator('.mcp-tool').count(),20);await page.locator('[data-tool-next]').click();assert.equal(await page.locator('.mcp-tool').count(),5);await page.locator('[data-tool-search]').fill('lookup_24');assert.equal(await page.locator('.mcp-tool').count(),1);await page.getByText('参数与返回值',{exact:true}).click();assert.match(await page.locator('.mcp-tool pre').textContent(),/inputSchema/);
  const installed=(await cli(['mcps','list'])).items.find(item=>item.name==='对齐工具服务');assert.equal((await cli(['mcps','tools',installed.id,'--search','lookup_24'])).tools[0].name,'lookup_24');console.log('CHECKPOINT '+evidence.cases.length);evidence.cases.push('25 real stdio MCP tools; desktop/CLI search, paging and schema');
  for(const [width,height] of [[1440,900],[760,820]]) {
    await app.evaluate(({BrowserWindow},{width,height})=>{const win=BrowserWindow.getAllWindows().find(win=>/^http:/.test(win.webContents.getURL()));win.setContentSize(width,height);},{width,height});
    await page.screenshot({path:join(root,`mcp-${width}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  const chat=(await cli(['communications','create'],{kind:'group',name:'对齐群聊',memberAgentIds:[agent.id]})).conversation;
  await cli(['communications','update',chat.id],{name:'已从 CLI 编辑'});assert.equal((await api('/api/communications/'+chat.id)).data.conversation.name,'已从 CLI 编辑');
  await page.goto(origin+'/communication');await page.locator(`[data-chat-id="${chat.id}"]`).waitFor({state:'attached'});
  await cli(['communications','delete',chat.id,'--yes']);assert.equal((await api('/api/communications/'+chat.id)).status,400);console.log('CHECKPOINT '+evidence.cases.length);evidence.cases.push('CLI group create/edit/delete reflected in real desktop; history retained');
  const files=await cli(['tasks','files',task.id]);assert.ok(JSON.stringify(files).includes('readme.txt'));
  assert.match(JSON.stringify(await cli(['tasks','file',task.id,'--path','readme.txt'])),/同一文件/);const output=join(root,'download.txt');await cli(['tasks','download',task.id,'--path','readme.txt','--output',output]);assert.equal(await readFile(output,'utf8'),'CLI 与桌面同一文件\n');
  await assert.rejects(cli(['tasks','file',task.id,'--path','../records/baton.sqlite']));console.log('CHECKPOINT '+evidence.cases.length);evidence.cases.push('real HTTP file listing/read/download and traversal rejection');
  if(real) {
    const token='PARITY_'+randomBytes(8).toString('hex');
    const started=await cli(['tasks','create','--start'],{title:'CLI 对齐真实任务',objective:`在当前工作目录创建 result.txt，内容必须恰好为 ${token}。使用工具读取确认后提交人类验收。经理自行完成，不派工、不咨询。`,managerAgentId:agent.id,memberAgentIds:[agent.id],acceptanceCriteria:['文件内容与目标一致']});
    evidence.taskId=started.task.id;evidence.runId=started.run.id;
    await cli(['tasks','pause',started.task.id]);await cli(['tasks','resume',started.task.id]);
    const deadline=Date.now()+420000;let final;
    while(Date.now()<deadline){const progress=await cli(['tasks','progress',started.task.id]);if(progress.runStatus==='failed')throw Error('real model task failed: '+JSON.stringify(progress.failure));if(progress.runStatus==='awaiting_acceptance'){final=progress;break;}await new Promise(resolve=>setTimeout(resolve,1000));}
    assert.ok(final,'real task timed out');assert.match(JSON.stringify(await cli(['tasks','file',started.task.id,'--path','result.txt'])),new RegExp(token));
    const consolePage=await cli(['tasks','console',started.task.id,'--agent',final.participants[0].id]);assert.ok(consolePage.events.length);
    const contentEvent=consolePage.events.find(row=>row.data?.contentRef);if(contentEvent)assert.ok(await cli(['tasks','console-content',started.task.id,'--event',contentEvent.id]));
    await page.goto(origin+'/runs/'+started.run.id);await page.locator('[data-open-completion-confirm]').click();await page.locator('#ack-completion').check();await page.locator('#confirm-completion').click();
    await page.waitForFunction(async id=>(await (await fetch('/api/tasks/'+id)).json()).task.status==='done',started.task.id);
    await cli(['tasks','archive',started.task.id]);assert.ok((await cli(['tasks','list','--archived'])).items.some(item=>item.id===started.task.id));await cli(['tasks','unarchive',started.task.id]);console.log('CHECKPOINT '+evidence.cases.length);evidence.cases.push('real Codex task create/pause/resume → verified file/console → desktop acceptance → CLI archive/unarchive');
    const direct=(await cli(['communications','create'],{kind:'agent',targetId:agent.id})).conversation;
    const message=await cli(['communications','message',direct.id],{content:'请只回复：对齐验证通过',clientRequestId:'parity_chat_001'});assert.equal((await cli(['communications','message',direct.id],{content:'请只回复：对齐验证通过',clientRequestId:'parity_chat_001'})).message.id,message.message.id);
    let response;const chatDeadline=Date.now()+180000;while(Date.now()<chatDeadline){const read=await cli(['communications','get',direct.id]);if(read.deliveries.some(row=>row.status==='failed'))throw Error('real chat failed');response=read.messages.find(row=>row.sender.type==='agent');if(response)break;await new Promise(resolve=>setTimeout(resolve,1000));}
    assert.ok(response);await cli(['communications','read',direct.id],{messageId:response.id});assert.equal((await cli(['communications','get',direct.id])).conversation.unreadCount,0);console.log('CHECKPOINT '+evidence.cases.length);evidence.cases.push('real private chat reply, keyed replay and explicit read acknowledgement');
  }
  assert.deepEqual(errors,[]);evidence.status='passed';if(process.env.BATON_PARITY_KEEP_OPEN==='1'){await page.goto(origin+'/workflows');await page.getByRole('button',{name:'编辑工作流：对齐工作流',exact:true}).click();await page.locator('.workflow-canvas-editor[data-ready=true]').waitFor();await page.locator('[data-cell-id=a]').focus();await page.locator('[data-cell-id=a]').press('Enter');await page.locator('.workflow-advanced-fields summary').click();}console.log(JSON.stringify(evidence));
} catch(error){evidence.status='failed';evidence.error=error.message;throw error;}
finally {await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));if(process.env.BATON_PARITY_KEEP_OPEN!=='1'||evidence.status!=='passed')await app.close();}
