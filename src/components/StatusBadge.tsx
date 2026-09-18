import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { palette, radii, spacing } from '../constants/theme';

interface StatusBadgeProps {
  text: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  containerStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const toneStyles = {
  success: { background: '#E7F5E8', color: palette.greenDark },
  warning: { background: '#FFF6E0', color: '#8C6A00' },
  danger: { background: '#FDECEC', color: palette.danger },
  info: { background: '#EAF2FD', color: palette.info },
  neutral: { background: palette.gray100, color: palette.gray700 },
};

export const StatusBadge = ({ text, tone = 'neutral', containerStyle, textStyle }: StatusBadgeProps) => (
  <View style={[styles.container, { backgroundColor: toneStyles[tone].background }, containerStyle]}>
    <Text style={[styles.text, { color: toneStyles[tone].color }, textStyle]}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
