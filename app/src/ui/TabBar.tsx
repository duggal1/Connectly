import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Pane } from '../lib/tabs';
import { H, useTok } from '../theme/tokens';
import { IconButton } from './Button';
import { PixelMark } from './Pixel';
import { Txt } from './Txt';

export interface TabItem {
  key: string;
  label: string;
}

function RouteChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
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
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed
          ? selected ? theme.controlPressed : theme.controlHover
          : selected ? theme.control : 'transparent',
      }}
    >
      <Txt kind="label" tone={selected ? 'text' : 'text2'} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

function SessionChip({
  item,
  selected,
  onShow,
  onClose,
}: {
  item: TabItem;
  selected: boolean;
  onShow: () => void;
  onClose: () => void;
}) {
  const theme = useTok();
  const [pressed, setPressed] = useState(false);
  const [closePressed, setClosePressed] = useState(false);
  return (
    <View
      style={{
        height: 36,
        maxWidth: 176,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 18,
        overflow: 'hidden',
        paddingLeft: 12,
        paddingRight: 4,
        backgroundColor: pressed
          ? selected ? theme.controlPressed : theme.controlHover
          : selected ? theme.control : 'transparent',
      }}
    >
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={item.label}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onShow();
        }}
        style={{ minWidth: 36, maxWidth: 136, height: 36, justifyContent: 'center' }}
      >
        <Txt kind="label" tone={selected ? 'text' : 'text2'} numberOfLines={1}>{item.label}</Txt>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${item.label}`}
        hitSlop={4}
        onPressIn={() => setClosePressed(true)}
        onPressOut={() => setClosePressed(false)}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onClose();
        }}
        style={{
          width: 28,
          height: 32,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: closePressed ? theme.controlPressed : 'transparent',
        }}
      >
        <Txt kind="body" tone="text2" style={{ fontSize: 18, lineHeight: 20 }}>×</Txt>
      </Pressable>
    </View>
  );
}

function NewTerminal({ onPress }: { onPress: () => void }) {
  const theme = useTok();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="New terminal"
      hitSlop={4}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.controlPressed : 'transparent',
      })}
    >
      <PixelMark name="plus" cell={3} colors={{ '#': theme.text }} />
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
  const theme = useTok();
  const inTerminal = pane.kind === 'tab';
  const onMac = pane.kind === 'mac' || pane.kind === 'screen';
  return (
    <View style={{ height: H.bar, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 }}>
      {inTerminal ? (
        <IconButton icon="arrowLeft" label="Back to sessions" onPress={() => onShow({ kind: 'sessions' })} />
      ) : (
        <View
          style={{
            height: 36,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            padding: 2,
            borderRadius: 18,
            backgroundColor: theme.well,
          }}
        >
          <RouteChip label="Sessions" selected={!onMac} onPress={() => onShow({ kind: 'sessions' })} />
          <RouteChip label="Mac" selected={onMac} onPress={() => onShow({ kind: 'mac' })} />
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{ flex: 1, minWidth: 0 }}
        contentContainerStyle={{ gap: 4, paddingLeft: 4, paddingRight: 4, alignItems: 'center' }}
      >
        {items.map((item) => (
          <SessionChip
            key={item.key}
            item={item}
            selected={pane.kind === 'tab' && pane.key === item.key}
            onShow={() => onShow({ kind: 'tab', key: item.key })}
            onClose={() => onClose(item.key)}
          />
        ))}
      </ScrollView>
      <NewTerminal onPress={onNew} />
    </View>
  );
}
