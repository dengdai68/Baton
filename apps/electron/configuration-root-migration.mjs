import {lstat,open,readFile,readdir,readlink,realpath,rename,rmdir,unlink} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {batonDataHome,defaultTaskWorkspaceRoot} from '../../server/data-home.mjs';
import {readStorageLocation,writeStorageLocation,storageLocation} from '../../server/storage-layout.mjs';

const journalName='.configuration-root-migration.json',lockName='.configuration-root-migration.lock';
const markers=['auth.sqlite','configuration.json','configuration.pending.json','storage.json','browser','runtime-configs','credentials','desktop-preferences.json'];
const inspect=path=>lstat(path,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const owned=info=>!process.getuid||info.uid===BigInt(process.getuid());
const privateFile=info=>info?.isFile()&&!info.isSymbolicLink()&&info.nlink===1n&&owned(info)&&(info.mode&0o077n)===0n;
const identity=info=>({dev:String(info.dev),ino:String(info.ino),type:info.isDirectory()?'directory':'file'});
const same=(info,entry)=>info&&owned(info)&&!info.isSymbolicLink()&&String(info.dev)===entry.dev&&String(info.ino)===entry.ino&&(entry.type==='directory'?info.isDirectory():info.isFile());
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};

async function json(path,limit=1024*1024){const info=await inspect(path);if(!privateFile(info)||info.size>BigInt(limit))throw new Error('配置迁移记录不是当前用户的私有常规文件');return JSON.parse(await readFile(path,'utf8'));}
async function atomicJson(path,value){const tmp=path+'.'+randomUUID()+'.tmp';try{const file=await open(tmp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}await rename(tmp,path);}finally{await unlink(tmp).catch(error=>{if(error.code!=='ENOENT')throw error;});}}

async function requireStopped(legacyRoot,root,fetcher){
  const singleton=await lstat(join(legacyRoot,'browser/SingletonLock')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(singleton?.isSymbolicLink()){
    const pid=Number((await readlink(join(legacyRoot,'browser/SingletonLock'))).match(/-(\d+)$/)?.[1]);
    if(Number.isSafeInteger(pid)&&pid>0&&alive(pid))throw new Error('旧 Baton 客户端仍在运行，请先退出再迁移配置');
  }
  for(const directory of [legacyRoot,root]){
    const path=join(directory,'desktop-endpoint.json');if(!await inspect(path))continue;
    const endpoint=await json(path,1024);
    if(!/^http:\/\/127\.0\.0\.1:(?:[1-9]\d{0,4})$/.test(endpoint.origin)||Number(new URL(endpoint.origin).port)>65535||typeof endpoint.instanceId!=='string')throw new Error('旧客户端连接记录无效，未迁移配置');
    let response;try{response=await fetcher(endpoint.origin+'/api/health',{redirect:'error',signal:AbortSignal.timeout(1500)});}catch{continue;}
    let health;try{health=await response.json();}catch{continue;}
    if(response.ok&&health.service==='baton-control-plane'&&health.instanceId===endpoint.instanceId)throw new Error('旧 Baton 后台仍在运行，请先退出再迁移配置');
  }
}

// This is a one-time installed-client cutover, not an alternative runtime layout.
// It runs before Chromium/authentication open files. The journal contains paths
// and inode identities only; private payloads and immutable Run facts are not rewritten.
export async function migrateDesktopConfiguration({home=homedir(),fetcher=fetch,afterMove,afterLocator}={}){
  const root=batonDataHome(home),legacyRoot=join(root,'desktop'),journal=join(root,journalName),lock=join(root,lockName);
  const parent=await inspect(root);
  if(parent&&(!parent.isDirectory()||parent.isSymbolicLink()||!owned(parent)||(parent.mode&0o077n)))throw new Error('Baton 配置根目录必须是当前用户的私有真实目录');
  let legacy=await inspect(legacyRoot),pending=await inspect(journal);
  if(!legacy&&!pending)return {migrated:false,root};
  if(legacy&&(!legacy.isDirectory()||legacy.isSymbolicLink()||!owned(legacy)||(legacy.mode&0o077n)))throw new Error('旧配置目录不是当前用户的私有真实目录');
  await requireStopped(legacyRoot,root,fetcher);
  const token=randomUUID();let held=false;
  const assertLock=async()=>{const value=await json(lock,1024);if(value.token!==token||value.pid!==process.pid)throw new Error('配置迁移锁已变更，迁移已停止');};
  try{
    const prior=await inspect(lock);
    if(prior){const value=await json(lock,1024);if(!Number.isSafeInteger(value.pid)||value.pid<1||alive(value.pid))throw new Error('另一个进程正在迁移配置，请稍后重试');const current=await inspect(lock);if(current?.ino!==prior.ino)throw new Error('配置迁移锁已变更');await unlink(lock);}
    const file=await open(lock,'wx',0o600);try{await file.writeFile(JSON.stringify({pid:process.pid,token}));await file.sync();}finally{await file.close();}held=true;
    pending=await inspect(journal);
    let plan;
    if(pending){
      plan=await json(journal);
      if(plan.version!==1||plan.root!==root||plan.legacyRoot!==legacyRoot||!Array.isArray(plan.entries)||plan.entries.length>1000||Object.keys(plan).some(k=>!['version','root','legacyRoot','entries','location'].includes(k)))throw new Error('配置迁移记录归属无效');
      plan.location=storageLocation(plan.location);
      const names=new Set();
      for(const entry of plan.entries){if(!entry||typeof entry.name!=='string'||entry.name!==basename(entry.name)||['.','..','desktop',journalName,lockName].includes(entry.name)||entry.name.includes('\\')||names.has(entry.name)||!['file','directory'].includes(entry.type)||!/^\d+$/.test(entry.dev)||!/^\d+$/.test(entry.ino))throw new Error('配置迁移条目无效');names.add(entry.name);}
    }else{
      for(const name of markers)if(await inspect(join(root,name)))throw new Error('新配置目录已有配置，未合并或覆盖；请先核对 ~/.baton 与 ~/.baton/desktop');
      const entries=[];
      for(const name of (await readdir(legacyRoot)).sort()){
        if(name.includes('\\')||['desktop',journalName,lockName].includes(name))throw new Error('旧配置目录包含无效或保留名称，未迁移');
        const info=await inspect(join(legacyRoot,name));
        if(!info||info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile())||!owned(info))throw new Error('旧配置包含不可迁移的链接或文件类型，未迁移');
        if(await inspect(join(root,name)))throw new Error('新旧配置存在同名条目，未合并或覆盖');
        entries.push({name,...identity(info)});
      }
      if(entries.length>1000)throw new Error('旧配置顶层条目过多，未迁移');
      const location=await readStorageLocation(legacyRoot,{version:1,workspaceRoot:defaultTaskWorkspaceRoot(home),previousRuntimeRoots:[]});
      plan={version:1,root,legacyRoot,entries,location};
      await assertLock();await atomicJson(journal,plan);
    }
    const nextLocation=storageLocation({...plan.location,previousRuntimeRoots:[...new Set([...plan.location.previousRuntimeRoots,join(legacyRoot,'runtime-configs'),join(await realpath(root),'desktop','runtime-configs')])]});
    for(const entry of plan.entries){
      await assertLock();
      const source=join(legacyRoot,entry.name),target=join(root,entry.name),before=await inspect(source),current=await inspect(target);
      if(before){
        if(current||!same(before,entry))throw new Error('配置迁移发生同名冲突或源文件变化，已停止且保留现有文件');
        await rename(source,target);await afterMove?.(entry.name);
      }else{
        let relocated=same(current,entry);
        if(!relocated&&entry.name==='storage.json'&&privateFile(current))relocated=JSON.stringify(await readStorageLocation(root,nextLocation))===JSON.stringify(nextLocation);
        if(!relocated)throw new Error('配置迁移条目缺失或已变化，请检查迁移记录；未初始化空配置');
      }
    }
    await assertLock();
    if(await inspect(join(root,'storage.json'))){const actual=JSON.stringify(await readStorageLocation(root,nextLocation));if(actual!==JSON.stringify(plan.location)&&actual!==JSON.stringify(nextLocation))throw new Error('工作目录定位已在迁移期间变化，未覆盖');}
    await writeStorageLocation(root,nextLocation);await afterLocator?.();
    await rmdir(legacyRoot).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await assertLock();await unlink(journal);
    return {migrated:true,root,previousRoot:legacyRoot,entries:plan.entries.length};
  }finally{
    if(held){const value=await json(lock,1024).catch(()=>null);if(value?.token===token)await unlink(lock);}
  }
}
