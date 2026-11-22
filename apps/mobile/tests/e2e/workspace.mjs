#!/usr/bin/env node
// Isolated workspace for phone UI acceptance (iOS and Android). Everything lives in a new
// private temp root that is deleted on exit: HOME, the administrator account, the self-signed
// certificate and the business records. Never reads or changes the operator's instance.
//
// Usage (from the repository root):
//   node apps/mobile/tests/e2e/workspace.mjs [--port 9543] [--http]
// Prints the workspace address, account and certificate fingerprint, then serves until Ctrl-C.
// Android devices reach the Mac's loopback through `adb reverse tcp:9543 tcp:9543`.
//
// Fixture: catalog employees, a paused task with image/file attachments, a task awaiting
// acceptance, an archived task, a direct chat with images, a group chat and an automation.
// Employees use the Codex runtime, whose CLI and credentials only exist under the operator's
// real HOME, so sending a message fails fast offline (failure + retry UI) and never reaches a model.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { request } from 'node:https';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { createAuth } from '../../../../server/auth.mjs';
import { createRunFiles } from '../../../../server/run-files.mjs';
import { provisionWorkspace } from '../../../../server/workspace-config.mjs';
import { createCatalogFixtureStore } from '../../../../tests/fixture-store.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_PORT = 9543;
const READY_TIMEOUT_MS = 90_000;
const USERNAME = 'e2e';
const OFFLINE_RUNTIME = { provider: 'codex' };
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

function option(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}
const port = Number(option('--port') || DEFAULT_PORT);
const plain = process.argv.includes('--http');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be 1024–65535');

/** Solid PNG of a given size (inline preview and full-screen viewer fixtures). */
const raster = (width, height, background) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

/** Seed the business records through Store commands (no Provider is called). */
async function seed(root) {
  const work = join(root, 'workspace');
  const store = createCatalogFixtureStore({ databasePath: join(work, 'records', 'baton.sqlite'), configurationDirectory: root, workspaceRoot: work });
  const files = createRunFiles({ root: join(work, 'records'), communicationsRoot: join(work, 'communications') });
  try {
    for (const agent of store.listAgents()) store.updateAgent(agent.id, { runtime: OFFLINE_RUNTIME });
    const images = [['横图.png', await raster(1200, 600, '#3980b5')], ['竖图.png', await raster(240, 1200, '#2f9e6b')]];
    const document = ['交接说明.txt', Buffer.from('原始文件下载字节保持。\n')];

    const chat = store.openCommunication({ kind: 'agent', targetId: 'agent_analyst' });
    const chatFiles = [];
    for (const [name, bytes] of [...images, document]) chatFiles.push(store.registerCommunicationAttachment(chat.id, await files.writeCommunicationAttachment(chat.id, name, bytes)));
    store.sendCommunication(chat.id, { content: '请看这两张图和说明文件。', attachmentIds: chatFiles.map((item) => item.id), clientRequestId: 'e2e-chat' });
    store.completeCommunication(chat.id, store.claimCommunication(chat.id).id, '已收到：图片直接展示，文件保持下载卡片。');
    const group = store.openCommunication({ kind: 'group', name: '产品交付群', memberAgentIds: ['agent_analyst', 'agent_designer'] });

    const members = ['system_project_manager'];
    const paused = store.createTask({ managerAgentId: 'system_project_manager', title: '图片与附件展示验证', objective: '只检查手机端呈现，不执行模型。', memberAgentIds: members });
    const pausedRun = store.createRun(paused.id);
    const runFiles = [];
    for (const [name, bytes] of [...images, document]) runFiles.push(store.registerRunAttachment(pausedRun.id, await files.writeRunAttachment(pausedRun.id, name, bytes)));
    store.addMessage({ runId: pausedRun.id, content: '任务图片与附件。', attachmentIds: runFiles.map((item) => item.id) });
    store.pauseRun(pausedRun.id);

    const review = store.createTask({ managerAgentId: 'system_project_manager', title: '待验收示例任务', objective: '经理已提交人类验收，等待确认完成。', acceptanceCriteria: ['交付说明完整'], memberAgentIds: members });
    store.requestHumanAcceptance(store.createRun(review.id).id);

    const archived = store.createTask({ managerAgentId: 'system_project_manager', title: '已归档示例任务', objective: '完成后归档，可恢复或删除。', memberAgentIds: members });
    const archivedRun = store.createRun(archived.id);
    store.requestHumanAcceptance(archivedRun.id);
    store.confirmRunCompletion(archivedRun.id);
    store.archiveTask(archived.id);

    const automation = store.saveAutomation({ managerAgentId: 'system_project_manager', title: '素材整理', objective: '保留自动化描述和触发记录回归。', memberAgentIds: members, cron: '0 9 * * 1-5', enabled: true });
    store.requestHumanAcceptance(store.triggerAutomation(automation.id).runId);
    return { chat: chat.id, group: group.id, tasks: [paused.id, review.id, archived.id], automation: automation.id };
  } finally {
    store.close();
  }
}

/** Poll /healthz until the gateway reports ready (self-signed certificate accepted here only). */
function health(origin) {
  return new Promise((done) => {
    const handle = (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { done(JSON.parse(body).status === 'ready'); } catch { done(false); }
      });
    };
    const call = origin.startsWith('https:') ? request(origin + '/healthz', { rejectUnauthorized: false }, handle) : httpGet(origin + '/healthz', handle);
    call.on('error', () => done(false));
    call.setTimeout(3000, () => { call.destroy(); done(false); });
    if (origin.startsWith('https:')) call.end();
  });
}

const root = await mkdtemp(join(tmpdir(), 'baton-mobile-e2e-'));
let child = null;
let cleaned = false;
function cleanup(code) {
  if (cleaned) return;
  cleaned = true;
  if (child && child.exitCode === null) child.kill('SIGTERM');
  rmSync(root, { recursive: true, force: true });
  log('removed', root);
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cleanup(0));

try {
  const origin = (plain ? 'http' : 'https') + '://127.0.0.1:' + port;
  log('root', root);
  const config = provisionWorkspace(root, { mode: 'local', origin, port, bind: '127.0.0.1' });
  const password = randomBytes(12).toString('hex');
  const auth = createAuth({ databasePath: join(root, 'auth.sqlite'), origins: [] });
  await auth.setAdministrator(USERNAME, password);
  auth.close();
  const seeded = await seed(root);
  log('seeded', JSON.stringify(seeded));
  const home = join(root, 'home');
  await mkdir(home, { mode: 0o700 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BATON_')));
  child = spawn(process.execPath, [join(repoRoot, 'server/workspace-admin.mjs'), 'serve', root], {
    cwd: repoRoot, env: { ...env, HOME: home, BATON_LOG_DIR: join(root, 'logs') }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => { log('gateway exited', code ?? signal); cleanup(code ?? 1); });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!(await health(origin))) {
    if (Date.now() > deadline) throw new Error('workspace gateway did not become ready within ' + READY_TIMEOUT_MS / 1000 + 's');
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  const fingerprint = config.cert
    ? createHash('sha256').update(Buffer.from(readFileSync(config.cert, 'utf8').replace(/-----[^-]+-----|\s/g, ''), 'base64')).digest('hex')
    : null;
  log('READY');
  console.log(JSON.stringify({ address: origin, username: USERNAME, password, fingerprint, root }));
} catch (error) {
  console.error(error);
  cleanup(1);
}
