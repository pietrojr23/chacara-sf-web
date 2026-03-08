import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import { RootStackParamList } from '../types/navigation';
import { AuthNavigator } from './AuthNavigator';
import { MainTabs } from './MainTabs';
import { TicketFormScreen } from '../screens/maintenance/TicketFormScreen';
import { ChatRoomScreen } from '../screens/chat/ChatRoomScreen';
import { MoreMenuScreen } from '../screens/more/MoreMenuScreen';
import { HouseProfileScreen } from '../screens/house/HouseProfileScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { EmergencyContactsScreen } from '../screens/emergency/EmergencyContactsScreen';
import { NoticesScreen } from '../screens/notices/NoticesScreen';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../contexts/AuthContext';
import { useAppConfig } from '../contexts/AppConfigContext';
import { navDarkTheme, navLightTheme, palette, spacing } from '../constants/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

const MissingProfileScreen = () => (
  <View style={styles.missingProfileContainer}>
    <Text style={styles.missingProfileTitle}>Perfil não encontrado</Text>
    <Text style={styles.missingProfileText}>
      Sua conta autenticou, mas ainda não existe cadastro em `/users/{'{userId}'}` no banco.
    </Text>
    <Text style={styles.missingProfileText}>Peça ao proprietário para vincular sua casa no painel administrativo.</Text>
  </View>
);

export const AppNavigator = () => {
  const { firebaseUser, profile, loading, profileResolved } = useAuth();
  const { config, loadingConfig } = useAppConfig();

  if (loading || loadingConfig || (firebaseUser && !profile && !profileResolved)) {
    return <LoadingState label="Preparando aplicativo..." />;
  }

  return (
    <NavigationContainer theme={config.temaEscuroAtivo ? navDarkTheme : navLightTheme}>
      <Stack.Navigator>
        {!firebaseUser ? (
          <Stack.Screen name="Auth" component={AuthNavigator} options={{ headerShown: false }} />
        ) : !profile ? (
          <Stack.Screen name="Auth" component={MissingProfileScreen} options={{ title: 'Conta sem perfil' }} />
        ) : (
          <>
            <Stack.Screen name="App" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="TicketForm" component={TicketFormScreen} options={{ title: 'Novo chamado' }} />
            <Stack.Screen name="ChatRoom" component={ChatRoomScreen} options={{ headerShown: false }} />
            <Stack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: 'Mais' }} />
            <Stack.Screen name="HouseProfile" component={HouseProfileScreen} options={{ title: 'Perfil da casa' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Configurações' }} />
            <Stack.Screen
              name="EmergencyContacts"
              component={EmergencyContactsScreen}
              options={{ title: 'Contatos de emergência' }}
            />
            <Stack.Screen name="Notices" component={NoticesScreen} options={{ title: 'Mural de avisos' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  missingProfileContainer: {
    flex: 1,
    backgroundColor: palette.sand,
    padding: spacing.xl,
    justifyContent: 'center',
    gap: spacing.md,
  },
  missingProfileTitle: {
    color: palette.gray900,
    fontSize: 22,
    fontWeight: '800',
  },
  missingProfileText: {
    color: palette.gray700,
    fontSize: 15,
  },
});
