import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { palette, spacing } from '../constants/theme';

export const LoadingState = ({ label = 'Carregando...' }: { label?: string }) => (
  <View style={styles.container}>
    <ActivityIndicator color={palette.greenDark} size="large" />
    <Text style={styles.label}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  label: {
    color: palette.gray700,
    fontSize: 15,
  },
});
