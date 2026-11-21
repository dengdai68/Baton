// HTTPS client for one paired workspace. Every request goes through the native
// certificate-pinned transport with the device's bearer token; the server is the
// same desktop API the Mac client uses (/api/*), reached through the workspace gateway.
import Transport, { type StreamEnd, type StreamEvent, type TransportRequest } from 'baton-transport';

import { $t, $tm } from '@/i18n';

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type ClientOptions = {
  origin: string;
  pin: string | null;
  token: string;
  /** Called once per 401: the device was revoked or the token expired. */
  onUnauthorized?: () => void;
};
export type Query = Record<string, string | number | boolean | null | undefined>;
type StreamHandlers = { onEvent: (event: string, data: string) => void; onEnd?: (error: ApiError | null) => void };

/** Map transport failures ("CODE: detail") to readable, translated errors. */
export function transportError(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PIN_MISMATCH'))
    return new ApiError($t('工作空间证书已变化，请在 Mac 上重新生成配对码后再连接。'), 0, 'PIN_MISMATCH');
  if (message.includes('NETWORK'))
    return new ApiError($t('无法连接工作空间：{0}', [message.replace(/^.*NETWORK:\s*/, '')]), 0, 'NETWORK');
  return new ApiError(message, 0, 'TRANSPORT');
}

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const pairs = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  return pairs.length ? path + (path.includes('?') ? '&' : '?') + pairs.join('&') : path;
}

let streamCounter = 0;
const streams = new Map<string, StreamHandlers>();
let subscribed = false;
function subscribeStreams() {
  if (subscribed) return;
  subscribed = true;
  Transport.addListener('onStreamEvent', (event: StreamEvent) => streams.get(event.id)?.onEvent(event.event, event.data));
  Transport.addListener('onStreamEnd', (end: StreamEnd) => {
    const handlers = streams.get(end.id);
    streams.delete(end.id);
    const error = end.error
      ? transportError(new Error(end.error))
      : end.status && end.status !== 200
        ? new ApiError($t('实时连接已断开（{0}）', [end.status]), end.status)
        : null;
    handlers?.onEnd?.(error);
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient({ origin, pin, token, onUnauthorized }: ClientOptions) {
  const base = (path: string, extra: Partial<TransportRequest> = {}): TransportRequest => ({
    url: origin + path,
    pin: pin ?? undefined,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...extra,
  });

  async function call<T>(method: string, path: string, body?: unknown, extra: Partial<TransportRequest> = {}): Promise<T> {
    let response;
    try {
      response = await Transport.request(base(path, { method, body: body === undefined ? undefined : JSON.stringify(body), ...extra }));
    } catch (error) {
      throw transportError(error);
    }
    let payload: any = null;
    if (response.body) {
      try { payload = JSON.parse(response.body); } catch { payload = null; }
    }
    if (response.status === 401) onUnauthorized?.();
    if (response.status < 200 || response.status >= 300) {
      const raw = typeof payload?.error === 'string' ? payload.error : $t('请求失败（{0}）', [response.status]);
      throw new ApiError($tm(raw), response.status);
    }
    return (response.fileUri ?? payload) as T;
  }

  return {
    origin,
    get: <T>(path: string, query?: Query) => call<T>('GET', withQuery(path, query)),
    post: <T>(path: string, body: unknown = {}) => call<T>('POST', path, body),
    put: <T>(path: string, body: unknown = {}) => call<T>('PUT', path, body),
    patch: <T>(path: string, body: unknown = {}) => call<T>('PATCH', path, body),
    del: <T>(path: string, body?: unknown) => call<T>('DELETE', path, body),
    /** Binary attachment upload from a local file:// URI. */
    upload: <T>(path: string, fileUri: string, query?: Query) =>
      call<T>('POST', withQuery(path, query), undefined, {
        bodyFile: fileUri,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/octet-stream' },
        timeout: 300,
      }),
    /** Download to the app cache and return the local file:// URI. */
    file: (path: string, options: { fileName?: string; cacheKey?: string } = {}) =>
      call<string>('GET', path, undefined, { responseType: 'file', ...options, cacheKey: options.cacheKey ? origin + '|' + options.cacheKey : undefined }),
    /** Server-sent events (run events); returns a function that closes the stream. */
    stream(path: string, handlers: StreamHandlers): () => void {
      subscribeStreams();
      const id = 'stream-' + ++streamCounter;
      streams.set(id, handlers);
      try {
        Transport.openStream(id, base(path, { headers: { Authorization: 'Bearer ' + token, Accept: 'text/event-stream' } }));
      } catch (error) {
        streams.delete(id);
        handlers.onEnd?.(transportError(error));
      }
      return () => {
        streams.delete(id);
        Transport.closeStream(id);
      };
    },
  };
}

/** Unauthenticated calls used during pairing (no token yet). */
export async function pairDevice(origin: string, pin: string | null, code: string, device: string): Promise<string> {
  let response;
  try {
    response = await Transport.request({
      url: origin + '/pair',
      method: 'POST',
      pin: pin ?? undefined,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, bearer: true, device }),
    });
  } catch (error) {
    throw transportError(error);
  }
  let payload: any = null;
  try { payload = response.body ? JSON.parse(response.body) : null; } catch { payload = null; }
  if (response.status === 401) throw new ApiError($t('配对码无效或已过期（5 分钟内有效且只能使用一次），请在 Mac 上重新生成。'), 401);
  if (response.status !== 200 || typeof payload?.token !== 'string')
    throw new ApiError($tm(payload?.error || $t('配对失败（{0}）', [response.status])), response.status);
  return payload.token;
}
