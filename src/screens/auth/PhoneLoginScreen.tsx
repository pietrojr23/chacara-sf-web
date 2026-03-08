import { Alert, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation';
import { AppButton } from '../../components/AppButton';
import { ScreenContainer } from '../../components/ScreenContainer';
import { palette, spacing } from '../../constants/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'PhoneLogin'>;

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.gray900,
  },
  subtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
});
