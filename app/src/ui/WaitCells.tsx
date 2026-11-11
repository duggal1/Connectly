import React, { useEffect, useState } from 'react';
import Svg, { G, Rect } from 'react-native-svg';
import { useTok } from '../theme/tokens';
import { useReduceMotion } from './hooks';

// Indeterminate wait: three 2 pt cells, one lit, stepping every 160 ms.
export function WaitCells({
  activeColor,
  idleColor,
}: {
  activeColor?: string;
  idleColor?: string;
} = {}) {
  const t = useTok();
  const reduce = useReduceMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % 3), 160);
    return () => clearInterval(id);
  }, [reduce]);
  const lit = reduce ? 1 : i;
  return (
    <Svg width={14} height={2}>
      <G shapeRendering="crispEdges">
        {[0, 1, 2].map((k) => (
          <Rect
            key={k}
            x={k * 6}
            y={0}
            width={2}
            height={2}
            fill={k === lit ? activeColor ?? t.accent : idleColor ?? t.dust}
          />
        ))}
      </G>
    </Svg>
  );
}
