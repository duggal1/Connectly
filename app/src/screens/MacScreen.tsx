import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { api, ApiError, json } from '../lib/api';
import type { ActionInfo, ActionResult, Capabilities, MacStatsData } from '../lib/api';
import type { HostConfig } from '../lib/storage';
import { H, tabular, useTok } from '../theme/tokens';
import { Button } from '../ui/Button';
import { MacStats } from '../ui/MacStats';
import { Notice } from '../ui/Notice';
import { Txt } from '../ui/Txt';
import { WaitCells } from '../ui/WaitCells';

const ACTION_KIND: Record<ActionInfo['kind'], string> = {
  app: 'App',
  path: 'File or folder',
  shortcut: 'Shortcut',
  script: 'Script',
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Can't reach the daemon.";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Txt kind="caption" tone="text2" style={{ paddingHorizontal: 16 }}>{title}</Txt>
      {children}
    </View>
  );
}

function ActionRow({
  action,
  result,
  busy,
  disabled,
  onRun,
}: {
  action: ActionInfo;
  result?: ActionResult;
  busy: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <View style={{ minHeight: H.row, paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt kind="label" numberOfLines={1}>{action.label}</Txt>
        {busy ? (
          <View style={{ height: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <WaitCells />
            <Txt kind="caption" tone="text2">Running {ACTION_KIND[action.kind].toLowerCase()}</Txt>
          </View>
        ) : result ? (
          <View style={{ minHeight: 16, flexDirection: 'row', alignItems: 'center' }}>
            <Txt kind="caption" tone={result.ok ? 'text2' : 'statusBad'} numberOfLines={2} style={tabular}>
              {result.ok
                ? `Done in ${result.ms} ms${result.output ? `. ${result.output}` : '.'}`
                : `Failed (${result.code})${result.output ? `. ${result.output}` : '.'}`}
            </Txt>
          </View>
        ) : (
          <Txt kind="caption" tone="text2">{ACTION_KIND[action.kind]}</Txt>
        )}
      </View>
      <Button label="Run" height={H.button} disabled={disabled} onPress={onRun} />
    </View>
  );
}

export function MacScreen({ cfg, onScreen }: { cfg: HostConfig; onScreen: () => void }) {
  const theme = useTok();
  const insets = useSafeAreaInsets();
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [stats, setStats] = useState<MacStatsData | null>(null);
  const [statsAt, setStatsAt] = useState(0);
  const [error, setError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [clipboardResult, setClipboardResult] = useState('');
  const [volumeResult, setVolumeResult] = useState('');
  const busyRef = useRef(false);
  const retryRef = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextCapabilities, nextStats] = await Promise.all([
        api<Capabilities>(cfg, '/api/capabilities'),
        api<MacStatsData>(cfg, '/api/stats'),
      ]);
      setCapabilities(nextCapabilities);
      setStats(nextStats);
      setStatsAt(Date.now());
      setError('');
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    }
  }, [cfg]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 10000);
    return () => clearInterval(interval);
  }, [load]);

  const guard = async (id: string, operation: () => Promise<void>, remember = true) => {
    if (busyRef.current) return;
    if (remember) retryRef.current = operation;
    busyRef.current = true;
    setBusy(id);
    setOperationError('');
    try {
      await operation();
    } catch (cause: unknown) {
      setOperationError(errorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const retryOperation = () => {
    const operation = retryRef.current;
    if (operation) void guard('retry', operation, false);
  };

  const run = (action: ActionInfo) => guard(action.id, async () => {
    const result = await api<ActionResult>(
      cfg,
      `/api/actions/${encodeURIComponent(action.id)}`,
      { method: 'POST' },
      (action.timeoutSec + 5) * 1000,
    );
    setResults((previous) => ({ ...previous, [action.id]: result }));
  });

  const sendToMac = () => guard('clipboard', async () => {
    setClipboardResult('');
    const text = await Clipboard.getStringAsync();
    if (!text) {
      setClipboardResult('The phone clipboard is empty.');
      return;
    }
    await api<void>(cfg, '/api/clipboard', json('PUT', { text }));
    setClipboardResult('Sent to the Mac clipboard.');
  });

  const copyFromMac = () => guard('clipboard', async () => {
    setClipboardResult('');
    const result = await api<{ text: string }>(cfg, '/api/clipboard');
    if (!result.text) {
      setClipboardResult('The Mac clipboard is empty.');
      return;
    }
    await Clipboard.setStringAsync(result.text);
    setClipboardResult('Copied from the Mac.');
  });

  const setVolume = (level: number) => guard('volume', async () => {
    setVolumeResult('');
    await api<void>(cfg, '/api/volume', json('PUT', { level }));
    setVolumeResult(level === 0 ? 'Volume muted.' : `Volume set to ${level}%.`);
  });

  const nothingEnabled = capabilities !== null
    && !capabilities.clipboard
    && !capabilities.volume
    && !capabilities.visual
    && capabilities.actions.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: 8,
          paddingBottom: 16 + insets.bottom,
          gap: 20,
        }}
      >
        <View style={{ paddingHorizontal: 16, gap: 4 }}>
          <Txt kind="display">Mac</Txt>
          <Txt kind="caption" tone="text2">{cfg.host}</Txt>
        </View>

        <MacStats data={stats} rx={statsAt} live={!error} />

        {error ? (
          <Notice text={error}>
            <Button label="Retry" kind="secondary" height={H.small} style={{ paddingHorizontal: 16 }} onPress={() => void load()} />
          </Notice>
        ) : null}
        {operationError ? (
          <Notice text={operationError}>
            <Button label="Retry" kind="secondary" height={H.small} style={{ paddingHorizontal: 16 }} onPress={retryOperation} />
          </Notice>
        ) : null}

        {capabilities === null && !error ? (
          <View style={{ height: H.row, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <WaitCells />
            <Txt kind="caption" tone="text2">Reading Mac controls</Txt>
          </View>
        ) : null}

        {capabilities && capabilities.actions.length > 0 ? (
          <Section title="Actions">
            {capabilities.actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                result={results[action.id]}
                busy={busy === action.id}
                disabled={busy !== null}
                onRun={() => void run(action)}
              />
            ))}
          </Section>
        ) : null}

        {capabilities?.clipboard ? (
          <Section title="Clipboard">
            <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 8 }}>
              <Button label="Send to Mac" height={H.button} disabled={busy !== null} onPress={() => void sendToMac()} />
              <Button label="Copy from Mac" height={H.button} disabled={busy !== null} onPress={() => void copyFromMac()} />
            </View>
            {clipboardResult ? <Txt kind="caption" tone="text2" style={{ paddingHorizontal: 16 }}>{clipboardResult}</Txt> : null}
          </Section>
        ) : null}

        {capabilities?.volume ? (
          <Section title="Volume">
            <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 8 }}>
              {[0, 25, 50, 75, 100].map((level) => (
                <Button
                  key={level}
                  label={level === 0 ? 'Mute' : String(level)}
                  height={H.button}
                  disabled={busy !== null}
                  onPress={() => void setVolume(level)}
                  style={{ width: 48, paddingHorizontal: 0 }}
                />
              ))}
            </View>
            {volumeResult ? <Txt kind="caption" tone="text2" style={{ paddingHorizontal: 16 }}>{volumeResult}</Txt> : null}
          </Section>
        ) : null}

        {capabilities?.visual ? (
          <Section title="Mac desktop">
            <View style={{ minHeight: H.row, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Txt kind="caption" tone="text2" style={{ flex: 1 }}>
                View and tap the Mac desktop.
              </Txt>
              <Button label="View desktop" kind="secondary" height={H.small} surface="field" disabled={busy !== null} style={{ paddingHorizontal: 16 }} onPress={onScreen} />
            </View>
          </Section>
        ) : null}

        {nothingEnabled ? (
          <View style={{ paddingHorizontal: 24 }}>
            <Txt kind="body" tone="text2">No phone controls are enabled. Add allow-listed controls in actions.json on the Mac.</Txt>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
