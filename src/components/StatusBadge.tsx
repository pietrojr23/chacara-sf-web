import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing } from '../constants/theme';

interface StatusBadgeProps {
  text: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}

const toneStyles = {
  success: { background: '#E7F5E8', color: palette.greenDark },
  warning: { background: '#FFF6E0', color: '#8C6A00' },
  danger: { background: '#FDECEC', color: palette.danger },
  info: { background: '#EAF2FD', color: palette.info },
  neutral: { background: palette.gray100, color: palette.gray700 },
};

export const StatusBadge = ({ text, tone = 'neutral' }: StatusBadgeProps) => (
  <View style={[styles.container, { backgroundColor: toneStyles[tone].background }]}>
    <Text style={[styles.text, { color: toneStyles[tone].color }]}>{text}</Text>
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
