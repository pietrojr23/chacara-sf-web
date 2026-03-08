import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing } from '../constants/theme';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
}

export const EmptyState = ({ title, subtitle }: EmptyStateProps) => (
  <View style={styles.container}>
    <Text style={styles.title}>{title}</Text>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.gray900,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: palette.gray700,
    textAlign: 'center',
  },
});
