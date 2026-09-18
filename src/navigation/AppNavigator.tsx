import { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';
import { AppTabParamList, RootStackParamList } from '../types/navigation';
import { AuthNavigator } from './AuthNavigator';
import { MainTabs } from './MainTabs';
import { TicketFormScreen } from '../screens/maintenance/TicketFormScreen';
import { ChatRoomScreen } from '../screens/chat/ChatRoomScreen';
import { MoreMenuScreen } from '../screens/more/MoreMenuScreen';
import { HouseProfileScreen } from '../screens/house/HouseProfileScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { EmergencyContactsScreen } from '../screens/emergency/EmergencyContactsScreen';
import { NoticesScreen } from '../screens/notices/NoticesScreen';
import { AIContractScreen } from '../screens/contracts/AIContractScreen';
import { HeadlightsConfigScreen } from '../screens/headlights/HeadlightsConfigScreen';
import { LoadingState } from '../components/LoadingState';
import { useAuth } from '../contexts/AuthContext';
import { useAppConfig } from '../contexts/AppConfigContext';
import { darkPalette, navLightTheme, palette, spacing } from '../constants/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();
type ChatRouteParams = RootStackParamList['ChatRoom'];
type NotificationRouteAction =
  | { kind: 'chat_room'; params: ChatRouteParams }
  | { kind: 'root_screen'; screen: keyof RootStackParamList }
  | { kind: 'tab'; tab: keyof AppTabParamList };

const MissingProfileScreen = ({ isDark }: { isDark: boolean }) => (
  <View style={[styles.missingProfileContainer, isDark && styles.missingProfileContainerDark]}>
    <Text style={[styles.missingProfileTitle, isDark && styles.missingProfileTitleDark]}>Perfil não encontrado</Text>
    <Text style={[styles.missingProfileText, isDark && styles.missingProfileTextDark]}>
      Sua conta autenticou, mas ainda não existe cadastro em `/users/{'{userId}'}` no banco.
    </Text>
    <Text style={[styles.missingProfileText, isDark && styles.missingProfileTextDark]}>
      Peça ao proprietário para vincular sua casa no painel administrativo.
    </Text>
  </View>
);

export const AppNavigator = () => {
  const { firebaseUser, profile, loading, profileResolved } = useAuth();
  const { loadingConfig } = useAppConfig();
  const isDark = false;
  const colors = palette;
  const navigationRef = useRef<{
    navigate: (...args: any[]) => void;
    isReady: () => boolean;
  } | null>(null);
  const handledNotificationIdsRef = useRef(new Set<string>());
  const [pendingNotificationRoute, setPendingNotificationRoute] = useState<NotificationRouteAction | null>(null);

  const parseBoolean = (value: unknown) => {
    if (typeof value === 'boolean') {
      return value;
    }

    const normalized = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'sim'].includes(normalized);
  };

  const resolveRouteFromNotification = (response: Notifications.NotificationResponse): NotificationRouteAction | null => {
    const notificationId = response.notification.request.identifier;
    if (handledNotificationIdsRef.current.has(notificationId)) {
      return null;
    }
    handledNotificationIdsRef.current.add(notificationId);

    const data = response.notification.request.content.data as Record<string, unknown>;
    const type = String(data.type ?? '').trim().toLowerCase();
    const topic = String(data.topic ?? '').trim().toLowerCase();

    if (type === 'chat_message' || type === 'chat' || topic === 'chat') {
      const chatId = String(data.chatId ?? 'geral').trim() || 'geral';
      const isPrivate = parseBoolean(data.isPrivate) || (chatId !== 'geral' && chatId !== 'global');
      const senderName = String(data.senderName ?? '').trim();
      const chatTitle = String(data.chatTitle ?? '').trim();

      return {
        kind: 'chat_room',
        params: {
          chatId,
          isPrivate,
          title: isPrivate ? (chatTitle || senderName || 'Conversa privada') : 'Grupo da Chácara',
        },
      };
    }

    if (type === 'notice_created' || type === 'notice' || topic === 'avisos') {
      return { kind: 'root_screen', screen: 'Notices' };
    }

    if (
      type === 'ticket_created'
      || type === 'ticket_updated'
      || type === 'ticket_comment'
      || type === 'ticket:new'
      || type === 'ticket:status'
      || topic === 'chamados'
    ) {
      return { kind: 'tab', tab: 'Tickets' };
    }

    if (
      type === 'payment_confirmed'
      || type === 'payment_marked_by_tenant'
      || type === 'payment'
      || type === 'rent:due'
      || type === 'rent:paid'
      || topic === 'financeiro'
    ) {
      return { kind: 'tab', tab: 'Finance' };
    }

    if (type === 'visitor_created' || type === 'visitor_status_updated' || type === 'visitor' || topic === 'visitantes') {
      return { kind: 'tab', tab: 'Gate' };
    }

    return null;
  };

  const navigateFromNotificationRoute = useCallback(
    (route: NotificationRouteAction) => {
      if (!navigationRef.current?.isReady() || !firebaseUser || !profile) {
        return false;
      }

      if (route.kind === 'chat_room') {
        navigationRef.current.navigate('ChatRoom', route.params);
        return true;
      }

      if (route.kind === 'root_screen') {
        navigationRef.current.navigate(route.screen);
        return true;
      }

      const destinationTab = route.tab;

      navigationRef.current.navigate('App');
      setTimeout(() => {
        navigationRef.current?.navigate(destinationTab);
      }, 0);
      return true;
    },
    [firebaseUser, profile],
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const nextRoute = resolveRouteFromNotification(response);
      if (nextRoute) {
        if (!navigateFromNotificationRoute(nextRoute)) {
          setPendingNotificationRoute(nextRoute);
        }
      }
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) {
        return;
      }

      const nextRoute = resolveRouteFromNotification(response);
      if (nextRoute) {
        if (!navigateFromNotificationRoute(nextRoute)) {
          setPendingNotificationRoute(nextRoute);
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [navigateFromNotificationRoute]);

  useEffect(() => {
    if (!pendingNotificationRoute) {
      return;
    }

    if (navigateFromNotificationRoute(pendingNotificationRoute)) {
      setPendingNotificationRoute(null);
    }
  }, [navigateFromNotificationRoute, pendingNotificationRoute]);

  if (loading || loadingConfig || (firebaseUser && !profile && !profileResolved)) {
    return <LoadingState label="Preparando aplicativo..." />;
  }

  return (
    <NavigationContainer
      ref={(ref) => {
        navigationRef.current = ref as typeof navigationRef.current;
      }}
      theme={navLightTheme}
    >
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.white },
          headerTintColor: colors.gray900,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.sand },
        }}
      >
        {!firebaseUser ? (
          <Stack.Screen name="Auth" component={AuthNavigator} options={{ headerShown: false }} />
        ) : !profile ? (
          <Stack.Screen name="Auth" options={{ title: 'Conta sem perfil' }}>
            {() => <MissingProfileScreen isDark={isDark} />}
          </Stack.Screen>
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
            <Stack.Screen
              name="AIContract"
              component={AIContractScreen}
              options={{ title: 'Contrato de aluguel (IA)' }}
            />
            <Stack.Screen
              name="HeadlightsConfig"
              component={HeadlightsConfigScreen}
              options={{ title: 'Configurar faróis' }}
            />
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
  missingProfileContainerDark: {
    backgroundColor: darkPalette.sand,
  },
  missingProfileTitleDark: {
    color: darkPalette.gray900,
  },
  missingProfileTextDark: {
    color: darkPalette.gray700,
  },
});
