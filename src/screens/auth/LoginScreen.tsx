import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../types/navigation';
import { AppButton } from '../../components/AppButton';
import { AppInput } from '../../components/AppInput';
import { ScreenContainer } from '../../components/ScreenContainer';
import { palette, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export const LoginScreen = ({ navigation }: Props) => {
  const { login, createOwner } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOwnerRegisterMode, setIsOwnerRegisterMode] = useState(false);

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

  const handleLogin = async () => {
    try {
      setLoading(true);
      if (isOwnerRegisterMode) {
        if (!ownerName.trim()) {
          throw new Error('Informe o nome do proprietário.');
        }

        await withTimeout(createOwner(ownerName, email, password), 15000);
        Alert.alert('Conta criada', 'Conta do proprietário criada com sucesso.');
      } else {
        await withTimeout(login(email, password), 15000);
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : '';
      const message =
        rawMessage === 'operation-timeout'
          ? 'A operação demorou demais para responder. Tente novamente.'
          : rawMessage.toLowerCase().includes('row-level security') || rawMessage.toLowerCase().includes('rls')
            ? 'O Supabase bloqueou a gravação por política RLS. Execute novamente o arquivo bootstrap.sql no SQL Editor.'
          : rawMessage.toLowerCase().includes('invalid schema')
            ? 'Supabase ainda não foi configurado. No painel Supabase, execute supabase/sql/bootstrap.sql e confirme o schema "public" exposto em Settings > API.'
            : rawMessage || 'Falha no login';
      Alert.alert('Erro', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer scroll={false}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Acessar conta</Text>
          <Text style={styles.subtitle}>
            {isOwnerRegisterMode
              ? 'Primeiro acesso: cadastre o proprietário da chácara.'
              : 'Entre com e-mail e senha para acessar o app.'}
          </Text>
        </View>

        <View style={styles.form}>
          {isOwnerRegisterMode ? (
            <AppInput
              label="Nome do proprietário"
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="Ex: João da Silva"
            />
          ) : null}

          <AppInput
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            placeholder="email@provedor.com"
            keyboardType="email-address"
          />

          <AppInput
            label="Senha"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
          />

          {!isOwnerRegisterMode ? (
            <Pressable onPress={() => navigation.navigate('ForgotPassword')}>
              <Text style={styles.link}>Esqueci minha senha</Text>
            </Pressable>
          ) : null}

          <AppButton
            label={isOwnerRegisterMode ? 'Criar conta do proprietário' : 'Entrar'}
            onPress={handleLogin}
            loading={loading}
          />
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => setIsOwnerRegisterMode((value) => !value)}>
            <Text style={styles.toggleLink}>
              {isOwnerRegisterMode ? 'Já tenho conta. Fazer login' : 'Primeiro acesso? Cadastrar proprietário'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    gap: spacing.xl,
  },
  header: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  title: {
    fontSize: 26,
    color: palette.gray900,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
    color: palette.gray700,
  },
  form: {
    gap: spacing.md,
  },
  link: {
    alignSelf: 'flex-end',
    color: palette.greenDark,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
  },
  toggleLink: {
    color: palette.gray700,
    fontWeight: '600',
  },
});
