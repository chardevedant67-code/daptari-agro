import React from 'react';
import {StyleSheet, View} from 'react-native';
import {COLORS, RADIUS, SHADOWS, SPACING} from '../theme';

export default function Card({children, style}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
});
