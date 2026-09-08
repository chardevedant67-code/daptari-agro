import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../theme';

export default function PrimaryButton({title, onPress, style, textStyle, disabled}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({pressed}) => [
        styles.btn,
        pressed && {opacity: 0.9},
        disabled && {backgroundColor: COLORS.labelMuted},
        style,
      ]}>
      <Text style={[styles.txt, textStyle]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 180,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.primary,
  },
  txt: {color: COLORS.white, fontWeight: '700', fontSize: 16},
});
