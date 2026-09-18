import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { radii, spacing, typography } from '../constants/theme';
import { useAppTheme } from '../hooks/useAppTheme';

interface AppCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export const AppCheckbox = ({ label, checked, onChange }: AppCheckboxProps) => {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(isDark, colors), [colors, isDark]);

  return (
    <Pressable style={styles.container} onPress={() => onChange(!checked)}>
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <MaterialIcons name="check" size={16} color="#FFFFFF" /> : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
};

const createStyles = (isDark: boolean, colors: ReturnType<typeof useAppTheme>['colors']) => StyleSheet.create({
  container: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: isDark ? '#9DB39D' : colors.gray300,
    backgroundColor: isDark ? '#263226' : '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.greenDark,
    borderColor: colors.greenDark,
  },
  label: {
    color: colors.gray900,
    fontSize: typography.size.body,
    fontWeight: typography.weight.semibold,
    flexShrink: 1,
  },
});
