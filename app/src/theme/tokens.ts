import { Platform, TextStyle } from 'react-native';

export interface Palette {
  mode: 'dark' | 'light';
  bg: string; surface: string; well: string;
  control: string; controlHover: string; controlPressed: string;
  field: string; fieldHover: string;
  text: string; text2: string;
  accent: string; accentHover: string; accentPressed: string; accentText: string; accentSoft: string; onAccent: string;
  statusOK: string; statusBad: string;
  wash: string; scrim: string;
  dust: string;
  ramp: [string, string, string, string, string];
}

const dark: Palette = {
  mode: 'dark',
  bg: '#000000', surface: '#121212', well: '#0A0A0A',
  control: '#202020', controlHover: '#181818', controlPressed: '#181818',
  field: '#101010', fieldHover: '#0C0C0C',
  text: '#FAFAFA', text2: '#A3A3A3',
  accent: '#2563EB', accentHover: '#3B82F6', accentPressed: '#1D4ED8',
  accentText: '#60A5FA', accentSoft: 'rgba(37,99,235,0.17)', onAccent: '#FAFAFA',
  statusOK: '#4ADE80', statusBad: '#F87171',
  wash: 'rgba(255,255,255,0.07)', scrim: 'rgba(0,0,0,0.55)',
  dust: '#2A2A2A',
  ramp: ['#171717', '#1E3A5F', '#1D4ED8', '#2563EB', '#60A5FA'],
};

export const useTok = (): Palette => dark;

// 4 pt grid
export const S = { 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 48: 48 } as const;
export const R = { card: 16, nested: 12, field: 8, chip: 6 } as const;
// Touch sizes (desktop spec scaled to 44 pt targets)
export const H = { button: 44, small: 32, field: 48, row: 56, bar: 52, key: 36 } as const;

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;
const serif = Platform.select({ ios: 'Georgia', default: 'serif' }) as string;

export const Type: Record<'caption' | 'body' | 'label' | 'title' | 'metric' | 'mono' | 'display', TextStyle> = {
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0 },
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.2 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500', letterSpacing: -0.2 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '500', letterSpacing: -0.3 },
  metric: { fontSize: 28, lineHeight: 32, fontWeight: '500', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  mono: { fontFamily: mono, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  // Display face: serif italic, page titles only. Vinci Italic isn't available, so this is a system stand-in.
  display: { fontFamily: serif, fontStyle: 'italic', fontSize: 28, lineHeight: 30, fontWeight: '400', letterSpacing: -1.4 },
};

export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };
