import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { RootStackParamList } from '../../types/navigation';

const futureModules = ['Reserva de áreas comuns', 'Mapa da propriedade', 'Horta e ferramentas', 'Entregas'];

export const MoreMenuScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sair da conta', 'Deseja realmente deslogar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              setSigningOut(true);
              await signOut();
            } catch {
              Alert.alert('Erro', 'Não foi possível sair da conta agora.');
            } finally {
              setSigningOut(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <SectionHeader title="Mais módulos" subtitle="Acesso rápido aos módulos secundários" />

      <AppCard>
        <MenuItem
          icon="campaign"
          title="Mural de avisos"
          subtitle="Comunicados gerais e por casa"
          onPress={() => navigation.navigate('Notices')}
        />
        <MenuItem
          icon="home"
          title="Perfil da casa"
          subtitle="Moradores, pets, veículos e contrato"
          onPress={() => navigation.navigate('HouseProfile')}
        />
        <MenuItem
          icon="settings"
          title="Configurações"
          subtitle="Webhooks, Pix, notificações e usuários"
          onPress={() => navigation.navigate('Settings')}
        />
        <MenuItem
          icon="local-hospital"
          title="Contatos de emergência"
          subtitle="SAMU, bombeiros e serviços locais"
          onPress={() => navigation.navigate('EmergencyContacts')}
        />
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Próximos módulos (pós-MVP)</Text>
        {futureModules.map((moduleName) => (
          <Pressable key={moduleName} style={styles.futureItem} onPress={() => Alert.alert('Em breve', `${moduleName} será liberado na próxima versão.`)}>
            <MaterialIcons name="hourglass-bottom" size={18} color={palette.gray700} />
            <Text style={styles.futureText}>{moduleName}</Text>
          </Pressable>
        ))}
      </AppCard>

      <AppCard>
        <AppButton label="Sair da conta" variant="danger" loading={signingOut} onPress={handleSignOut} />
      </AppCard>
    </ScreenContainer>
  );
};

const MenuItem = ({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) => (
  <Pressable style={({ pressed }) => [styles.menuItem, pressed && styles.menuPressed]} onPress={onPress}>
    <View style={styles.menuIcon}>
      <MaterialIcons name={icon} size={20} color={palette.greenDark} />
    </View>
    <View style={styles.menuContent}>
      <Text style={styles.menuTitle}>{title}</Text>
      <Text style={styles.menuSubtitle}>{subtitle}</Text>
    </View>
    <MaterialIcons name="chevron-right" size={22} color={palette.gray500} />
  </Pressable>
);

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.gray900,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
  },
  menuPressed: {
    opacity: 0.7,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECF3E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuContent: {
    flex: 1,
    gap: spacing.xs,
  },
  menuTitle: {
    color: palette.gray900,
    fontWeight: '800',
    fontSize: 14,
  },
  menuSubtitle: {
    color: palette.gray700,
    fontSize: 12,
  },
  futureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  futureText: {
    color: palette.gray700,
    fontSize: 14,
  },
});
