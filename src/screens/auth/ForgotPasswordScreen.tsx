import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation';
import { ScreenContainer } from '../../components/ScreenContainer';
import { AppInput } from '../../components/AppInput';
import { AppButton } from '../../components/AppButton';
import { useAuth } from '../../contexts/AuthContext';
import { palette, spacing } from '../../constants/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export const ForgotPasswordScreen = ({ navigation }: Props) => {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const withTimeout = <T,>(promise: Promise<T>, timeoutMs = 12000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('operation-timeout'));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timeoutId);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });

  const handleReset = async () => {
    try {
      setLoading(true);
      await withTimeout(resetPassword(email), 15000);
      Alert.alert('Enviado', 'Enviamos um link de recuperação para seu e-mail.');
      navigation.goBack();
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'operation-timeout'
          ? 'A operação demorou demais para responder. Tente novamente.'
          : error instanceof Error
            ? error.message
            : 'Falha ao enviar recuperação';
      Alert.alert('Erro', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>Recuperar senha</Text>
        <Text style={styles.subtitle}>Informe o e-mail da conta para receber o link de redefinição.</Text>
      </View>

      <AppInput
        label="E-mail"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        placeholder="email@provedor.com"
      />

      <AppButton label="Enviar link" onPress={handleReset} loading={loading} />
      <AppButton label="Voltar" variant="ghost" onPress={() => navigation.goBack()} />
    </ScreenContainer>
  );
};

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
    fontSize: 15,
    color: palette.gray700,
  },
});
