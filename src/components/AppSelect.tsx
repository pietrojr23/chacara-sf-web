import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { radii, spacing, typography } from '../constants/theme';
import { useAppTheme } from '../hooks/useAppTheme';

export interface AppSelectOption {
  label: string;
  value: string;
}

interface AppSelectProps {
  label: string;
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

export const AppSelect = ({ label, value, options, onChange, placeholder = 'Selecionar' }: AppSelectProps) => {
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(isDark, colors), [colors, isDark]);
  const [open, setOpen] = useState(false);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.trigger} onPress={() => setOpen((current) => !current)}>
        <Text style={styles.valueText}>{selectedLabel}</Text>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={20} color={colors.gray700} />
      </Pressable>

      {open ? (
        <View style={styles.optionsContainer}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                style={[styles.optionRow, selected && styles.optionRowSelected]}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                {selected ? <MaterialIcons name="check" size={18} color={colors.greenDark} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (isDark: boolean, colors: ReturnType<typeof useAppTheme>['colors']) => StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  label: {
    color: colors.gray700,
    fontSize: typography.size.body,
    fontWeight: typography.weight.semibold,
  },
  trigger: {
    minHeight: 50,
    borderRadius: radii.md,
    backgroundColor: isDark ? '#1F261F' : colors.gray100,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  valueText: {
    color: colors.gray900,
    fontSize: typography.size.body,
    fontWeight: typography.weight.medium,
    flex: 1,
  },
  optionsContainer: {
    borderWidth: 1,
    borderColor: isDark ? '#314131' : colors.gray300,
    borderRadius: radii.md,
    backgroundColor: isDark ? '#1E281E' : '#FFFFFF',
    overflow: 'hidden',
  },
  optionRow: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: isDark ? '#2B392B' : colors.gray100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  optionRowSelected: {
    backgroundColor: isDark ? '#243124' : '#EDF5EA',
  },
  optionText: {
    color: colors.gray900,
    fontSize: typography.size.body,
    fontWeight: typography.weight.medium,
    flex: 1,
  },
  optionTextSelected: {
    color: colors.greenDark,
    fontWeight: typography.weight.bold,
  },
});
