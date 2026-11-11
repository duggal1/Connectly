import React from 'react';
import Svg, { G, Rect } from 'react-native-svg';
import { useTok } from '../theme/tokens';

const COLS = 24, P = 4, C = 3, ROWS = 4;

// Column height = round-trip bucket: <=30 ms 1 cell, <=80 ms 2, <=200 ms 3, above 4.
// Missed heartbeat = one rose cell. Newest sample white. Empty slots are dust.
export function LinkStrip({ samples }: { samples: (number | null)[] }) {
  const t = useTok();
  const tail = samples.slice(-COLS);
  const padded: (number | null | undefined)[] = [...Array(COLS - tail.length).fill(undefined), ...tail];
  const rects: React.ReactElement[] = [];
  padded.forEach((s, i) => {
    const x = i * P;
    if (s === undefined) {
      rects.push(<Rect key={`d${i}`} x={x + 1} y={(ROWS - 1) * P + 1} width={1} height={1} fill={t.dust} />);
      return;
    }
    if (s === null) {
      rects.push(<Rect key={`m${i}`} x={x} y={(ROWS - 1) * P} width={C} height={C} fill={t.statusBad} />);
      return;
    }
    const h = s <= 30 ? 1 : s <= 80 ? 2 : s <= 200 ? 3 : 4;
    const fill = i === COLS - 1 ? t.text : i >= COLS - 8 ? t.ramp[3] : t.ramp[2];
    for (let r = 0; r < h; r++) {
      rects.push(<Rect key={`${i}-${r}`} x={x} y={(ROWS - 1 - r) * P} width={C} height={C} fill={fill} />);
    }
  });
  return (
    <Svg width={COLS * P - 1} height={ROWS * P - 1} accessibilityLabel="Link latency history">
      <G shapeRendering="crispEdges">{rects}</G>
    </Svg>
  );
}