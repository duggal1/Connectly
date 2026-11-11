import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTok } from '../theme/tokens';
import { useReduceMotion } from './hooks';

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const t = useTok();
  const reduce = useReduceMotion();
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: value ? 1 : 0, duration: reduce ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value, reduce, x]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      onPress={() => { Haptics.selectionAsync().catch(() => {}); onChange(!value); }}
    >
      <Animated.View
        style={{
          width: 40, height: 24, borderRadius: 12,
          backgroundColor: x.interpolate({ inputRange: [0, 1], outputRange: [t.controlPressed, t.accent] }),
        }}
      >
        <Animated.View
          style={{
            position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF',
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 16] }) }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}