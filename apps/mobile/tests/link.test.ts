import assert from 'node:assert/strict';
import test from 'node:test';
import {loginOrigin} from '../src/workspace/link.ts';
test('addresses default to HTTPS and preserve explicit HTTP', () => {
  for(const input of ['mac.local:9443',' https://MAC.local:9443/ ']) assert.equal(loginOrigin(input),'https://mac.local:9443');
  assert.equal(loginOrigin('https://[::1]:9443'),'https://[::1]:9443');
  assert.equal(loginOrigin('http://MAC.local:9080'), 'http://mac.local:9080');
  for(const input of ['','https://user:pw@host','https://host/tasks','https://host?x=1','baton://pair#code','https://host:0']) assert.throws(()=>loginOrigin(input));
});

import {relayInvitation} from '../src/workspace/link.ts';
test('pairing links require a version, a single HTTPS relay authority and complete credentials',()=>{
  const q = new URLSearchParams({v:'1',relay:'relay.example:8443',fp:'1'.repeat(64),r:'2'.repeat(32),t:'x'.repeat(43)});
  const link = 'baton://pair?'+q;
  assert.equal(relayInvitation(link).relay,'https://relay.example:8443');
  for (const next of [link+'&v=1',link.replace('v=1','v=2'),link.replace('relay.example','user@relay.example'),link.replace('relay.example','other/path'),link.replace('fp=1','fp=z'),link+'#fragment'])
    assert.throws(()=>relayInvitation(next));
});
