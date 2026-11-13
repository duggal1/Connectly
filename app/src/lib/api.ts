import type { HostConfig } from './storage';

export interface SessionInfo {
  id: string;
  shell: string;
  created: string;
  attached: boolean;
  detachedAt?: string;
  cols: number;
  rows: number;
}

export interface MacStatsData {
  battery: number | null;
  charging: boolean;
  source: 'ac' | 'battery';
  remaining: number | null;
  lidClosed: boolean | null;
  load1: number;
  at: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public requestId?: string) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 6000;
let requestSequence = 0;

function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: typeof error, message: String(error) };
}

function apiErrorMessage(body: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    return body.trim() || fallback;
  }
  return body.trim() || fallback;
}

const hostPart = (h: string) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);
export const httpBase = (c: HostConfig) => `${c.tls ? 'https' : 'http'}://${hostPart(c.host)}:${c.port}`;
export const wsUrl = (c: HostConfig) => `${c.tls ? 'wss' : 'ws'}://${hostPart(c.host)}:${c.port}/ws`;

function request<T>(cfg: HostConfig, path: string, init: RequestInit | undefined, optional404: false, timeoutMs: number): Promise<T>;
function request<T>(cfg: HostConfig, path: string, init: RequestInit | undefined, optional404: true, timeoutMs: number): Promise<T | null>;
async function request<T>(cfg: HostConfig, path: string, init: RequestInit | undefined, optional404: boolean, timeoutMs: number): Promise<T | null> {
  const requestId = `req-${Date.now()}-${++requestSequence}`;
  const url = httpBase(cfg) + path;
  const method = init?.method ?? 'GET';
  const startedAt = Date.now();
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  console.info('[api] request started', { requestId, method, url, timeoutMs });
  try {
    const r = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'X-Request-ID': requestId,
        ...(init?.headers ?? {}),
      },
      signal: ctl.signal,
    });
    const durationMs = Date.now() - startedAt;
    if (!(optional404 && r.status === 404)) {
      console.info('[api] response received', {
        requestId,
        method,
        url,
        status: r.status,
        statusText: r.statusText,
        durationMs,
      });
    }
    if (optional404 && r.status === 404) {
      console.info('[api] optional endpoint unavailable', { requestId, path, status: r.status });
      return null;
    }
    let responseBody = '';
    if (!r.ok) {
      responseBody = (await r.text()).slice(0, 1000);
      console.error('[api] non-success response body', {
        requestId,
        url,
        status: r.status,
        responseBody,
      });
    }
    if (r.status === 401) throw new ApiError(`Wrong token (HTTP 401, request ${requestId}).`, 401, requestId);
    if (r.status === 429) throw new ApiError(`Too many attempts; locked for 5 minutes (HTTP 429, request ${requestId}).`, 429, requestId);
    if (!r.ok) {
      throw new ApiError(apiErrorMessage(responseBody, `Daemon returned HTTP ${r.status} ${r.statusText} (request ${requestId}).`), r.status, requestId);
    }
    if (r.status === 204) return undefined as T;
    return (await r.json()) as T;
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      console.warn('[api] request rejected', {
        requestId,
        method,
        url,
        status: error.status,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
    const detail = describeError(error);
    const durationMs = Date.now() - startedAt;
    const message = timedOut
      ? `Timed out after ${timeoutMs} ms contacting ${url}. Confirm Tailscale is connected on both devices and that this phone can see the Mac in the same tailnet. The token is checked only after the Mac responds. Request ${requestId}.`
      : `Network error contacting ${url}: ${detail.name}: ${detail.message}. Request ${requestId}.`;
    console.error('[api] request failed', {
      requestId,
      method,
      url,
      durationMs,
      timedOut,
      errorName: detail.name,
      errorMessage: detail.message,
    });
    throw new ApiError(message, 0, requestId);
  } finally {
    clearTimeout(timer);
  }
}

export function api<T>(cfg: HostConfig, path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return request<T>(cfg, path, init, false, timeoutMs);
}

export function apiOptional<T>(cfg: HostConfig, path: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T | null> {
  return request<T>(cfg, path, init, true, timeoutMs);
}

export interface ActionInfo {
  id: string;
  label: string;
  kind: 'app' | 'path' | 'shortcut' | 'script';
  timeoutSec: number;
}

export interface Capabilities {
  clipboard: boolean;
  volume: boolean;
  open: boolean;
  visual: boolean;
  actions: ActionInfo[];
}

export interface ActionResult {
  ok: boolean;
  code: number;
  output: string;
  ms: number;
}

export interface VisualGrant {
  ticket: string;
  ttlSec: number;
}

export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
