// Parse what a user scans or pastes: a one-time pairing link from the Mac
// (baton://pair#origin=…&pin=…&code=…) or a plain HTTPS workspace address.
// Pure functions (no React Native APIs) so tests run under node --test.

export type WorkspaceAddress = {
  /** Normalized origin, e.g. https://192.168.1.8:9443 (default port omitted). */
  origin: string;
  host: string;
  port: number;
  /** Lower-case hex SHA-256 of the paired certificate; null means system trust. */
  pin: string | null;
};
export type ParsedInput = { address: WorkspaceAddress; code: string | null };

export class LinkError extends Error {}

const ORIGIN = /^https:\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/?$/i;
const PIN = /^[a-f0-9]{64}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;

/** Normalize an https origin; reject credentials, paths, queries and fragments. */
export function parseOrigin(value: string): Omit<WorkspaceAddress, 'pin'> {
  const match = ORIGIN.exec(value.trim());
  if (!match) throw new LinkError('请输入有效的 HTTPS 地址或 Baton 配对链接。');
  const host = match[1].toLowerCase();
  const port = match[2] ? Number(match[2]) : 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host.startsWith('.') || host.endsWith('.') || host.includes('..'))
    throw new LinkError('请输入有效的 HTTPS 地址或 Baton 配对链接。');
  return { origin: 'https://' + host + (port === 443 ? '' : ':' + port), host, port };
}

/** Decode application/x-www-form-urlencoded pairs (as written by URLSearchParams). */
function formFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of text.split('&')) {
    if (!part) continue;
    const index = part.indexOf('=');
    const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, ' '));
    try {
      fields.set(decode(index < 0 ? part : part.slice(0, index)), index < 0 ? '' : decode(part.slice(index + 1)));
    } catch {
      throw new LinkError('配对链接已损坏，请在 Mac 上重新生成。');
    }
  }
  return fields;
}

/** Read a pairing link or an HTTPS address. */
export function parseWorkspaceInput(input: string): ParsedInput {
  const text = input.trim();
  if (/^baton:\/\/pair/i.test(text)) {
    const hash = text.indexOf('#');
    const fields = formFields(hash < 0 ? '' : text.slice(hash + 1));
    const origin = fields.get('origin') || '';
    const pin = (fields.get('pin') || '').toLowerCase();
    const code = fields.get('code') || '';
    if (!PIN.test(pin) || !CODE.test(code)) throw new LinkError('配对链接已损坏，请在 Mac 上重新生成。');
    return { address: { ...parseOrigin(origin), pin }, code };
  }
  return { address: { ...parseOrigin(text), pin: null }, code: null };
}
