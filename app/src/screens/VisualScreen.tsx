import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, wsUrl } from '../lib/api';
import type { VisualGrant } from '../lib/api';
import type { HostConfig } from '../lib/storage';
import { vncHtml } from '../terminal/vncHtml';
import { H, tabular, useTok } from '../theme/tokens';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { PixelMark } from '../ui/Pixel';
import { Txt } from '../ui/Txt';
import { WaitCells } from '../ui/WaitCells';

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Can't reach the daemon.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function VisualScreen({ cfg, onClose }: { cfg: HostConfig; onClose: () => void }) {
  const theme = useTok();
  const insets = useSafeAreaInsets();
  const active = useRef(true);
  const [ticket, setTicket] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');

  const requestGrant = useCallback(
    () => api<VisualGrant>(cfg, '/api/visual/start', { method: 'POST' }, 20000),
    [cfg],
  );

  const stop = useCallback(() => {
    void api<void>(cfg, '/api/visual/stop', { method: 'POST' }).catch(() => {});
  }, [cfg]);

  useEffect(() => {
    active.current = true;
    void requestGrant()
      .then((grant) => {
        if (!active.current) {
          stop();
          return;
        }
        setDeadline(Date.now() + grant.ttlSec * 1000);
        setTicket(grant.ticket);
      })
      .catch((cause: unknown) => {
        if (active.current) setError(errorMessage(cause));
      });
    return () => {
      active.current = false;
      stop();
    };
  }, [requestGrant, stop]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const html = useMemo(() => {
    if (!ticket) return null;
    const bridge = wsUrl(cfg).replace(/\/ws$/, '/vnc');
    return vncHtml(`${bridge}?ticket=${encodeURIComponent(ticket)}`);
  }, [cfg, ticket]);

  const onMessage = (event: WebViewMessageEvent) => {
    let value: unknown;
    try {
      value = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (!isRecord(value) || typeof value.t !== 'string') return;
    if (value.t === 'connect') {
      setLive(true);
      setError('');
    } else if (value.t === 'fail') {
      setError(typeof value.message === 'string' ? value.message : 'Screen Sharing sign-in failed.');
    } else if (value.t === 'disconnect') {
      setLive(false);
      if (!error) setError(value.clean ? 'Screen sharing ended.' : 'Connection lost.');
    }
  };

  const extend = async () => {
    try {
      const grant = await requestGrant();
      setDeadline(Date.now() + grant.ttlSec * 1000);
      setTicket(grant.ticket);
      setLive(false);
      setError('');
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    }
  };

  const remaining = Math.max(0, Math.round((deadline - now) / 1000));
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ height: H.bar, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
        <Button label="Done" kind="quiet" height={H.small} onPress={onClose} />
        <Txt kind="title" style={{ flex: 1 }}>Screen</Txt>
        {deadline > 0 ? <Txt kind="caption" tone="text2" style={tabular}>{clock}</Txt> : null}
        <Button label="Extend" kind="quiet" height={H.small} disabled={!ticket || !!error} onPress={() => void extend()} />
      </View>

      <View style={{ flex: 1, marginBottom: insets.bottom }}>
        {html ? (
          <WebView<object>
            source={{ html }}
            originWhitelist={['*']}
            mixedContentMode="always"
            javaScriptEnabled
            onMessage={onMessage}
            bounces={false}
            style={{ flex: 1, backgroundColor: theme.bg }}
          />
        ) : null}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, left: 0, right: 0 }}>
          {error ? (
            <Notice lead={<PixelMark name="failed" cell={2} colors={{ '#': theme.statusBad }} />} text={error} />
          ) : !live ? (
            <Notice lead={<WaitCells />} text="Starting Screen Sharing." />
          ) : null}
        </View>
      </View>
    </View>
  );
}
