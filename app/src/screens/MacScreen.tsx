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
import { PageTitle } from '../ui/PageTitle';
import { PixelMark } from '../ui/Pixel';
import { Txt } from '../ui/Txt';

const KIND: Record<ActionInfo['kind'], string> = {
  app: 'Opens an app',
  path: 'Opens a file or folder',
  shortcut: 'Runs a Shortcut',
  script: 'Runs a configured script',
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
  onRun,
}: {
  action: ActionInfo;
  result?: ActionResult;
  busy: boolean;
  onRun: () => void;
}) {
  const failed = result !== undefined && !result.ok;
  return (
    <View style={{ minHeight: H.row, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt kind="label">{action.label}</Txt>
        {result ? (
          <Txt kind="caption" tone={failed ? 'statusBad' : 'text2'} numberOfLines={3} style={tabular}>
            {failed
              ? `Failed (${result.code})${result.output ? `. ${result.output}` : '.'}`
              : `Done in ${result.ms} ms.${result.output ? ` ${result.output}` : ''}`}
          </Txt>
        ) : (
          <Txt kind="caption" tone="text2">{KIND[action.kind]}</Txt>
        )}
      </View>
      <Button label={busy ? 'Running' : 'Run'} height={H.small} disabled={busy} onPress={onRun} />
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
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [note, setNote] = useState('');
  const busyRef = useRef(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (message: string) => {
    setNote(message);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 3500);
  };

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
    return () => {
      clearInterval(interval);
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, [load]);

  const guard = async (id: string, operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(id);
    try {
      await operation();
    } catch (cause: unknown) {
      flash(errorMessage(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
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

  const toMac = () => guard('clip', async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      flash('The phone clipboard is empty.');
      return;
    }
    await api<void>(cfg, '/api/clipboard', json('PUT', { text }));
    flash('Sent to the Mac clipboard.');
  });

  const fromMac = () => guard('clip', async () => {
    const result = await api<{ text: string }>(cfg, '/api/clipboard');
    if (!result.text) {
      flash('The Mac clipboard is empty.');
      return;
    }
    await Clipboard.setStringAsync(result.text);
    flash('Copied from the Mac.');
  });

  const setVolume = (level: number) => guard('volume', async () => {
    await api<void>(cfg, '/api/volume', json('PUT', { level }));
  });

  const nothingEnabled = capabilities !== null
    && !capabilities.clipboard
    && !capabilities.volume
    && !capabilities.visual
    && capabilities.actions.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 + insets.bottom, gap: 24 }}>
        <View style={{ paddingHorizontal: 24, gap: 4 }}>
          <PageTitle>Mac</PageTitle>
          <Txt kind="caption" tone="text2">{cfg.host}</Txt>
        </View>

        <MacStats data={stats} rx={statsAt} live={!error} />

        {error ? (
          <Notice lead={<PixelMark name="failed" cell={2} colors={{ '#': theme.statusBad }} />} text={error}>
            <Button label="Retry" kind="primary" height={H.small} onPress={() => void load()} />
          </Notice>
        ) : null}
        {note ? <Notice text={note} /> : null}

        {capabilities && capabilities.actions.length > 0 ? (
          <Section title="Actions">
            {capabilities.actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                result={results[action.id]}
                busy={busy !== null}
                onRun={() => void run(action)}
              />
            ))}
          </Section>
        ) : null}

        {capabilities?.clipboard ? (
          <Section title="Clipboard">
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button label="Send to Mac" height={H.small} disabled={busy !== null} onPress={() => void toMac()} />
              <Button label="Copy from Mac" height={H.small} disabled={busy !== null} onPress={() => void fromMac()} />
            </View>
          </Section>
        ) : null}

        {capabilities?.volume ? (
          <Section title="Volume">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 }}>
              {[0, 25, 50, 75, 100].map((level) => (
                <Button
                  key={level}
                  label={level === 0 ? 'Mute' : String(level)}
                  height={H.small}
                  disabled={busy !== null}
                  onPress={() => void setVolume(level)}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {capabilities?.visual ? (
          <Section title="Screen">
            <View style={{ minHeight: H.row, paddingLeft: 16, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Txt kind="caption" tone="text2" style={{ flex: 1 }}>
                Starts Screen Sharing on demand and stops it automatically.
              </Txt>
              <Button label="Open" height={H.small} disabled={busy !== null} onPress={onScreen} />
            </View>
          </Section>
        ) : null}

        {nothingEnabled ? (
          <Txt kind="caption" tone="text2" style={{ paddingHorizontal: 24 }}>
            Nothing is enabled. Add allow-listed controls in ~/.config/connectly-termd/actions.json on the Mac.
          </Txt>
        ) : null}
      </ScrollView>
    </View>
  );
}
