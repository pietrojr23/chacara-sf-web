import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
} from './firestoreLiteCompat';
import { getFirebaseDb } from './firebase';

type NotificationTopic = 'avisos' | 'chamados' | 'financeiro' | 'chat' | 'visitantes';

interface SendPushToUsersParams {
  topic: NotificationTopic;
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

const db = getFirebaseDb();
const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const MAX_MESSAGES_PER_REQUEST = 100;

const defaultNotificationFlags: Record<NotificationTopic, boolean> = {
  avisos: true,
  chamados: true,
  financeiro: true,
  chat: true,
  visitantes: true,
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const getExpoProjectId = () => {
  const extraRef = (Constants as unknown as {
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
    easConfig?: { projectId?: string };
  });

  return (
    process.env.EXPO_PUBLIC_EXPO_PROJECT_ID
    || extraRef.easConfig?.projectId
    || extraRef.expoConfig?.extra?.eas?.projectId
    || undefined
  );
};

const isExpoPushToken = (token: string) =>
  /^ExponentPushToken\[[\w-]+\]$/.test(token) || /^ExpoPushToken\[[\w-]+\]$/.test(token);

const extractPushTokensFromUserData = (data: Record<string, unknown>) => {
  const tokens = new Set<string>();

  const addToken = (raw: unknown) => {
    const token = String(raw ?? '').trim();
    if (!token || !isExpoPushToken(token)) {
      return;
    }
    tokens.add(token);
  };

  addToken(data.expoPushToken);
  addToken(data.pushToken);

  const list = data.pushTokens;
  if (Array.isArray(list)) {
    list.forEach((item) => {
      if (typeof item === 'string') {
        addToken(item);
        return;
      }

      if (item && typeof item === 'object') {
        addToken((item as { token?: unknown }).token);
      }
    });
  }

  return Array.from(tokens);
};

const getNotificationFlags = async () => {
  try {
    const snapshot = await getDoc(doc(db, 'configuracoes', 'global'));
    if (!snapshot.exists()) {
      return defaultNotificationFlags;
    }

    const raw = snapshot.data() as { notificacoes?: Partial<Record<NotificationTopic, boolean>> };
    return {
      ...defaultNotificationFlags,
      ...(raw.notificacoes ?? {}),
    };
  } catch {
    return defaultNotificationFlags;
  }
};

const chunk = <T,>(items: T[], chunkSize: number) => {
  if (chunkSize <= 0) {
    return [items];
  }

  const result: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize));
  }
  return result;
};

const removeInvalidTokensFromUser = async (userId: string, invalidTokens: Set<string>) => {
  if (!invalidTokens.size) {
    return;
  }

  try {
    const ref = doc(db, 'users', userId);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) {
      return;
    }

    const data = snapshot.data() as Record<string, unknown>;
    const currentTokens = extractPushTokensFromUserData(data);
    const filteredTokens = currentTokens.filter((token) => !invalidTokens.has(token));
    const nextPrimaryToken = filteredTokens[0] ?? null;

    await setDoc(
      ref,
      {
        pushTokens: filteredTokens,
        pushToken: nextPrimaryToken,
        expoPushToken: nextPrimaryToken,
        lastPushTokenUpdate: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch {
    // Não interrompe o fluxo principal por falha na limpeza de token.
  }
};

export const registerForPushNotificationsAsync = async (userId: string) => {
  const isExpoGo =
    Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';

  // Expo Go no Android (SDK 53+) não suporta push remoto.
  if (Platform.OS === 'android' && isExpoGo) {
    return null;
  }

  if (!Device.isDevice) {
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = getExpoProjectId();
  const tokenResponse = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();

  const expoToken = tokenResponse.data;
  const nativeTokenResponse = await Notifications.getDevicePushTokenAsync();
  const devicePushToken = String(nativeTokenResponse.data ?? '');

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7CB342',
    });
  }

  const userRef = doc(db, 'users', userId);
  let existingTokens: string[] = [];

  try {
    const snapshot = await getDoc(userRef);
    if (snapshot.exists()) {
      existingTokens = extractPushTokensFromUserData(snapshot.data() as Record<string, unknown>);
    }
  } catch {
    existingTokens = [];
  }

  const mergedTokens = Array.from(new Set([...existingTokens, expoToken]));

  await setDoc(
    userRef,
    {
      pushToken: expoToken,
      expoPushToken: expoToken,
      pushTokens: mergedTokens,
      devicePushToken,
      lastPushTokenUpdate: new Date().toISOString(),
    },
    { merge: true },
  );

  // Garante que o token atual fique vinculado somente ao usuário logado no dispositivo.
  try {
    const usersSnapshot = await getDocs(query(collection(db, 'users'), limit(5000)));

    await Promise.all(
      usersSnapshot.docs
        .filter((item) => item.id !== userId)
        .filter((item) => {
          const data = item.data() as Record<string, unknown>;
          return extractPushTokensFromUserData(data).includes(expoToken);
        })
        .map((item) => removeInvalidTokensFromUser(item.id, new Set([expoToken]))),
    );
  } catch {
    // Ignora limpeza cruzada para não impedir login/token registration.
  }

  return expoToken;
};

export const sendPushToUsers = async ({
  topic,
  userIds,
  title,
  body,
  data,
}: SendPushToUsersParams) => {
  const dedupUserIds = Array.from(new Set(userIds.map((id) => String(id).trim()).filter(Boolean)));
  if (!dedupUserIds.length) {
    return;
  }

  const notificationFlags = await getNotificationFlags();
  if (!notificationFlags[topic]) {
    return;
  }

  const usersSnapshot = await getDocs(query(collection(db, 'users'), limit(5000)));
  const userIdSet = new Set(dedupUserIds);

  const tokenToUserIds = new Map<string, Set<string>>();
  const messages: Array<Record<string, unknown>> = [];

  usersSnapshot.docs.forEach((item) => {
    if (!userIdSet.has(item.id)) {
      return;
    }

    const userData = item.data() as Record<string, unknown>;
    if (userData.ativo === false) {
      return;
    }

    const tokens = extractPushTokensFromUserData(userData);
    tokens.forEach((token) => {
      if (!tokenToUserIds.has(token)) {
        tokenToUserIds.set(token, new Set<string>());
      }

      tokenToUserIds.get(token)?.add(item.id);
      messages.push({
        to: token,
        sound: 'default',
        title,
        body,
        data: {
          ...(data ?? {}),
          topic,
        },
        priority: 'high',
        channelId: 'default',
      });
    });
  });

  if (!messages.length) {
    return;
  }

  const invalidTokensByUser = new Map<string, Set<string>>();
  const messageChunks = chunk(messages, MAX_MESSAGES_PER_REQUEST);

  for (const part of messageChunks) {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(part),
    });

    let parsed: {
      data?: Array<{ status?: string; details?: { error?: string } }>;
      errors?: Array<{ message?: string }>;
    } | null = null;

    try {
      parsed = (await response.json()) as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
        errors?: Array<{ message?: string }>;
      };
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const detail = parsed?.errors?.[0]?.message;
      throw Object.assign(new Error(detail || 'Falha ao enviar push via Expo API.'), {
        code: 'push-send-failed',
      });
    }

    const tickets = Array.isArray(parsed?.data) ? parsed.data : [];
    tickets.forEach((ticket, index) => {
      if (ticket.status !== 'error') {
        return;
      }

      if (ticket.details?.error !== 'DeviceNotRegistered') {
        return;
      }

      const token = String(part[index]?.to ?? '');
      if (!token) {
        return;
      }

      const owners = tokenToUserIds.get(token);
      if (!owners?.size) {
        return;
      }

      owners.forEach((ownerId) => {
        if (!invalidTokensByUser.has(ownerId)) {
          invalidTokensByUser.set(ownerId, new Set<string>());
        }
        invalidTokensByUser.get(ownerId)?.add(token);
      });
    });
  }

  if (!invalidTokensByUser.size) {
    return;
  }

  await Promise.all(
    Array.from(invalidTokensByUser.entries()).map(([userId, invalidTokens]) =>
      removeInvalidTokensFromUser(userId, invalidTokens)),
  );
};

export type { NotificationTopic };
