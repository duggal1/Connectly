import React, { ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { useReduceMotion } from './hooks';

// Route change = opacity cross-fade only.
export function Fade({ k, children }: { k: string; children: ReactNode }) {
  const o = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();
  useEffect(() => {
    o.setValue(reduce ? 1 : 0);
    if (!reduce) Animated.timing(o, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [k, reduce, o]);
  return <Animated.View style={{ flex: 1, opacity: reduce ? 1 : o }}>{children}</Animated.View>;
}
