export function loginOrigin(input: string): string {
  const value = input.trim();
  const invalid = () => new Error('请输入有效的工作空间地址');
  if (!value) throw invalid();
  const url = new URL(value.includes('://') ? value : 'https://' + value);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.hostname.includes('..') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0') throw invalid();
  return url.origin;
}

export function relayInvitation(input: string) {
  const invalid = () => new Error('配对地址无效');
  if (input.length > 2048) throw invalid();
  const link = new URL(input.trim());
  if (link.protocol !== 'baton:' || link.hostname !== 'pair' || link.username || link.password || link.port || link.pathname || link.hash) throw invalid();
  const params = link.searchParams;
  const fields = ['v','relay','fp','r','t'];
  if ([...params.keys()].length !== fields.length || fields.some(field => params.getAll(field).length !== 1) || params.get('v') !== '1') throw invalid();
  const host = params.get('relay')!, route = params.get('r')!, pin = params.get('fp')!, token = params.get('t')!;
  if (!/^[a-z0-9.\-\[\]:]+$/i.test(host) || !/^[a-f0-9]{32}$/.test(route) || !/^[a-f0-9]{64}$/.test(pin) || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw invalid();
  return {relay:loginOrigin('https://' + host), route, pin, token};
}

// Keep the single-use credential out of navigation history and persisted route parameters.
let pending = '';
const listeners = new Set<() => void>();
export function onPairingLink(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setPairingLink(value: string) {
  pending = value;
  for (const listener of listeners) listener();
}
export function takePairingLink() { const value = pending; pending = ''; return value; }
