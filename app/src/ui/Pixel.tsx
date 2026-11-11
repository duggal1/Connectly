import React from 'react';
import Svg, { G, Rect } from 'react-native-svg';

// '#' = cell, 'W' = white head, ':' = dust
// logo only: H = highlight, A = accent, D = shade, K = hub, W = spindle, L = loose cell
export const BITMAPS = {
  logo: [
    '....HHHHH.L.....',
    '..HHHHHHHA..L.L.',
    '.HHHHHHHAAA.A...',
    '.HHHHHHAAAAAA.L.',
    'HHHHHHAAAAAAAA..',
    'HHHHHAAAAAAAAAA.',
    'HHHHAAKKKKAAAAAA',
    'HHHAAAKWWKAAAAAA',
    'HHAAAAKWWKAAADDD',
    'HAAAAAKKKKAADDDD',
    'AAAAAAAAAAAADDDD',
    'AAAAAAAAAAADDDDD',
    '.AAAAAAAAADDDDD.',
    '.AAAAAAADDDDDDD.',
    '..AAAADDDDDDDD..',
    '....DDDDDDDD....',
  ],
  check: ['......#', '.....#.', '#...#..', '.#.#...', '..#....'],
  arrowLeft: ['..#....', '.#.....', '#######', '.#.....', '..#....'],
  arrowRight: ['....#..', '.....#.', '#######', '.....#.', '....#..'],
  plus: ['..#..', '..#..', '#####', '..#..', '..#..'],
  failed: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  dot: ['.##.', '####', '####', '.##.'],
  aperture: ['###', '#W#', '###'],
  lens: ['..###..', '.#...#.', '#.....#', '#..W..#', '#.....#', '.#...#.', '..###..'],
  terminal: [
    '.##################.',
    '#TOTOTOTTTTTTTTTTTT#',
    '####################',
    '#DDDDDDDDDDDDDDDDDD#',
    '#DDLLLLLLLLLLLDDDDD#',
    '#DDLLLLLLLDDDDDDDDD#',
    '#DDDDDDDDDDDDDDDDDD#',
    '#DDBDDDDDDDDDDDDDDD#',
    '#DDDBDDWWDDDDDDDDDD#',
    '#DDDDBDWWDDDDDDDDDD#',
    '#DDDBDDWWDDDDDDDDDD#',
    '#DDBDDDDDDDDDDDDDDD#',
    '#DDDDDDDDDDDDDDDDDD#',
    '.##################.',
  ],
  frameLock: [
    '###.....###',
    '#.........#',
    '#.........#',
    '...........',
    '.....:.....',
    '....:W:....',
    '.....:.....',
    '...........',
    '#.........#',
    '#.........#',
    '###.....###',
  ],
} as const;

export type BitmapName = keyof typeof BITMAPS;

// Logo palette, pulled from the site tokens
export const LOGO_COLORS: Record<string, string> = {
  H: '#3B82F6', // --accent-hover
  A: '#2563EB', // --accent
  D: '#1D4ED8', // shade
  K: '#0A0A0A', // hub
  W: '#FAFAFA', // --text
  L: '#60A5FA', // --okay, loose cells
};

export function PixelMark({
  name,
  cell = 2,
  gap = 0,
  colors,
}: {
  name: BitmapName;
  cell?: number;
  gap?: number;
  colors: Record<string, string>;
}) {
  const rows = BITMAPS[name];
  const step = cell + gap;
  const w = rows[0].length * cell + (rows[0].length - 1) * gap;
  const h = rows.length * cell + (rows.length - 1) * gap;
  const rects: React.ReactElement[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = colors[row[x]];
      if (fill) {
        rects.push(
          <Rect key={`${x}-${y}`} x={x * step} y={y * step} width={cell} height={cell} fill={fill} />
        );
      }
    }
  });
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <G shapeRendering="crispEdges">{rects}</G>
    </Svg>
  );
}

// Usage:
// <PixelMark name="logo" cell={4} colors={LOGO_COLORS} />
