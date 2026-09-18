import { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  BottomTabBarButtonProps,
  BottomTabNavigationProp,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { AppTabParamList, RootStackParamList } from '../types/navigation';
import { HomeScreen } from '../screens/dashboard/HomeScreen';
import { GateScreen } from '../screens/gate/GateScreen';
import { CamerasScreen } from '../screens/cameras/CamerasScreen';
import { HeadlightsScreen } from '../screens/headlights/HeadlightsScreen';
import { FinanceScreen } from '../screens/finance/FinanceScreen';
import { TicketsScreen } from '../screens/maintenance/TicketsScreen';
import { ChatScreen } from '../screens/chat/ChatScreen';
import { palette } from '../constants/theme';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

const Tab = createBottomTabNavigator<AppTabParamList>();
const ACCESS_MENU_WIDTH = 220;

const tabIcons: Record<keyof AppTabParamList, keyof typeof MaterialIcons.glyphMap> = {
  Home: 'home',
  Gate: 'meeting-room',
  Cameras: 'videocam',
  Headlights: 'highlight',
  Finance: 'payments',
  Tickets: 'build',
  Chat: 'chat',
};

const labels: Record<keyof AppTabParamList, string> = {
  Home: 'Home',
  Gate: 'Portão',
  Cameras: 'Acesso',
  Headlights: 'Faróis',
  Finance: 'Financeiro',
  Tickets: 'Chamados',
  Chat: 'Chat',
};

export const MainTabs = () => {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width } = useWindowDimensions();
  const [accessMenuVisible, setAccessMenuVisible] = useState(false);
  const tabNavigationRef = useRef<BottomTabNavigationProp<AppTabParamList> | null>(null);
  const tabsCount = 6;
  const accessTabIndex = 2;
  const accessMenuLeft = useMemo(() => {
    const centerX = ((accessTabIndex + 0.5) / tabsCount) * width;
    const minLeft = 12;
    const maxLeft = Math.max(minLeft, width - ACCESS_MENU_WIDTH - 12);

    return Math.min(Math.max(centerX - ACCESS_MENU_WIDTH / 2, minLeft), maxLeft);
  }, [accessTabIndex, tabsCount, width]);

  const closeAccessMenu = () => setAccessMenuVisible(false);

  const openCameras = () => {
    closeAccessMenu();
    tabNavigationRef.current?.navigate('Cameras');
  };

  const openHeadlights = () => {
    closeAccessMenu();
    tabNavigationRef.current?.navigate('Headlights');
  };

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route, navigation }) => {
          if (route.name === 'Cameras' || route.name === 'Headlights') {
            tabNavigationRef.current = navigation as BottomTabNavigationProp<AppTabParamList>;
          }

          const isAccessTab = route.name === 'Cameras';

          return {
            tabBarActiveTintColor: palette.greenDark,
            tabBarInactiveTintColor: palette.gray500,
            headerStyle: { backgroundColor: palette.white },
            headerTintColor: palette.gray900,
            headerTitleStyle: { fontWeight: '800' },
            tabBarStyle: {
              borderTopColor: '#DDE4DB',
              height: 75,
              paddingBottom: 8,
              paddingTop: 8,
            },
            tabBarIcon: ({ color, size }) => (
              isAccessTab ? (
                <View style={styles.accessTabIcon}>
                  <MaterialIcons name="videocam" color={color} size={Math.max(14, size - 2)} />
                  <MaterialIcons
                    name="highlight"
                    color={color}
                    size={Math.max(14, size - 2)}
                    style={styles.accessTabIconSecond}
                  />
                </View>
              ) : (
                <MaterialIcons name={tabIcons[route.name as keyof AppTabParamList]} color={color} size={size} />
              )
            ),
            tabBarLabel: labels[route.name as keyof AppTabParamList],
            title: isAccessTab ? 'Câmeras' : labels[route.name as keyof AppTabParamList],
            tabBarButton: isAccessTab
              ? ({ accessibilityState, children, onLongPress, style, testID }: BottomTabBarButtonProps) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={accessibilityState}
                    accessibilityLabel="Acesso rápido: câmeras e faróis"
                    onPress={() => setAccessMenuVisible((current) => !current)}
                    onLongPress={onLongPress}
                    style={style}
                    testID={testID}
                  >
                    {children}
                  </Pressable>
                )
              : undefined,
            headerRight: () => (
              <Pressable onPress={() => rootNavigation.navigate('MoreMenu')} style={{ paddingHorizontal: 12 }}>
                <MaterialIcons name="menu" size={24} color={palette.gray900} />
              </Pressable>
            ),
          };
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Gate" component={GateScreen} />
        <Tab.Screen name="Cameras" component={CamerasScreen} />
        <Tab.Screen
          name="Headlights"
          component={HeadlightsScreen}
          options={{
            title: 'Faróis',
            tabBarButton: () => null,
            tabBarItemStyle: { display: 'none' },
          }}
        />
        <Tab.Screen name="Finance" component={FinanceScreen} />
        <Tab.Screen name="Tickets" component={TicketsScreen} />
        <Tab.Screen name="Chat" component={ChatScreen} />
      </Tab.Navigator>

      <Modal transparent visible={accessMenuVisible} animationType="fade" onRequestClose={closeAccessMenu}>
        <View style={styles.overlayRoot}>
          <Pressable style={styles.backdrop} onPress={closeAccessMenu} />
          <View style={[styles.menuContainer, { left: accessMenuLeft }]}>
            <View style={styles.menuCard}>
              <Pressable style={styles.menuOption} onPress={openCameras}>
                <MaterialIcons name="videocam" size={18} color={palette.greenDark} />
                <Text style={styles.menuOptionText}>Câmeras</Text>
              </Pressable>
              <View style={styles.divider} />
              <Pressable style={styles.menuOption} onPress={openHeadlights}>
                <MaterialIcons name="highlight" size={18} color={palette.greenDark} />
                <Text style={styles.menuOptionText}>Faróis</Text>
              </Pressable>
            </View>
            <View style={styles.menuArrow} />
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  overlayRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  menuContainer: {
    position: 'absolute',
    bottom: 84,
    width: ACCESS_MENU_WIDTH,
  },
  menuArrow: {
    alignSelf: 'center',
    width: 14,
    height: 14,
    backgroundColor: palette.white,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: '#DDE4DB',
    transform: [{ rotate: '45deg' }],
    marginTop: -7,
    zIndex: 2,
  },
  menuCard: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: '#DDE4DB',
    borderRadius: 14,
    paddingVertical: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  menuOptionText: {
    color: palette.gray900,
    fontSize: 14,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: '#E6ECE4',
  },
  accessTabIcon: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accessTabIconSecond: {
    marginLeft: 2,
  },
});
