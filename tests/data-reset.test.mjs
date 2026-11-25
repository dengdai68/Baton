import test from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDataReset} from '../server/data-reset.mjs';
import {createStore} from '../server/store.mjs';
import {createAuth} from '../server/auth.mjs';
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'af-work-reset-')));t.after(()=>rm(root,{recursive:true,force:true}));const configurationRoot=join(root,'private/desktop'),workspaceRoot=join(root,'private/workspace');await mkdir(configurationRoot,{recursive:true});await mkdir(workspaceRoot);const options={workspaceRoot,configurationRoot};return {root,options,reset:createDataReset(options)};}
test('reset deletes the entire current work root and preserves authentication, configuration, and outside files',async t=>{
 const {root,options,reset}=await fixture(t),databasePath=join(options.configurationRoot,'sqlite/baton.sqlite'),authPath=join(options.configurationRoot,'auth.sqlite');
 await mkdir(join(databasePath,'..'),{mode:0o700});
 let store=createStore({databasePath,workspaceRoot:options.workspaceRoot,configurationDirectory:options.configurationRoot});const before=store.getBootstrap().installationId;
 const employee=store.createAgent({name:'Business employee'});store.openCommunication({kind:'agent',targetId:employee.id});store.registerExtensions([{id:randomUUID(),kind:'mcp',name:'Retained service',createdAt:new Date().toISOString(),providers:['codex']}]);
 const auth=createAuth({databasePath:authPath});await auth.setAdministrator('fixture-admin','Fixture-only-reset-2847');
 const files=[join(options.configurationRoot,'runtime-configs/kept.json'),join(options.configurationRoot,'credentials/kept.json'),join(options.configurationRoot,'sqlite/keep.txt'),join(root,'outside.txt')];for(const path of files){await mkdir(join(path,'..'),{recursive:true});await writeFile(path,'preserved');}
 await writeFile(join(options.workspaceRoot,'user-file.txt'),'also deleted');await symlink(files[3],join(options.workspaceRoot,'external-link'));await reset.begin();store.close();
 await writeFile(databasePath+'.history.sqlite','derived history');
 await writeFile(databasePath+'-wal','interrupt proof');
 assert.equal(await createDataReset(options).recover(),true);assert.deepEqual(await readdir(options.workspaceRoot),[]);
 for(const path of [databasePath,databasePath+'-wal',databasePath+'.history.sqlite'])await assert.rejects(access(path),{code:'ENOENT'});
 for(const path of files)assert.equal(await readFile(path,'utf8'),'preserved');assert.equal(auth.configured(),true);auth.close();
 store=createStore({databasePath,workspaceRoot:options.workspaceRoot,configurationDirectory:options.configurationRoot});try{assert.notEqual(store.getBootstrap().installationId,before);assert.equal(store.listAgents().some(item=>item.id===employee.id),false);assert.deepEqual(store.listCommunications(),[]);assert.equal(store.queryExtensions('mcp').total,1);}finally{store.close();}
 assert.equal(await reset.recover(),false);
});
test('reset refuses linked roots, configuration ancestors and protected repository paths before deletion',async t=>{
 const {root,options}=await fixture(t);await writeFile(join(options.workspaceRoot,'sentinel'),'kept');
 const linked=join(root,'linked');await symlink(options.workspaceRoot,linked);await assert.rejects(createDataReset({...options,workspaceRoot:linked}).begin(),/真实文件夹/);
 for(const target of [root,options.configurationRoot,join(options.configurationRoot,'nested')])await assert.rejects(createDataReset({...options,workspaceRoot:target}).begin(),/受保护/);
 await assert.rejects(createDataReset({...options,protectedPaths:[options.workspaceRoot]}).begin(),/受保护/);
 assert.equal(await readFile(join(options.workspaceRoot,'sentinel'),'utf8'),'kept');
});
test('uncommitted intent never deletes live data and committed intent cannot name another root',async t=>{
 const {options,reset}=await fixture(t);await writeFile(join(options.workspaceRoot,'sentinel'),'kept');const path=join(options.configurationRoot,'data-reset.json');
 await writeFile(path+'.pending','unfinished',{mode:0o600});assert.equal(await reset.recover(),false);await assert.rejects(access(path+'.pending'),{code:'ENOENT'});
 await writeFile(path,JSON.stringify({version:2,workspaceRoot:options.workspaceRoot,databasePath:join(options.configurationRoot,'auth.sqlite')}),{mode:0o600});await assert.rejects(reset.recover(),/归属无效/);assert.equal(await readFile(join(options.workspaceRoot,'sentinel'),'utf8'),'kept');
});
test('Store refuses reset while execution is active',t=>{const store=createStore();t.after(()=>store.close());const worker=store.listAgents().find(item=>item.kind!=='manager');const task=store.createTask({managerAgentId:worker.id,memberAgentIds:[worker.id],title:'Reset guard',objective:'fixture',workspacePath:tmpdir()});store.createRun(task.id);assert.throws(()=>store.prepareDataReset(),/停止正在执行/);});

test('flat configuration reset owns its default workspace only and retains credentials and login',async t=>{
 const {root}=await fixture(t),configurationRoot=join(root,'.baton'),workspaceRoot=join(configurationRoot,'workspace');await mkdir(workspaceRoot,{recursive:true});
 const auth=join(configurationRoot,'auth.sqlite');await writeFile(auth,'unchanged-auth');await writeFile(join(workspaceRoot,'result.md'),'remove only business files');
 const reset=createDataReset({configurationRoot,workspaceRoot});await reset.begin();await reset.recover();assert.deepEqual(await readdir(workspaceRoot),[]);assert.equal(await readFile(auth,'utf8'),'unchanged-auth');
 for(const name of ['credentials','browser','runtime-configs','other'])await assert.rejects(createDataReset({configurationRoot,workspaceRoot:join(configurationRoot,name)}).begin(),/受保护/);
});
