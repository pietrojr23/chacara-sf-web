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
type ActiveChatNotificationContext = {
  chatId: string;
  isPrivate: boolean;
} | null;

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
const PUSH_REGISTRATION_DEBUG_VERSION = 1;
let activeChatContext: ActiveChatNotificationContext = null;

const defaultNotificationFlags: Record<NotificationTopic, boolean> = {
  avisos: true,
  chamados: true,
  financeiro: true,
  chat: true,
  visitantes: true,
};

const isValidUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const parseBoolean = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'sim'].includes(normalized);
};

const normalizeChatId = (value: unknown) => {
  const chatId = String(value ?? '').trim();
  return chatId || 'geral';
};

export const setActiveChatNotificationContext = (context: ActiveChatNotificationContext) => {
  if (!context) {
    activeChatContext = null;
    return;
  }

  activeChatContext = {
    chatId: normalizeChatId(context.chatId),
    isPrivate: Boolean(context.isPrivate),
  };
};

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data ?? {}) as Record<string, unknown>;
    const type = String(data.type ?? '').trim().toLowerCase();
    const topic = String(data.topic ?? '').trim().toLowerCase();
    const isChatNotification = type === 'chat_message' || type === 'chat' || topic === 'chat';

    if (isChatNotification && activeChatContext) {
      const notificationChatId = normalizeChatId(data.chatId);
      const notificationIsPrivate =
        parseBoolean(data.isPrivate) || (notificationChatId !== 'geral' && notificationChatId !== 'global');

      const sameChat =
        activeChatContext.chatId === notificationChatId
        && activeChatContext.isPrivate === notificationIsPrivate;

      if (sameChat) {
        return {
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: false,
          shouldShowList: false,
        };
      }
    }

    return {
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

const getExpoProjectId = () => {
  const extraRef = (Constants as unknown as {
    expoConfig?: { extra?: { eas?: { projectId?: string } } };
    easConfig?: { projectId?: string };
  });

  const normalizeCandidate = (value?: string | null) => {
    const candidate = String(value ?? '').trim();
    if (!candidate) {
      return undefined;
    }

    // Ignora placeholders comuns no .env para não bloquear fallback válido.
    if (['...', 'undefined', 'null', 'changeme', 'replace-me'].includes(candidate.toLowerCase())) {
      return undefined;
    }

    if (!isValidUuid(candidate)) {
      return undefined;
    }

    return candidate;
  };

  return (
    normalizeCandidate(process.env.EXPO_PUBLIC_EXPO_PROJECT_ID)
    || normalizeCandidate(extraRef.easConfig?.projectId)
    || normalizeCandidate(extraRef.expoConfig?.extra?.eas?.projectId)
    || undefined
  );
};

const getExpoPushTokenWithFallback = async () => {
  const projectId = getExpoProjectId();

  if (projectId) {
    try {
      return {
        tokenResponse: await Notifications.getExpoPushTokenAsync({ projectId }),
        mode: 'explicit-project-id' as const,
        projectId,
      };
    } catch (error) {
      if (__DEV__) {
        console.warn('[push] falha com projectId explicito, tentando fallback automatico:', error);
      }
    }
  }

  return {
    tokenResponse: await Notifications.getExpoPushTokenAsync(),
    mode: 'implicit-project-id' as const,
    projectId: projectId ?? null,
  };
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
  addToken(data.expo_push_token);
  addToken(data.pushToken);
  addToken(data.push_token);

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

  const listSnakeCase = data.push_tokens;
  if (Array.isArray(listSnakeCase)) {
    listSnakeCase.forEach((item) => {
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

const asErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? 'Erro desconhecido');
};

const isAndroidFcmNotConfiguredError = (message: string) =>
  Platform.OS === 'android'
  && /(firebaseapp is not initialized|fcm-credentials|complete the guide)/i.test(message);

const truncate = (value: string, max = 240) => {
  const input = String(value ?? '').trim();
  if (!input) {
    return '';
  }

  if (input.length <= max) {
    return input;
  }

  return `${input.slice(0, max - 3)}...`;
};

const tokenPreview = (value: string | null) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= 20) {
    return trimmed;
  }

  return `${trimmed.slice(0, 12)}...${trimmed.slice(-6)}`;
};

const normalizeRemoteImageUrl = (value: unknown) => {
  const candidate = String(value ?? '').trim();
  if (!candidate) {
    return null;
  }

  return /^https?:\/\//i.test(candidate) ? candidate : null;
};

const DEFAULT_NOTIFICATION_IMAGE_URL = normalizeRemoteImageUrl(
  process.env.EXPO_PUBLIC_NOTIFICATION_IMAGE_URL,
);

const updatePushRegistrationDebug = async (
  userId: string,
  payload: {
    status: string;
    reason?: string;
    permissionStatus?: string;
    projectId?: string | null;
    registrationMode?: string | null;
    expoToken?: string | null;
    devicePushToken?: string | null;
    errorMessage?: string;
  },
) => {
  const now = new Date().toISOString();

  const data = {
    version: PUSH_REGISTRATION_DEBUG_VERSION,
    status: payload.status,
    reason: payload.reason ?? null,
    permissionStatus: payload.permissionStatus ?? null,
    projectId: payload.projectId ?? null,
    registrationMode: payload.registrationMode ?? null,
    expoTokenPreview: tokenPreview(payload.expoToken ?? null),
    devicePushTokenPreview: tokenPreview(payload.devicePushToken ?? null),
    errorMessage: truncate(payload.errorMessage ?? '', 500) || null,
    platform: Platform.OS,
    isDevice: Device.isDevice,
    appOwnership: Constants.appOwnership ?? null,
    executionEnvironment: Constants.executionEnvironment ?? null,
    updatedAt: now,
  };

  try {
    await setDoc(
      doc(db, 'users', userId),
      {
        pushRegistration: data,
        push_registration: data,
        lastPushRegistrationUpdate: now,
        last_push_registration_update: now,
      },
      { merge: true },
    );
  } catch {
    // Não bloqueia fluxo de registro por falha de telemetria.
  }
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
        push_tokens: filteredTokens,
        pushToken: nextPrimaryToken,
        push_token: nextPrimaryToken,
        expoPushToken: nextPrimaryToken,
        expo_push_token: nextPrimaryToken,
        lastPushTokenUpdate: new Date().toISOString(),
        last_push_token_update: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch {
    // Não interrompe o fluxo principal por falha na limpeza de token.
  }
};

export const registerForPushNotificationsAsync = async (userId: string) => {
  const projectId = getExpoProjectId() ?? null;

  await updatePushRegistrationDebug(userId, {
    status: 'started',
    projectId,
  });

  const isExpoGo =
    Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';

  // Expo Go no Android (SDK 53+) não suporta push remoto.
  if (Platform.OS === 'android' && isExpoGo) {
    await updatePushRegistrationDebug(userId, {
      status: 'skipped',
      reason: 'android-expo-go-no-remote-push',
      projectId,
    });
    return null;
  }

  if (!Device.isDevice) {
    await updatePushRegistrationDebug(userId, {
      status: 'skipped',
      reason: 'not-a-physical-device',
      projectId,
    });
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    await updatePushRegistrationDebug(userId, {
      status: 'permission-denied',
      reason: 'notifications-permission-not-granted',
      permissionStatus: finalStatus,
      projectId,
    });
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7CB342',
    });
  }

  let registrationMode: string | null = null;
  let tokenResponse: { data: string };

  try {
    const result = await getExpoPushTokenWithFallback();
    tokenResponse = result.tokenResponse;
    registrationMode = result.mode;
  } catch (error) {
    const errorMessage = asErrorMessage(error);
    await updatePushRegistrationDebug(userId, {
      status: 'error',
      reason: isAndroidFcmNotConfiguredError(errorMessage)
        ? 'android-fcm-not-configured'
        : 'expo-push-token-fetch-failed',
      permissionStatus: finalStatus,
      projectId,
      errorMessage,
    });
    return null;
  }

  const expoToken = String(tokenResponse.data ?? '').trim();
  if (!isExpoPushToken(expoToken)) {
    await updatePushRegistrationDebug(userId, {
      status: 'error',
      reason: 'invalid-expo-push-token',
      permissionStatus: finalStatus,
      projectId,
      registrationMode,
      expoToken,
    });
    return null;
  }
  let devicePushToken: string | null = null;
  let nativeTokenErrorMessage: string | null = null;

  try {
    const nativeTokenResponse = await Notifications.getDevicePushTokenAsync();
    const normalizedDeviceToken = String(nativeTokenResponse.data ?? '').trim();
    devicePushToken = normalizedDeviceToken || null;
  } catch (error) {
    nativeTokenErrorMessage = asErrorMessage(error);
    if (__DEV__) {
      console.warn('[push] nao foi possivel obter token nativo (seguindo apenas com Expo token):', error);
    }
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

  try {
    await setDoc(
      userRef,
      {
        pushToken: expoToken,
        push_token: expoToken,
        expoPushToken: expoToken,
        expo_push_token: expoToken,
        pushTokens: mergedTokens,
        push_tokens: mergedTokens,
        devicePushToken,
        device_push_token: devicePushToken,
        lastPushTokenUpdate: new Date().toISOString(),
        last_push_token_update: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch (error) {
    await updatePushRegistrationDebug(userId, {
      status: 'error',
      reason: 'save-token-failed',
      permissionStatus: finalStatus,
      projectId,
      registrationMode,
      expoToken,
      devicePushToken,
      errorMessage: asErrorMessage(error),
    });
    return null;
  }

  await updatePushRegistrationDebug(userId, {
    status: 'registered',
    reason: nativeTokenErrorMessage ? 'registered-without-native-token' : 'ok',
    permissionStatus: finalStatus,
    projectId,
    registrationMode,
    expoToken,
    devicePushToken,
    errorMessage: nativeTokenErrorMessage ?? undefined,
  });

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
  const notificationImageUrl =
    normalizeRemoteImageUrl(data?.imageUrl) ?? DEFAULT_NOTIFICATION_IMAGE_URL;
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
      const message: Record<string, unknown> = {
        to: token,
        sound: 'default',
        title,
        body,
        data: {
          ...(data ?? {}),
          topic,
          ...(notificationImageUrl ? { imageUrl: notificationImageUrl } : {}),
        },
        priority: 'high',
        channelId: 'default',
      };

      if (notificationImageUrl) {
        message.mutableContent = true;
        message.richContent = { image: notificationImageUrl };
      }

      messages.push(message);
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
