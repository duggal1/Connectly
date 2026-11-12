import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { G, Rect } from 'react-native-svg';
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

/*
 * Structure
 *   Purpose   see which sessions are running, open one, end one, start one.
 *   Primary   the running count and the roster: one cell per session.
 *   Idea      the roster IS the list. Each session is one cell, the same cell
 *             that sits at the left of its row. Press a row or a cell and the
 *             rest of the roster steps down to 25%, the readout names it.
 *             Tabs filter the roster the same way.
 *   States    loading, error, empty, none-in-tab, running, idle, stale.
 *   Tokens    cell 12 / gap 2 / radius 2, row 56, segmented 28 (items 24),
 *             one accent (t.accent). Status hues live only in cells, marks and
 *             tag text: green running, blue idle, orange stale, rose error.
 */

const LINE = '#1F1F1F';
const CELL = 12;
const GAP = 2;
const CELL_OFF = '#202020'; // --control
const THUMB = '#2C2C2C'; // one step above --control
const BLUE = '#60A5FA'; // --okay
const ORANGE = '#FB923C';
const EASE = Easing.bezier(0.23, 1, 0.32, 1);

// A detached session older than this reads as stale
const STALE_MS = 60 * 60 * 1000;

type Tok = ReturnType<typeof useTok>;
type Status = 'live' | 'idle' | 'stale';
type Filter = 'all' | Status;

const LABEL: Record<Status, string> = { live: 'Running', idle: 'Idle', stale: 'Stale' };
const RANK: Record<Status, number> = { live: 0, idle: 1, stale: 2 };
const hue = (t: Tok, s: Status) => (s === 'live' ? t.statusOK : s === 'idle' ? BLUE : ORANGE);

// Pixel marks. '1' = body, '2' = head. A missing colour is a cut-out.
const BITS = {
  ring: ['..111..', '.1...1.', '1.....1', '1..2..1', '1.....1', '.1...1.', '..111..'],
  warn: ['...1...', '..111..', '.11211.', '.11211.', '1111111', '1112111', '1111111'],
  dot: ['.11.', '1111', '1111', '.11.'],
} as const;

function Bits({ name, colors, cell = 2 }: { name: keyof typeof BITS; colors: Record<string, string>; cell?: number }) {
  const rows = BITS[name];
  const rects: React.ReactElement[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = colors[row[x]];
      if (fill) rects.push(<Rect key={`${x}-${y}`} x={x * cell} y={y * cell} width={cell} height={cell} fill={fill} />);
    }
  });
  return (
    <Svg
      width={rows[0].length * cell}
      height={rows.length * cell}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <G shapeRendering="crispEdges">{rects}</G>
    </Svg>
  );
}

function StatusMark({ status }: { status: Status }) {
  const t = useTok();
  if (status === 'live') return <Bits name="ring" colors={{ '1': t.statusOK, '2': t.text }} />;
  if (status === 'stale') return <Bits name="warn" colors={{ '1': ORANGE }} />;
  return <Bits name="dot" colors={{ '1': BLUE }} />;
}

function Tag({ status }: { status: Status }) {
  const t = useTok();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 14, alignItems: 'center' }}>
        <StatusMark status={status} />
      </View>
      <Txt kind="caption" style={{ color: hue(t, status) }}>{LABEL[status]}</Txt>
    </View>
  );
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let on = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (on) setReduce(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { on = false; sub.remove(); };
  }, []);
  return reduce;
}

function toMs(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : new Date(v as string).getTime();
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n; // seconds or milliseconds
}

function statusOf(s: SessionInfo, now: number): Status {
  if (s.attached) return 'live';
  const at = toMs(s.detachedAt ?? s.created);
  return at !== null && now - at >= STALE_MS ? 'stale' : 'idle';
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up.';
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

/* ---------------------------------------------------------------- roster */

function Cell({
  color,
  dim,
  index,
  reduce,
  label,
  onHot,
}: {
  color: string;
  dim: boolean;
  index: number;
  reduce: boolean;
  label: string;
  onHot: (on: boolean) => void;
}) {
  const fill = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  // Cells start empty, then fill in order, once
  useEffect(() => {
    if (reduce) {
      fill.setValue(1);
      return;
    }
    const a = Animated.timing(fill, {
      toValue: 1,
      duration: 160,
      delay: Math.min(index * 12, 300),
      easing: EASE,
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [reduce, index, fill]);

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: dim ? 0.25 : 1,
      duration: reduce ? 0 : 100,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [dim, reduce, opacity]);

  return (
    <Pressable
      accessibilityRole="text"
      accessibilityLabel={label}
      hitSlop={2}
      onPressIn={() => onHot(true)}
      onPressOut={() => onHot(false)}
    >
      <Animated.View
        style={{
          width: CELL,
          height: CELL,
          borderRadius: 2,
          opacity,
          backgroundColor: fill.interpolate({ inputRange: [0, 1], outputRange: [CELL_OFF, color] }),
        }}
      />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ tabs */

function Segmented({
  value,
  onChange,
  items,
  reduce,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
  items: { key: Filter; label: string; count: number }[];
  reduce: boolean;
}) {
  const t = useTok();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const idx = Math.max(0, items.findIndex((i) => i.key === value));
  const seg = width > 0 ? Math.floor((width - 4) / items.length) : 0;

  useEffect(() => {
    Animated.timing(x, {
      toValue: idx * seg,
      duration: reduce ? 0 : 280,
      easing: EASE,
      useNativeDriver: true,
    }).start();
  }, [idx, seg, reduce, x]);

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {seg > 0 ? (
        <View
          style={{
            width: seg * items.length + 4,
            height: 28,
            padding: 2,
            borderRadius: 14,
            overflow: 'hidden',
            backgroundColor: CELL_OFF,
            flexDirection: 'row',
          }}
        >
          <Animated.View
            style={{
              position: 'absolute',
              top: 2,
              left: 2,
              width: seg,
              height: 24,
              borderRadius: 12,
              backgroundColor: THUMB,
              transform: [{ translateX: x }],
            }}
          />
          {items.map((i) => {
            const on = i.key === value;
            return (
              <Pressable
                key={i.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on, disabled: i.count === 0 && i.key !== 'all' }}
                accessibilityLabel={`${i.label}, ${i.count}`}
                onPress={() => onChange(i.key)}
                style={{
                  width: seg,
                  height: 24,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  opacity: i.count === 0 && !on ? 0.4 : 1,
                }}
              >
                <Txt kind="caption" tone={on ? 'text' : 'text2'} style={{ fontWeight: '500' }}>{i.label}</Txt>
                <Txt kind="caption" tone="text2" style={tabular}>{String(i.count)}</Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ rows */

function Row({
  s,
  status,
  onOpen,
  onEnd,
  onHot,
}: {
  s: SessionInfo;
  status: Status;
  onOpen: () => void;
  onEnd: () => void;
  onHot: (id: string | null) => void;
}) {
  const t = useTok();
  const [pressed, setPressed] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const shell = s.shell.split('/').pop() ?? s.shell;
  const detail = s.attached ? 'In use' : `Detached ${ago(s.detachedAt ?? s.created)}`;

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
      accessibilityLabel={`Open ${shell} session ${s.id.slice(0, 4)}, ${LABEL[status]}`}
      onPressIn={() => { setPressed(true); onHot(s.id); }}
      onPressOut={() => { setPressed(false); onHot(null); }}
      onPress={onOpen}
      style={{
        paddingHorizontal: 0,
        paddingVertical: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        backgroundColor: pressed ? t.controlHover : 'transparent',
        borderBottomWidth: 1,
        borderBottomColor: LINE,
      }}
    >
      <View style={{ width: 16, alignItems: 'flex-start' }}>
        <View style={{ width: CELL, height: CELL, borderRadius: 2, backgroundColor: hue(t, status) }} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt kind="label" style={{ fontSize: 15, lineHeight: 19, letterSpacing: -0.25 }}>
          {`${shell} ${s.id.slice(0, 4)}`}
        </Txt>
        <Tag status={status} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Txt kind="caption" tone="text2" style={tabular}>{`${s.cols}x${s.rows}`}</Txt>
        <Txt kind="caption" tone="text2">{detail}</Txt>
      </View>
      <Pressable
        onPress={end}
        accessibilityRole="button"
        accessibilityLabel={armed ? 'Confirm end session' : 'End session'}
        hitSlop={6}
        style={({ pressed }) => ({
          height: 32,
          minWidth: 48,
          paddingHorizontal: 8,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? t.controlPressed : 'transparent',
        })}
      >
        <Txt kind="caption" tone={armed ? 'statusBad' : 'text2'} style={{ fontWeight: '500', letterSpacing: 0.2 }}>
          {armed ? 'END?' : 'END'}
        </Txt>
      </Pressable>
    </Pressable>
  );
}

function NewSessionButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New session"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 40,
        paddingHorizontal: 20,
        borderRadius: 20,
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
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 20 }}
      />
      <PixelMark name="plus" cell={2} colors={{ '#': '#FFFFFF' }} />
      <Txt kind="label" style={{ color: '#FFFFFF', fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0 }}>
        New session
      </Txt>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- screen */

export function SessionsScreen({
  cfg,
  onOpen,
  onNew,
  onHost,
  onEnded,
}: {
  cfg: HostConfig;
  onOpen: (id: string) => void;
  onNew: () => void;
  onHost: () => void;
  onEnded?: (id: string) => void;
}) {
  const t = useTok();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const horizontalInset = width < 420 ? 20 : 32;
  const titleSize = width < 640 ? 36 : 56;
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const [mac, setMac] = useState<MacStatsData | null>(null);
  const [macRx, setMacRx] = useState(0);
  const statsUnavailable = useRef(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [hot, setHot] = useState<string | null>(null);

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
      onEnded?.(id);
    } catch {}
    setTimeout(load, 400);
  };

  // Running first, then idle, then stale
  const items = useMemo(() => {
    const now = Date.now();
    return (list ?? [])
      .map((s) => ({ s, status: statusOf(s, now) }))
      .sort((a, b) => RANK[a.status] - RANK[b.status]);
  }, [list]);

  const counts = useMemo<Record<Filter, number>>(() => {
    const c: Record<Filter, number> = { all: items.length, live: 0, idle: 0, stale: 0 };
    items.forEach((i) => { c[i.status] += 1; });
    return c;
  }, [items]);

  const visible = filter === 'all' ? items : items.filter((i) => i.status === filter);
  const hotItem = hot ? items.find((i) => i.s.id === hot) ?? null : null;
  const hasList = !error && list !== null && list.length > 0;

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'live', label: 'Running', count: counts.live },
    { key: 'idle', label: 'Idle', count: counts.idle },
    { key: 'stale', label: 'Stale', count: counts.stale },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
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
            <Txt kind="caption">{greeting()}</Txt>
            <Txt kind="caption" tone="text2">{cfg.host}</Txt>
          </View>
        </View>
        <Button label="Host" kind="secondary" height={H.small} style={{ paddingHorizontal: 16 }} onPress={onHost} />
      </View>

      <MacStats data={mac} rx={macRx} live={!error} />

      {hasList ? (
        <View style={{ paddingHorizontal: horizontalInset, paddingTop: 24 }}>
          {/* readout */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Txt
                  kind="display"
                  style={[tabular, { fontSize: 40, lineHeight: 40, letterSpacing: -1.6, fontWeight: '400', minWidth: 24 }]}
                >
                  {String(counts.live)}
                </Txt>
                <Txt kind="body" tone="text2" style={{ fontSize: 16 }}>running</Txt>
              </View>
              <Txt kind="caption" tone="text2" style={[tabular, { marginTop: 8 }]}>
                {`of ${counts.all} ${counts.all === 1 ? 'session' : 'sessions'}`}
              </Txt>
            </View>
            <View style={{ minWidth: 140, alignItems: 'flex-end', gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 21 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    opacity: hotItem ? 1 : 0,
                    backgroundColor: hotItem ? hue(t, hotItem.status) : CELL_OFF,
                  }}
                />
                <Txt kind="label">
                  {hotItem ? `${hotItem.s.shell.split('/').pop() ?? hotItem.s.shell} ${hotItem.s.id.slice(0, 4)}` : 'Press a cell'}
                </Txt>
              </View>
              <Txt kind="caption" tone="text2" style={tabular}>
                {hotItem ? `${LABEL[hotItem.status]}  ${hotItem.s.cols}x${hotItem.s.rows}` : '1 cell, 1 session'}
              </Txt>
            </View>
          </View>

          {/* roster */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginTop: 16 }}>
            {items.map(({ s, status }, i) => (
              <Cell
                key={s.id}
                index={i}
                reduce={reduce}
                color={hue(t, status)}
                dim={hot ? hot !== s.id : filter !== 'all' && status !== filter}
                label={`${s.shell.split('/').pop() ?? s.shell} ${s.id.slice(0, 4)}, ${LABEL[status]}`}
                onHot={(on) => setHot(on ? s.id : null)}
              />
            ))}
          </View>

          <View style={{ marginTop: 24 }}>
            <Segmented value={filter} onChange={setFilter} items={tabs} reduce={reduce} />
          </View>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingBottom: 96 + insets.bottom }}
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
            <PixelMark
              name="terminal"
              cell={4}
              colors={{
                '#': '#2A2A2A',
                T: '#1A1A1A',
                O: '#525252',
                D: '#0F0F0F',
                L: '#2E2E2E',
                B: t.accent,
                W: t.text,
              }}
            />
            <Txt kind="body" tone="text2" style={{ maxWidth: 280, lineHeight: 22 }}>
              Tap New session to open a terminal on your Mac.
            </Txt>
          </View>
        ) : visible.length === 0 ? (
          <View style={{ paddingHorizontal: horizontalInset, paddingTop: 24 }}>
            <Txt kind="body" tone="text2">{`No ${tabs.find((x) => x.key === filter)!.label.toLowerCase()} sessions.`}</Txt>
          </View>
        ) : (
          <View style={{ paddingHorizontal: horizontalInset, borderTopWidth: 1, borderTopColor: LINE }}>
            {visible.map(({ s, status }) => (
              <Row
                key={s.id}
                s={s}
                status={status}
                onHot={setHot}
                onOpen={() => onOpen(s.id)}
                onEnd={() => end(s.id)}
              />
            ))}
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
