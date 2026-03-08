import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { palette, radii, spacing } from '../constants/theme';

export const AppCard = ({ children }: { children: ReactNode }) => <View style={styles.card}>{children}</View>;

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: palette.gray100,
    gap: spacing.md,
  },
});
