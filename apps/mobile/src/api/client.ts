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
  relay?: string;
  deviceKey?: string;
  /** Called once per 401: the device was revoked or the token expired. */
  onUnauthorized?: () => void;
};
export type Query = Record<string, string | number | boolean | null | undefined>;
type StreamHandlers = { onEvent: (event: string, data: string) => void; onEnd?: (error: ApiError | null) => void };

/** Map transport failures ("CODE: detail") to readable, translated errors. */
export function transportError(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PIN_MISMATCH'))
    return new ApiError($t('工作空间证书已变化，请核对服务器证书后重新登录。'), 0, 'PIN_MISMATCH');
  // Native failures arrive wrapped ("Calling the 'request' function has failed\n→ Caused by: NETWORK: …").
  if (message.includes('NETWORK'))
    return new ApiError($t('无法连接工作空间：{0}', [message.replace(/^[\s\S]*?NETWORK:\s*/, '')]), 0, 'NETWORK');
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

export function createApiClient({ origin, pin, token, relay, deviceKey, onUnauthorized }: ClientOptions) {
  const base = (path: string, extra: Partial<TransportRequest> = {}): TransportRequest => ({
    url: origin + path,
    pin: pin ?? undefined, relay, deviceKey,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...extra,
  });

  let renewAt = 0;
  let renewing: Promise<void> | undefined;
  function authorize() {
    if (!relay || Date.now() < renewAt) return Promise.resolve();
    return renewing ??= (async () => {
      const response = await Transport.request(base('/relay/session',{method:'POST',body:'{}'}));
      if (response.status === 401) onUnauthorized?.();
      const data = JSON.parse(response.body || '{}');
      if (response.status !== 200 || !data.token) throw new ApiError($t('无法恢复设备通道'),response.status);
      token = data.token;
      renewAt = Date.now()+12*60000;
    })().finally(()=>{renewing=undefined;});
  }
  async function call<T>(method: string, path: string, body?: unknown, extra: Partial<TransportRequest> = {}): Promise<T> {
    let response;
    try {
      await authorize();
      const send = () => {
        const options = base(path, {method, body:body === undefined ? undefined : JSON.stringify(body), ...extra});
        if (relay) options.headers = {...options.headers,Authorization:'Bearer '+token};
        return Transport.request(options);
      };
      response = await send();
      if (relay && response.status === 401) {
        renewAt = 0; await authorize(); response = await send();
      }
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
      streams.set(id, {...handlers,onEnd:error=>{
        if (relay && error?.status === 401) { renewAt=0; handlers.onEnd?.(null); }
        else handlers.onEnd?.(error);
      }});
      void authorize().then(()=>{
        if (streams.has(id)) Transport.openStream(id,base(path,{headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'}}));
      }).catch(error=>{
        if (streams.delete(id)) handlers.onEnd?.(transportError(error));
      });
      return () => {
        streams.delete(id);
        Transport.closeStream(id);
      };
    },
  };
}

/**
 * Client for screens that are still unmounting after the workspace was closed
 * (logout, forget, switch): every call rejects instead of the render throwing.
 */
export function closedClient(): ApiClient {
  const closed = async (): Promise<never> => { throw new ApiError($t('工作空间已关闭，请重新连接。'), 0, 'CLOSED'); };
  return {
    origin: '',
    get: closed, post: closed, put: closed, patch: closed, del: closed, upload: closed, file: closed,
    stream(_path: string, handlers: StreamHandlers) {
      handlers.onEnd?.(new ApiError($t('工作空间已关闭，请重新连接。'), 0, 'CLOSED'));
      return () => undefined;
    },
  };
}

export async function loginDevice(origin: string, pin: string | null, name: string, password: string, device: string) {
  const response = await Transport.request({url: origin + '/login', method: 'POST', pin:pin ?? undefined,
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({name,password,device,bearer:true}), timeout:20}).catch(error => {throw transportError(error);});
  const result = JSON.parse(response.body || '{}');
  if (response.status !== 200 || !result.token || !result.workspace)
    throw new ApiError($tm(result.error || $t('登录失败，请检查地址和账号')), response.status);
  return result as {token:string; workspace:string; mode:'local'|'cloud'};
}
