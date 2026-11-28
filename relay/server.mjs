import { createServer } from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { publicPin, readMessages, routePattern, sendMessage } from './wire.mjs';

export function createRelay({cert, key, allow}) {
  const controls = new Map();
  const routes = new Map(), waiting = new Map(), sockets = new Set();
  const server = createServer({cert, key, requestCert:true, rejectUnauthorized:false,
    minVersion:'TLSv1.3', headersTimeout:10000, maxHeaderSize:8192}, (_req, res) => {
    res.writeHead(404).end();
  });
  server.maxConnections = 2048;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const reply = (socket, code) => socket.end('HTTP/1.1 ' + code + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  const ok = socket => socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  server.on('connect', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (head.length) socket.unshift(head);
    const target = req.url.toLowerCase();
    const cert = socket.getPeerCertificate().raw;
    const owner = cert && publicPin(cert);
    if (target === 'control.baton.invalid:443') {
      if (!allow.has(owner)) return reply(socket, '403 Forbidden');
      // A reconnecting Baton replaces its own stale control socket (sleep, network switch).
      for (const [previous, pin] of controls) if (pin === owner) previous.destroy();
      const owned = new Map(), active = new Set();
      const peer = {socket, owner, active};
      controls.set(socket,owner);
      ok(socket);
      socket.setTimeout(75000, () => socket.destroy());
      readMessages(socket, msg => {
        if (msg.ping === true) return sendMessage(socket, {pong:true});
        if (!Array.isArray(msg.routes) || msg.routes.length > 1024) throw Error();
        const next = new Map();
        for (const {id, expires} of msg.routes) {
          if (!routePattern.test(id) || !Number.isSafeInteger(expires) || expires < 0) throw Error();
          const previous = routes.get(id);
          if (previous && previous.peer !== peer && previous.peer.owner !== owner) throw Error();
          next.set(id, {peer, expires});
        }
        for (const id of owned.keys()) if (!next.has(id) && routes.get(id)?.peer === peer) routes.delete(id);
        owned.clear();
        for (const [id, item] of next) { routes.set(id, item); owned.set(id, item); }
        sendMessage(socket, {registered:msg.revision});
      });
      socket.on('close', () => {
        controls.delete(socket);
        for (const id of owned.keys()) if (routes.get(id)?.peer === peer) routes.delete(id);
        for (const s of active) s.destroy();
      });
      return;
    }
    const attach = /^([a-f0-9]{32})\.attach\.invalid:443$/.exec(target);
    if (attach) {
      const client = waiting.get(attach[1]);
      if (!client || !allow.has(owner) || owner !== client.peer.owner) return reply(socket,'403 Forbidden');
      waiting.delete(attach[1]);
      clearTimeout(client.timer);
      if (client.socket.destroyed || routes.get(client.route)?.peer !== client.peer) return reply(socket,'404 Not Found');
      ok(socket); ok(client.socket);
      client.socket.pipe(socket).pipe(client.socket);
      socket.once('close', () => client.socket.destroy());
      client.socket.once('close', () => socket.destroy());
      return;
    }
    const route = /^([a-f0-9]{32})\.baton\.invalid:443$/.exec(target)?.[1];
    const item = routes.get(route);
    if (!item || (item.expires && item.expires <= Date.now())) return reply(socket, '404 Not Found');
    if (item.peer.active.size >= 128 || waiting.size >= 512) return reply(socket, '503 Busy');
    const id = randomBytes(16).toString('hex');
    const timer = setTimeout(() => socket.destroy(), 10000);
    waiting.set(id, {socket, route, peer:item.peer, timer});
    item.peer.active.add(socket);
    socket.once('close', () => { waiting.delete(id); clearTimeout(timer); item.peer.active.delete(socket); });
    sendMessage(item.peer.socket, {open:id, route});
  });
  server.setAllowed = pins => {
    allow = new Set(pins);
    for (const [socket, owner] of controls) if (!allow.has(owner)) socket.destroy();
  };
  server.shutdown = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise(resolve => server.close(resolve));
  };
  return server;
}

// Resolve symlinks (for example /tmp on macOS) so the command line entry is always recognized.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [configFile] = process.argv.slice(2);
  if (!configFile) throw Error('用法: node relay/server.mjs /path/to/relay.json');
  const conf = JSON.parse(readFileSync(configFile));
  if (!Array.isArray(conf.allow) || conf.allow.some(pin => !/^[a-f0-9]{64}$/.test(pin))) throw Error('无效的 Baton 公钥指纹');
  const server = createRelay({key:readFileSync(conf.key), cert:readFileSync(conf.cert), allow:new Set(conf.allow)});
  process.on('SIGHUP', () => {
    try {
      const pins = JSON.parse(readFileSync(configFile)).allow;
      if (!Array.isArray(pins) || pins.some(pin => !/^[a-f0-9]{64}$/.test(pin))) throw Error();
      server.setAllowed(pins);
    } catch { console.error('Relay 接入名单重载失败'); }
  });
  server.listen(conf.port ?? 443, conf.bind ?? '0.0.0.0', () => console.log('Baton Relay listening on port ' + server.address().port));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { void server.shutdown(); });
}
