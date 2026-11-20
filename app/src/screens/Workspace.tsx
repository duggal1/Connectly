import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HostConfig } from '../lib/storage';
import { remoteApi } from '../lib/remote';
import type { LooseAgent, RemoteInfo, RemoteSession, RemoteSnapshot } from '../lib/remote';
import { newKey, useTabs } from '../lib/tabs';
import { TerminalScreen } from '../terminal/TerminalScreen';
import { useTok } from '../theme/tokens';
import { TabBar } from '../ui/TabBar';
import { Fade } from '../ui/Fade';
import { useReduceMotion } from '../ui/hooks';
import { MacScreen } from './MacScreen';
import { SessionsScreen } from './SessionsScreen';
import { VisualScreen } from './VisualScreen';

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  aider: 'Aider',
};

function terminalLabel(title: string | undefined): string {
  const value = (title ?? '').trim();
  const normalized = value.toLowerCase();
  for (const [key, label] of Object.entries(AGENT_LABELS)) {
    if (normalized.includes(key)) return label;
  }
  if (!value || value.length > 24 || value.includes('/')) return 'Terminal';
  return value;
}

function TerminalLayer({ active, children }: { active: boolean; children: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const opacity = React.useRef(new Animated.Value(active ? 1 : 0)).current;
  const visibleOpacity = reduceMotion ? (active ? 1 : 0) : opacity;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(active ? 1 : 0);
      return;
    }
    Animated.timing(opacity, {
      toValue: active ? 1 : 0,
      duration: 180,
      easing: Easing.bezier(0.23, 1, 0.32, 1),
      useNativeDriver: true,
    }).start();
  }, [active, opacity, reduceMotion]);

  return (
    <Animated.View
      pointerEvents={active ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { opacity: visibleOpacity, zIndex: active ? 1 : 0 }]}
    >
      {children}
    </Animated.View>
  );
}

export function Workspace({ cfg, onHost }: { cfg: HostConfig; onHost: () => void }) {
  const theme = useTok();
  const insets = useSafeAreaInsets();
  const [state, dispatch, ready] = useTabs(cfg);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [remoteSnapshot, setRemoteSnapshot] = useState<RemoteSnapshot | null>(null);
  const [remoteInfo, setRemoteInfo] = useState<RemoteInfo | null>(null);
  const [remoteError, setRemoteError] = useState('');
  const [remoteLoading, setRemoteLoading] = useState(true);
  const remoteRequest = useRef(false);
  const remoteSessions = remoteSnapshot?.sessions ?? [];
  const looseAgents = remoteSnapshot?.loose ?? [];
  const { tabs, pane } = state;
  const availableCounts = new Map<string, number>();
  const availableItems = [
    ...remoteSessions.map((session) => ({
      key: session.id,
      label: AGENT_LABELS[session.agent] ?? session.name,
      at: session.createdAt,
      kind: 'remote' as const,
    })),
    ...looseAgents.map((agent) => ({
      key: `process-${agent.pid}-${agent.startedAt}`,
      label: AGENT_LABELS[agent.agent] ?? agent.agent,
      at: agent.startedAt,
      kind: 'loose' as const,
    })),
  ].sort((a, b) => a.at - b.at).map((item) => {
    const count = (availableCounts.get(item.label) ?? 0) + 1;
    availableCounts.set(item.label, count);
    const label = `${item.label} ${count} · Mac`;
    const opened = item.kind === 'remote' && tabs.some((tab) => tab.remoteId === item.key);
    return { ...item, label, opened };
  });
  const tabLabels = new Map<string, string>();
  const tabCounts = new Map<string, number>();
  tabs.forEach((tab) => {
    if (tab.remoteId) {
      const item = availableItems.find((candidate) => candidate.key === tab.remoteId);
      const session = remoteSessions.find((candidate) => candidate.id === tab.remoteId);
      tabLabels.set(tab.key, item?.label ?? `${AGENT_LABELS[session?.agent ?? ''] ?? terminalLabel(tab.remoteName)} · Mac`);
      return;
    }
    const label = terminalLabel(titles[tab.key]);
    const count = (tabCounts.get(label) ?? 0) + 1;
    tabCounts.set(label, count);
    tabLabels.set(tab.key, `${label} ${count}`);
  });

  const open = useCallback((session?: string) => {
    dispatch({ type: 'open', key: newKey(), session });
  }, [dispatch]);

  const openRemote = useCallback((remoteId: string, remoteName: string) => {
    dispatch({ type: 'openRemote', key: newKey(), remoteId, remoteName });
  }, [dispatch]);

  const refreshRemote = useCallback(async () => {
    if (remoteRequest.current) return;
    remoteRequest.current = true;
    try {
      setRemoteSnapshot(await remoteApi.list(cfg));
      setRemoteError('');
    } catch (error: unknown) {
      setRemoteError(error instanceof Error ? error.message : 'Could not load Mac terminals.');
    } finally {
      remoteRequest.current = false;
      setRemoteLoading(false);
    }
  }, [cfg]);

  useEffect(() => {
    let active = true;
    void remoteApi.info(cfg).then((info) => { if (active) setRemoteInfo(info); }).catch(() => {});
    void refreshRemote();
    const interval = setInterval(() => void refreshRemote(), 5000);
    return () => { active = false; clearInterval(interval); };
  }, [cfg, refreshRemote]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pane.kind === 'screen') {
        dispatch({ type: 'show', pane: { kind: 'mac' } });
        return true;
      }
      if (pane.kind !== 'sessions') {
        dispatch({ type: 'show', pane: { kind: 'sessions' } });
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [pane, dispatch]);

  useEffect(() => {
    const liveKeys = new Set(tabs.map((tab) => tab.key));
    setTitles((previous) => {
      const next = Object.fromEntries(Object.entries(previous).filter(([key]) => liveKeys.has(key)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [tabs]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  const cover = [StyleSheet.absoluteFill, { zIndex: 2, backgroundColor: theme.bg }];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <TabBar
        items={tabs.map((tab) => ({
          key: tab.key,
          label: tabLabels.get(tab.key) ?? 'Terminal 1',
        }))}
        available={availableItems.filter((item) => !item.opened).map(({ key, label }) => ({ key, label }))}
        pane={pane}
        onShow={(nextPane) => dispatch({ type: 'show', pane: nextPane })}
        onClose={(key) => dispatch({ type: 'close', key })}
        onNew={() => open()}
        onOpenAvailable={(id) => {
          const session = remoteSessions.find((candidate) => candidate.id === id);
          if (session) openRemote(session.id, session.name);
          else {
            const agent = looseAgents.find((candidate) => `process-${candidate.pid}-${candidate.startedAt}` === id);
            if (agent) void remoteApi.focusLoose(cfg, agent).then(() => dispatch({ type: 'show', pane: { kind: 'screen' } })).catch((error: unknown) => {
              Alert.alert('Could not open terminal', error instanceof Error ? error.message : 'Request failed.');
            });
          }
        }}
      />

      <View style={{ flex: 1 }}>
        {tabs.map((tab) => {
          const active = pane.kind === 'tab' && pane.key === tab.key;
          return (
            <TerminalLayer key={tab.key} active={active}>
              <TerminalScreen
                cfg={cfg}
                session={tab.session}
                remoteId={tab.remoteId}
                remoteName={tab.remoteName}
                active={active}
                onBound={(session) => dispatch({ type: 'bind', key: tab.key, session })}
                onTitle={(title) => setTitles((previous) => previous[tab.key] === title
                  ? previous
                  : { ...previous, [tab.key]: title })}
                onRestart={() => dispatch({ type: 'restart', key: tab.key, next: newKey() })}
              />
            </TerminalLayer>
          );
        })}

        {pane.kind === 'sessions' ? (
          <View style={cover}>
            <Fade k="sessions">
              <SessionsScreen
                cfg={cfg}
                onOpen={open}
                onOpenRemote={openRemote}
                onOpenLoose={(agent) => { void remoteApi.focusLoose(cfg, agent).then(() => dispatch({ type: 'show', pane: { kind: 'screen' } })).catch((error: unknown) => Alert.alert('Could not open terminal', error instanceof Error ? error.message : 'Request failed.')); }}
                remoteSnapshot={remoteSnapshot}
                remoteInfo={remoteInfo}
                remoteError={remoteError}
                remoteLoading={remoteLoading}
                onRemoteRefresh={() => void refreshRemote()}
                onNew={() => open()}
                onHost={onHost}
                onEnded={(session) => dispatch({ type: 'closeSession', session })}
                onRemoteEnded={(remoteId) => dispatch({ type: 'closeRemote', remoteId })}
              />
            </Fade>
          </View>
        ) : null}

        {pane.kind === 'mac' ? (
          <View style={cover}>
            <Fade k="mac">
              <MacScreen cfg={cfg} onScreen={() => dispatch({ type: 'show', pane: { kind: 'screen' } })} />
            </Fade>
          </View>
        ) : null}

        {pane.kind === 'screen' ? (
          <View style={cover}>
            <Fade k="screen">
              <VisualScreen cfg={cfg} onClose={() => dispatch({ type: 'show', pane: { kind: 'mac' } })} />
            </Fade>
          </View>
        ) : null}
      </View>
    </View>
  );
}
