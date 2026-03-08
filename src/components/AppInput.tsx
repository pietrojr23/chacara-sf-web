import { TextInput, StyleSheet, Text, View, KeyboardTypeOptions } from 'react-native';
import { palette, radii, spacing } from '../constants/theme';

interface AppInputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  editable?: boolean;
}

export const AppInput = ({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  editable = true,
}: AppInputProps) => {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.gray500}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        style={[styles.input, !editable && styles.inputReadonly, multiline && styles.multiline]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  label: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: palette.gray900,
  },
  inputReadonly: {
    backgroundColor: palette.gray100,
    borderColor: palette.gray300,
    color: palette.gray700,
  },
  multiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
