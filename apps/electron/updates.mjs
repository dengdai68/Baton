import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import semver from 'semver';

export const RELEASE_ROOT = 'https://github.com/dengdai68/Baton/releases';
const latestApi = 'https://api.github.com/repos/dengdai68/Baton/releases/latest';
// Newest releases by date; the beta channel compares their versions itself.
const releasesApi = 'https://api.github.com/repos/dengdai68/Baton/releases?per_page=30';
/** Update channels: stable (default) takes releases only; beta also takes vX.Y.Z-beta.N prereleases. */
export const UPDATE_CHANNELS = Object.freeze(['stable', 'beta']);
export function normalizeUpdateChannel(value) { return UPDATE_CHANNELS.includes(value) ? value : null; }
const stableVersion = tag => typeof tag === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) ? semver.valid(tag.replace(/^v/, '')) : null;
const betaVersion = tag => typeof tag === 'string' && /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)$/.test(tag) ? semver.valid(tag.replace(/^v/, '')) : null;

/**
 * The update a published release offers this install, or null. A release needs a
 * strict vX.Y.Z tag with prerelease=false; the beta channel also accepts
 * vX.Y.Z-beta.N marked prerelease. Drafts, other tags, mismatched flags and
 * versions not above the current one never qualify, so nothing downgrades.
 */
export function selectRelease(release, currentVersion, arch = process.arch, channel = 'stable') {
  if (!release || release.draft !== false || !semver.valid(currentVersion)) return null;
  const stable = release.prerelease === false ? stableVersion(release.tag_name) : null;
  const beta = channel === 'beta' && release.prerelease === true ? betaVersion(release.tag_name) : null;
  const version = stable || beta;
  if (!version || !semver.gt(version, currentVersion)) return null;
  const tag = release.tag_name, prefix = `${RELEASE_ROOT}/download/${encodeURIComponent(tag)}/`;
  const assets = (release.assets || []).filter(a => a?.state === 'uploaded' && typeof a.name === 'string' && a.browser_download_url === prefix + encodeURIComponent(a.name));
  const installer = assets.find(a => a.name === `Baton-${version}-${arch}.dmg` && Number.isSafeInteger(a.size) && a.size > 0);
  return { version, channel: beta ? 'beta' : 'stable', tag, releaseUrl: `${RELEASE_ROOT}/tag/${encodeURIComponent(tag)}`, feedUrl: prefix,
    installer: installer ? { name: installer.name, url: installer.browser_download_url, size: installer.size, digest: /^sha256:[a-f0-9]{64}$/i.test(installer.digest || '') ? installer.digest.slice(7).toLowerCase() : null } : null,
    checksums: assets.find(a => a.name === 'SHA256SUMS.txt')?.browser_download_url || null,
    nativeManifest: assets.some(a => a.name === 'latest-mac.yml') };
}

async function boundedText(response, limit) {
  let length = 0; const chunks = [];
  for await (const chunk of response.body) { length += chunk.length; if (length > limit) throw new Error('更新响应超出大小限制'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
/** Anonymous bounded GitHub API read; 404 is "nothing published", other failures are errors. */
async function readGitHub(url, fetcher, limit) {
  const response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Baton-Updater' }, signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('暂时无法连接 GitHub 检查更新，请稍后重试');
  return JSON.parse(await boundedText(response, limit));
}
/** GitHub's latest release: the newest published non-prerelease, or null when none exists. */
export async function fetchLatestRelease(fetcher = fetch) { return readGitHub(latestApi, fetcher, 1024 * 1024); }
/** Recently published releases, prereleases included (anonymous reads never list drafts). */
export async function fetchReleases(fetcher = fetch) {
  const releases = await readGitHub(releasesApi, fetcher, 4 * 1024 * 1024);
  if (releases !== null && !Array.isArray(releases)) throw new Error('GitHub 返回的版本列表无法识别，请稍后重试');
  return releases || [];
}
/** The highest qualifying update among releases for the channel (GitHub orders by date, not version). */
export function pickRelease(releases, currentVersion, arch = process.arch, channel = 'stable') {
  return (releases || []).map(release => selectRelease(release, currentVersion, arch, channel)).filter(Boolean)
    .sort((a, b) => semver.rcompare(a.version, b.version))[0] || null;
}

export async function downloadReleaseInstaller(release, cacheRoot, onProgress, { fetcher = fetch, signal } = {}) {
  const asset = release.installer;
  if (!asset) throw new Error('该版本没有适合本机的安装包');
  let expected = asset.digest;
  if (!expected && release.checksums) {
    const response = await fetcher(release.checksums, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)].filter(Boolean)) });
    if (!response.ok) throw new Error('无法读取安装包校验信息，请重试或前往 Release 下载');
    const line = (await boundedText(response, 256 * 1024)).split(/\r?\n/).map(line => line.match(/^([a-f0-9]{64})\s+\*?([^/\\]+)$/i)).find(match => match?.[2] === asset.name);
    expected = line?.[1].toLowerCase();
  }
  if (!expected) throw new Error('该安装包缺少 SHA-256 校验信息，请前往 Release 下载');
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(cacheRoot, 'download-')), path = join(scratch, asset.name);
  let file;
  try {
    const response = await fetcher(asset.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)].filter(Boolean)) });
    if (!response.ok) throw new Error('安装包下载失败，请重试');
    file = await open(path, 'wx', 0o600);
    const hash = createHash('sha256'); let transferred = 0, lastProgress = 0;
    for await (const chunk of response.body) {
      transferred += chunk.length;
      if (transferred > asset.size) throw new Error('安装包大小校验失败，请重试');
      hash.update(chunk);
      await file.writeFile(chunk);
      if (Date.now() - lastProgress > 200) { onProgress({ percent: transferred / asset.size * 100, transferred, total: asset.size }); lastProgress = Date.now(); }
    }
    if (transferred !== asset.size || hash.digest('hex') !== expected) throw new Error('安装包校验失败，请重新下载');
    await file.close(); file = null;
    const destination = join(cacheRoot, asset.name);
    await rename(path, destination);
    onProgress({ percent: 100, transferred, total: asset.size });
    return destination;
  } finally { await file?.close(); await rm(scratch, { recursive: true, force: true }); }
}

// Status wording per channel; the stable texts predate channels and stay as they were.
const CHANNEL_TEXT = {
  stable: { packaged: '启动后自动检查正式版，Beta 不参与更新。', source: '开发模式：可检查正式版，安装版支持下载更新。', checking: '正在检查正式版…', current: '当前没有可用的正式版更新。', none: '尚未发布正式版，Beta 不参与更新。' },
  beta: { packaged: '启动后自动检查正式版和测试版。', source: '开发模式：可检查正式版和测试版，安装版支持下载更新。', checking: '正在检查正式版和测试版…', current: '当前没有可用的更新。', none: '尚未发布可用版本。' }
};
const FOUND_TEXT = {
  stable: { found: version => `发现正式版 ${version}`, noInstaller: '发现正式版，但尚未提供适合本机的安装包，可查看发布页面。' },
  beta: { found: version => `发现测试版 ${version}`, noInstaller: '发现测试版，但尚未提供适合本机的安装包，可查看发布页面。' }
};

// The controller owns update state only. Domain activity, native installation and
// the saved channel remain behind injected host adapters, never renderer paths or URLs.
export function createApplicationUpdates({ currentVersion, packaged, arch, nativeInstall = false, cacheRoot, channel = 'stable',
  readLatest = fetchLatestRelease, readAll = fetchReleases, saveChannel = async () => {}, downloadInstaller = downloadReleaseInstaller, createNativeUpdater,
  openInstaller, prepareRestart, releaseRestart = () => {}, onDiagnostic = () => {},
  intervalMs = 6 * 60 * 60 * 1000, startupMs = 20000 } = {}) {
  const events = new EventEmitter();
  const idleMessage = selected => CHANNEL_TEXT[selected][packaged ? 'packaged' : 'source'];
  const initialChannel = normalizeUpdateChannel(channel) || 'stable';
  let state = { phase: 'idle', channel: initialChannel, currentVersion, version: null, releaseChannel: null, releaseUrl: RELEASE_ROOT, percent: 0, lastCheckedAt: null,
    installMode: 'manual', message: idleMessage(initialChannel) };
  let candidate, nativeUpdater, installerPath, installerCache, operation, timer, stopped = false, installing = false;
  const currentCacheRoot = () => typeof cacheRoot === 'function' ? cacheRoot() : cacheRoot;
  const downloadAbort = new AbortController();
  const snapshot = () => ({ ...state, canDownload: packaged && Boolean(candidate?.installer) && ['available', 'error'].includes(state.phase), canInstall: packaged && state.phase === 'downloaded' && !installing });
  const publish = patch => { if (stopped) return; state = { ...state, ...patch }; events.emit('change', snapshot()); };
  const failure = (error, phase = 'error') => { onDiagnostic(error); publish({ phase, message: String(error.message || '更新操作失败，请重试').slice(0, 350) }); };
  function schedule(delay = intervalMs) {
    clearTimeout(timer); if (!packaged || stopped) return;
    timer = setTimeout(() => { void check().finally(() => schedule()); }, delay); timer.unref?.();
  }
  async function check() {
    if (stopped) return snapshot();
    if (operation) return operation;
    if (state.phase === 'downloaded' || installing) return snapshot();
    const previous = candidate, selected = state.channel, text = CHANNEL_TEXT[selected];
    publish({ phase: 'checking', message: text.checking });
    operation = Promise.resolve().then(async () => {
      try {
        // Stable reads GitHub's latest release; beta compares recent releases by version.
        const releases = selected === 'beta' ? await readAll() : [await readLatest()].filter(Boolean);
        if (stopped) return snapshot();
        candidate = pickRelease(releases, currentVersion, arch, selected);
        installerPath = null; nativeUpdater = null;
        const installMode = nativeInstall && candidate?.nativeManifest ? 'native' : 'manual', found = candidate && FOUND_TEXT[candidate.channel];
        publish({ phase: candidate ? 'available' : 'current', version: candidate?.version || null, releaseChannel: candidate?.channel || null, releaseUrl: candidate?.releaseUrl || RELEASE_ROOT,
          installMode, percent: 0, lastCheckedAt: new Date().toISOString(),
          message: candidate ? candidate.installer ? found.found(candidate.version) : found.noInstaller : releases.length ? text.current : text.none });
      } catch (error) { candidate = previous; failure(error); }
      finally { operation = null; }
      return snapshot();
    });
    return operation;
  }
  async function download() {
    if (operation) return operation;
    if (!snapshot().canDownload) throw new Error('请先检查适合本机的更新');
    publish({ phase: 'downloading', percent: 0, message: '正在下载安装包…' });
    operation = Promise.resolve().then(async () => {
      try {
        const progress = value => publish({ percent: Math.max(0, Math.min(100, Number(value.percent) || 0)) });
        if (state.installMode === 'native') {
          nativeUpdater = createNativeUpdater(candidate, progress, error => {
            installing = false; releaseRestart(); failure(error, state.phase === 'downloaded' ? 'downloaded' : 'error');
          });
          await nativeUpdater.download(candidate.version);
        } else {installerCache=currentCacheRoot();installerPath = await downloadInstaller(candidate, installerCache, progress, { signal: downloadAbort.signal });}
        publish({ phase: 'downloaded', percent: 100, message: state.installMode === 'native' ? '下载完成，可在任务结束后重启安装。' : '下载完成。打开安装包后，将 Baton 拖入“应用程序”安装。' });
      } catch (error) { nativeUpdater = null; installerPath = null; failure(error); }
      finally { operation = null; }
      return snapshot();
    });
    return operation;
  }
  async function install() {
    if (!snapshot().canInstall || installing) throw new Error('更新尚未下载完成');
    installing = true;
    let restarting = false;
    try {
      if (state.installMode === 'manual') {
        const targetCache=currentCacheRoot();
        const error = await openInstaller(targetCache===installerCache?installerPath:join(targetCache,basename(installerPath)));
        if (error) throw new Error('无法打开安装包，请前往 Release 下载');
      } else {
        await prepareRestart();
        nativeUpdater.install();
        restarting = true;
        publish({message:'正在重启安装…'});
      }
    } catch (error) { releaseRestart(); failure(error, 'downloaded'); }
    finally { if (!restarting) installing = false; }
    return snapshot();
  }
  /**
   * Switch the update channel. The host saves the choice first, so a failed save
   * changes nothing; the old candidate is dropped and the new channel is checked.
   */
  async function setChannel(value) {
    const next = normalizeUpdateChannel(value), busy = () => state.phase === 'downloading' || installing;
    if (!next) throw new Error('更新渠道无效');
    if (busy()) throw new Error('下载或安装进行中，完成后再切换更新渠道');
    if (next === state.channel) return snapshot();
    if (operation) await operation;
    if (busy()) throw new Error('下载或安装进行中，完成后再切换更新渠道');
    await saveChannel(next);
    candidate = null; installerPath = null; nativeUpdater = null;
    publish({ channel: next, phase: 'idle', version: null, releaseChannel: null, releaseUrl: RELEASE_ROOT, percent: 0, installMode: 'manual', message: idleMessage(next) });
    return check();
  }
  return { snapshot, check, download, install, setChannel, subscribe(listener) { events.on('change', listener); return () => events.off('change', listener); },
    start() { schedule(startupMs); }, stop() { stopped = true; clearTimeout(timer); downloadAbort.abort(); events.removeAllListeners(); } };
}
