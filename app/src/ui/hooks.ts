import { useEffect, useState } from 'react';
import { AccessibilityInfo, Dimensions, Keyboard, Platform } from 'react-native';

export function useReduceMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setR);
    const s = AccessibilityInfo.addEventListener('reduceMotionChanged', setR);
    return () => s.remove();
  }, []);
  return r;
}

export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const subs =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', (e) =>
              setH(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY)),
            ),
            Keyboard.addListener('keyboardWillHide', () => setH(0)),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height)),
            Keyboard.addListener('keyboardDidHide', () => setH(0)),
          ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return h;
}

export function useDelayed(active: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) {
      setOn(false);
      return;
    }
    const id = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return on;
}
