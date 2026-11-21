// Run: npm test   (node --test with built-in TypeScript type stripping)
import assert from 'node:assert/strict';
import test from 'node:test';

import { LinkError, parseOrigin, parseWorkspaceInput } from '../src/workspace/link.ts';

const pin = 'a'.repeat(64);
const code = 'K0sjGY8D9drxP29JOwI_WHEpENX9iyPJl_nyr7OrmKM';
const pairing = (origin: string, extra = '') =>
  'baton://pair#' + new URLSearchParams({ origin, pin, code }).toString() + extra;

test('pairing links keep origin, pin and one-time code', () => {
  const parsed = parseWorkspaceInput(pairing('https://192.168.1.8:9443'));
  console.log('pairing ->', JSON.stringify(parsed));
  assert.deepEqual(parsed, {
    address: { origin: 'https://192.168.1.8:9443', host: '192.168.1.8', port: 9443, pin },
    code,
  });
});

test('plain HTTPS addresses use system trust and no code', () => {
  for (const [input, origin] of [
    ['https://Baton.Example.com', 'https://baton.example.com'],
    ['  https://relay.example:8443/ ', 'https://relay.example:8443'],
    ['https://relay.example:443', 'https://relay.example'],
  ]) {
    const parsed = parseWorkspaceInput(input);
    console.log(JSON.stringify(input), '->', parsed.address.origin);
    assert.equal(parsed.address.origin, origin);
    assert.equal(parsed.address.pin, null);
    assert.equal(parsed.code, null);
  }
});

test('unsafe or malformed input is rejected with a readable message', () => {
  for (const input of [
    'http://192.168.1.8:9443',
    'https://user:pw@host',
    'https://host/path',
    'https://host?x=1',
    'https://host:70000',
    'https://..',
    '',
    'baton://pair#origin=https%3A%2F%2Fhost&pin=zz&code=' + code,
    'baton://pair#origin=https%3A%2F%2Fhost&pin=' + pin + '&code=short',
    pairing('http://host:9443'),
    'baton://pair#%E0%A4%A',
  ]) {
    assert.throws(() => parseWorkspaceInput(input), LinkError, JSON.stringify(input));
    console.log('rejected', JSON.stringify(input.slice(0, 48)));
  }
  assert.equal(parseOrigin('https://10.0.0.2:9443').port, 9443);
});
