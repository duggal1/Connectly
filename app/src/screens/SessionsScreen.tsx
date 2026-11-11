import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, apiOptional, ApiError } from '../lib/api';
import type { MacStatsData, SessionInfo } from '../lib/api';
import type { HostConfig } from '../lib/storage';
import { ago } from '../lib/time';
import { Button } from '../ui/Button';
import { MacStats } from '../ui/MacStats';
import { Notice } from '../ui/Notice';
import { PixelMark } from '../ui/Pixel';
import { Txt } from '../ui/Txt';
import { WaitCells } from '../ui/WaitCells';
import { H, tabular, useTok } from '../theme/tokens';

const LINE = '#1F1F1F';

function Row({ s, onOpen, onEnd }: { s: SessionInfo; onOpen: () => void; onEnd: () => void }) {
  const t = useTok();
  const [pressed, setPressed] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const shell = s.shell.split('/').pop() ?? s.shell;
  const meta = s.attached
    ? `In use  ${s.cols}x${s.rows}`
    : `Detached ${ago(s.detachedAt ?? s.created)}  ${s.cols}x${s.rows}`;

  const end = () => {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 3000);
    } else {
      if (timer.current) clearTimeout(timer.current);
      onEnd();
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${shell} session ${s.id.slice(0, 4)}`}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onOpen}
      style={{
        paddingHorizontal: 0,
        paddingVertical: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        backgroundColor: pressed ? t.control : 'transparent',
        borderBottomWidth: 1,
        borderBottomColor: LINE,
      }}
    >
      <View style={{ width: 16, alignItems: 'flex-start' }}>
        <PixelMark
          name="dot"
          cell={2}
          colors={{ '#': s.attached ? t.statusOK : t.text2 }}
        />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt kind="label" style={{ fontSize: 15, lineHeight: 19, letterSpacing: -0.25 }}>
          {`${shell} ${s.id.slice(0, 4)}`}
        </Txt>
        <Txt kind="caption" tone="text2" style={tabular}>{meta}</Txt>
      </View>
      <Txt kind="caption" tone={s.attached ? 'text' : 'text2'} style={{ minWidth: 34, textAlign: 'right' }}>
        {s.attached ? 'Live' : 'Idle'}
      </Txt>
      <Pressable
        onPress={end}
        accessibilityRole="button"
        accessibilityLabel={armed ? 'Confirm end session' : 'End session'}
        hitSlop={6}
        style={{ height: 32, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}
      >
        <Txt kind="caption" tone={armed ? 'statusBad' : 'text2'} style={{ fontWeight: '500', letterSpacing: 0.2 }}>
          {armed ? 'END?' : 'END'}
        </Txt>
      </Pressable>
    </Pressable>
  );
}

function NewSessionButton({ onPress }: { onPress: () => void }) {
  const t = useTok();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New session"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 40,
        paddingHorizontal: 20,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#638DFF',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        shadowColor: '#0043FB',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: pressed ? 0.35 : 0.6,
        shadowRadius: pressed ? 4 : 8,
        opacity: pressed ? 0.96 : 1,
      })}
    >
      <LinearGradient
        colors={['#001651', '#0040F0']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 12 }}
      />
      <PixelMark name="plus" cell={2} gap={1} colors={{ '#': '#FFFFFF' }} />
      <Txt kind="label" style={{ color: '#FFFFFF', fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0 }}>
        New session
      </Txt>
    </Pressable>
  );
}

export function SessionsScreen({
  cfg,
  onOpen,
  onNew,
  onHost,
}: {
  cfg: HostConfig;
  onOpen: (id: string) => void;
  onNew: () => void;
  onHost: () => void;
}) {
  const t = useTok();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalInset = width < 420 ? 20 : 32;
  const titleSize = width < 640 ? 36 : 56;
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const [mac, setMac] = useState<MacStatsData | null>(null);
  const [macRx, setMacRx] = useState(0);
  const statsUnavailable = useRef(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const statsRequest = statsUnavailable.current
        ? Promise.resolve({ data: null, unsupported: true })
        : apiOptional<MacStatsData>(cfg, '/api/stats')
          .then((data) => ({ data, unsupported: data === null }))
          .catch(() => ({ data: null, unsupported: false }));
      const [sessions, statsResult] = await Promise.all([
        api<SessionInfo[]>(cfg, '/api/sessions'),
        statsRequest,
      ]);
      setList(sessions);
      if (statsResult.unsupported) statsUnavailable.current = true;
      if (statsResult.data) {
        setMac(statsResult.data);
        setMacRx(Date.now());
      }
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Can't reach the daemon.");
    }
  }, [cfg]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 10000);
    return () => clearInterval(interval);
  }, [load]);

  const end = async (id: string) => {
    try {
      await api<void>(cfg, `/api/sessions/${id}`, { method: 'DELETE' });
    } catch {}
    setTimeout(load, 400);
  };

  const liveCount = list?.filter((s) => s.attached).length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View
        style={{
          paddingHorizontal: horizontalInset,
          paddingTop: 32,
          paddingBottom: 24,
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <View style={{ gap: 16, flex: 1 }}>
          <Txt
            kind="display"
            accessibilityRole="header"
            style={{ fontSize: titleSize, lineHeight: titleSize, letterSpacing: -1.2, fontWeight: '400' }}
          >
            Sessions
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Txt kind="caption" tone="text2">{cfg.host}</Txt>
            {list ? (
              <>
                <Txt kind="caption" tone="text2">·</Txt>
                <Txt kind="caption" tone="text2" style={tabular}>{`${list.length} total`}</Txt>
                <Txt kind="caption" tone="text2">·</Txt>
                <Txt kind="caption" tone="text2" style={tabular}>{`${liveCount} live`}</Txt>
              </>
            ) : null}
          </View>
        </View>
        <Button label="Host" kind="quiet" height={H.small} onPress={onHost} />
      </View>

      <MacStats data={mac} rx={macRx} live={!error} />

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: 96 + insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={t.accent}
            onRefresh={async () => {
              setRefreshing(true);
              statsUnavailable.current = false;
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {error ? (
          <Notice lead={<PixelMark name="failed" cell={2} colors={{ '#': t.statusBad }} />} text={error}>
            <Button label="Retry" kind="primary" height={H.small} onPress={load} />
          </Notice>
        ) : list === null ? (
          <View style={{ alignItems: 'center', paddingTop: 96 }}><WaitCells /></View>
        ) : list.length === 0 ? (
          <View
            style={{
              flexGrow: 1,
              minHeight: 360,
              justifyContent: 'center',
              paddingHorizontal: horizontalInset,
              paddingBottom: 40,
              gap: 24,
            }}
          >
            <PixelMark name="terminal" cell={4} colors={{ '#': '#A3A3A3', D: '#1A1A1A', B: t.accent, W: t.text }} />
            <View style={{ gap: 8, maxWidth: 360 }}>
              <Txt kind="title" style={{ fontSize: 22, lineHeight: 26, letterSpacing: -0.6, fontWeight: '400' }}>
                No sessions yet
              </Txt>
              <Txt kind="body" tone="text2" style={{ maxWidth: 300, lineHeight: 22 }}>
                Start a session to open a terminal on your Mac.
              </Txt>
            </View>
          </View>
        ) : (
          <View style={{ paddingHorizontal: horizontalInset, borderTopWidth: 1, borderTopColor: LINE }}>
            {list.map((s) => <Row key={s.id} s={s} onOpen={() => onOpen(s.id)} onEnd={() => end(s.id)} />)}
          </View>
        )}
      </ScrollView>

      {!error ? (
        <View style={{ position: 'absolute', left: horizontalInset, right: horizontalInset, bottom: 16 + insets.bottom }}>
          <NewSessionButton onPress={onNew} />
        </View>
      ) : null}
    </View>
  );
}
