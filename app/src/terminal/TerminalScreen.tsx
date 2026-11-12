import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { fromByteArray } from 'base64-js';
import { H, tabular, useTok } from '../theme/tokens';
import type { MacStatsData } from '../lib/api';
import type { HostConfig } from '../lib/storage';
import { LinkState, TermConnection } from '../lib/connection';
import { utf8Encode } from '../lib/protocol';
import { useDelayed, useKeyboardHeight } from '../ui/hooks';
import { Button } from '../ui/Button';
import { MacStats } from '../ui/MacStats';
import { Notice } from '../ui/Notice';
import { PixelMark } from '../ui/Pixel';
import { Txt } from '../ui/Txt';
import { WaitCells } from '../ui/WaitCells';
import { KeyBar } from './KeyBar';
import { LinkStrip } from './LinkStrip';
import { TERMINAL_HTML, xtermTheme } from './terminalHtml';

const WORD: Record<LinkState, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  failed: 'Offline',
  exited: 'Ended',
  gone: 'Ended',
};

interface MacSnapshot {
  s: MacStatsData;
  rx: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ctrlByte(b: number): number {
  if (b >= 0x61 && b <= 0x7a) return b & 0x1f;
  if (b >= 0x41 && b <= 0x5a) return b & 0x1f;
  if (b === 0x20 || b === 0x40) return 0x00;
  if (b === 0x5b) return 0x1b;
  if (b === 0x5c) return 0x1c;
  if (b === 0x5d) return 0x1d;
  if (b === 0x3f) return 0x7f;
  return b;
}

export function TerminalScreen({
  cfg,
  session,
  active,
  onBound,
  onTitle,
  onRestart,
}: {
  cfg: HostConfig;
  session?: string;
  active: boolean;
  onBound: (id: string) => void;
  onTitle: (title: string) => void;
  onRestart: () => void;
}) {
  const t = useTok();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();

  const web = useRef<WebView<object>>(null);
  const conn = useRef<TermConnection | null>(null);
  const size = useRef({ cols: 80, rows: 24 });
  const outBuf = useRef<Uint8Array[]>([]);
  const flushT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlush = useRef(0);
  const ctrlRef = useRef(false);

  const [ctrlOn, setCtrlOn] = useState(false);
  const [link, setLink] = useState<LinkState>('connecting');
  const [detail, setDetail] = useState('');
  const [samples, setSamples] = useState<(number | null)[]>([]);
  const [echo, setEcho] = useState<number | null>(null);
  const [mac, setMac] = useState<MacSnapshot | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [sid, setSid] = useState<string | undefined>(session);
  const [title, setTitle] = useState('');
  const [renderer, setRenderer] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [rendererMsg, setRendererMsg] = useState('');
  const slow = useDelayed(link === 'reconnecting', 1500);

  const js = useCallback((code: string) => web.current?.injectJavaScript(code + ';true;'), []);

  useEffect(() => {
    if (renderer !== 'ok') return;
    js(active ? 'window.__focus()' : 'window.__blur()');
  }, [active, renderer, js]);

  const flush = useCallback(() => {
    flushT.current = null;
    lastFlush.current = Date.now();
    const parts = outBuf.current;
    if (parts.length === 0) return;
    outBuf.current = [];
    const total = parts.reduce((size, part) => size + part.length, 0);
    const all = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      all.set(part, offset);
      offset += part.length;
    }
    js(`window.__w("${fromByteArray(all)}")`);
  }, [js]);

  const pushTheme = useCallback(() => js(`window.__theme(${JSON.stringify(xtermTheme(t))})`), [js, t]);

  useEffect(() => {
    if (renderer === 'ok') pushTheme();
  }, [renderer, pushTheme]);

  const startConn = () => {
    const connection = new TermConnection(cfg, { session, cols: size.current.cols, rows: size.current.rows }, {
      state: (state, stateDetail) => { setLink(state); setDetail(stateDetail ?? ''); },
      ready: (info) => {
        if (info.reset) {
          outBuf.current = [];
          js('window.__reset()');
        }
        setSid(info.session);
        onBound(info.session);
        setExitCode(null);
      },
      data: (bytes) => {
        outBuf.current.push(bytes);
        if (flushT.current) return;
        const elapsed = Date.now() - lastFlush.current;
        if (elapsed >= 8) flush();
        else flushT.current = setTimeout(flush, 8 - elapsed);
      },
      rtt: (ms) => setSamples((previous) => [...previous.slice(-23), ms]),
      exit: (code) => setExitCode(code),
      stats: (stats) => setMac({ s: stats, rx: Date.now() }),
    });
    conn.current = connection;
    connection.start();
  };

  useEffect(() => () => {
    conn.current?.stop();
    if (flushT.current) clearTimeout(flushT.current);
  }, []);

  const sendString = (value: string) => conn.current?.sendInput(utf8Encode(value));

  const sendTyped = (bytes: Uint8Array) => {
    if (ctrlRef.current && bytes.length === 1) {
      bytes = new Uint8Array([ctrlByte(bytes[0])]);
      ctrlRef.current = false;
      setCtrlOn(false);
    }
    conn.current?.sendInput(bytes);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const raw = event.nativeEvent.data;
    const marker = raw.charCodeAt(0);
    if (marker === 105) {
      sendTyped(utf8Encode(raw.slice(1)));
      return;
    }
    if (marker === 98) {
      const bytes = new Uint8Array(Math.max(0, raw.length - 1));
      for (let i = 1; i < raw.length; i++) bytes[i - 1] = raw.charCodeAt(i) & 255;
      sendTyped(bytes);
      return;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (!isRecord(parsed) || typeof parsed.t !== 'string') return;
    switch (parsed.t) {
      case 'ready': {
        const cols = parsed.cols;
        const rows = parsed.rows;
        if (typeof cols !== 'number' || typeof rows !== 'number') return;
        size.current = { cols, rows };
        setRenderer('ok');
        if (!conn.current) startConn();
        else {
          outBuf.current = [];
          conn.current.reconnectFresh();
        }
        break;
      }
      case 'echo':
        {
          const ms = parsed.ms;
          if (typeof ms === 'number') {
            setEcho((previous) => (previous == null ? ms : Math.round(previous * 0.7 + ms * 0.3)));
          }
        }
        break;
      case 'resize':
        if (typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
          size.current = { cols: parsed.cols, rows: parsed.rows };
          conn.current?.setSize(parsed.cols, parsed.rows);
        }
        break;
      case 'bell':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        break;
      case 'title':
        if (typeof parsed.s === 'string') {
          setTitle(parsed.s);
          onTitle(parsed.s);
        }
        break;
      case 'sel':
        if (typeof parsed.s === 'string' && parsed.s) Clipboard.setStringAsync(parsed.s);
        break;
      case 'fatal':
        setRenderer('failed');
        setRendererMsg(typeof parsed.m === 'string' ? parsed.m : 'Renderer error.');
        break;
    }
  };

  const paste = async () => {
    const value = await Clipboard.getStringAsync();
    if (value) js(`window.__paste(${JSON.stringify(value)})`);
  };

  const last = samples.length ? samples[samples.length - 1] : undefined;
  const speed = link !== 'live' ? '—' : echo != null ? `echo ${echo} ms` : last != null ? `${last} ms` : '—';
  const heading = title || (sid ? `Session ${sid.slice(0, 4)}` : 'New session');
  const lead =
    link === 'live' ? <PixelMark name="dot" cell={3} colors={{ '#': t.statusOK }} />
    : link === 'failed' ? <PixelMark name="failed" cell={2} colors={{ '#': t.statusBad }} />
    : link === 'exited' || link === 'gone' ? <PixelMark name="dot" cell={3} colors={{ '#': t.text2 }} />
    : <WaitCells />;

  const notice =
    renderer === 'failed' ? (
      <Notice lead={<PixelMark name="failed" cell={2} colors={{ '#': t.statusBad }} />} text={rendererMsg} />
    ) : link === 'failed' ? (
      <Notice lead={<PixelMark name="failed" cell={2} colors={{ '#': t.statusBad }} />} text={detail || 'Connection refused.'}>
        <Button label="Retry" kind="primary" height={H.small} onPress={() => conn.current?.retry()} />
      </Notice>
    ) : link === 'exited' ? (
      <Notice text={`Process exited with code ${exitCode ?? 0}.`}>
        <Button label="New session" kind="primary" height={H.small} onPress={onRestart} />
      </Notice>
    ) : link === 'gone' ? (
      <Notice text="This session ended on the Mac." surface="well">
        <Button
          label="New session"
          kind="secondary"
          height={H.small}
          surface="field"
          style={{ paddingHorizontal: 8 }}
          onPress={onRestart}
        />
      </Notice>
    ) : link === 'connecting' ? (
      <Notice lead={<WaitCells />} text="Connecting." surface="surface" />
    ) : link === 'reconnecting' && slow ? (
      <Notice lead={<WaitCells />} text="Reconnecting. Typing is held for 20 s, then dropped." />
    ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ height: H.bar, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
        <View style={{ flex: 1 }}>
          <Txt kind="label" numberOfLines={1}>{heading}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 16 }}>
            <View style={{ width: 14, alignItems: 'flex-start' }}>{lead}</View>
            <Txt kind="caption" tone="text2">{WORD[link]}</Txt>
            <Txt kind="caption" tone="text2" style={[tabular, { minWidth: 72 }]}>{speed}</Txt>
          </View>
        </View>
        <LinkStrip samples={samples} />
      </View>

      {kb === 0 ? <MacStats data={mac?.s ?? null} rx={mac?.rx ?? 0} live={link === 'live'} /> : null}

      <View style={{ flex: 1, paddingBottom: kb }}>
        <View style={{ flex: 1 }}>
          <WebView<object>
            ref={web}
            source={{ html: TERMINAL_HTML }}
            originWhitelist={['*']}
            onMessage={onMessage}
            javaScriptEnabled
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            hideKeyboardAccessoryView
            keyboardDisplayRequiresUserAction={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            setSupportMultipleWindows={false}
            onContentProcessDidTerminate={() => web.current?.reload()}
            onRenderProcessGone={() => web.current?.reload()}
            style={{ flex: 1, backgroundColor: t.bg }}
          />
          {notice ? (
            <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, left: 0, right: 0, zIndex: 2 }}>
              {notice}
            </View>
          ) : null}
        </View>
        <KeyBar
          ctrl={ctrlOn}
          bottom={kb > 0 ? 0 : insets.bottom}
          onSend={sendString}
          onCtrl={() => { ctrlRef.current = !ctrlRef.current; setCtrlOn(ctrlRef.current); }}
          onCopy={() => js('window.__sel()')}
          onPaste={paste}
        />
      </View>
    </View>
  );
}
