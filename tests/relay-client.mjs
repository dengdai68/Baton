import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:tls';
import { openTunnel, publicPin, routeHost } from '../relay/wire.mjs';

export async function call(url, ca, key, target, path, data, token) {
  const stream = await openTunnel(url,routeHost(target.r)+':443',{ca});
  const phone = connect({...key,socket:stream,rejectUnauthorized:false,minVersion:'TLSv1.3'});
  try {
    await once(phone,'secureConnect');
    assert.equal(publicPin(phone.getPeerCertificate().raw),target.fp);
    const body = Buffer.isBuffer(data) ? data : data ? JSON.stringify(data) : '';
    const type = Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json';
    phone.write((data?'POST':'GET')+' '+path+' HTTP/1.1\r\nHost: '+routeHost(target.r)+'\r\nConnection: close\r\nContent-type: '+type+'\r\nContent-length: '+Buffer.byteLength(body)+'\r\n'+(token?'Authorization: Bearer '+token+'\r\n':'')+'\r\n');
    if (body.length) phone.write(body);
    let result='';
    for await(const chunk of phone) {
      result+=chunk;
      if (path === '/api/workspace/events' && result.includes('data: {"ready":true}\n\n')) break;
    }
    const status = Number(result.match(/^HTTP\/1\.1 (\d+)/)?.[1]);
    const payload = result.match(/\{[^\r\n]*\}/)?.[0];
    return {status,...JSON.parse(payload || '{}')};
  } finally {phone.destroy(); stream.destroy();}
}
