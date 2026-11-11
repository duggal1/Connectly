import React from 'react';
import { View } from 'react-native';
import { useTok } from '../theme/tokens';
import { PixelMark } from './Pixel';
import { Txt } from './Txt';

type Kind = 'live' | 'detached' | 'failed';

// Notched rectangle: 2 pt stepped corners, no radius, no stroke.
export function Badge({ kind, label }: { kind: Kind; label: string }) {
  const t = useTok();
  const bg = kind === 'live' ? t.accentSoft : t.control;
  const fg = kind === 'live' ? t.accentText : kind === 'failed' ? t.statusBad : t.text2;
  const mark = kind === 'failed' ? 'failed' : 'dot';
  const tone = kind === 'live' ? 'accentText' : kind === 'failed' ? 'statusBad' : 'text2';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 20 }}>
      <View style={{ width: 2, height: 16, backgroundColor: bg }} />
      <View style={{ height: 20, backgroundColor: bg, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 6 }}>
        <PixelMark name={mark} cell={1} colors={{ '#': fg }} />
        <Txt kind="caption" tone={tone as any} style={{ fontWeight: '500' }}>{label}</Txt>
      </View>
      <View style={{ width: 2, height: 16, backgroundColor: bg }} />
    </View>
  );
}