import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HostConfig } from '../lib/storage';
import { newKey, useTabs } from '../lib/tabs';
import { TerminalScreen } from '../terminal/TerminalScreen';
import { useTok } from '../theme/tokens';
import { TabBar } from '../ui/TabBar';
import { MacScreen } from './MacScreen';
import { SessionsScreen } from './SessionsScreen';
import { VisualScreen } from './VisualScreen';

export function Workspace({ cfg, onHost }: { cfg: HostConfig; onHost: () => void }) {
  const theme = useTok();
  const insets = useSafeAreaInsets();
  const [state, dispatch, ready] = useTabs(cfg);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const { tabs, pane } = state;

  const open = useCallback((session?: string) => {
    dispatch({ type: 'open', key: newKey(), session });
  }, [dispatch]);

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
          label: titles[tab.key] || (tab.session ? `Term ${tab.session.slice(0, 4)}` : 'New'),
        }))}
        pane={pane}
        onShow={(nextPane) => dispatch({ type: 'show', pane: nextPane })}
        onClose={(key) => dispatch({ type: 'close', key })}
        onNew={() => open()}
      />

      <View style={{ flex: 1 }}>
        {tabs.map((tab) => {
          const active = pane.kind === 'tab' && pane.key === tab.key;
          return (
            <View
              key={tab.key}
              pointerEvents={active ? 'auto' : 'none'}
              style={[StyleSheet.absoluteFill, { opacity: active ? 1 : 0, zIndex: active ? 1 : 0 }]}
            >
              <TerminalScreen
                cfg={cfg}
                session={tab.session}
                active={active}
                onBound={(session) => dispatch({ type: 'bind', key: tab.key, session })}
                onTitle={(title) => setTitles((previous) => previous[tab.key] === title
                  ? previous
                  : { ...previous, [tab.key]: title })}
                onRestart={() => dispatch({ type: 'restart', key: tab.key, next: newKey() })}
              />
            </View>
          );
        })}

        {pane.kind === 'sessions' ? (
          <View style={cover}>
            <SessionsScreen
              cfg={cfg}
              onOpen={open}
              onNew={() => open()}
              onHost={onHost}
              onEnded={(session) => dispatch({ type: 'closeSession', session })}
            />
          </View>
        ) : null}

        {pane.kind === 'mac' ? (
          <View style={cover}>
            <MacScreen cfg={cfg} onScreen={() => dispatch({ type: 'show', pane: { kind: 'screen' } })} />
          </View>
        ) : null}

        {pane.kind === 'screen' ? (
          <View style={cover}>
            <VisualScreen cfg={cfg} onClose={() => dispatch({ type: 'show', pane: { kind: 'mac' } })} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
