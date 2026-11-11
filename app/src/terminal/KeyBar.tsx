import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { H, R, Type, useTok } from '../theme/tokens';
import { Txt } from './../ui/Txt';

type Item =
  | { kind: 'send'; label: string; send: string }
  | { kind: 'ctrl' }
  | { kind: 'copy' }
  | { kind: 'paste' };

// Edit these. Quick actions type a command and press Return.
const ITEMS: Item[] = [
  { kind: 'send', label: 'esc', send: '\x1b' },
  { kind: 'send', label: 'tab', send: '\t' },
  { kind: 'ctrl' },
  { kind: 'send', label: '↑', send: '\x1b[A' },
  { kind: 'send', label: '↓', send: '\x1b[B' },
  { kind: 'send', label: '←', send: '\x1b[D' },
  { kind: 'send', label: '→', send: '\x1b[C' },
  { kind: 'send', label: '|', send: '|' },
  { kind: 'send', label: '~', send: '~' },
  { kind: 'send', label: '/', send: '/' },
  { kind: 'send', label: '-', send: '-' },
  { kind: 'send', label: '^C', send: '\x03' },
  { kind: 'send', label: '^D', send: '\x04' },
  { kind: 'copy' },
  { kind: 'paste' },
  { kind: 'send', label: 'opencode', send: 'opencode\r' },
  { kind: 'send', label: 'claude', send: 'claude\r' },
];

function Key({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const t = useTok();
  const [pressed, setPressed] = useState(false);
  const bg = active ? t.accentSoft : pressed ? t.controlPressed : t.control;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={{ height: H.key, minWidth: 40, paddingHorizontal: 12, borderRadius: R.field, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Txt kind="mono" tone={active ? 'accentText' : 'text'} style={{ fontFamily: Type.mono.fontFamily }}>{label}</Txt>
    </Pressable>
  );
}

export function KeyBar(props: {
  ctrl: boolean;
  bottom: number;
  onSend: (s: string) => void;
  onCtrl: () => void;
  onCopy: () => void;
  onPaste: () => void;
}) {
  const t = useTok();
  return (
    <View style={{ backgroundColor: t.bg, paddingTop: 6, paddingBottom: props.bottom + 6 }}>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 8, gap: 6 }}>
        {ITEMS.map((it, i) => {
          if (it.kind === 'ctrl') return <Key key={i} label="ctrl" active={props.ctrl} onPress={props.onCtrl} />;
          if (it.kind === 'copy') return <Key key={i} label="copy" onPress={props.onCopy} />;
          if (it.kind === 'paste') return <Key key={i} label="paste" onPress={props.onPaste} />;
          return <Key key={i} label={it.label} onPress={() => props.onSend(it.send)} />;
        })}
      </ScrollView>
    </View>
  );
}