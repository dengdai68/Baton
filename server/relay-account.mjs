import { createServer } from 'node:https';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { connectRelay } from './relay-connector.mjs';
import { publicPin, relayOrigin } from '../relay/wire.mjs';
import { deviceApiAllowed } from './workspace-http.mjs';

const id = () => randomBytes(16).toString('hex');
const digest = text => createHash('sha256').update(text).digest();
const inviteLifetime = 600000, sessionLifetime = 900000;

export function serviceIdentity(root) {
  const dir = join(root, 'relay-identity');
  if (!existsSync(dir)) {
    mkdirSync(root, {recursive:true, mode:0o700});
    const temp = mkdtempSync(join(root, '.relay-key-'));
    try {
      execFileSync('openssl', ['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes',
        '-subj','/CN=Baton','-days','3650','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem')], {stdio:'ignore',timeout:15000});
      chmodSync(join(temp,'key.pem'), 0o600);
      renameSync(temp, dir);
    } catch (error) { if (!existsSync(dir)) throw error; }
    finally { rmSync(temp, {recursive:true, force:true}); }
  }
  return {key:readFileSync(join(dir,'key.pem')), cert:readFileSync(join(dir,'cert.pem'))};
}

export function relayAccount({root, account, api, readJson, sendJson, name, tlsOptions}) {
  const path = join(root, 'relay-access.sqlite');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS settings(account TEXT PRIMARY KEY, origin TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY, owner TEXT NOT NULL, hash BLOB NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY, owner TEXT NOT NULL, device TEXT NOT NULL, label TEXT NOT NULL, created INTEGER NOT NULL, invitation TEXT NOT NULL, lastSeen INTEGER NOT NULL);`);
  const identity = serviceIdentity(root), pin = publicPin(identity.cert);
  let connector, connectedOrigin;
  const sessions = new Map(), streams = new Map();
  const owner = () => account()?.version;
  const origin = () => db.prepare('SELECT origin FROM settings WHERE account=?').get(owner() || '')?.origin;
  const activeRoutes = () => {
    db.prepare('DELETE FROM invitations WHERE expires<=?').run(Date.now());
    db.prepare('DELETE FROM channels WHERE lastSeen<=?').run(Date.now()-30*86400000);
    return db.prepare(`SELECT id,expires FROM invitations WHERE owner=? UNION ALL SELECT id,0 AS expires FROM channels WHERE owner=?`).all(owner() || '',owner() || '');
  };
  function connect() {
    const url = origin();
    if (url === connectedOrigin && connector) return;
    connector?.close(); connector = null; connectedOrigin = url;
    if (url) connector = connectRelay(url, {...identity, ...tlsOptions}, activeRoutes, accept);
  }
  function settings() {
    connect();
    return {origin:origin() || '', pin, online:connector?.online || false, registered:connector?.ready || false, error:connector?.error || null,
      devices:db.prepare('SELECT id,label,created,invitation,lastSeen FROM channels WHERE owner=? ORDER BY created DESC').all(owner() || '')};
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function configure(input) {
    if (typeof input !== 'string') throw Error('请输入 Relay 的 HTTPS 地址');
    const url = input ? relayOrigin(input) : '';
    if (!owner()) throw Error('请先登录');
    if (url !== (origin() || '')) {
      transaction(() => {
        for (const table of ['invitations','channels','settings']) db.prepare('DELETE FROM ' + table + ' WHERE ' + (table === 'settings' ? 'account' : 'owner') + '=?').run(owner());
        if (url) db.prepare('INSERT INTO settings VALUES (?,?)').run(owner(), url);
      });
      sessions.clear(); connect();
    }
    return settings();
  }
  async function invite() {
    if (!connector?.ready || !origin()) throw Error('Relay 尚未连接，请检查接入名单和地址');
    if (activeRoutes().length >= 1024) throw Error('通道和邀请数量已达上限');
    const route = id(), token = randomBytes(32).toString('base64url'), expires = Date.now() + inviteLifetime;
    db.prepare('INSERT INTO invitations (id,owner,hash,expires) VALUES (?,?,?,?)').run(route, owner(), digest(token), expires);
    connector.sync();
    // Return a usable address only after the Relay has acknowledged its route.
    for (let i=0; i<100 && !connector?.ready; i++) await new Promise(resolve => setTimeout(resolve,50));
    if (!connector?.ready) throw Error('Relay 登记邀请超时，请重试');
    const link = new URL('baton://pair');
    link.search = new URLSearchParams({v:'1', relay:new URL(origin()).host, r:route, fp:pin, t:token}).toString();
    return {link:link.href, expires};
  }
  function revoke(route) {
    db.prepare('DELETE FROM channels WHERE id=? AND owner=?').run(route, owner() || '');
    sessions.delete(route);
    for (const stream of streams.get(route) || []) stream.destroy();
    connector?.sync();
  }
  function session(route) {
    const token = randomBytes(32).toString('base64url');
    sessions.set(route, {hash:digest(token), expires:Date.now() + sessionLifetime});
    return {channel:route, token, workspace:name(), mode:'local', user:account().name};
  }
  function accept(route, stream) {
    const open = streams.get(route) || new Set();
    open.add(stream); streams.set(route, open);
    stream.once('close', () => {open.delete(stream); if (!open.size) streams.delete(route);});
    const inner = createServer({...identity, minVersion:'TLSv1.3', requestCert:true, rejectUnauthorized:false,
      handshakeTimeout:10000, requestTimeout:300000}, async (req,res) => {
      res.setHeader('Cache-Control','no-store');
      const reject = (status, error) => sendJson(res,status,{error});
      try {
        const cert = req.socket.getPeerCertificate().raw;
        if (!cert || !owner() || origin() !== connectedOrigin) return reject(401,'请重新配对');
        const device = publicPin(cert);
        const url = new URL(req.url,'https://baton.invalid');
        if (url.pathname === '/relay/redeem' && req.method === 'POST') {
          const data = await readJson(req,4096);
          const channel = id();
          const paired = transaction(() => {
            const invite = db.prepare('SELECT * FROM invitations WHERE id=? AND owner=? AND expires>?').get(route,owner(),Date.now());
            if (!invite) return false;
            if (typeof data.t !== 'string' || !timingSafeEqual(invite.hash,digest(data.t))) {
              if (invite.attempts >= 4) db.prepare('DELETE FROM invitations WHERE id=?').run(route);
              else db.prepare('UPDATE invitations SET attempts=attempts+1 WHERE id=?').run(route);
              return false;
            }
            db.prepare('DELETE FROM invitations WHERE id=?').run(route);
            const label = String(data.device || 'Baton Mobile').replace(/[\x00-\x1f\x7f]/g,'').slice(0,60);
            db.prepare('INSERT INTO channels VALUES (?,?,?,?,?,?,?)').run(channel,owner(),device,label,Date.now(),route,Date.now());
            return true;
          });
          if (!paired) return reject(410,'配对链接无效、已使用或已过期');
          connector.sync();
          return sendJson(res,200,session(channel));
        }
        const row = db.prepare('SELECT device,lastSeen FROM channels WHERE id=? AND owner=?').get(route, owner());
        if (!row || row.device !== device || row.lastSeen <= Date.now()-30*86400000) return reject(401,'设备未获授权或已撤销');
        if (Date.now()-row.lastSeen > 60000) db.prepare('UPDATE channels SET lastSeen=? WHERE id=?').run(Date.now(),route);
        if (req.method === 'POST' && url.pathname === '/relay/session') return sendJson(res,200,session(route));
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization)?.[1];
        const valid = () => {
          const record = sessions.get(route);
          return token && record && record.expires > Date.now() && timingSafeEqual(record.hash,digest(token)) &&
            db.prepare('SELECT 1 FROM channels WHERE id=? AND owner=?').get(route,owner() || '');
        };
        if (!valid()) return reject(401,'请重新登录');
        if (url.pathname === '/logout' && req.method === 'POST') {
          res.once('finish', () => revoke(route));
          return sendJson(res,200,{ok:true});
        }
        if (req.method === 'GET' && url.pathname === '/api/settings/current-workspace')
          return sendJson(res,200,{name:name(),origin:origin(),username:account().name,deviceId:route,local:false});
        if (!['GET','HEAD','POST','PATCH','DELETE','PUT'].includes(req.method) || !deviceApiAllowed(req.method,url.pathname,'mobile'))
          return reject(403,'此操作仅可在 Mac 上进行');
        await api(req,res,url,{remote:true,sessionValid:valid});
      } catch { if (!res.headersSent) reject(400,'请求处理失败'); else res.destroy(); }
    });
    inner.emit('connection',stream);
  }
  connect();
  return {settings, configure, invite, revoke, close() {connector?.close(); db.close();}};
}
