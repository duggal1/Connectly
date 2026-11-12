import React, { useCallback, useEffect, useState } from 'react';
import { Animated, BackHandler, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HostConfig } from '../lib/storage';
import { newKey, useTabs } from '../lib/tabs';
import { TerminalScreen } from '../terminal/TerminalScreen';
import { useTok } from '../theme/tokens';
import { TabBar } from '../ui/TabBar';
import { Fade } from '../ui/Fade';
import { useReduceMotion } from '../ui/hooks';
import { MacScreen } from './MacScreen';
import { SessionsScreen } from './SessionsScreen';
import { VisualScreen } from './VisualScreen';

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
          label: titles[tab.key] || (tab.session ? 'Terminal' : 'New'),
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
            <TerminalLayer key={tab.key} active={active}>
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
            </TerminalLayer>
          );
        })}

        {pane.kind === 'sessions' ? (
          <View style={cover}>
            <Fade k="sessions">
              <SessionsScreen
                cfg={cfg}
                onOpen={open}
                onNew={() => open()}
                onHost={onHost}
                onEnded={(session) => dispatch({ type: 'closeSession', session })}
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
