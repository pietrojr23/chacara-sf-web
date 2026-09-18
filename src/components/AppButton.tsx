import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { palette, radii, spacing } from '../constants/theme';

interface AppButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  loadingTimeoutMs?: number;
}

export const AppButton = ({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  loadingTimeoutMs = 12000,
}: AppButtonProps) => {
  const [loadingStuck, setLoadingStuck] = useState(false);
  const [internalLoading, setInternalLoading] = useState(false);

  const effectiveLoading = loading || internalLoading;

  useEffect(() => {
    if (!effectiveLoading) {
      setLoadingStuck(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      setLoadingStuck(true);
      setInternalLoading(false);
    }, loadingTimeoutMs);

    return () => clearTimeout(timeoutId);
  }, [effectiveLoading, loadingTimeoutMs]);

  const showLoading = effectiveLoading && !loadingStuck;
  const isDisabled = disabled || showLoading;

  const handlePress = () => {
    try {
      const result = onPress();
      if (result && typeof (result as Promise<void>).then === 'function') {
        setInternalLoading(true);
        void (result as Promise<void>).finally(() => {
          setInternalLoading(false);
        });
      }
    } catch {
      setInternalLoading(false);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      disabled={isDisabled}
      onPress={handlePress}
    >
      {showLoading ? (
        <ActivityIndicator color={variant === 'ghost' ? palette.greenDark : palette.white} />
      ) : (
        <Text style={[styles.label, variant === 'ghost' && styles.ghostLabel]}>{label}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  primary: {
    backgroundColor: palette.greenDark,
  },
  secondary: {
    backgroundColor: palette.greenLight,
  },
  danger: {
    backgroundColor: palette.danger,
  },
  ghost: {
    backgroundColor: palette.gray100,
    borderWidth: 1,
    borderColor: palette.gray300,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
  },
  label: {
    color: palette.white,
    fontSize: 14,
    fontWeight: '700',
  },
  ghostLabel: {
    color: palette.greenDark,
  },
});
