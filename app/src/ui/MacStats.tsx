import React from 'react';
import { View } from 'react-native';
import Svg, { G, Rect } from 'react-native-svg';
import type { MacStatsData } from '../lib/api';
import { ago } from '../lib/time';
import { tabular, useTok } from '../theme/tokens';
import { Txt } from './Txt';

const CELLS = 10;

function Cells({ pct, color }: { pct: number; color: string }) {
  const t = useTok();
  const lit = Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * CELLS));
  return (
    <Svg width={CELLS * 4 - 1} height={6}>
      <G shapeRendering="crispEdges">
        {Array.from({ length: CELLS }, (_, i) => (
          <Rect key={i} x={i * 4} y={0} width={3} height={6} fill={i < lit ? color : t.dust} />
        ))}
      </G>
    </Svg>
  );
}

export function describeMac(stats: MacStatsData): string {
  const parts: string[] = [];
  if (stats.battery != null) parts.push(`${stats.battery}%`);
  if (stats.charging) parts.push('Charging');
  else if (stats.source === 'ac') parts.push('Plugged in');
  else if (stats.remaining != null) parts.push(`${Math.floor(stats.remaining / 60)} h ${stats.remaining % 60} min left`);
  else parts.push('On battery');
  if (stats.lidClosed != null) parts.push(stats.lidClosed ? 'Lid closed' : 'Lid open');
  return parts.join(', ');
}

export function MacStats({ data, rx, live }: { data: MacStatsData | null; rx: number; live: boolean }) {
  const t = useTok();
  const low = data?.battery != null && data.battery < 20 && !data.charging && data.source === 'battery';
  const color = !data ? t.text : low ? t.statusBad : data.charging ? t.statusOK : t.text;
  return (
    <View style={{ height: 20, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {data ? (
        <>
          {data.battery != null ? <Cells pct={data.battery} color={color} /> : null}
          <Txt kind="caption" tone={low ? 'statusBad' : 'text2'} style={tabular} numberOfLines={1}>
            {describeMac(data)}{live ? '' : `, seen ${ago(new Date(rx).toISOString())}`}
          </Txt>
        </>
      ) : null}
    </View>
  );
}
