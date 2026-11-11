import React, { ReactNode } from 'react';
import { View } from 'react-native';
import { R, useTok } from '../theme/tokens';
import { Txt } from './Txt';

export function Notice({ lead, text, children }: { lead?: ReactNode; text: string; children?: ReactNode }) {
  const t = useTok();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: 12, marginBottom: 8, minHeight: 48, borderRadius: R.nested,
        backgroundColor: t.control, flexDirection: 'row', alignItems: 'center',
        paddingLeft: 16, paddingRight: 8, gap: 12,
      }}
    >
      {lead}
      <Txt kind="body" style={{ flex: 1, paddingVertical: 12 }}>{text}</Txt>
      {children}
    </View>
  );
}