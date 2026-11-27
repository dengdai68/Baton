import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:tls';
import { createHash } from 'node:crypto';
import { createRelay } from '../relay/server.mjs';
import { publicPin, openTunnel, routeHost } from '../relay/wire.mjs';
import { relayAccount, serviceIdentity } from '../server/relay-account.mjs';

function relayFixture(root) {
  const keyFile = join(root,'key.pem'), certFile = join(root,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=localhost',
    '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',keyFile,'-out',certFile],{stdio:'ignore'});
  return {key:readFileSync(keyFile),cert:readFileSync(certFile)};
}
function accountFixture(root, ca, username) {
  mkdirSync(root,{recursive:true});
  return relayAccount({root, tlsOptions:{ca},name:()=>username+' workspace',account:()=>({version:'v1',name:username}),
    async readJson(req) {let value='';for await(const chunk of req) value+=chunk;return JSON.parse(value);},
    sendJson(res,status,payload) {res.writeHead(status,{'content-type':'application/json','connection':'close'});res.end(JSON.stringify(payload));},
    async api(req,res) {
      if (req.url === '/api/runs/run_test/attachments') {
        const hash = createHash('sha256');
        for await (const chunk of req) hash.update(chunk);
        res.end(JSON.stringify({hash:hash.digest('hex')}));
      } else if (req.url === '/api/workspace/events') {
        res.writeHead(200,{'Content-Type':'text/event-stream'});
        res.write('event: ready\ndata: {"ready":true}\n\n');
        // Leave the stream open. The phone must see the event before disconnecting.
      } else res.end(JSON.stringify({user:username}));
    }});

}
async function online(account) {
  for (let i=0; i<150; i++) {
    if (account.settings().registered) return;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error('registration timeout ' + account.settings().error);
}
async function call(url, ca, key, target, path, data, token) {
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
test('two Baton hosts share one relay, credentials and live routes are isolated', {timeout:40000}, async t => {
  const root=mkdtempSync(join(tmpdir(),'baton-relay-test-'));
  const outer=relayFixture(root), a=accountFixture(join(root,'A'),outer.cert,'Alice'), b=accountFixture(join(root,'B'),outer.cert,'Bob');
  const allowed=new Set([a.settings().pin,b.settings().pin]);
  let relay=createRelay({...outer,allow:allowed});
  const start=async port=>{relay.listen(port,'127.0.0.1');await once(relay,'listening');};
  await start(0);
  const port=relay.address().port, url='https://127.0.0.1:'+port;
  t.after(async()=>{a.close();b.close();await relay.shutdown();rmSync(root,{recursive:true,force:true});});
  a.configure(url); b.configure(url);await Promise.all([online(a),online(b)]);
  const d1=serviceIdentity(join(root,'phone1')),d2=serviceIdentity(join(root,'phone2'));
  await assert.rejects(openTunnel(url,'control.baton.invalid:443',{ca:outer.cert,...d1}),/403/);
  const invite=async account=>Object.fromEntries(new URL((await account.invite()).link).searchParams);
  const send=(key,target,path,data,token)=>call(url,outer.cert,key,target,path,data,token);
  const expired=await invite(a);
  const access=new DatabaseSync(join(root,'A','relay-access.sqlite'));
  try {access.prepare('UPDATE invitations SET expires=0 WHERE id=?').run(expired.r);} finally {access.close();}
  // The Mac rechecks the deadline even when the Relay still knows the route.
  const denied=await Promise.allSettled([send(d1,expired,'/relay/redeem',{t:expired.t})]);
  assert.ok(denied[0].status==='rejected' || denied[0].value.status===410);
  assert.equal(a.settings().devices.length,0);
  const link=await invite(a);
  await assert.rejects(send(d1,{...link,fp:'wrong'},'/relay/redeem',{t:link.t}));
  const bad=await send(d1,link,'/relay/redeem',{t:'forged'});
  assert.equal(bad.status,410);
  const compete=await Promise.allSettled([d1,d2].map(key=>send(key,link,'/relay/redeem',{t:link.t})));
  const winners=compete.flatMap((x,i)=>x.status==='fulfilled' && x.value.status===200 ? [i] : []);
  assert.equal(winners.length,1);
  const first=compete[winners[0]].value, key=[d1,d2][winners[0]], other=[d2,d1][winners[0]];
  await online(a);
  await assert.rejects(send(key,link,'/relay/redeem',{t:link.t}),/404/);
  const channel={r:first.channel,fp:link.fp};
  assert.equal((await send(key,channel,'/api/tasks',null,first.token)).user,'Alice');
  const upload = Buffer.alloc(20*1024*1024,0xa5);
  const received = await send(key,channel,'/api/runs/run_test/attachments',upload,first.token);
  assert.equal(received.hash,createHash('sha256').update(upload).digest('hex'));
  assert.equal((await send(key,channel,'/api/workspace/events',null,first.token)).ready,true);
  assert.equal((await send(other,channel,'/api/tasks',null,first.token)).status,401);
  const second=await invite(a), two=await send(other,second,'/relay/redeem',{t:second.t});
  const third=await invite(b), bob=await send(key,third,'/relay/redeem',{t:third.t});
  await Promise.all([online(a),online(b)]);
  a.revoke(first.channel);await online(a);
  await assert.rejects(send(key,channel,'/relay/session',{}),/404/);
  const alive={r:two.channel,fp:second.fp}, separate={r:bob.channel,fp:third.fp};
  assert.equal((await send(other,alive,'/api/tasks',null,two.token)).user,'Alice');
  assert.equal((await send(key,separate,'/api/tasks',null,bob.token)).user,'Bob');
  await relay.shutdown();
  relay=createRelay({...outer,allow:allowed});await start(port);
  await new Promise(resolve=>setTimeout(resolve,100));
  await Promise.all([online(a),online(b)]);
  assert.equal((await send(other,alive,'/relay/session',{})).user,'Alice');
  a.configure('');
  assert.equal((await send(key,separate,'/relay/session',{})).user,'Bob');
  relay.setAllowed([]);
  for (let i=0;i<50 && b.settings().online;i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(b.settings().online,false);
  await assert.rejects(send(key,separate,'/relay/session',{}),/404/);
});
