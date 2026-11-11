import React from 'react';
import { Text, TextProps } from 'react-native';
import { Palette, Type, useTok } from '../theme/tokens';

type Tone = 'text' | 'text2' | 'accentText' | 'statusBad' | 'onAccent';

export function Txt({
  kind = 'body',
  tone = 'text',
  style,
  ...rest
}: TextProps & { kind?: keyof typeof Type; tone?: Tone }) {
  const t: Palette = useTok();
  return <Text maxFontSizeMultiplier={1.2} {...rest} style={[Type[kind], { color: t[tone] }, style]} />;
}