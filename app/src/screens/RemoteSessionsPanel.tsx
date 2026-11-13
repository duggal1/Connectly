import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Modal, Pressable, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { HostConfig } from '../lib/storage';
import { ago } from '../lib/time';
import { remoteApi } from '../lib/remote';
import type { LooseAgent, RemoteInfo, RemoteSession, RemoteSnapshot } from '../lib/remote';
import { H, R, tabular, useTok } from '../theme/tokens';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { PixelMark } from '../ui/Pixel';
import { Txt } from '../ui/Txt';
import { WaitCells } from '../ui/WaitCells';

const AGENT: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  aider: 'Aider',
};

function compactPath(path: string): string {
  if (!path) return '';
  const home = path.replace(/^\/Users\/[^/]+/, '~');
  if (home.length <= 40) return home;
  return `…/${home.split('/').slice(-2).join('/')}`;
}

function activityLabel(session: RemoteSession): string {
  if (session.state === 'shell') return 'Prompt';
  return session.state === 'running' ? 'Running' : `Idle ${ago(new Date(session.lastActive).toISOString())}`;
}

function RemoteRow({
  session,
  onOpen,
  onActions,
}: {
  session: RemoteSession;
  onOpen: () => void;
  onActions: () => void;
}) {
  const t = useTok();
  const label = AGENT[session.agent] ?? (session.state === 'shell' ? 'Shell' : session.command || 'Terminal');
  const statusColor = session.state === 'running' ? t.statusOK : session.state === 'idle' ? t.text2 : t.accentText;
  const clients = [
    session.macClients > 0 ? `${session.macClients} Mac` : '',
    session.phones > 0 ? `${session.phones} phone${session.phones === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${label}, ${session.name}, ${activityLabel(session)}`}
      onPress={onOpen}
      onLongPress={onActions}
      delayLongPress={300}
      style={({ pressed }) => ({
        minHeight: 68,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: R.nested,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? t.bg : 'transparent',
      })}
    >
      <PixelMark name="dot" cell={2} colors={{ '#': statusColor }} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Txt kind="label" numberOfLines={1}>{label}</Txt>
          <Txt kind="caption" tone="text2" numberOfLines={1}>{session.name}</Txt>
        </View>
        <Txt kind="caption" tone="text2" numberOfLines={1}>{compactPath(session.cwd) || session.title || session.command}</Txt>
        {session.preview ? <Txt kind="caption" tone="text2" numberOfLines={1} style={tabular}>{session.preview}</Txt> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3, minWidth: 76 }}>
        <Txt kind="caption" style={{ color: statusColor }}>{activityLabel(session)}</Txt>
        <Txt kind="caption" tone="text2" style={tabular}>{`${session.cols}×${session.rows}`}</Txt>
        <Txt kind="caption" tone="text2" numberOfLines={1}>{clients || 'Mac ready'}</Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${session.name}`}
        hitSlop={8}
        onPress={onActions}
        style={({ pressed }) => ({
          width: 32,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? t.bg : 'transparent',
        })}
      >
        <Txt kind="body" tone="text2" style={{ fontSize: 18, lineHeight: 20 }}>⋯</Txt>
      </Pressable>
    </Pressable>
  );
}

function OutsideRow({ agent, onStop }: { agent: LooseAgent; onStop: () => void }) {
  const t = useTok();
  return (
    <View style={{ minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <PixelMark name="dot" cell={2} colors={{ '#': agent.state === 'running' ? t.statusOK : t.text2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt kind="label">{AGENT[agent.agent] ?? agent.agent}</Txt>
        <Txt kind="caption" tone="text2" numberOfLines={1}>{compactPath(agent.cwd) || agent.tty}</Txt>
      </View>
      <Txt kind="caption" tone="text2" style={tabular}>{ago(new Date(agent.startedAt).toISOString())}</Txt>
      <Button label="Stop" kind="secondary" surface="field" height={H.small} onPress={onStop} />
    </View>
  );
}

export function RemoteSessionsPanel({
  cfg,
  refreshKey,
  onOpen,
  onEnded,
}: {
  cfg: HostConfig;
  refreshKey: number;
  onOpen: (id: string, name: string) => void;
  onEnded: (id: string) => void;
}) {
  const t = useTok();
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [info, setInfo] = useState<RemoteInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [renameTarget, setRenameTarget] = useState<RemoteSession | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const hasSnapshot = useRef(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (live) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { live = false; subscription.remove(); };
  }, []);

  const load = useCallback(async () => {
    const firstLoad = !hasSnapshot.current;
    if (firstLoad) setLoading(true);
    const [infoResult, listResult] = await Promise.allSettled([remoteApi.info(cfg), remoteApi.list(cfg)]);
    if (infoResult.status === 'fulfilled') setInfo(infoResult.value);
    if (listResult.status === 'fulfilled') {
      hasSnapshot.current = true;
      setSnapshot(listResult.value);
      setError('');
    } else {
      const status = listResult.reason instanceof Error && 'status' in listResult.reason
        ? Number(listResult.reason.status)
        : 0;
      setError(status === 503
        ? 'Install tmux on the Mac, then restart termd.'
        : listResult.reason instanceof Error ? listResult.reason.message : 'Could not load Mac terminals.');
    }
    setLoading(false);
  }, [cfg]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  const end = (session: RemoteSession) => {
    Alert.alert(`End ${session.name}?`, 'This stops the session on your Mac.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End session',
        style: 'destructive',
        onPress: () => {
          void remoteApi.end(cfg, session.id).then(() => {
            onEnded(session.id);
            void load();
          }).catch((reason: unknown) => {
            Alert.alert('Could not end session', reason instanceof Error ? reason.message : 'Request failed.');
          });
        },
      },
    ]);
  };

  const actions = (session: RemoteSession) => {
    Alert.alert(AGENT[session.agent] ?? session.name, session.cwd || session.title || session.command, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open', onPress: () => onOpen(session.id, session.name) },
      {
        text: 'Interrupt',
        onPress: () => { void remoteApi.interrupt(cfg, session.id).catch((reason: unknown) => Alert.alert('Could not interrupt', reason instanceof Error ? reason.message : 'Request failed.')); },
      },
      { text: 'Rename', onPress: () => { setRenameTarget(session); setRenameValue(session.name); } },
      { text: 'End session', style: 'destructive', onPress: () => end(session) },
    ]);
  };

  const stopOutside = (agent: LooseAgent) => {
    Alert.alert(`Stop ${AGENT[agent.agent] ?? agent.agent}?`, 'This process is outside the private tmux server and cannot be mirrored.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Interrupt',
        onPress: () => { void remoteApi.stopLoose(cfg, agent, 'int').then(load).catch((reason: unknown) => Alert.alert('Could not stop process', reason instanceof Error ? reason.message : 'Request failed.')); },
      },
      {
        text: 'Quit',
        style: 'destructive',
        onPress: () => { void remoteApi.stopLoose(cfg, agent, 'term').then(load).catch((reason: unknown) => Alert.alert('Could not stop process', reason instanceof Error ? reason.message : 'Request failed.')); },
      },
    ]);
  };

  const rename = async () => {
    if (!renameTarget || !renameValue.trim() || renameBusy) return;
    setRenameBusy(true);
    try {
      const result = await remoteApi.rename(cfg, renameTarget.id, renameValue.trim());
      setRenameTarget(null);
      await load();
      onOpen(result.id, result.name);
    } catch (reason: unknown) {
      Alert.alert('Could not rename session', reason instanceof Error ? reason.message : 'Request failed.');
    } finally {
      setRenameBusy(false);
    }
  };

  const sessions = snapshot?.sessions ?? [];
  const loose = snapshot?.loose ?? [];
  const running = sessions.filter((session) => session.state === 'running').length;
  const status = sessions.length
    ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}, ${running} active`
    : info?.available ? 'Private tmux sessions' : 'tmux required';

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 12 }}>
        <Txt kind="title">Mac terminals</Txt>
        <Txt kind="caption" tone="text2" style={tabular}>{status}</Txt>
      </View>

      {error ? (
        <Notice text={error} surface="well">
          <Button label="Retry" kind="secondary" height={H.small} onPress={() => void load()} />
        </Notice>
      ) : loading && snapshot === null ? (
        <View style={{ height: 56, justifyContent: 'center', paddingHorizontal: 12 }}><WaitCells /></View>
      ) : sessions.length ? (
        <View style={{ gap: 2, padding: 4, borderRadius: R.card, overflow: 'hidden', backgroundColor: t.well }}>
          {sessions.map((session) => (
            <RemoteRow
              key={session.id}
              session={session}
              onOpen={() => onOpen(session.id, session.name)}
              onActions={() => actions(session)}
            />
          ))}
        </View>
      ) : (
        <View style={{ paddingHorizontal: 12, paddingVertical: 12, gap: 8 }}>
          <Txt kind="caption" tone="text2">
            {info?.available
              ? 'Open a new Mac terminal after adding the hook to ~/.zshrc to mirror it here.'
              : 'Install tmux on the Mac to mirror terminals here. Existing non-tmux processes stay view-only.'}
          </Txt>
          {info?.hook ? (
            <Button
              label="Copy Mac hook"
              kind="secondary"
              surface="field"
              height={H.small}
              onPress={() => { void Clipboard.setStringAsync(info.hook); }}
            />
          ) : null}
          {info && !info.available ? (
            <Txt kind="caption" tone="text2">After installing tmux, restart termd and add the copied hook to your shell startup file.</Txt>
          ) : null}
        </View>
      )}

      {loose.length ? (
        <View style={{ paddingTop: 12, gap: 4 }}>
          <Txt kind="label" style={{ paddingHorizontal: 12 }}>Outside tmux</Txt>
          <Txt kind="caption" tone="text2" style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
            Visible and stoppable. These terminals cannot be attached after they have started.
          </Txt>
          <View style={{ gap: 2, padding: 4, borderRadius: R.card, overflow: 'hidden', backgroundColor: t.well }}>
            {loose.map((agent) => (
              <OutsideRow key={`${agent.pid}-${agent.startedAt}`} agent={agent} onStop={() => stopOutside(agent)} />
            ))}
          </View>
        </View>
      ) : null}

      <Modal transparent visible={renameTarget !== null} animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setRenameTarget(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: t.scrim }}>
          <Pressable accessibilityLabel="Close rename session" onPress={() => setRenameTarget(null)} style={{ flex: 1 }} />
          <View style={{ backgroundColor: t.well, borderTopLeftRadius: R.card, borderTopRightRadius: R.card, padding: 20, gap: 16 }}>
            <Txt kind="title">Rename session</Txt>
            <View style={{ height: H.field, borderRadius: R.field, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: t.field }}>
              <TextInput
                value={renameValue}
                onChangeText={setRenameValue}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={40}
                placeholder="Session name"
                placeholderTextColor={t.text2}
                selectionColor={t.accent}
                style={{ color: t.text, fontSize: 15, padding: 0 }}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              <Button label="Cancel" kind="secondary" surface="field" height={H.small} onPress={() => setRenameTarget(null)} />
              <Button label={renameBusy ? 'Saving' : 'Save'} kind="primary" height={H.small} disabled={!renameValue.trim() || renameBusy} onPress={() => void rename()} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
