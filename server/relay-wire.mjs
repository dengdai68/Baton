import { createHash, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import { request } from 'node:https';

export const routePattern = /^[a-f0-9]{32}$/;
export const routeHost = route => route + '.baton.invalid';
export function publicPin(cert) {
  return createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('hex');
}

export function relayOrigin(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || url.port === '0') throw Error('请输入 Relay 的 HTTPS 地址');
  return url.origin;
}

// Control sockets carry bounded JSON lines. Data sockets carry only inner TLS bytes.
export function readMessages(socket, handle) {
  let pending = '';
  socket.on('data', chunk => {
    pending += chunk;
    try {
      for (;;) {
        const end = pending.indexOf('\n');
        if (end > 65536 || (end < 0 && pending.length > 65536)) throw Error();
        if (end < 0) break;
        const value = JSON.parse(pending.slice(0, end));
        pending = pending.slice(end + 1);
        handle(value);
      }
    } catch { socket.destroy(); }
  });
}
export function sendMessage(socket, value) {
  if (socket.writableLength > 131072) return socket.destroy();
  socket.write(JSON.stringify(value) + '\n');
}

export function openTunnel(origin, authority, options = {}) {
  return new Promise((resolve, reject) => {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    const req = request(origin, {...options, agent:false, method:'CONNECT', path:authority,
      servername:isIP(host) ? '' : host, checkServerIdentity:(_,cert) => checkServerIdentity(host,cert),
      minVersion:'TLSv1.3', headers:{Host:authority}});
    req.setTimeout(12000, () => req.destroy(Error('Relay 连接超时')));
    req.on('error', reject);
    req.on('connect', (res, socket, head) => {
      socket.setTimeout(0);
      socket.on('error', () => socket.destroy());
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(Error('Relay HTTP ' + res.statusCode));
        return;
      }
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.end();
  });
}
