import assert from 'node:assert/strict';
import test from 'node:test';
import {loginOrigin} from '../src/workspace/link.ts';
test('addresses default to HTTPS and preserve explicit HTTP', () => {
  for(const input of ['mac.local:9443',' https://MAC.local:9443/ ']) assert.equal(loginOrigin(input),'https://mac.local:9443');
  assert.equal(loginOrigin('https://[::1]:9443'),'https://[::1]:9443');
  assert.equal(loginOrigin('http://MAC.local:9080'), 'http://mac.local:9080');
  for(const input of ['','https://user:pw@host','https://host/tasks','https://host?x=1','baton://pair#code','https://host:0']) assert.throws(()=>loginOrigin(input));
});
