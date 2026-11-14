import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createStore} from '../server/store.mjs';
import {createMarketplace} from '../server/runtime/marketplace.mjs';
import {remotePluginRevision} from '../server/runtime/configuration.mjs';
import {createPluginUpdates,pluginUpdateSources} from '../server/plugin-updates.mjs';

const pause=ms=>new Promise(done=>setTimeout(done,ms));

test('plugin updates have no automatic lifecycle or persisted preferences',async t=>{
  const root=await mkdtemp(join(tmpdir(),'af-manual-updates-')),store=createStore({databasePath:join(root,'state.sqlite')});
  t.after(()=>{store.close();return rm(root,{recursive:true,force:true});});
  let probes=0;store.registerExtensions([{id:randomUUID(),kind:'plugin',name:'Manual',providers:[],createdAt:new Date().toISOString(),source:{url:'https://manual.invalid/repo.git',revision:'same'}}]);
  const updater=createPluginUpdates({getStore:()=>store,marketplace:{},probe:async()=>{probes++;return 'same';},intervalMs:10});t.after(()=>updater.stop());
  assert.equal(updater.start,undefined);assert.equal(updater.configure,undefined);
  await pause(30);assert.equal(probes,0,'opening or reading status never starts Git work');assert.deepEqual(updater.status(),{running:false,lastCheckedAt:null,lastResult:null});
  assert.equal((await updater.check()).updatedPlugins,0);assert.equal(probes,1);
  await pause(30);assert.equal(probes,1,'completion does not schedule another check');
  assert.equal(store.getPluginUpdateSettings,undefined);assert.equal(store.setPluginUpdateSettings,undefined);
  assert.equal('pluginAutoUpdate' in store.snapshot().settings,false);assert.equal('pluginUpdateIntervalMinutes' in store.snapshot().settings,false);
});

import {gitOrigin} from './plugin-git-fixture.mjs';

test('manual Git update replaces selected plugins, retains frozen files and skips deleted plugins/MCPs',async t=>{
  const origin=await gitOrigin(t);
  await mkdir(join(origin.source,'.claude-plugin'));await mkdir(join(origin.source,'alpha/.claude-plugin'),{recursive:true});await mkdir(join(origin.source,'alpha/skills/check'),{recursive:true});await mkdir(join(origin.source,'beta/.claude-plugin'),{recursive:true});
  await writeFile(join(origin.source,'.claude-plugin/marketplace.json'),JSON.stringify({name:'fixture',plugins:[{name:'alpha',source:'./alpha'},{name:'beta',source:'./beta'}]}));
  await writeFile(join(origin.source,'alpha/.claude-plugin/plugin.json'),JSON.stringify({name:'alpha',version:'1.0.0',mcpServers:{probe:{command:'node',args:['--version']}}}));
  await writeFile(join(origin.source,'beta/.claude-plugin/plugin.json'),' {"name":"beta"}');
  await writeFile(join(origin.source,'alpha/skills/check/SKILL.md'),'---\nname: check\ndescription: test\n---\nBEFORE');
  const initialRevision=await origin.commit();await origin.git('-C',join(origin.root,'repos/repo.git'),'symbolic-ref','HEAD','refs/heads/main');
  await origin.git('-C',origin.source,'branch','stable');await origin.git('-C',origin.source,'tag','-a','v1','-m','fixture',initialRevision);await origin.git('-C',origin.source,'push','origin','stable','v1');
  const market=createMarketplace(join(origin.root,'runtime')),store=createStore({databasePath:join(origin.root,'state.sqlite')});t.after(()=>store.close());
  const installed=await market.import({url:origin.url}),old=installed.plugins.find(p=>p.name==='alpha'),beta=installed.plugins.find(p=>p.name==='beta');
  store.registerExtensions([...installed.plugins,...installed.mcps]);
  store.removeExtension({kind:'plugin',id:beta.id,name:beta.name});
  const frozen=await market.resolve({pluginIds:[old.id],mcpIds:installed.mcps.map(m=>m.id)},'codex');
  const employee=store.createAgent({name:'原生更新验证',runtime:{provider:'codex',...frozen}});
  const role=store.createRole({name:'更新继承角色',prompt:'ROLE',...await market.resolveRole({pluginIds:[old.id],mcpIds:[]})});
  const inheritedEmployee=store.createAgent({name:'仅角色继承',roleIds:[role.id],runtime:{provider:'codex'}});

  const updater=createPluginUpdates({getStore:()=>store,marketplace:market});t.after(()=>updater.stop());
  await writeFile(join(origin.source,'alpha/skills/check/SKILL.md'),'---\nname: check\ndescription: test\n---\nAFTER');
  const revision=await origin.commit();assert.equal(await remotePluginRevision({url:origin.url}),revision);
  assert.equal(await remotePluginRevision({url:origin.url,ref:'stable'}),initialRevision);assert.equal(await remotePluginRevision({url:origin.url,ref:'v1'}),initialRevision);assert.equal(await remotePluginRevision({url:origin.url,sha:initialRevision}),initialRevision);
  const result=await updater.check();assert.equal(result.updatedPlugins,1);assert.deepEqual(result.errors,[]);
  const updated=store.listAgents().find(a=>a.id===employee.id).runtime;
  assert.deepEqual(store.getRole(role.id).extensionSelection.pluginIds,updated.extensionSelection.pluginIds);assert.deepEqual(store.listAgents().find(item=>item.id===inheritedEmployee.id).inheritedExtensionSelection.pluginIds,updated.extensionSelection.pluginIds);
  assert.notEqual(updated.extensionSelection.pluginIds[0],old.id);assert.deepEqual(updated.extensionSelection.mcpIds,frozen.extensionSelection.mcpIds);
  assert.match(await readFile(updated.skillPaths[0],'utf8'),/AFTER/);assert.match(await readFile(frozen.skillPaths[0],'utf8'),/BEFORE/);
  assert.equal((await market.mcpCatalog()).entries.length,installed.mcps.length);
  assert.equal((await readdir(join(origin.root,'runtime/plugins'))).length,1,'manual update source checkouts are disposable; initial manual source remains');
  assert.deepEqual((await market.catalog()).plugins.filter(p=>!store.isExtensionRemoved('plugin',p.id)).map(p=>p.name),['alpha']);
  assert.equal((await updater.check()).updatedPlugins,0);
  // Same manifest version, incompatible new Hook: no partial employee update.
  await writeFile(join(origin.source,'alpha/.claude-plugin/plugin.json'),JSON.stringify({name:'alpha',version:'1.0.0',hooks:{CwdChanged:[{hooks:[{type:'command',command:'true'}]}]}}));await origin.commit();
  assert.equal((await updater.check()).errors.length,1);assert.deepEqual(store.listAgents().find(a=>a.id===employee.id).runtime,updated);
  await writeFile(join(origin.source,'alpha/.claude-plugin/plugin.json'),' {"name":"alpha","version":"1.0.1"}');await origin.commit();assert.equal((await updater.check()).updatedPlugins,1);
});

test('manual checks never overlap and stopping aborts in-flight network work',async t=>{
  const root=await mkdtemp(join(tmpdir(),'af-update-state-')),databasePath=join(root,'state.sqlite');t.after(()=>rm(root,{recursive:true,force:true}));let store=createStore({databasePath});
  const marketplace={catalog:async()=>({plugins:[{id:'installed',name:'probe',source:{url:'https://example.invalid/repo.git',revision:'a'}}]})};
  store.registerExtensions((await marketplace.catalog()).plugins.map(item=>({...item,id:randomUUID(),kind:'plugin',providers:[],createdAt:new Date().toISOString()})));
  let calls=0;const updater=createPluginUpdates({getStore:()=>store,marketplace,probe:async(_,{signal})=>{calls++;await new Promise(done=>signal.addEventListener('abort',done,{once:true}));throw new Error('cancelled')}});
  const first=updater.check();assert.equal(first,updater.check());await pause(10);assert.equal(calls,1);updater.stop();await first;assert.equal(updater.status().running,false);assert.throws(()=>updater.check(),/关闭|重启/);
  store.close();store=createStore({databasePath});assert.equal('pluginAutoUpdate' in store.snapshot().settings,false);store.close();
});

test('origin tracking groups shared markets and preserves pinned dependency refs',()=>{
  const groups=pluginUpdateSources([{name:'a',source:{url:'https://git.invalid/child.git',ref:'stable',sha:'f'.repeat(40),revision:'f'.repeat(40),origin:{url:'https://git.invalid/market.git',revision:'root'}}},{name:'b',source:{url:'https://git.invalid/market.git',revision:'root'}},{name:'local',source:{url:'file:///tmp/example',revision:'local'}}]);
  assert.equal(groups.length,1);assert.equal(groups[0].plugins.length,2);assert.equal(groups[0].specs.length,2);assert.equal(groups[0].specs.find(s=>s.ref==='stable').sha,'f'.repeat(40));
});
test('a network failure in one origin does not block the remaining origins',async t=>{
  const root=await mkdtemp(join(tmpdir(),'af-update-error-')),store=createStore({databasePath:join(root,'state.sqlite')});t.after(()=>{store.close();return rm(root,{recursive:true,force:true})});
  let calls=0;
  const marketplace={catalog:async()=>({plugins:['broken','healthy'].map(name=>({id:name,name,source:{url:`https://${name}.invalid/repo.git`,revision:'current'}}))})};
  store.registerExtensions((await marketplace.catalog()).plugins.map(item=>({...item,id:randomUUID(),kind:'plugin',providers:[],createdAt:new Date().toISOString()})));
  const updater=createPluginUpdates({getStore:()=>store,marketplace,probe:async spec=>{calls++;if(spec.url.includes('broken'))throw Error('fixture network failure');return 'current'}});t.after(()=>updater.stop());
  const result=await updater.check();assert.equal(calls,2);assert.equal(result.checkedSources,2);assert.equal(result.errors.length,1);assert.equal(result.updatedPlugins,0);
});
test('a shared failing dependency is probed only once per cycle across origins',async t=>{
  const root=await mkdtemp(join(tmpdir(),'af-shared-source-')),store=createStore({databasePath:join(root,'state.sqlite')});t.after(()=>{store.close();return rm(root,{recursive:true,force:true})});
  const counts=new Map(),marketplace={catalog:async()=>({plugins:['a','b'].map(name=>({id:name,name,source:{url:'https://shared.invalid/plugin.git',revision:'old',origin:{url:`https://${name}.invalid/market.git`,revision:'current'}}}))})};
  store.registerExtensions((await marketplace.catalog()).plugins.map(item=>({...item,id:randomUUID(),kind:'plugin',providers:[],createdAt:new Date().toISOString()})));
  const updater=createPluginUpdates({getStore:()=>store,marketplace,probe:async spec=>{counts.set(spec.url,(counts.get(spec.url)||0)+1);if(spec.url.includes('shared'))throw Error('offline');return 'current'}});t.after(()=>updater.stop());
  assert.equal((await updater.check()).errors.length,2);assert.equal(counts.get('https://shared.invalid/plugin.git'),1);
});

test('bare Skill Git updates replace current employee and role bindings while preserving frozen Skill bytes',async t=>{
  const origin=await gitOrigin(t),skill=join(origin.source,'skills/bare-update');await mkdir(join(skill,'references'),{recursive:true});
  const content=description=>`---\nname: bare-update\ndescription: ${description}\n---\nRead references/facts.txt.`;
  await writeFile(join(skill,'SKILL.md'),content('before'));await writeFile(join(skill,'references/facts.txt'),'BEFORE');const first=await origin.commit();await origin.git('-C',join(origin.root,'repos/repo.git'),'symbolic-ref','HEAD','refs/heads/main');
  const market=createMarketplace(join(origin.root,'runtime')),store=createStore({databasePath:join(origin.root,'state.sqlite')});t.after(()=>store.close());
  const old=(await market.import({url:origin.url})).plugins[0];store.registerExtensions([old]);assert.equal(old.source.revision,first);
  const frozen=await market.resolve({pluginIds:[old.id],mcpIds:[]},'claude-code');const employee=store.createAgent({name:'bare employee',runtime:{provider:'claude-code',...frozen}});
  const role=store.createRole({name:'bare role',prompt:'Use skill',...await market.resolveRole({pluginIds:[old.id],mcpIds:[]})});const inherited=store.createAgent({name:'inherited',roleIds:[role.id],runtime:{provider:'claude-code'}});
  const updater=createPluginUpdates({getStore:()=>store,marketplace:market});t.after(()=>updater.stop());
  await writeFile(join(skill,'SKILL.md'),content('after'));await writeFile(join(skill,'references/facts.txt'),'AFTER');const revision=await origin.commit();
  const result=await updater.check();assert.equal(result.updatedPlugins,1);assert.deepEqual(result.errors,[]);
  const current=store.listExtensions('plugin');assert.equal(current.length,1);assert.equal(current[0].description,'after');assert.equal(current[0].source.revision,revision);assert.notEqual(current[0].id,old.id);
  assert.deepEqual(store.getRole(role.id).extensionSelection.pluginIds,[current[0].id]);assert.deepEqual(store.listAgents().find(a=>a.id===inherited.id).inheritedExtensionSelection.pluginIds,[current[0].id]);
  const runtime=store.listAgents().find(a=>a.id===employee.id).runtime;assert.deepEqual(runtime.extensionSelection.pluginIds,[current[0].id]);assert.match(await readFile(runtime.skillPaths[0],'utf8'),/description: after/);assert.equal(await readFile(resolve(runtime.skillPaths[0],'../references/facts.txt'),'utf8'),'AFTER');assert.match(await readFile(frozen.skillPaths[0],'utf8'),/description: before/);assert.equal(await readFile(resolve(frozen.skillPaths[0],'../references/facts.txt'),'utf8'),'BEFORE');
  assert.equal((await updater.check()).updatedPlugins,0);
  await writeFile(join(skill,'SKILL.md'),'---\nname: renamed\ndescription: renamed\n---\nnew');await origin.commit();const rejected=await updater.check();assert.equal(rejected.updatedPlugins,0);assert.equal(rejected.errors.length,1);assert.deepEqual(store.listExtensions('plugin').map(p=>p.id),[current[0].id]);
});

// The real button controller is tested under delayed acknowledgements; a 202 is
// an in-flight command rather than a completed update receipt.
import {createPluginUpdateAction} from '../web/marketplace.mjs';
const updateButton=()=>({disabled:false,textContent:'',setAttribute(key,value){this[key]=value;}});
const until=async predicate=>{const deadline=Date.now()+2000;while(!predicate()){if(Date.now()>deadline)throw Error('manual update condition timed out');await pause(5);}};
test('manual update button waits for completion, coalesces clicks and stops polling at the receipt',async t=>{
  const button=updateButton(),calls=[],notices=[];let value={running:false,lastCheckedAt:null,lastResult:null},refreshes=0,release;
  const gate=new Promise(resolve=>release=resolve);
  const action=createPluginUpdateAction(button,{pollMs:10,notify:(...args)=>notices.push(args),onUpdated:()=>{refreshes++;},api:async(_path,options)=>{calls.push(options?.method || 'GET');if(options?.method==='POST'){await gate;value={...value,running:true};}return value;}});t.after(()=>action.dispose());
  await action.refresh();assert.equal(button.textContent,'更新全部');assert.deepEqual(calls,['GET']);
  const first=button.onclick();void button.onclick();assert.equal(button.disabled,true);assert.equal(button.textContent,'更新中…');release();await first;
  assert.deepEqual(calls,['GET','POST']);assert.equal(button.disabled,true);assert.deepEqual(notices,[],'202 running must not announce zero updated plugins');
  value={running:false,lastCheckedAt:new Date().toISOString(),lastResult:{updatedPlugins:2,errors:[]}};await until(()=>refreshes===1);
  assert.equal(button.disabled,false);assert.equal(button.textContent,'更新全部');assert.deepEqual(notices,[['已更新 2 个插件。',false]]);
  const count=calls.length;await pause(30);assert.equal(calls.length,count,'idle directory has no recurring update reads');
});
test('manual update read failures offer a read retry and disposal cancels pending polling',async()=>{
  const button=updateButton(),calls=[],notices=[];let running=false;
  const action=createPluginUpdateAction(button,{pollMs:10,notify:(...args)=>notices.push(args),api:async(_path,options)=>{calls.push(options?.method || 'GET');if(options?.method==='POST'){running=true;throw Error('lost response');}return {running,lastCheckedAt:null,lastResult:null};}});
  await action.refresh();await button.onclick();assert.equal(button.textContent,'重试读取');assert.equal(button.disabled,false);assert.match(notices[0][0],/无法确认/);
  await button.onclick();assert.deepEqual(calls,['GET','POST','GET'],'uncertain send retry reads status instead of sending another command');assert.equal(button.disabled,true);
  action.dispose();const count=calls.length;await pause(30);assert.equal(calls.length,count);
});
