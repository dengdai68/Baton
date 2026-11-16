import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {migrateDesktopConfiguration} from '../apps/electron/configuration-root-migration.mjs';
import {readStorageLocation,writeStorageLocation,runtimeStoragePath} from '../server/storage-layout.mjs';
import {createStore} from '../server/store.mjs';
import {createMarketplace,readExtensionFile} from '../server/runtime/marketplace.mjs';

const offline=async()=>{throw Error('not running');};
async function fixture(t){
 const home=await mkdtemp(join(tmpdir(),'baton-config-cutover-')),root=join(home,'.baton'),legacy=join(root,'desktop'),work=join(home,'existing-work');
 t.after(()=>rm(home,{recursive:true,force:true}));
 await mkdir(legacy,{recursive:true,mode:0o700});await mkdir(join(root,'logs'),{mode:0o700});await mkdir(join(work,'records'),{recursive:true});
 await writeFile(join(legacy,'auth.sqlite'),'opaque-authentication',{mode:0o600});await writeFile(join(legacy,'configuration.json'),'opaque-private-configuration',{mode:0o600});
 await writeStorageLocation(legacy,{version:1,workspaceRoot:work,previousRuntimeRoots:['/previous/runtime-configs']});
 await mkdir(join(legacy,'browser'),{mode:0o700});await writeFile(join(legacy,'browser','Cookies'),'existing-login',{mode:0o600});
 await mkdir(join(legacy,'runtime-configs','marketplace'),{recursive:true,mode:0o700});
 await writeFile(join(legacy,'runtime-configs','marketplace','manifest.json'),'immutable-plugin-bytes',{mode:0o600});
 await writeFile(join(work,'records','frozen-ref.txt'),join(legacy,'runtime-configs','marketplace','manifest.json'));
 await writeFile(join(root,'cli-session.json'),'independent-cli-session',{mode:0o600});
 return {home,root,legacy,work};
}
test('installed configuration cutover preserves login/configuration bytes and frozen Runtime references',async t=>{
 const f=await fixture(t),before=await lstat(join(f.legacy,'auth.sqlite'),{bigint:true});
 const result=await migrateDesktopConfiguration({...f,fetcher:offline});assert.equal(result.migrated,true);
 assert.equal(await readFile(join(f.root,'auth.sqlite'),'utf8'),'opaque-authentication');assert.equal((await lstat(join(f.root,'auth.sqlite'),{bigint:true})).ino,before.ino);
 assert.equal(await readFile(join(f.root,'configuration.json'),'utf8'),'opaque-private-configuration');assert.equal(await readFile(join(f.root,'browser','Cookies'),'utf8'),'existing-login');
 assert.equal(await readFile(join(f.root,'cli-session.json'),'utf8'),'independent-cli-session');
 const location=await readStorageLocation(f.root,{});assert.equal(location.workspaceRoot,f.work);assert.ok(location.previousRuntimeRoots.includes('/previous/runtime-configs'));assert.ok(location.previousRuntimeRoots.includes(join(f.legacy,'runtime-configs')));
 const frozen=await readFile(join(f.work,'records','frozen-ref.txt'),'utf8');assert.ok(frozen.startsWith(f.legacy));
 const mapped=runtimeStoragePath(frozen,{currentRoot:join(f.root,'runtime-configs'),previousRoots:location.previousRuntimeRoots});assert.equal(await readFile(mapped,'utf8'),'immutable-plugin-bytes');
 await assert.rejects(lstat(f.legacy),{code:'ENOENT'});assert.equal((await migrateDesktopConfiguration({...f,fetcher:offline})).migrated,false);
});
test('cutover resumes after partial file moves and after locator publication',async t=>{
 for(const phase of ['move','locator']){
  const f=await fixture(t);await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline,...(phase==='move'?{afterMove:()=>{throw Error('interrupted');}}:{afterLocator:()=>{throw Error('interrupted');}})}),/interrupted/);
  assert.equal(await readFile(join(f.root,'auth.sqlite'),'utf8'),'opaque-authentication');
  await migrateDesktopConfiguration({...f,fetcher:offline});assert.equal(await readFile(join(f.root,'browser','Cookies'),'utf8'),'existing-login');await assert.rejects(lstat(f.legacy),{code:'ENOENT'});
 }
});
test('existing target configuration and same-name files refuse before moving source data',async t=>{
 for(const name of ['auth.sqlite','unrelated.txt']){
  const f=await fixture(t);if(name==='unrelated.txt')await writeFile(join(f.legacy,name),'source');await writeFile(join(f.root,name),'different target',{mode:0o600});
  await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline}),/已有配置|同名/);assert.equal(await readFile(join(f.legacy,'auth.sqlite'),'utf8'),'opaque-authentication');assert.equal(await readFile(join(f.root,name),'utf8'),'different target');
 }
});
test('a live legacy Chromium owner or matching service prevents migration',async t=>{
 const f=await fixture(t);await symlink('fixture-host-'+process.pid,join(f.legacy,'browser','SingletonLock'));
 await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline}),/仍在运行/);await rm(join(f.legacy,'browser','SingletonLock'));
 await writeFile(join(f.legacy,'desktop-endpoint.json'),JSON.stringify({origin:'http://127.0.0.1:23456',instanceId:'same'}),{mode:0o600});
 await assert.rejects(migrateDesktopConfiguration({...f,fetcher:async()=>({ok:true,json:async()=>({service:'baton-control-plane',instanceId:'same'})})}),/后台仍在运行/);
 assert.equal(await readFile(join(f.legacy,'auth.sqlite'),'utf8'),'opaque-authentication');
});
test('symlink entries, live locks and tampered migration records fail closed',async t=>{
 const f=await fixture(t);await symlink(join(f.home,'outside'),join(f.legacy,'linked'));
 await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline}),/链接/);await rm(join(f.legacy,'linked'));
 const lock=join(f.root,'.configuration-root-migration.lock');await writeFile(lock,JSON.stringify({pid:process.pid,token:'other'}),{mode:0o600});
 await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline}),/另一个进程/);await rm(lock);
 await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline,afterMove:()=>{throw Error('interrupt');}}),/interrupt/);
 const path=join(f.root,'.configuration-root-migration.json'),plan=JSON.parse(await readFile(path,'utf8'));plan.entries[0].name='../outside';await writeFile(path,JSON.stringify(plan));
 await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline}),/条目无效/);
});
test('locator edits during interrupted migration are retained and reported',async t=>{
 const f=await fixture(t);await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline,afterLocator:()=>{throw Error('interrupt');}}),/interrupt/);
 await writeStorageLocation(f.root,{version:1,workspaceRoot:join(f.home,'operator-change'),previousRuntimeRoots:[]});
 await assert.rejects(migrateDesktopConfiguration({...f,fetcher:offline}),/缺失或已变化|定位已/);
 assert.equal((await readStorageLocation(f.root,{})).workspaceRoot,join(f.home,'operator-change'));
});

test('a stale migration owner can resume, while an absent legacy root creates no configuration',async t=>{
 const f=await fixture(t);await writeFile(join(f.root,'.configuration-root-migration.lock'),JSON.stringify({pid:99999998,token:'stale'}),{mode:0o600});
 await migrateDesktopConfiguration({...f,fetcher:offline});assert.equal(await readFile(join(f.root,'auth.sqlite'),'utf8'),'opaque-authentication');
 const empty=join(f.home,'unused-home');assert.equal((await migrateDesktopConfiguration({home:empty,fetcher:offline})).migrated,false);await assert.rejects(lstat(join(empty,'.baton')),{code:'ENOENT'});
});

test('real configuration catalog and frozen Run survive the directory-only move',async t=>{
 const home=await mkdtemp(join(tmpdir(),'baton-config-store-cutover-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const root=join(home,'.baton'),legacy=join(root,'desktop'),work=join(home,'work'),databasePath=join(work,'records/baton.sqlite');await mkdir(legacy,{recursive:true,mode:0o700});
 const market=createMarketplace(join(legacy,'runtime-configs'));
 const mcp=await market.add({kind:'mcp',name:'cutover-proof',description:'Isolated metadata proof; no tool calls.',content:JSON.stringify({mcpServers:{proof:{command:'/usr/bin/true',args:[]}}})});
 let store=createStore({databasePath,workspaceRoot:work,configurationDirectory:legacy});store.registerExtensions([mcp]);
 const employee=store.createAgent({name:'cutover member',runtime:{profileId:'runtime_codex',...await market.resolve({pluginIds:[],mcpIds:[mcp.id]},'codex')}});
 const run=store.createRun(store.createTask({title:'frozen cutover',objective:'directory-only fixture',managerAgentId:employee.id,memberAgentIds:[employee.id]}).id);store.pauseRun(run.id);
 const before=store.getRun(run.id),configuration=await readFile(join(legacy,'configuration.json'));store.close();
 await writeStorageLocation(legacy,{version:1,workspaceRoot:work,previousRuntimeRoots:[]});await migrateDesktopConfiguration({home,fetcher:offline});
 assert.deepEqual(await readFile(join(root,'configuration.json')),configuration);
 const location=await readStorageLocation(root,{}),saved={root:process.env.BATON_RUNTIME_CONFIG_ROOT,previous:process.env.BATON_RUNTIME_PREVIOUS_ROOTS};
 process.env.BATON_RUNTIME_CONFIG_ROOT=join(await realpath(root),'runtime-configs');process.env.BATON_RUNTIME_PREVIOUS_ROOTS=JSON.stringify(location.previousRuntimeRoots);
 try{
  store=createStore({databasePath,workspaceRoot:work,configurationDirectory:root});assert.deepEqual(store.getRun(run.id),before);assert.equal(store.listAgents().find(a=>a.id===employee.id).runtime.extensionSelection.mcpIds[0],mcp.id);
  const ref=before.manager.runtime.extensionManifest.find(ref=>ref.kind==='mcp');assert.ok(location.previousRuntimeRoots.some(prefix=>ref.path.startsWith(prefix+'/')));assert.ok((await readExtensionFile(ref)).includes('proof'));
  assert.equal((await createMarketplace(join(root,'runtime-configs')).detail(mcp.id,'mcp')).id,mcp.id);
 }finally{store?.close();for(const [name,value]of [['BATON_RUNTIME_CONFIG_ROOT',saved.root],['BATON_RUNTIME_PREVIOUS_ROOTS',saved.previous]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
