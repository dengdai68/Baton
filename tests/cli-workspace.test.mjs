import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {execute,run} from '../cli/main.mjs';
import {createClient} from '../cli/client.mjs';
const origin='http://127.0.0.1:51983',instanceId='11111111-2222-4333-8444-555555555555';
const input=value=>Readable.from([JSON.stringify(value)]);
async function fixture(t,handler) {
  const root=await mkdtemp(join(tmpdir(),'baton-cli-workspace-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const privateRoot=join(root,'private');await mkdir(privateRoot,{mode:0o700});
  const endpointFile=join(privateRoot,'endpoint.json'),sessionFile=join(privateRoot,'session.json');
  await writeFile(endpointFile,JSON.stringify({origin,instanceId}),{mode:0o600});
  await writeFile(sessionFile,JSON.stringify({origin,cookie:'baton_session='+'a'.repeat(64),expiresAt:null}),{mode:0o600});
  const calls=[],fetcher=async(url,init)=>{
    const path=new URL(url).pathname+new URL(url).search;
    if(path==='/api/health')return Response.json({service:'baton-control-plane',instanceId});
    assert.equal(init.headers.Cookie,'baton_session='+'a'.repeat(64));assert.equal(init.redirect,'error');
    calls.push({path,...init});return handler(path,init);
  };
  return {root,calls,fetcher,endpointFile,sessionFile,invoke:(args,value,options={})=>execute([...args,'--endpoint-file',endpointFile,'--session-file',sessionFile],{fetcher,stdin:input(value),...options})};
}

test('task lifecycle uses exactly the desktop routes, selected Run and authoritative errors',async t=>{
  const f=await fixture(t,(path,init)=>path==='/api/tasks/t'?Response.json({task:{id:'t',runs:[{id:'new'},{id:'old'}]}}):path.endsWith('/resume')?Response.json({error:'不能恢复'},{status:400}):path.endsWith('/archive')||path.endsWith('/unarchive')?Response.json({task:{id:'t',title:'任务',status:'done',archivedAt:null,managerSnapshot:{systemPrompt:'private'}}}):Response.json({run:{id:'old',taskId:'t',status:'paused',participants:[{systemPrompt:'private'}]}}));
  for(const operation of ['pause','retry-now','retry-orchestration','retry-failed-node']) {
    const result=await f.invoke(['tasks',operation,'t','--run','old',...(operation==='retry-failed-node'?['--file','-']:[])],{workflowNodeId:'n'});
    assert.equal(result.run.id,'old');assert.equal(JSON.stringify(result).includes('private'),false);
    assert.equal(f.calls.at(-1).path,`/api/runs/old/${operation}`);assert.equal(f.calls.at(-1).method,'POST');
  }
  await assert.rejects(f.invoke(['tasks','resume','t']),e=>e.code==='SERVER_REJECTED'&&e.status===400);
  for(const operation of ['archive','unarchive']){const result=await f.invoke(['tasks',operation,'t']);assert.equal(f.calls.at(-1).path,`/api/tasks/t/${operation}`);assert.equal(JSON.stringify(result).includes('private'),false);}
  const count=f.calls.length;await assert.rejects(f.invoke(['tasks','pause','t','--run','foreign']),e=>e.code==='NOT_FOUND');assert.equal(f.calls.length,count+1);
});

test('communications share create/update/history/read/retry/delete routes without leaking employee prompts',async t=>{
  const conversation={id:'c',name:'群聊',kind:'group',members:[{id:'a',name:'A',systemPrompt:'PRIVATE_PROMPT',roles:[{prompt:'PRIVATE_ROLE'}]}]};
  const f=await fixture(t,(path,init)=>path.includes('before=')?Response.json({conversation,messages:[{id:'older'}],deliveries:[],hasMore:false,nextBefore:'older'}):path.split('?')[0]==='/api/communications/c'?Response.json(init.method==='GET'?{conversation,messages:[{id:'latest'}],deliveries:[],hasMore:true,nextBefore:'latest'}:{conversation}):Response.json({conversation}));
  assert.equal((await f.invoke(['communications','create','--file','-'],{kind:'group',memberAgentIds:['a']})).conversation.id,'c');
  await f.invoke(['communications','update','c','--file','-'],{name:'改名',memberAgentIds:[]});assert.equal(f.calls.at(-1).method,'PUT');
  const history=await f.invoke(['communications','get','c','--all']);assert.deepEqual(history.messages.map(m=>m.id),['older','latest']);assert.doesNotMatch(JSON.stringify(history),/PRIVATE/);
  await f.invoke(['communications','read','c','--file','-'],{messageId:'latest'});assert.equal(f.calls.at(-1).path,'/api/communications/c/read');
  await f.invoke(['communications','retry','c','--file','-'],{deliveryId:'d'});assert.equal(f.calls.at(-1).path,'/api/communications/c/deliveries/d/retry');
  const count=f.calls.length;await assert.rejects(f.invoke(['communications','delete','c']),e=>e.code==='USAGE');assert.equal(f.calls.length,count);
  await f.invoke(['communications','delete','c','--yes']);assert.equal(f.calls.at(-1).method,'DELETE');
});

test('chat attachment retry traverses history, reuses IDs and sends the same request key',async t=>{
  const body=Buffer.from('附件内容'),sha256=createHash('sha256').update(body).digest('hex');let saved;
  const f=await fixture(t,async(path,init)=>{
    if(path==='/api/communications/c')return Response.json({messages:saved?[]:[],hasMore:Boolean(saved),nextBefore:'cursor'});
    if(path.includes('before='))return Response.json({messages:[saved],hasMore:false});
    if(path.includes('/attachments?')){assert.equal(await new Response(init.body).text(),body.toString());return Response.json({attachment:{id:'attachment_a'}});}
    if(path.endsWith('/messages')){const value=JSON.parse(init.body);saved={...value,id:'m',attachments:[{id:'attachment_a',name:'input.txt',bytes:body.length,sha256}]};return Response.json({message:saved});}
    throw Error(path);
  });
  const path=join(f.root,'input.txt');await writeFile(path,body);
  const value={content:'',attachmentPaths:[path]};
  const args=['communications','message','c','--file','-','--client-request-id','request_001'];
  assert.equal((await f.invoke(args,value)).message.id,'m');assert.equal((await f.invoke(args,value)).message.id,'m');assert.equal(f.calls.filter(row=>row.path.includes('/attachments?')).length,1);
  await writeFile(path,'改动');await assert.rejects(f.invoke(args,value),e=>e.code==='CLIENT_REQUEST_CONFLICT');
});

test('binary downloads are authenticated, exact, exclusive and remove interrupted output',async t=>{
  const bytes=Buffer.from([0,255,1,9]);let fail=false,rejected=false;
  const f=await fixture(t,()=>rejected?Response.json({error:'拒绝读取'},{status:400}):fail?new Response(new ReadableStream({start(controller){controller.enqueue(bytes);controller.error(Error('disconnected'));}})):new Response(bytes));
  const client=createClient(f),path=join(f.root,'result.bin');assert.equal((await client.download('/api/runs/r/working-directory/content?download=1',path)).bytes,4);assert.deepEqual(await readFile(path),bytes);
  await assert.rejects(client.download('/api/file',path),e=>e.code==='OUTPUT_FILE');assert.deepEqual(await readFile(path),bytes);
  fail=true;const partial=join(f.root,'partial');await assert.rejects(client.download('/api/file',partial),e=>e.code==='CONNECTION_UNCERTAIN');await assert.rejects(access(partial));
  fail=false;rejected=true;await assert.rejects(client.download('/api/file',partial),e=>e.code==='SERVER_REJECTED');await assert.rejects(access(partial));
});

test('console follow recovers bursts across pages exactly once and JSON uses line envelopes',async t=>{
  const controller=new AbortController();let generation=0;
  const f=await fixture(t,path=>{
    if(path==='/api/tasks/t')return Response.json({task:{runs:[{id:'r'}]}});
    const before=new URL(origin+path).searchParams.get('before');
    if(before)return Response.json({events:[{id:'old'},{id:'new1'}],hasMore:false,traces:[]});
    generation++;return Response.json(generation===1?{events:[{id:'old'}],hasMore:false,traces:[]}:{events:[{id:'new2'},{id:'new3'}],hasMore:true,nextBefore:'new2',traces:[]});
  });
  const iterator=await f.invoke(['tasks','console','t','--agent','a','--follow'],undefined,{signal:controller.signal,pollMs:1});
  assert.deepEqual((await iterator.next()).value.events.map(e=>e.id),['old']);assert.deepEqual((await iterator.next()).value.events.map(e=>e.id),['new1','new2','new3']);controller.abort();assert.equal((await iterator.next()).done,true);
  generation=0;const stop=new AbortController(),lines=[];
  const code=await run(['tasks','console','t','--agent','a','--follow','--json','--endpoint-file',f.endpointFile,'--session-file',f.sessionFile],{fetcher:f.fetcher,pollMs:1,signal:stop.signal,write:line=>{lines.push(JSON.parse(line));if(lines.length===2)stop.abort();}});
  assert.equal(code,0);assert.equal(lines.length,2);assert.equal(lines[1].ok,true);
});

test('new help and invalid flags stay offline, including required IDs in market usage',async()=>{
  const offline=()=>assert.fail('must stay offline');
  for(const args of [['tasks','console','t'],['tasks','download','t','--path','x'],['communications','retry','c','--file','-'],['tasks','console','t','--agent','a','--follow','--before','e']])await assert.rejects(execute(args,{fetcher:offline,stdin:input({deliveryId:'../x'})}));
  for(const group of ['mcps','plugins']) {
    const lines=[];assert.equal(await run([group,'check-compatibility','--help'],{fetcher:offline,write:line=>lines.push(line)}),0);assert.match(lines.join(''),new RegExp(`baton ${group} check-compatibility ID`));
  }
});
