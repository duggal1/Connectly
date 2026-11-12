import React, { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { H, useTok } from '../theme/tokens';
import { BitmapName, PixelMark } from './Pixel';
import { Txt } from './Txt';
import { WaitCells } from './WaitCells';

type Kind = 'primary' | 'secondary' | 'quiet';

export function Button({
  label,
  onPress,
  kind = 'secondary',
  height = H.button,
  disabled,
  loading = false,
  surface = 'control',
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: Kind;
  height?: number;
  disabled?: boolean;
  loading?: boolean;
  surface?: 'control' | 'field';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTok();
  const sc = useRef(new Animated.Value(1)).current;
  const [pressed, setPressed] = useState(false);
  const eff: Kind = kind === 'primary' && disabled && !loading ? 'secondary' : kind;
  const bg =
    eff === 'primary' ? (pressed ? t.accentPressed : t.accent)
    : eff === 'secondary' ? (pressed ? t[surface === 'field' ? 'fieldHover' : 'controlPressed'] : t[surface])
    : pressed ? t.controlHover : 'transparent';
  const fg =
    eff === 'primary' ? t.onAccent
    : eff === 'secondary' ? (disabled ? t.text2 : t.text)
    : pressed ? t.text : t.text2;
  const to = (v: number, d: number) =>
    Animated.timing(sc, { toValue: v, duration: d, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();

  const isPrimary = eff === 'primary';
  const h = isPrimary ? 42 : height;
  const radius = isPrimary ? h / 2 : height / 2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: loading }}
      disabled={disabled}
      onPressIn={() => { setPressed(true); to(0.98, 90); }}
      onPressOut={() => { setPressed(false); to(1, 140); }}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
    >
      <Animated.View
        style={[
          {
            height: h,
            paddingHorizontal: isPrimary ? 19 : (height >= 40 ? 20 : 12),
            borderRadius: radius,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: sc }],
            opacity: disabled && kind !== 'primary' ? 0.4 : 1,
            overflow: 'hidden',
            borderWidth: isPrimary ? 1 : 0,
            borderColor: isPrimary ? '#638DFF' : 'transparent',
            // inset glow approximated via shadow
            shadowColor: isPrimary ? '#0043FB' : 'transparent',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: isPrimary ? 0.6 : 0,
            shadowRadius: isPrimary ? 6 : 0,
          },
          style,
        ]}
      >
        {isPrimary ? (
          <LinearGradient
            colors={pressed ? ['#000F3A', '#002FCC'] : ['#001651', '#0040F0']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius }}
          />
        ) : null}
        <View style={{ backgroundColor: isPrimary ? 'transparent' : bg, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius }} />
        <View style={{ zIndex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt kind="label" style={{ color: isPrimary ? '#FFFFFF' : fg, fontSize: isPrimary ? 15 : undefined, fontWeight: isPrimary ? '500' : undefined }}>{label}</Txt>
          {loading ? <WaitCells activeColor="#93C5FD" idleColor="rgba(255,255,255,0.45)" /> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = 'text',
}: {
  icon: BitmapName;
  label: string;
  onPress: () => void;
  tone?: 'text' | 'text2' | 'accent';
}) {
  const t = useTok();
  const [pressed, setPressed] = useState(false);
  const color = tone === 'accent' ? t.accent : tone === 'text2' ? t.text2 : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onPress}
      hitSlop={4}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: 36, height: 36, borderRadius: 14, overflow: 'hidden',
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: pressed ? t.controlHover : 'transparent',
        }}
      >
        <PixelMark name={icon} cell={2} colors={{ '#': color }} />
      </View>
    </Pressable>
  );
}
