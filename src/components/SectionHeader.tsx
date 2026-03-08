import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing } from '../constants/theme';

export const SectionHeader = ({
  title,
  subtitle,
  rightElement,
}: {
  title: string;
  subtitle?: string;
  rightElement?: ReactNode;
}) => (
  <View style={styles.wrapper}>
    <View style={styles.texts}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
    {rightElement ? <View style={styles.right}>{rightElement}</View> : null}
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  title: {
    color: palette.gray900,
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
});
