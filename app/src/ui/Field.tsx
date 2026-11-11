import React, { useState } from 'react';
import { Pressable, TextInput, TextInputProps, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { H, R, Type, useTok } from '../theme/tokens';
import { Txt } from './Txt';

export function Field({
  label,
  secure,
  mono,
  ...rest
}: TextInputProps & { label: string; secure?: boolean; mono?: boolean }) {
  const t = useTok();
  const [focus, setFocus] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Txt kind="caption" tone="text2">{label}</Txt>
      <View
        style={{
          height: H.field, borderRadius: R.field,
          backgroundColor: focus ? t.fieldHover : t.field,
          flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
        }}
      >
        <TextInput
          {...rest}
          accessibilityLabel={label}
          secureTextEntry={secure && !shown}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholderTextColor={t.text2}
          selectionColor={t.accent}
          cursorColor={t.accent}
          onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
          style={[
            { flex: 1, padding: 0, color: t.text, fontSize: 15 },
            mono ? { fontFamily: Type.mono.fontFamily, fontSize: 13 } : null,
          ]}
        />
        {secure ? (
          <Pressable onPress={() => setShown((s) => !s)} hitSlop={12} accessibilityRole="button" accessibilityLabel={shown ? 'Hide token' : 'Show token'}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={t.text2} strokeWidth={1.5} strokeLinecap="round">
              {shown ? (
                <>
                  <Path d="M6.43385 6.51953C4.22009 7.89049 2.93281 9.86457 2.31858 11.0339C2.10621 11.4382 2.00003 11.6403 2 12.0082C1.99997 12.3761 2.10584 12.5777 2.3176 12.981C3.32862 14.9066 6.16702 19.0195 11.9669 19.0195C14.2454 19.0195 16.0669 18.3848 17.5 17.4972" />
                  <Path d="M9.87868 9.87868C9.33579 10.4216 9 11.1716 9 12C9 13.6569 10.3431 15 12 15C12.8284 15 13.5784 14.6642 14.1213 14.1213" />
                  <Path d="M2 2L22 22" />
                  <Path d="M10 5.14847C10.5934 5.05255 11.224 5 11.8936 5C17.7747 5 20.6528 9.05385 21.6779 10.9517C21.8927 11.3492 22 11.548 22 11.9106C22 12.2733 21.8921 12.4727 21.6765 12.8717C21.3678 13.4428 20.8916 14.2085 20.2167 15" />
                </>
              ) : (
                <>
                  <Path d="M2 12C2 12 5 5 12 5C19 5 22 12 22 12C22 12 19 19 12 19C5 19 2 12 2 12Z" />
                  <Path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" />
                </>
              )}
            </Svg>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}