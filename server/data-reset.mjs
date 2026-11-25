import {lstat,open,readFile,readdir,rename,rm,mkdir,realpath,unlink} from 'node:fs/promises';
import {join,resolve,isAbsolute,parse,dirname,sep} from 'node:path';
import {homedir} from 'node:os';
import {configurationOverlapsWorkspace,storageBusinessRoot,storageDatabasePath,storageDatabaseFiles} from './storage-layout.mjs';

// The intent survives clearing both the work root and the business database.
export function createDataReset({workspaceRoot,configurationRoot,databasePath,protectedPaths=[]}){
  if(!workspaceRoot||!configurationRoot)throw new Error('清除操作需要工作目录和配置目录');
  const work=resolve(workspaceRoot),control=resolve(configurationRoot),journal=join(control,'data-reset.json'),pending=journal+'.pending';
  const managedDatabase=storageDatabasePath(control);
  const database=databasePath ? resolve(databasePath) : managedDatabase;
  const insideWork=database.startsWith(work+sep);
  const plan={version:2,workspaceRoot:work,databasePath:database};
  const protectedRoots=[resolve(homedir()),control,...protectedPaths.map(path=>resolve(path))];
  function safe(path){if(!isAbsolute(path)||path!==resolve(path)||path===parse(path).root||protectedRoots.some(root=>root===path||root.startsWith(path+'/'))||configurationOverlapsWorkspace(control,path))throw new Error('清除目标包含受保护目录，未执行清除');}
  async function validate(){safe(work);const info=await lstat(work).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw new Error('工作目录必须是真实文件夹，未执行清除');if(info){const actual=await realpath(work);safe(actual);if(actual!==work)throw new Error('工作目录父路径包含链接，未执行清除');}const config=await lstat(control);if(!config.isDirectory()||config.isSymbolicLink())throw new Error('配置目录不可用');}
  async function privateFile(path){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>4096||(info.mode&0o077))throw new Error('数据清除记录无效');}
  async function ownedDatabaseFiles() {
    if(insideWork)return [];
    if(database!==managedDatabase)throw new Error('数据库位于受保护目录，未执行清除');
    const root=dirname(database);
    const parent=await lstat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!parent)return [];
    if(!parent.isDirectory()||(parent.mode&0o077)||(process.getuid&&parent.uid!==process.getuid()))throw new Error('SQLite 目录不可安全清除');
    const owned=[];
    for(const path of storageDatabaseFiles(database)) {
      const file=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
      if(!file)continue;
      if(!file.isFile()||file.nlink!==1||(process.getuid&&file.uid!==process.getuid()))throw new Error('SQLite 文件不可安全清除');
      owned.push(path);
    }
    return owned;
  }
  async function clearWorkspaceFiles() {
    const records = storageBusinessRoot(work);
    const info = await lstat(records).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && !info.isDirectory()) await unlink(records);
    await mkdir(records, { recursive: true, mode: 0o700 });
    // The desktop host needs both directories to open this workspace again.
    // Keep them available while a committed reset removes their contents.
    for (const directory of [work, records]) {
      for (const name of await readdir(directory)) {
        const path = join(directory, name);
        if (path !== records) await rm(path, { recursive: true, force: true });
      }
    }
  }
  return {
    async begin(){await validate();await ownedDatabaseFiles();await mkdir(control,{recursive:true,mode:0o700});try{await lstat(journal);throw new Error('已有数据清除尚未完成，请重启后继续');}catch(error){if(error.code!=='ENOENT')throw error;}
      const fd=await open(pending,'wx',0o600);try{await fd.writeFile(JSON.stringify(plan));await fd.sync();}finally{await fd.close();}await rename(pending,journal);
    },
    async recover(){let intent;try{await privateFile(journal);intent=JSON.parse(await readFile(journal,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;try{await privateFile(pending);await rm(pending);}catch(error){if(error.code!=='ENOENT')throw error;}return false;}
      if(intent?.version!==plan.version||intent.workspaceRoot!==work||intent.databasePath!==database||Object.keys(intent).length!==3)throw new Error('数据清除记录归属无效');
      await validate();
      const owned=await ownedDatabaseFiles();
      await clearWorkspaceFiles();
      for(const path of owned)await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await rm(journal);return true;
    }
  };
}
