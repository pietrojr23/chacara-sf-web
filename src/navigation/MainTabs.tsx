import { Pressable } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { AppTabParamList, RootStackParamList } from '../types/navigation';
import { HomeScreen } from '../screens/dashboard/HomeScreen';
import { GateScreen } from '../screens/gate/GateScreen';
import { CamerasScreen } from '../screens/cameras/CamerasScreen';
import { FinanceScreen } from '../screens/finance/FinanceScreen';
import { TicketsScreen } from '../screens/maintenance/TicketsScreen';
import { ChatScreen } from '../screens/chat/ChatScreen';
import { palette } from '../constants/theme';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';

const Tab = createBottomTabNavigator<AppTabParamList>();

const tabIcons: Record<keyof AppTabParamList, keyof typeof MaterialIcons.glyphMap> = {
  Home: 'home',
  Gate: 'meeting-room',
  Cameras: 'videocam',
  Finance: 'payments',
  Tickets: 'build',
  Chat: 'chat',
};

const labels: Record<keyof AppTabParamList, string> = {
  Home: 'Home',
  Gate: 'Portão',
  Cameras: 'CAMERAS',
  Finance: 'Financeiro',
  Tickets: 'Chamados',
  Chat: 'Chat',
};

export const MainTabs = () => {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: palette.greenDark,
        tabBarInactiveTintColor: palette.gray500,
        headerStyle: { backgroundColor: palette.white },
        headerTintColor: palette.gray900,
        headerTitleStyle: { fontWeight: '800' },
        tabBarStyle: {
          borderTopColor: '#DDE4DB',
          height: 66,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarIcon: ({ color, size }) => (
          <MaterialIcons name={tabIcons[route.name as keyof AppTabParamList]} color={color} size={size} />
        ),
        title: labels[route.name as keyof AppTabParamList],
        headerRight: () => (
          <Pressable onPress={() => rootNavigation.navigate('MoreMenu')} style={{ paddingHorizontal: 12 }}>
            <MaterialIcons name="menu" size={24} color={palette.gray900} />
          </Pressable>
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Gate" component={GateScreen} />
      <Tab.Screen name="Cameras" component={CamerasScreen} />
      <Tab.Screen name="Finance" component={FinanceScreen} />
      <Tab.Screen name="Tickets" component={TicketsScreen} />
      <Tab.Screen name="Chat" component={ChatScreen} />
    </Tab.Navigator>
  );
};
