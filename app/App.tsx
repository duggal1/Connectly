import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { HostConfig } from './src/lib/storage';
import { loadHost } from './src/lib/storage';
import { useTok } from './src/theme/tokens';
import { Fade } from './src/ui/Fade';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { Workspace } from './src/screens/Workspace';

function Root() {
  const t = useTok();
  const [cfg, setCfg] = useState<HostConfig | null>(null);
  const [booted, setBooted] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    void loadHost().then((host) => {
      setCfg(host);
      setConnecting(!host);
      setBooted(true);
    }).catch(() => {
      setConnecting(true);
      setBooted(true);
    });
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (connecting && cfg) {
        setConnecting(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [connecting, cfg]);

  if (!booted) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      {cfg ? (
        <Workspace
          key={`${cfg.host}:${cfg.port}:${cfg.tls}:${cfg.token}`}
          cfg={cfg}
          onHost={() => setConnecting(true)}
        />
      ) : null}
      {connecting ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 10, backgroundColor: t.bg }]}>
          <Fade k="connect">
          <ConnectScreen
            initial={cfg}
            onDone={(host) => { setCfg(host); setConnecting(false); }}
            onCancel={cfg ? () => setConnecting(false) : undefined}
          />
          </Fade>
        </View>
      ) : null}
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
