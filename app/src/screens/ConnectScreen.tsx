import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { HostConfig, saveHost } from '../lib/storage';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Notice } from '../ui/Notice';

import { PixelMark } from '../ui/Pixel';
import { Toggle } from '../ui/Toggle';
import { Txt } from '../ui/Txt';
import { H, R, useTok } from '../theme/tokens';

export function ConnectScreen({
  initial,
  onDone,
  onCancel,
}: {
  initial: HostConfig | null;
  onDone: (h: HostConfig) => void;
  onCancel?: () => void;
}) {
  const t = useTok();
  const insets = useSafeAreaInsets();
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 7681));
  const [token, setToken] = useState(initial?.token ?? '');
  const [tls, setTls] = useState(initial?.tls ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const portNum = Number(port);
  const valid = host.trim().length > 0 && token.trim().length > 0 && Number.isInteger(portNum) && portNum > 0 && portNum < 65536;

  const connect = async () => {
    const cfg: HostConfig = {
      host: host.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, ''),
      port: portNum,
      tls,
      token: token.trim(),
    };
    setBusy(true);
    setError('');
    try {
      await api(cfg, '/api/sessions'); // proves reachability and the token in one request
      await saveHost(cfg);
      onDone(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 24, paddingBottom: 24 + insets.bottom, gap: 24 }}
      >
        <View style={{ alignItems: 'center', paddingTop: 8 }}>
          <PixelMark name="logo" cell={3} colors={{ '#': '#1D4ED8' }} />
        </View>

        <View style={{ gap: 8, paddingTop: 16 }}>
          <Txt kind="display">Connect</Txt>
          <Txt kind="body" tone="text2">Run termd on your Mac, then enter its address and token.</Txt>
        </View>

        <View style={{ gap: 16 }}>
          <Field label="Host" value={host} onChangeText={setHost} placeholder="100.64.0.7 or mac.tailnet.ts.net" keyboardType="url" returnKeyType="next" />
          <Field label="Port" value={port} onChangeText={setPort} keyboardType="number-pad" mono />
          <Field label="Token" value={token} onChangeText={setToken} secure mono placeholder="termd --print-token" returnKeyType="go" onSubmitEditing={() => valid && !busy && connect()} />
          <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderRadius: R.field, backgroundColor: t.field }}>
            <Txt kind="label">TLS</Txt>
            <Toggle value={tls} onChange={setTls} label="TLS" />
          </View>
        </View>

        {error ? (
          <Notice lead={<PixelMark name="failed" cell={2} colors={{ '#': t.statusBad }} />} text={error} />
        ) : null}

        <View style={{ gap: 8 }}>
          <Button
            label={busy ? 'Connecting' : 'Connect'}
            kind="primary"
            height={H.button}
            disabled={!valid || busy}
            loading={busy}
            onPress={connect}
          />
          {onCancel ? <Button label="Cancel" kind="quiet" onPress={onCancel} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}
