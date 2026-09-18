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

export const MoreMenuScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut, profile } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const isOwner = Boolean(profile?.isOwner);
  const sectionSubtitle = isOwner
    ? 'Acesso rápido aos módulos secundários e administração'
    : 'Acesso rápido aos módulos secundários da sua casa';

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
      <SectionHeader title="Mais módulos" subtitle={sectionSubtitle} />

      <AppCard>
        <MenuItem
          icon="campaign"
          title="Mural de avisos"
          subtitle={isOwner ? 'Comunicados gerais e por casa' : 'Comunicados da chácara e da sua casa'}
          onPress={() => navigation.navigate('Notices')}
        />
        <MenuItem
          icon="home"
          title="Perfil da casa"
          subtitle={isOwner ? 'Moradores, pets, veículos e contrato' : 'Moradores, veículos, pets e contrato da casa'}
          onPress={() => navigation.navigate('HouseProfile')}
        />
        {isOwner ? (
          <MenuItem
            icon="auto-awesome"
            title="Contrato por IA"
            subtitle="Gerar contrato de aluguel em PDF"
            onPress={() => navigation.navigate('AIContract')}
          />
        ) : null}
        <MenuItem
          icon="settings"
          title="Configurações"
          subtitle={isOwner ? 'Webhooks, PIX, notificações e usuários' : 'Minha conta e notificações'}
          onPress={() => navigation.navigate('Settings')}
        />
        <MenuItem
          icon="local-hospital"
          title="Contatos de emergência"
          subtitle="SAMU, bombeiros e serviços locais"
          onPress={() => navigation.navigate('EmergencyContacts')}
        />
      </AppCard>

      {/* <AppCard>
        <Text style={styles.cardTitle}>Próximos módulos (pós-MVP)</Text>
        {futureModules.map((moduleName) => (
          <Pressable key={moduleName} style={styles.futureItem} onPress={() => Alert.alert('Em breve', `${moduleName} será liberado na próxima versão.`)}>
            <MaterialIcons name="hourglass-bottom" size={18} color={palette.gray700} />
            <Text style={styles.futureText}>{moduleName}</Text>
          </Pressable>
        ))}
      </AppCard> */}

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
  disabled,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable
    style={({ pressed }) => [styles.menuItem, pressed && !disabled && styles.menuPressed, disabled && styles.menuDisabled]}
    onPress={onPress}
    disabled={disabled}
  >
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
    fontSize: 17,
    fontWeight: '800',
    color: palette.gray900,
    textTransform: 'uppercase',
  },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
  },
  menuPressed: {
    opacity: 0.7,
  },
  menuDisabled: {
    opacity: 0.55,
  },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    fontSize: 16,
  },
  menuSubtitle: {
    color: palette.gray700,
    fontSize: 14,
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
