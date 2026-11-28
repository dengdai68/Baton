// Isolated Electron acceptance for remote access inside Settings → 工作空间, with a
// local Relay and a protocol-level phone (tests/relay-client.mjs). Never touches the
// installed instance, ~/.baton or port 9443: the LAN form is rendered, never enabled.
// Usage: node scripts/test-remote-access.mjs
//   BATON_LOCALE=en      run the same flow with the English catalog
//   BATON_REMOTE_KEEP=1  keep the run directory (screenshots, logs) for inspection
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeStorageLocation } from '../server/storage-layout.mjs';
import { desktopStoragePaths } from '../apps/electron/runtime-paths.mjs';
import { createAuth } from '../server/auth.mjs';
import { createRelay } from '../relay/server.mjs';
import { serviceIdentity } from '../server/relay-account.mjs';
import { call } from '../tests/relay-client.mjs';

const english = process.env.BATON_LOCALE === 'en';
const t = (zh, en) => (english ? en : zh);
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...parts) => console.log(stamp(), ...parts);

await mkdir('.data', { recursive: true });
const root = await mkdtemp(resolve('.data/remote-access-')), home = join(root, 'home'), data = join(root, 'client');
const shots = join(root, 'screenshots'), password = randomBytes(20).toString('hex');
for (const directory of [home, join(home, '.baton'), data, shots, join(root, 'work')]) await mkdir(directory, { recursive: true, mode: 0o700 });
const auth = createAuth({ databasePath: join(data, 'auth.sqlite') }); await auth.setAdministrator('remote-qa', password); auth.close();
await writeStorageLocation(data, { version: 1, workspaceRoot: join(root, 'work'), previousRuntimeRoots: [] });
// A saved locator must point at an existing instance directory (source runs use the desktop-dev instance).
await mkdir(desktopStoragePaths(data, { controlRoot: data, home, workspaceRoot: join(root, 'work'), instance: 'desktop-dev' }).dataRoot, { recursive: true, mode: 0o700 });

// Local Relay with a self-signed certificate; the isolated server trusts it via NODE_EXTRA_CA_CERTS.
const relayKey = join(root, 'relay-key.pem'), relayCert = join(root, 'relay-cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost',
  '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', relayKey, '-out', relayCert], { stdio: 'ignore' });
const outer = { key: readFileSync(relayKey), cert: readFileSync(relayCert) };
const relay = createRelay({ ...outer, allow: new Set() });
relay.listen(0, '127.0.0.1'); await once(relay, 'listening');
const relayUrl = 'https://127.0.0.1:' + relay.address().port;
const phoneKey = serviceIdentity(join(root, 'phone'));
// The desktop starts its service from the login-shell environment, so trust the test Relay there.
for (const profile of ['.zprofile', '.zshrc']) await writeFile(join(home, profile), `export NODE_EXTRA_CA_CERTS='${relayCert}'\n`, { mode: 0o600 });
log('isolated root', root, '| relay', relayUrl, '| locale', english ? 'en' : 'zh-CN');

const app = await electron.launch({ args: ['apps/electron/main.mjs'], timeout: 90000, env: { ...process.env, HOME: home,
  BATON_DESKTOP_DATA_ROOT: data, BATON_LOG_DIR: join(root, 'logs'), NODE_EXTRA_CA_CERTS: relayCert, ...(english ? { BATON_LOCALE: 'en' } : {}) } });
const errors = [], cases = [];
const poll = async (label, check, timeout = 45000) => {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) { log('ok', label, `(${((Date.now() - started) / 1000).toFixed(1)}s)`); return value; }
    if (Date.now() - started > timeout) throw Error('Timed out: ' + label);
    await new Promise((done) => setTimeout(done, 500));
  }
};
try {
  const page = await app.firstWindow({ timeout: 90000 }); page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:/, { timeout: 60000 }); const origin = new URL(page.url()).origin;
  const api = (path) => page.evaluate(async (path) => (await fetch(path, { cache: 'no-store' })).json(), path);
  const resize = async (width) => {
    await app.evaluate(({ BrowserWindow }, { origin, width }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith(origin)).setContentSize(width, 900), { origin, width });
    await page.waitForFunction((width) => innerWidth === width, width);
  };
  await page.goto(origin + '/login');
  await page.locator('#username').fill('remote-qa'); await page.locator('#password').fill(password);
  await page.getByRole('button', { name: t('登录', 'Sign in'), exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await resize(1320);

  const section = page.locator('[data-remote-access]'), pill = section.locator('[data-relay-pill]');
  const statusText = () => pill.textContent();
  await page.goto(origin + '/settings/workspaces');
  await section.waitFor({ state: 'visible' });
  await poll('initial status is unset', async () => (await statusText()).includes(t('未设置', 'Not set')));
  assert.equal(await page.locator('a[href="/phone/index.html"]').count(), 0, 'no link to the removed standalone page');
  assert.ok(await section.locator('[data-add-phone]').isDisabled(), 'Add Phone waits for a connected Relay');
  assert.match(await section.locator('[data-relay-devices]').textContent(), new RegExp(t('尚无配对手机', 'No paired phones yet')));
  const directForm = section.locator('[data-direct-form]');
  await directForm.waitFor();
  assert.ok((await directForm.locator('input[name="origin"]').inputValue()).startsWith('http://'), 'LAN form suggests an address');
  await page.screenshot({ path: join(shots, '1-unset.png'), fullPage: true });
  // Element screenshots scroll the inner settings container, so lower panels are captured in full.
  await section.screenshot({ path: join(shots, '1-unset-section.png') });
  cases.push('unset: inline section, no standalone link, Add Phone disabled, empty device list, LAN form (not enabled)');

  await section.locator('#relay-origin').fill(relayUrl);
  await section.locator('[data-relay-form] button[type="submit"]').click();
  await poll('Relay rejects an unlisted Mac', async () => (await statusText()).includes(t('未获准接入', 'Not allowed')), 60000);
  const pin = (await section.locator('[data-relay-pin]').textContent()).trim();
  assert.match(pin, /^[a-f0-9]{64}$/, 'the Mac access fingerprint is shown in full');
  assert.equal(pin, (await api('/api/account/relay')).pin);
  await page.screenshot({ path: join(shots, '2-not-allowed.png'), fullPage: true });
  cases.push('403: red "not allowed" with the full, copyable Mac access fingerprint');

  relay.setAllowed([pin]);
  await poll('Relay connected after allow-listing', async () => (await statusText()).includes(t('已连接', 'Connected')), 60000);
  await poll('Add Phone enabled', async () => !(await section.locator('[data-add-phone]').isDisabled()));
  cases.push('allow-listed: green "connected", Add Phone enabled');

  await section.locator('[data-add-phone]').first().click();
  const qr = section.locator('.phone-pairing-qr');
  await poll('QR image decoded', () => qr.evaluate((img) => img.complete && img.naturalWidth > 0));
  const link = await section.locator('[data-invitation-link]').inputValue();
  assert.match(link, /^baton:\/\/pair\?/);
  assert.match(await section.locator('[data-invitation-countdown]').textContent(), /\b(10:00|9:5\d)\b/);
  assert.ok(await section.locator('[data-add-phone]').first().isDisabled(), 'one live invitation at a time');
  await section.locator('[data-cancel-invitation]').click();
  // Themes switch through the real Appearance setting; each theme gets a fresh invitation.
  for (const theme of ['light', 'dark']) {
    await page.goto(origin + '/settings/appearance'); await page.locator(`[name="theme"][value="${theme}"]`).check();
    await page.goto(origin + '/settings/workspaces'); await section.waitFor({ state: 'visible' });
    await poll(`connected (${theme})`, async () => (await statusText()).includes(t('已连接', 'Connected')));
    await section.locator('[data-add-phone]').first().click(); await qr.waitFor();
    for (const width of [1320, 760]) {
      await resize(width);
      const overflow = await page.evaluate(() => { const content = document.querySelector('.settings-content'); return content.scrollWidth - content.clientWidth; });
      assert.ok(overflow <= 1, `no horizontal overflow at ${width}px ${theme} (${overflow}px)`);
      await page.screenshot({ path: join(shots, `3-invitation-${theme}-${width}.png`), fullPage: true });
      await section.screenshot({ path: join(shots, `3-invitation-${theme}-${width}-section.png`) });
    }
    await resize(1320);
    if (theme === 'light') await section.locator('[data-cancel-invitation]').click();
  }
  const liveLink = await section.locator('[data-invitation-link]').inputValue();
  cases.push('invitation: QR decoded (data: image allowed), baton://pair link, 10:00 countdown; 1320/760 × light/dark without horizontal overflow');

  const target = Object.fromEntries(new URL(liveLink).searchParams);
  const redeemed = await call(relayUrl, outer.cert, phoneKey, target, '/relay/redeem', { t: target.t, device: 'QA Pixel' });
  log('phone redeem ->', redeemed.status, redeemed.token ? 'token issued' : '(no token)');
  assert.equal(redeemed.status, 200);
  await poll('page reports the paired phone', async () => (await section.locator('[data-phone-pairing]').textContent()).includes('QA Pixel'), 15000);
  assert.match(await section.locator('[data-relay-devices]').textContent(), /QA Pixel/);
  await section.screenshot({ path: join(shots, '4-paired-section.png') });
  cases.push('phone redeemed through the Relay: "Added QA Pixel" with "Not me, remove"; device listed');

  await section.locator('[data-phone-pairing] [data-remove-device]').click();
  await page.locator('[data-confirm-dialog-accept]').waitFor();
  await page.screenshot({ path: join(shots, '5-confirm-remove.png') });
  await page.locator('[data-confirm-dialog-accept]').click();
  await poll('device removed', async () => (await api('/api/account/relay')).devices.length === 0);
  await poll('list shows no phones', async () => (await section.locator('[data-relay-devices]').textContent()).includes(t('尚无配对手机', 'No paired phones yet')));
  assert.ok(await section.locator('[data-phone-pairing]').isHidden(), 'the outcome panel closes after removing the phone');
  cases.push('"Not me, remove": confirmation dialog, then the phone disappears from the Relay and the page');

  await section.locator('[data-add-phone]').first().click();
  await qr.waitFor();
  await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 11 * 60 * 1000; });
  await poll('invitation expires on the page', async () => (await section.locator('[data-phone-pairing]').textContent()).includes(t('配对地址已过期', 'The pairing link expired')), 10000);
  assert.equal(await section.locator('[data-phone-pairing] [data-add-phone]').count(), 1, 'expired panel offers Regenerate');
  await section.locator('[data-phone-pairing]').screenshot({ path: join(shots, '6-expired-panel.png') });
  await page.evaluate(() => location.reload());
  await section.waitFor({ state: 'visible' });
  await poll('connected again after reload', async () => (await statusText()).includes(t('已连接', 'Connected')));
  await section.locator('[data-add-phone]').first().click(); await qr.waitFor();
  await section.locator('[data-cancel-invitation]').click();
  assert.ok(await section.locator('[data-phone-pairing]').isHidden(), 'cancel hides the invitation');
  cases.push('expiry shows Regenerate; cancel hides a live invitation');

  // In-app navigation keeps the settings UI mounted, so this proves hide() stops polling.
  let relayRequests = 0;
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/account/relay')) relayRequests++; });
  await page.locator('[data-settings-page="general"]').click();
  await new Promise((done) => setTimeout(done, 17000));
  log('relay requests during 17s on General:', relayRequests);
  assert.equal(relayRequests, 0, 'no Relay polling outside Workspaces');
  await page.locator('[data-settings-page="workspaces"]').click();
  await poll('polling resumes on Workspaces', async () => relayRequests > 0, 5000);
  cases.push('in-app navigation: no Relay requests for 17s on General, polling resumes on Workspaces');
  if (errors.length) throw Error('page errors: ' + errors.join(' | '));
  log('PASS', cases.length, 'cases');
  for (const item of cases) log(' -', item);
  log('screenshots', shots);
} catch (error) {
  // Failure evidence: page errors, the workspace panel text and a screenshot.
  const page = app.windows()[0];
  log('FAIL', error.message.split('\n')[0]);
  log('page errors:', errors.length ? errors.join(' | ') : '(none)');
  if (page) {
    log('current workspace panel:', await page.locator('[data-current-workspace]').textContent().catch(() => '(unavailable)'));
    await page.screenshot({ path: join(shots, 'failure.png'), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  await relay.shutdown();
  if (process.env.BATON_REMOTE_KEEP !== '1') await rm(root, { recursive: true, force: true });
}
