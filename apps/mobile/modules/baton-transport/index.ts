import { NativeModule, requireNativeModule } from 'expo';

/** One HTTPS request. Exactly one of body / bodyBase64 / bodyFile may be set. */
export type TransportRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** UTF-8 text body (JSON). */
  body?: string;
  /** Binary body encoded as base64. */
  bodyBase64?: string;
  /** file:// URI streamed from disk (attachments). */
  bodyFile?: string;
  /** Lower-case hex SHA-256 of the paired workspace certificate (local workspaces only). */
  pin?: string;
  /** "text" (default), "base64" or "file" (written to the app cache, URI returned). */
  responseType?: 'text' | 'base64' | 'file';
  /** File name used for "file" responses (share sheet, previews). */
  fileName?: string;
  /** Immutable content key: a cached file is returned without a network request. */
  cacheKey?: string;
  /** Seconds before the request times out (default 60). */
  timeout?: number;
};

export type TransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  fileUri: string | null;
  cached?: boolean;
};

export type StreamEvent = { id: string; event: string; data: string };
export type StreamEnd = { id: string; status: number; error: string | null };

type TransportEvents = {
  onStreamEvent(event: StreamEvent): void;
  onStreamEnd(event: StreamEnd): void;
};

declare class BatonTransportModule extends NativeModule<TransportEvents> {
  request(options: TransportRequest): Promise<TransportResponse>;
  openStream(id: string, options: TransportRequest): void;
  closeStream(id: string): void;
  clearCache(): Promise<void>;
}

/** Native certificate-pinned transport (iOS). Android support is not implemented yet. */
export default requireNativeModule<BatonTransportModule>('BatonTransport');
