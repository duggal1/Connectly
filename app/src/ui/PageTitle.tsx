import React from 'react';
import { View } from 'react-native';
import { useTok } from '../theme/tokens';
import { PixelMark } from './Pixel';
import { Txt } from './Txt';

// Every page title ends in the aperture: a 3x3 ring, accent rim, white head.
export function PageTitle({ children }: { children: string }) {
  const t = useTok();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }} accessibilityRole="header">
      <Txt kind="display">{children}</Txt>
      <View style={{ marginLeft: 2, marginBottom: 6 }}>
        <PixelMark name="aperture" cell={2} colors={{ '#': t.accent, W: t.text }} />
      </View>
    </View>
  );
}