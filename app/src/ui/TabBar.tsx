import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Pane } from '../lib/tabs';
import { useTok } from '../theme/tokens';
import { IconButton } from './Button';
import { PixelMark } from './Pixel';
import { Txt } from './Txt';

export interface TabItem {
  key: string;
  label: string;
}

function Chip({
  label,
  selected,
  onPress,
  onClose,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  onClose?: () => void;
}) {
  const theme = useTok();
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={{
        height: 36,
        maxWidth: 168,
        borderRadius: 18,
        paddingLeft: 12,
        paddingRight: onClose ? 4 : 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: selected ? theme.control : pressed ? theme.wash : 'transparent',
      }}
    >
      <Txt kind="label" tone={selected ? 'text' : 'text2'} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      {onClose ? (
        <Pressable
          onPress={onClose}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Close ${label}`}
          style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
        >
          <PixelMark name="failed" cell={1} colors={{ '#': theme.text2 }} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function TabBar({
  items,
  pane,
  onShow,
  onClose,
  onNew,
}: {
  items: TabItem[];
  pane: Pane;
  onShow: (pane: Pane) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}) {
  return (
    <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Chip label="Sessions" selected={pane.kind === 'sessions'} onPress={() => onShow({ kind: 'sessions' })} />
        <Chip
          label="Mac"
          selected={pane.kind === 'mac' || pane.kind === 'screen'}
          onPress={() => onShow({ kind: 'mac' })}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 4, paddingLeft: 8, alignItems: 'center' }}
      >
        {items.map((item) => (
          <Chip
            key={item.key}
            label={item.label}
            selected={pane.kind === 'tab' && pane.key === item.key}
            onPress={() => onShow({ kind: 'tab', key: item.key })}
            onClose={() => onClose(item.key)}
          />
        ))}
      </ScrollView>
      <IconButton icon="plus" label="New terminal" onPress={onNew} />
    </View>
  );
}
