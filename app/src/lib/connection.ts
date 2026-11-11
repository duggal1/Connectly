import { AppState, NativeEventSubscription } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { wsUrl } from './api';
import type { MacStatsData } from './api';
import type { HostConfig } from './storage';
import { T, encode, decode, resizePayload, utf8Encode, utf8Decode } from './protocol';

export type LinkState = 'connecting' | 'live' | 'reconnecting' | 'failed' | 'exited' | 'gone';

export interface Events {
  state(s: LinkState, detail?: string): void;
  ready(info: { session: string; resumed: boolean; reset: boolean }): void;
  data(b: Uint8Array): void;
  rtt(ms: number | null): void;
  exit(code: number): void;
  stats(s: MacStatsData): void;
}

const HB_EVERY = 4000;
const HB_TIMEOUT = 6000;
const CONNECT_TIMEOUT = 7000;
const QUEUE_TTL = 20000;
const QUEUE_MAX = 4096;

type Timer = ReturnType<typeof setTimeout> | null;
type ControlMessage = Record<string, unknown> & { op: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseControl(payload: Uint8Array): ControlMessage | null {
  try {
    const value: unknown = JSON.parse(utf8Decode(payload));
    if (isRecord(value) && typeof value.op === 'string') return { ...value, op: value.op };
  } catch {}
  return null;
}

function parseStats(message: ControlMessage): MacStatsData | null {
  const battery = message.battery;
  const remaining = message.remaining;
  const lidClosed = message.lidClosed;
  const source = message.source;
  const load1 = message.load1;
  const at = message.at;
  if (
    (battery !== null && typeof battery !== 'number') ||
    typeof message.charging !== 'boolean' ||
    (source !== 'ac' && source !== 'battery') ||
    (remaining !== null && typeof remaining !== 'number') ||
    (lidClosed !== null && typeof lidClosed !== 'boolean') ||
    typeof load1 !== 'number' ||
    typeof at !== 'number'
  ) return null;
  return { battery, charging: message.charging, source, remaining, lidClosed, load1, at };
}

export class TermConnection {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private terminal = false;
  private live = false;
  private retryT: Timer = null;
  private missT: Timer = null;
  private connT: Timer = null;
  private hbI: ReturnType<typeof setInterval> | null = null;
  private appSub: NativeEventSubscription;
  private netUnsub: () => void;
  private netUp: boolean | null = null;
  private netType: string | null = null;
  private session?: string;
  private cols: number;
  private rows: number;
  private rx = 0;
  private queue: { at: number; b: Uint8Array }[] = [];
  private queued = 0;

  constructor(
    private cfg: HostConfig,
    init: { session?: string; cols: number; rows: number },
    private ev: Events,
  ) {
    this.session = init.session;
    this.cols = init.cols;
    this.rows = init.rows;
    this.appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') this.onForeground();
    });
    this.netUnsub = NetInfo.addEventListener((state) => this.onNet(state));
  }

  start() {
    this.open();
  }

  stop() {
    this.stopped = true;
    this.appSub.remove();
    this.netUnsub();
    this.teardown();
  }

  retry() {
    this.terminal = false;
    this.attempt = 0;
    this.teardown();
    this.open();
  }

  reconnectFresh() {
    this.rx = 0;
    this.kick();
  }

  sendInput(bytes: Uint8Array) {
    if (this.stopped || this.terminal) return;
    if (this.live) {
      this.sendRaw(encode(T.STDIN, bytes));
      return;
    }
    this.queue.push({ at: Date.now(), b: bytes });
    this.queued += bytes.length;
    while (this.queued > QUEUE_MAX && this.queue.length > 0) {
      const dropped = this.queue.shift();
      if (dropped) this.queued -= dropped.b.length;
    }
  }

  setSize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    if (this.live) this.sendRaw(encode(T.RESIZE, resizePayload(cols, rows)));
  }

  kill() {
    if (this.live) this.sendRaw(encode(T.CONTROL, utf8Encode(JSON.stringify({ op: 'kill' }))));
  }

  private open() {
    if (this.stopped) return;
    const baseUrl = wsUrl(this.cfg);
    const url = `${baseUrl}?trace_id=ws-${Date.now()}`;
    this.ev.state(this.attempt === 0 ? 'connecting' : 'reconnecting');
    console.info('[terminal] websocket opening', {
      url,
      attempt: this.attempt + 1,
      session: this.session ?? null,
      cols: this.cols,
      rows: this.rows,
    });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (error: unknown) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error('[terminal] websocket construction failed', { url, error: detail });
      this.drop(`Could not create the WebSocket: ${detail}`);
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.connT = setTimeout(() => {
      this.connT = null;
      if (!this.live && ws === this.ws) {
        this.drop(`No ready response from ${baseUrl} after ${CONNECT_TIMEOUT} ms.`);
      }
    }, CONNECT_TIMEOUT);
    ws.onopen = () => {
      if (ws !== this.ws) return;
      console.info('[terminal] websocket opened', { url, readyState: ws.readyState });
      const hello = {
        op: 'hello', v: 2, token: this.cfg.token,
        session: this.session ?? '', cols: this.cols, rows: this.rows, offset: this.rx,
      };
      this.sendRaw(encode(T.CONTROL, utf8Encode(JSON.stringify(hello))));
    };
    ws.onmessage = (event) => {
      if (ws !== this.ws || !(event.data instanceof ArrayBuffer)) return;
      this.onFrame(event.data);
    };
    ws.onclose = (event) => {
      console.warn('[terminal] websocket closed', {
        url, code: event.code, reason: event.reason, wasClean: event.wasClean,
      });
      if (ws === this.ws) this.drop(event.reason || `WebSocket closed with code ${event.code}.`);
    };
    ws.onerror = () => {
      console.error('[terminal] websocket error', { url, readyState: ws.readyState });
      if (ws === this.ws) this.drop(`WebSocket error while connecting to ${baseUrl}.`);
    };
  }

  private onFrame(buf: ArrayBuffer) {
    const frame = decode(buf);
    if (!frame) return;
    switch (frame.type) {
      case T.STDOUT:
      case T.STDERR:
        this.rx += frame.payload.length;
        this.ev.data(frame.payload);
        break;
      case T.HEARTBEAT: {
        if (frame.payload.length === 8) {
          const ts = new DataView(frame.payload.buffer, frame.payload.byteOffset, 8).getFloat64(0, false);
          this.ev.rtt(Math.max(0, Math.round(Date.now() - ts)));
        }
        if (this.missT) clearTimeout(this.missT);
        this.missT = null;
        break;
      }
      case T.CONTROL: {
        const message = parseControl(frame.payload);
        if (message) this.onControl(message);
        break;
      }
    }
  }

  private onControl(message: ControlMessage) {
    switch (message.op) {
      case 'ready': {
        const session = message.session;
        const base = message.base;
        if (typeof session !== 'string') return;
        if (this.connT) clearTimeout(this.connT);
        this.connT = null;
        this.live = true;
        this.attempt = 0;
        this.session = session;
        this.rx = typeof base === 'number' && Number.isFinite(base) && base >= 0 ? base : 0;
        const resumed = message.resumed === true;
        const reset = message.reset !== false;
        console.info('[terminal] session ready', { session, resumed, reset, base: this.rx });
        this.ev.ready({ session, resumed, reset });
        this.ev.state('live');
        this.flushQueue();
        this.startHeartbeat();
        break;
      }
      case 'stats': {
        const stats = parseStats(message);
        if (stats) this.ev.stats(stats);
        break;
      }
      case 'error':
        if (message.fatal === true) {
          const detail = typeof message.message === 'string' ? message.message : 'Connection refused.';
          console.error('[terminal] daemon rejected connection', { message: detail });
          this.terminal = true;
          this.teardown();
          this.ev.state('failed', detail);
        }
        break;
      case 'gone':
        this.terminal = true;
        this.queue = [];
        this.queued = 0;
        this.teardown();
        this.ev.state('gone');
        break;
      case 'exit': {
        this.terminal = true;
        this.teardown();
        const code = typeof message.code === 'number' && Number.isFinite(message.code) ? message.code : 0;
        this.ev.exit(code);
        this.ev.state('exited');
        break;
      }
    }
  }

  private flushQueue() {
    const cutoff = Date.now() - QUEUE_TTL;
    const keep = this.queue.filter((item) => item.at >= cutoff);
    this.queue = [];
    this.queued = 0;
    if (keep.length === 0) return;
    const size = keep.reduce((total, item) => total + item.b.length, 0);
    const all = new Uint8Array(size);
    let offset = 0;
    for (const item of keep) {
      all.set(item.b, offset);
      offset += item.b.length;
    }
    this.sendRaw(encode(T.STDIN, all));
  }

  private drop(reason = 'WebSocket connection closed without a reason.') {
    if (this.stopped || this.terminal) return;
    this.teardown();
    this.attempt += 1;
    const delay = Math.min(5000, 250 * 2 ** Math.min(this.attempt - 1, 5)) + Math.random() * 150;
    console.warn('[terminal] reconnect scheduled', { attempt: this.attempt, delayMs: Math.round(delay), reason });
    this.ev.state('reconnecting', `${reason} Retrying in ${Math.round(delay)} ms.`);
    this.retryT = setTimeout(() => {
      this.retryT = null;
      this.open();
    }, delay);
  }

  private kick() {
    if (this.stopped || this.terminal) return;
    this.teardown();
    this.open();
  }

  private teardown() {
    this.live = false;
    if (this.retryT) clearTimeout(this.retryT);
    if (this.missT) clearTimeout(this.missT);
    if (this.connT) clearTimeout(this.connT);
    if (this.hbI) clearInterval(this.hbI);
    this.retryT = this.missT = this.connT = null;
    this.hbI = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try { ws.close(); } catch {}
    }
  }

  private startHeartbeat() {
    if (this.hbI) clearInterval(this.hbI);
    this.beat();
    this.hbI = setInterval(() => this.beat(), HB_EVERY);
  }

  private beat(timeout = HB_TIMEOUT) {
    if (!this.live) return;
    const payload = new Uint8Array(8);
    new DataView(payload.buffer).setFloat64(0, Date.now(), false);
    this.sendRaw(encode(T.HEARTBEAT, payload));
    if (!this.missT) {
      this.missT = setTimeout(() => {
        this.missT = null;
        this.ev.rtt(null);
        this.drop();
      }, timeout);
    }
  }

  private probe(timeout: number) {
    if (!this.live) return;
    if (this.missT) clearTimeout(this.missT);
    this.missT = null;
    this.beat(timeout);
  }

  private onForeground() {
    if (this.stopped || this.terminal) return;
    if (this.live) this.probe(3000);
    else this.kick();
  }

  private onNet(state: NetInfoState) {
    const up = state.isConnected === true;
    const wasUp = this.netUp;
    const first = wasUp === null;
    const changed = state.type !== this.netType;
    this.netUp = up;
    this.netType = state.type;
    if (first || this.stopped || this.terminal || !up) return;
    if (!wasUp || changed) {
      if (this.live) this.probe(2500);
      else this.kick();
    }
  }

  private sendRaw(frame: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
  }
}
