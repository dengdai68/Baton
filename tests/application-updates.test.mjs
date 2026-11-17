import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationUpdates, selectRelease, pickRelease, normalizeUpdateChannel, fetchLatestRelease, fetchReleases, downloadReleaseInstaller, RELEASE_ROOT } from '../apps/electron/updates.mjs';
import { isUpdateSender } from '../apps/electron/policy.mjs';
import { createAuth } from '../server/auth.mjs';

const payload = Buffer.from('isolated installer fixture, never executed');
const digest = createHash('sha256').update(payload).digest('hex');
function release(version = '1.2.3', extra = {}) {
  const asset = name => ({name,state:'uploaded',size:payload.length,digest:'sha256:'+digest,browser_download_url:`${RELEASE_ROOT}/download/v${version}/${name}`});
  return {tag_name:'v'+version,draft:false,prerelease:false,assets:[asset(`Baton-${version}-arm64.dmg`),asset('latest-mac.yml'),asset('SHA256SUMS.txt')],...extra};
}
const options = extra => ({currentVersion:'1.0.0-beta.109',arch:'arm64',packaged:true,readLatest:async()=>release(),...extra});

test('only stable published versions upgrade, including beta-to-same-stable; no downgrade or foreign assets', () => {
  for (const item of [release('2.0.0-beta.1'),release('2.0.0',{prerelease:true}),release('2.0.0',{draft:true}),release('02.0.0'),release('1.0.0+build.1')]) assert.equal(selectRelease(item,'0.1.0','arm64'),null);
  assert.equal(selectRelease(release('1.0.0'),'1.0.0-beta.109','arm64').version,'1.0.0');
  assert.equal(selectRelease(release('1.0.0'),'1.0.0','arm64'),null);
  assert.equal(selectRelease(release('1.0.0'),'2.0.0-beta.1','arm64'),null);
  const malicious = release(); malicious.assets[0].browser_download_url='https://example.com/Baton-1.2.3-arm64.dmg';
  assert.equal(selectRelease(malicious,'1.0.0','arm64').installer,null);
  assert.equal(selectRelease(release(),'1.0.0','x64').installer,null);
});

test('renamed repository is used for discovery, package publishing and strict asset selection', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.build.publish[0].repo, 'Baton');
  assert.equal(RELEASE_ROOT, 'https://github.com/dengdai68/Baton/releases');
  const result = await fetchLatestRelease(async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/dengdai68/Baton/releases/latest');
    assert.equal(options.redirect, 'error');
    return Response.json(release());
  });
  assert.ok(selectRelease(result, '1.0.0', 'arm64').installer);
  result.assets[0].browser_download_url = result.assets[0].browser_download_url.replace('/Baton/', '/Baton-App/');
  assert.equal(selectRelease(result, '1.0.0', 'arm64').installer, null);
});

test('GitHub no-stable 404 differs from offline/rate-limit failure', async () => {
  assert.equal(await fetchLatestRelease(async()=>new Response('',{status:404})),null);
  await assert.rejects(fetchLatestRelease(async()=>new Response('',{status:403})),/GitHub/);
  await assert.rejects(fetchLatestRelease(async()=>new Response('x'.repeat(1024*1024+1))),/大小/);
});

test('checking never downloads; no stable, failure and explicit retry report truthfully',async()=>{
  let reads=0,downloads=0;
  const service=createApplicationUpdates(options({readLatest:async()=>{reads++; if(reads===1)throw new Error('offline');return null;},downloadInstaller:async()=>{downloads++;}}));
  assert.equal((await service.check()).phase,'error');
  assert.equal((await service.check()).phase,'current');
  assert.equal(reads,2);assert.equal(downloads,0);service.stop();
});

test('manual download is explicit, coalesced, progress is public and opening never restarts',async()=>{
  let downloads=0,opened,prepared=0,finish;
  const gate=new Promise(resolve=>{finish=resolve;});
  const service=createApplicationUpdates(options({cacheRoot:'/unused',downloadInstaller:async(_release,_root,progress)=>{downloads++;progress({percent:25});await gate;return '/private/fixture.dmg';},openInstaller:async path=>{opened=path;return '';},prepareRestart:async()=>{prepared++;}}));
  const states=[];service.subscribe(s=>states.push(s));
  await service.check();assert.equal(downloads,0);
  const first=service.download(),second=service.download();await Promise.resolve();assert.equal(service.snapshot().percent,25);
  finish();await Promise.all([first,second]);assert.equal(downloads,1);assert.equal(service.snapshot().phase,'downloaded');
  await service.install();assert.equal(opened,'/private/fixture.dmg');assert.equal(prepared,0);
  assert.ok(states.every(s=>!('installerPath' in s) && !('feedUrl' in s)));service.stop();
});

test('native installation waits for idle lease and retains downloaded update on busy rejection',async()=>{
  let install=0,releaseLease=0,busy=true;
  const service=createApplicationUpdates(options({nativeInstall:true,createNativeUpdater:()=>({download:async version=>assert.equal(version,'1.2.3'),install(){install++;}}),prepareRestart:async()=>{if(busy)throw new Error('仍有任务执行');},releaseRestart(){releaseLease++;}}));
  await service.check();await service.download();await service.install();assert.equal(install,0);assert.equal(releaseLease,1);
  assert.equal(service.snapshot().phase,'downloaded');assert.match(service.snapshot().message,/任务/);
  busy=false;await service.install();assert.equal(install,1);assert.equal(service.snapshot().canInstall,false);
  await assert.rejects(service.install(),/下载完成/);assert.equal(install,1,'duplicate install cannot release the pending restart lease');service.stop();
});

test('native setup or manual checksum failures permit download retry, never claim readiness',async()=>{
  let tries=0;
  const service=createApplicationUpdates(options({nativeInstall:true,createNativeUpdater(){tries++;throw new Error('manifest mismatch');}}));
  await service.check();await service.download();assert.equal(service.snapshot().phase,'error');assert.equal(service.snapshot().canInstall,false);
  await service.download();assert.equal(tries,2);service.stop();
});

test('real streamed download verifies checksum/size, publishes only a complete file and removes failed parts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-app-update-'));
  try{
    const selected=selectRelease(release(),'1.0.0','arm64');
    const path=await downloadReleaseInstaller(selected,root,()=>{}, {fetcher:async()=>new Response(payload)});
    assert.deepEqual(await readFile(path),payload);
    assert.deepEqual(await readdir(root),['Baton-1.2.3-arm64.dmg']);
    await assert.rejects(downloadReleaseInstaller(selected,root,()=>{},{fetcher:async()=>new Response(Buffer.alloc(payload.length))}),/校验/);
    assert.deepEqual(await readdir(root),['Baton-1.2.3-arm64.dmg']);
    assert.deepEqual(await readFile(path),payload,'failed replacement preserves complete download');
    selected.installer.digest=null;
    const fromChecksum=await downloadReleaseInstaller(selected,root,()=>{},{fetcher:async url=>new Response(url.endsWith('SHA256SUMS.txt')?`${digest}  ${selected.installer.name}\n`:payload)});
    assert.equal(fromChecksum,path);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cancelled stream cannot become a downloaded installer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-update-abort-')),abort=new AbortController();abort.abort();
  try{await assert.rejects(downloadReleaseInstaller(selectRelease(release(),'1.0.0','arm64'),root,()=>{},{signal:abort.signal,fetcher:async(_url,{signal})=>{signal.throwIfAborted();}}));assert.deepEqual(await readdir(root),[]);}
  finally{await rm(root,{recursive:true,force:true});}
});

test('automatic checks never overlap, do not download, and stop with their host',async()=>{
  let reads=0,finish;const pending=new Promise(resolve=>{finish=resolve;});
  const service=createApplicationUpdates(options({startupMs:5,intervalMs:10,readLatest:async()=>{reads++;await pending;return null;}}));
  service.start();await new Promise(r=>setTimeout(r,30));assert.equal(reads,1);
  service.stop();finish();await new Promise(r=>setTimeout(r,30));assert.equal(reads,1);
});

test('update mutations accept only the owned settings main frame',()=>{
  const origin='http://127.0.0.1:59001',mainFrame={url:origin+'/settings/updates'},contents={mainFrame};
  assert.equal(isUpdateSender({sender:contents,senderFrame:mainFrame},contents,origin),true);
  assert.equal(isUpdateSender({sender:contents,senderFrame:{...mainFrame}},contents,origin),false);
  for(const url of [origin+'/settings/general','https://evil.test/settings/updates',origin+'/settings/updates/extra']){mainFrame.url=url;assert.equal(isUpdateSender({sender:contents,senderFrame:mainFrame},contents,origin),false);}
});

test('owned service restart lease atomically blocks writes, rejects busy writes and releases on matching ID',async()=>{
  const root=await mkdtemp(join(tmpdir(),'af-update-lease-')),password=randomBytes(16).toString('hex');
  const auth=createAuth({databasePath:join(root,'auth.sqlite')});await auth.setAdministrator('updates-qa',password);auth.close();
  const child=fork(new URL('../server/index.mjs',import.meta.url),[],{stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,HOME:root,BATON_DESKTOP_PORT:'0',BATON_BOOTSTRAP_TOKEN:randomBytes(32).toString('hex'),BATON_DB_PATH:join(root,'state.sqlite'),BATON_AUTH_DB_PATH:join(root,'auth.sqlite'),BATON_RUN_FILES_ROOT:join(root,'runs'),BATON_RUNTIME_CONFIG_ROOT:join(root,'runtime'),BATON_WORKSPACE_ROOT:join(root,'work'),BATON_LOG_DIR:join(root,'logs')}});
  const receive=(predicate,timeout=20000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.off('message',listener);reject(Error('IPC timeout'));},timeout);const listener=value=>{if(predicate(value)){clearTimeout(timer);child.off('message',listener);resolve(value);}};child.on('message',listener);});
  let held;
  try{
    const ready=await receive(m=>m.type==='baton-ready',Number(process.env.BATON_TEST_STARTUP_TIMEOUT_MS||20000)),origin='http://127.0.0.1:'+ready.port;
    const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'updates-qa',password})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0],headers={Origin:origin,Cookie:cookie,'Content-Type':'application/json'};
    const prepare=async()=>{const id=randomUUID(),pending=receive(m=>m.type==='baton-update-readiness' && m.id===id);child.send({type:'baton-update-prepare',id});return {...await pending,id};};
    const release=async id=>{const pending=receive(m=>m.type==='baton-update-released' && m.id===id);child.send({type:'baton-update-release',id});await pending;};
    const lease=await prepare();assert.equal(lease.ready,true);
    assert.equal((await fetch(origin+'/api/tasks',{method:'POST',headers,body:'{}'})).status,503);
    assert.equal((await fetch(origin+'/api/health')).status,200);
    child.send({type:'baton-update-release',id:randomUUID()});assert.equal((await prepare()).ready,false);
    await release(lease.id);assert.equal((await fetch(origin+'/api/tasks',{method:'POST',headers,body:'{}'})).status,400);
    held=httpRequest(origin+'/api/tasks',{method:'POST',headers:{...headers,'Content-Length':'10000'}});held.on('error',()=>{});held.write('{"title":');
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal((await prepare()).ready,false,'in-flight HTTP write blocks native restart');
    held.destroy();held=null;
  }finally{held?.destroy();const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;await rm(root,{recursive:true,force:true});}
});

// The host may move verified business storage while retaining update state.
test('manual installer follows the active data root after verified relocation',async()=>{
  let root='/before/updates',downloadedAt,opened;
  const service=createApplicationUpdates(options({cacheRoot:()=>root,downloadInstaller:async(_release,cache)=>{downloadedAt=cache;return join(cache,'verified.dmg');},openInstaller:async path=>{opened=path;return '';}}));
  await service.check();await service.download();assert.equal(downloadedAt,'/before/updates');
  root='/after/updates';await service.install();assert.equal(opened,'/after/updates/verified.dmg');service.stop();
});

test('beta channel takes vX.Y.Z-beta.N prereleases and releases, highest version first, never downgrading', () => {
  const beta = (version, extra) => release(version, { prerelease: true, ...extra });
  // Drafts, malformed suffixes and mismatched prerelease flags never qualify, even on beta.
  for (const item of [beta('2.0.0-beta.1',{draft:true}),beta('2.0.0-beta.01'),beta('2.0.0-rc.1'),beta('2.0.0-beta'),release('2.0.0-beta.1'),beta('2.0.0')]) assert.equal(selectRelease(item,'0.1.0','arm64','beta'),null,item.tag_name);
  assert.equal(selectRelease(beta('2.0.0-beta.1'),'0.1.0','arm64'),null,'the stable channel ignores betas');
  const picked = selectRelease(beta('2.0.0-beta.1'),'0.1.0','arm64','beta');
  assert.deepEqual({version:picked.version,channel:picked.channel,installer:picked.installer?.name},{version:'2.0.0-beta.1',channel:'beta',installer:'Baton-2.0.0-beta.1-arm64.dmg'});
  assert.equal(selectRelease(release('2.0.0'),'0.1.0','arm64','beta').channel,'stable');
  // GitHub lists by date; versions decide, and a release outranks its own betas.
  const list = [beta('1.2.0-beta.2'),release('1.1.0'),beta('1.2.0-beta.3'),beta('1.1.0-beta.9')];
  console.log('beta channel picks:', pickRelease(list,'1.1.0','arm64','beta').version, '| with 1.2.0:', pickRelease([...list,release('1.2.0')],'1.1.0','arm64','beta').version);
  assert.equal(pickRelease(list,'1.1.0','arm64','beta').version,'1.2.0-beta.3');
  assert.equal(pickRelease([...list,release('1.2.0')],'1.1.0','arm64','beta').version,'1.2.0');
  assert.equal(pickRelease(list,'1.1.0','arm64','stable'),null,'stable keeps to releases');
  assert.equal(pickRelease(list,'1.2.0-beta.3','arm64','beta'),null,'nothing equal or older');
  assert.equal(pickRelease([release('1.1.0')],'1.2.0-beta.3','arm64','stable'),null,'back on stable, a beta install is never downgraded');
  assert.equal(normalizeUpdateChannel('beta'),'beta');assert.equal(normalizeUpdateChannel('stable'),'stable');assert.equal(normalizeUpdateChannel('nightly'),null);
});

test('beta channel reads the published release list with the same bounds and errors', async () => {
  const list = await fetchReleases(async (url, init) => {
    assert.equal(url,'https://api.github.com/repos/dengdai68/Baton/releases?per_page=30');assert.equal(init.redirect,'error');
    return Response.json([release('1.2.0-beta.1',{prerelease:true})]);
  });
  assert.equal(list[0].tag_name,'v1.2.0-beta.1');
  assert.deepEqual(await fetchReleases(async()=>new Response('',{status:404})),[]);
  await assert.rejects(fetchReleases(async()=>Response.json({message:'not a list'})),/版本列表/);
  await assert.rejects(fetchReleases(async()=>new Response('',{status:403})),/GitHub/);
});

test('stable default never reads betas; switching saves first, re-checks and refuses while downloading', async () => {
  const saved = []; let lists = 0;
  const service = createApplicationUpdates(options({currentVersion:'1.1.0',readLatest:async()=>release('1.1.0'),
    readAll:async()=>{lists++;return [release('1.2.0-beta.1',{prerelease:true}),release('1.1.0')];},saveChannel:async value=>{saved.push(value);}}));
  const stable = await service.check();
  assert.deepEqual({channel:stable.channel,phase:stable.phase,version:stable.version},{channel:'stable',phase:'current',version:null});assert.equal(lists,0);
  const beta = await service.setChannel('beta');
  console.log('after switching to beta:', beta.phase, beta.version, beta.releaseChannel, beta.message);
  assert.deepEqual({channel:beta.channel,phase:beta.phase,version:beta.version,releaseChannel:beta.releaseChannel,canDownload:beta.canDownload},{channel:'beta',phase:'available',version:'1.2.0-beta.1',releaseChannel:'beta',canDownload:true});
  assert.equal(beta.message,'发现测试版 1.2.0-beta.1');assert.deepEqual(saved,['beta']);assert.equal(lists,1);
  await assert.rejects(service.setChannel('nightly'),/更新渠道无效/);assert.deepEqual(saved,['beta']);
  const back = await service.setChannel('stable');
  assert.deepEqual({channel:back.channel,phase:back.phase,version:back.version,releaseChannel:back.releaseChannel},{channel:'stable',phase:'current',version:null,releaseChannel:null});
  assert.deepEqual(saved,['beta','stable']);service.stop();
  // A failed save changes nothing.
  const failing = createApplicationUpdates(options({saveChannel:async()=>{throw new Error('disk full');}}));
  await assert.rejects(failing.setChannel('beta'),/disk full/);assert.equal(failing.snapshot().channel,'stable');failing.stop();
  // A running download keeps its channel until it finishes.
  let finish;const downloading = createApplicationUpdates(options({downloadInstaller:()=>new Promise(resolve=>{finish=resolve;})}));
  await downloading.check();const pending = downloading.download();
  await assert.rejects(downloading.setChannel('beta'),/下载或安装进行中/);finish('/isolated/verified.dmg');assert.equal((await pending).phase,'downloaded');downloading.stop();
  // A saved beta choice starts on beta and reports an empty list truthfully.
  const restored = createApplicationUpdates(options({channel:'beta',readAll:async()=>[]}));
  assert.deepEqual({channel:restored.snapshot().channel,message:restored.snapshot().message},{channel:'beta',message:'启动后自动检查正式版和测试版。'});
  assert.equal((await restored.check()).message,'尚未发布可用版本。');restored.stop();
});
