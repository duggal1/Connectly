import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HostConfig, loadHost } from './src/lib/storage';
import { useTok } from './src/theme/tokens';
import { Fade } from './src/ui/Fade';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { SessionsScreen } from './src/screens/SessionsScreen';
import { TerminalScreen } from './src/terminal/TerminalScreen';

type Route =
  | { name: 'boot' }
  | { name: 'connect'; first: boolean }
  | { name: 'sessions' }
  | { name: 'terminal'; session?: string; key: number };

function Root() {
  const t = useTok();
  const [cfg, setCfg] = useState<HostConfig | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const keyRef = useRef(0);

  useEffect(() => {
    loadHost().then((h) => {
      setCfg(h);
      setRoute(h ? { name: 'sessions' } : { name: 'connect', first: true });
    });
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'terminal') { setRoute({ name: 'sessions' }); return true; }
      if (route.name === 'connect' && !route.first) { setRoute({ name: 'sessions' }); return true; }
      return false;
    });
    return () => sub.remove();
  }, [route]);

  const openTerminal = (session?: string) => setRoute({ name: 'terminal', session, key: ++keyRef.current });
  const fadeKey = route.name === 'terminal' ? `t${route.key}` : route.name;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      <Fade k={fadeKey}>
        {route.name === 'connect' ? (
          <ConnectScreen
            initial={cfg}
            onDone={(h) => { setCfg(h); setRoute({ name: 'sessions' }); }}
            onCancel={route.first ? undefined : () => setRoute({ name: 'sessions' })}
          />
        ) : route.name === 'sessions' && cfg ? (
          <SessionsScreen
            cfg={cfg}
            onOpen={openTerminal}
            onNew={() => openTerminal(undefined)}
            onHost={() => setRoute({ name: 'connect', first: false })}
          />
        ) : route.name === 'terminal' && cfg ? (
          <TerminalScreen
            key={route.key}
            cfg={cfg}
            session={route.session}
            onBack={() => setRoute({ name: 'sessions' })}
            onRestart={() => openTerminal(undefined)}
          />
        ) : null}
      </Fade>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}