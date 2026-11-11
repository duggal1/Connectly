export const T = { STDIN: 1, STDOUT: 2, STDERR: 3, RESIZE: 4, CONTROL: 5, HEARTBEAT: 6 } as const;

export function encode(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

export function decode(buf: ArrayBuffer): { type: number; payload: Uint8Array } | null {
  const b = new Uint8Array(buf);
  if (b.length < 5) return null;
  const n = new DataView(buf).getUint32(1, false);
  if (n !== b.length - 5) return null;
  return { type: b[0], payload: b.subarray(5) };
}

export function resizePayload(cols: number, rows: number): Uint8Array {
  const p = new Uint8Array(4);
  const v = new DataView(p.buffer);
  v.setUint16(0, cols, false);
  v.setUint16(2, rows, false);
  return p;
}

export function utf8Encode(s: string): Uint8Array {
  const bin = unescape(encodeURIComponent(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}