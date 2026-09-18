import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as LocalAuthentication from 'expo-local-authentication';
import { useFocusEffect } from '@react-navigation/native';
import { ChevronRight, DoorClosed, DoorOpen, ImagePlus, User } from 'lucide-react-native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppInput } from '../../components/AppInput';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { StatusBadge } from '../../components/StatusBadge';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { updateGateStatus } from '../../services/gateService';
import {
  createVisitor,
  getVisitors,
  subscribeAccessLogs,
  subscribeGateStatus,
  updateVisitorStatus,
} from '../../services/firestoreService';
import { uploadImageAsync } from '../../services/storageService';
import { Visitor } from '../../types/models';
import { formatDateBR } from '../../utils/format';
import { colors, darkColors, radius, spacing, typography } from '../../theme';
import { useAppTheme } from '../../hooks/useAppTheme';

type TenantGateRule = {
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  cooldownSeconds: number;
  maxOpensPerDay: number;
  requireProximity: boolean;
  maxDistanceMeters: number;
  requireBiometric: boolean;
  accessPin: string;
};

const defaultTenantGateRule: TenantGateRule = {
  enabled: true,
  windowStart: '06:00',
  windowEnd: '23:00',
  cooldownSeconds: 30,
  maxOpensPerDay: 10,
  requireProximity: true,
  maxDistanceMeters: 200,
  requireBiometric: true,
  accessPin: '',
};

const parseHmToMinutes = (raw: string) => {
  const text = String(raw ?? '').trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
};

const isTimeWithinWindow = (date: Date, startHm: string, endHm: string) => {
  const nowMinutes = date.getHours() * 60 + date.getMinutes();
  const startMinutes = parseHmToMinutes(startHm);
  const endMinutes = parseHmToMinutes(endHm);

  if (startMinutes == null || endMinutes == null) {
    return true;
  }

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  }

  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
};

const toNumberSafe = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

const toDateSafe = (value: unknown) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isSameDayLocal = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

const calculateDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
};

export const GateScreen = () => {
  const SWIPE_KNOB_SIZE = 62;
  const { profile, firebaseUser } = useAuth();
  const { config } = useAppConfig();
  const { dataVersion } = useDataSync();
  const { isDark } = useAppTheme();
  const themeColors = isDark ? darkColors : colors;
  const [gateStatus, setGateStatus] = useState<'aberto' | 'fechado'>('fechado');
  const [loadingAction, setLoadingAction] = useState<null | 'gate' | 'registerVisitor' | `visitor:${string}`>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [accessLogs, setAccessLogs] = useState<Array<Record<string, any>>>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhoto, setVisitorPhoto] = useState<string | null>(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [currentPinTitle, setCurrentPinTitle] = useState('Confirme seu PIN');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const gateSwipeX = useRef(new Animated.Value(0)).current;
  const gateSwipeValueRef = useRef(0);
  const gateSwipeStartRef = useRef(0);
  const pinResolverRef = useRef<((value: string | null) => void) | null>(null);

  const isOwner = Boolean(profile?.isOwner);
  const authUid = firebaseUser?.uid ?? profile?.id ?? '';
  const [gateSwipeWidth, setGateSwipeWidth] = useState(0);

  const withTimeout = useCallback(
    <T,>(promise: Promise<T>, timeoutMs = 12000): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject({ code: 'operation-timeout' });
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
      }),
    [],
  );

  const tenantGateRule = useMemo<TenantGateRule>(() => {
    const raw = config.tenantGateAccess;
    const houseId = String(profile?.casaId ?? '').trim();
    const houseRule = houseId
      ? raw?.houseRules?.find((item) => String(item.houseId ?? '').trim() === houseId)
      : undefined;

    return {
      enabled: houseRule?.enabled ?? raw?.enabled ?? defaultTenantGateRule.enabled,
      windowStart: String(houseRule?.windowStart ?? raw?.defaultWindowStart ?? defaultTenantGateRule.windowStart),
      windowEnd: String(houseRule?.windowEnd ?? raw?.defaultWindowEnd ?? defaultTenantGateRule.windowEnd),
      cooldownSeconds: Math.max(
        0,
        Math.trunc(
          toNumberSafe(
            houseRule?.cooldownSeconds ?? raw?.defaultCooldownSeconds,
            defaultTenantGateRule.cooldownSeconds,
          ),
        ),
      ),
      maxOpensPerDay: Math.max(
        1,
        Math.trunc(
          toNumberSafe(
            houseRule?.maxOpensPerDay ?? raw?.defaultMaxOpensPerDay,
            defaultTenantGateRule.maxOpensPerDay,
          ),
        ),
      ),
      requireProximity:
        houseRule?.requireProximity ?? raw?.defaultRequireProximity ?? defaultTenantGateRule.requireProximity,
      maxDistanceMeters: Math.max(
        20,
        Math.trunc(
          toNumberSafe(
            houseRule?.maxDistanceMeters ?? raw?.defaultMaxDistanceMeters,
            defaultTenantGateRule.maxDistanceMeters,
          ),
        ),
      ),
      requireBiometric:
        houseRule?.requireBiometric ?? raw?.defaultRequireBiometric ?? defaultTenantGateRule.requireBiometric,
      accessPin: String(houseRule?.accessPin ?? '').trim(),
    };
  }, [config.tenantGateAccess, profile?.casaId]);

  const requestAccessPin = useCallback((title: string) =>
    new Promise<string | null>((resolve) => {
      pinResolverRef.current = resolve;
      setCurrentPinTitle(title);
      setPinInput('');
      setPinError('');
      setPinModalVisible(true);
    }), []);

  const closePinModal = useCallback((value: string | null) => {
    const resolver = pinResolverRef.current;
    pinResolverRef.current = null;
    setPinModalVisible(false);
    setPinInput('');
    setPinError('');
    resolver?.(value);
  }, []);

  const loadVisitors = useCallback(async () => {
    if (!profile || !authUid) {
      return;
    }

    const result = await getVisitors({
      isOwner,
      userId: authUid,
    });
    setVisitors(result);
  }, [authUid, isOwner, profile]);

  useEffect(() => {
    if (!profile || !authUid) {
      return undefined;
    }

    const unsubscribeStatus = subscribeGateStatus((status) => {
      setGateStatus(status);
    });

    const unsubscribeLogs = subscribeAccessLogs(authUid, isOwner, (logs) => {
      setAccessLogs(logs as Array<Record<string, any>>);
    });

    void loadVisitors().catch(() => undefined);

    return () => {
      unsubscribeStatus();
      unsubscribeLogs();
    };
  }, [authUid, isOwner, loadVisitors, profile]);

  useFocusEffect(
    useCallback(() => {
      void loadVisitors().catch(() => undefined);
      return undefined;
    }, [dataVersion, loadVisitors]),
  );

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    const listenerId = gateSwipeX.addListener(({ value }) => {
      gateSwipeValueRef.current = value;
    });

    return () => {
      gateSwipeX.removeListener(listenerId);
    };
  }, [gateSwipeX]);

  useEffect(() => {
    return () => {
      if (pinResolverRef.current) {
        pinResolverRef.current(null);
        pinResolverRef.current = null;
      }
    };
  }, []);

  const tenantOpenEvents = useMemo(() => {
    return accessLogs
      .filter((item) => String(item.status ?? '').trim() === 'aberto')
      .map((item) => {
        const createdAt = toDateSafe(item.createdAt);
        return {
          createdAt,
          userId: String(item.userId ?? ''),
        };
      })
      .filter((item): item is { createdAt: Date; userId: string } => Boolean(item.createdAt) && item.userId === authUid)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }, [accessLogs, authUid]);

  const tenantOpensToday = useMemo(() => {
    const now = new Date();
    return tenantOpenEvents.filter((item) => isSameDayLocal(item.createdAt, now)).length;
  }, [tenantOpenEvents]);

  const validateTenantGateOpen = useCallback(async () => {
    if (isOwner) {
      return { allowed: true as const, context: {} as Record<string, number> };
    }

    const houseId = String(profile?.casaId ?? '').trim();
    if (!houseId) {
      return {
        allowed: false as const,
        message: 'Sua conta não está vinculada a uma casa. Fale com o proprietário.',
      };
    }

    if (!tenantGateRule.enabled) {
      return {
        allowed: false as const,
        message: 'Abertura do portão está desativada para a sua casa.',
      };
    }

    const now = new Date();
    if (!isTimeWithinWindow(now, tenantGateRule.windowStart, tenantGateRule.windowEnd)) {
      return {
        allowed: false as const,
        message: `Abertura permitida apenas entre ${tenantGateRule.windowStart} e ${tenantGateRule.windowEnd}.`,
      };
    }

    if (tenantOpensToday >= tenantGateRule.maxOpensPerDay) {
      return {
        allowed: false as const,
        message: `Limite diário atingido (${tenantGateRule.maxOpensPerDay} aberturas).`,
      };
    }

    if (tenantGateRule.cooldownSeconds > 0 && tenantOpenEvents.length) {
      const lastOpen = tenantOpenEvents[tenantOpenEvents.length - 1];
      const elapsedSeconds = Math.floor((Date.now() - lastOpen.createdAt.getTime()) / 1000);
      if (elapsedSeconds < tenantGateRule.cooldownSeconds) {
        return {
          allowed: false as const,
          message: `Aguarde ${tenantGateRule.cooldownSeconds - elapsedSeconds}s para abrir novamente.`,
        };
      }
    }

    const locationContext: Record<string, number> = {};
    if (tenantGateRule.requireProximity) {
      const targetLat = Number(config.latitude);
      const targetLon = Number(config.longitude);
      if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
        return {
          allowed: false as const,
          message: 'Localização da chácara não está configurada. Fale com o proprietário.',
        };
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        return {
          allowed: false as const,
          message: 'Permita acesso à localização para abrir o portão.',
        };
      }

      const position = await withTimeout<Location.LocationObject>(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        12000,
      );
      const userLat = position.coords.latitude;
      const userLon = position.coords.longitude;
      const distanceMeters = calculateDistanceMeters(userLat, userLon, targetLat, targetLon);

      locationContext.latitude = userLat;
      locationContext.longitude = userLon;
      locationContext.distanceMeters = distanceMeters;

      if (distanceMeters > tenantGateRule.maxDistanceMeters) {
        return {
          allowed: false as const,
          message: `Você está fora da área permitida (${Math.round(distanceMeters)}m de distância).`,
        };
      }
    }

    const hasPin = tenantGateRule.accessPin.length >= 4;
    if (tenantGateRule.requireBiometric) {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);

      if (hasHardware && isEnrolled) {
        const authResult = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Confirme para abrir o portão',
          cancelLabel: 'Cancelar',
          disableDeviceFallback: false,
        });

        if (!authResult.success) {
          if (!hasPin) {
            return {
              allowed: false as const,
              message: 'Confirmação biométrica cancelada ou inválida.',
            };
          }
        } else {
          return { allowed: true as const, context: locationContext };
        }
      } else if (!hasPin) {
        return {
          allowed: false as const,
          message: 'Biometria obrigatória para abrir o portão neste dispositivo.',
        };
      }
    }

    if (hasPin) {
      const enteredPin = await requestAccessPin('Digite o PIN da casa para abrir');
      if (!enteredPin || enteredPin.trim() !== tenantGateRule.accessPin) {
        return {
          allowed: false as const,
          message: 'PIN inválido.',
        };
      }
    }

    return { allowed: true as const, context: locationContext };
  }, [
    config.latitude,
    config.longitude,
    isOwner,
    profile?.casaId,
    requestAccessPin,
    tenantGateRule,
    tenantOpenEvents,
    tenantOpensToday,
    withTimeout,
  ]);

  const handleAction = async (
    statusOverride?: 'aberto' | 'fechado',
    options?: { showSuccessAlert?: boolean; showErrorAlert?: boolean },
  ) => {
    if (!profile || !authUid) {
      return;
    }

    const showSuccessAlert = options?.showSuccessAlert ?? true;
    const showErrorAlert = options?.showErrorAlert ?? true;
    const nextStatus = statusOverride ?? (isOwner ? (gateStatus === 'aberto' ? 'fechado' : 'aberto') : 'aberto');
    let actionContext: {
      houseId?: string;
      latitude?: number;
      longitude?: number;
      distanceMeters?: number;
    } = {};

    try {
      if (!isOwner && nextStatus === 'aberto') {
        const validation = await validateTenantGateOpen();
        if (!validation.allowed) {
          if (showErrorAlert) {
            Alert.alert('Acesso bloqueado', validation.message);
          }
          return;
        }
        actionContext = {
          houseId: String(profile.casaId ?? '').trim() || undefined,
          latitude: validation.context.latitude,
          longitude: validation.context.longitude,
          distanceMeters: validation.context.distanceMeters,
        };
      }

      setLoadingAction('gate');
      await withTimeout(updateGateStatus(nextStatus, authUid, profile.nome, 'manual', actionContext), 20000);
      if (showSuccessAlert) {
        Alert.alert('Portão', 'Comando enviado com sucesso.');
      }
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      if (showErrorAlert) {
        Alert.alert(
          'Erro',
          code === 'operation-timeout'
            ? 'Ação demorou demais para responder. Verifique conexão e webhook.'
            : 'Falha ao acionar o portão. Verifique o webhook configurado.',
        );
      }
    } finally {
      setLoadingAction(null);
    }
  };

  const maxGateSwipe = Math.max(gateSwipeWidth - SWIPE_KNOB_SIZE - spacing.xs, 0);

  const resetGateSwipe = useCallback(() => {
    Animated.spring(gateSwipeX, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
    }).start();
    gateSwipeStartRef.current = 0;
  }, [gateSwipeX]);

  const runGateSwipeAction = useCallback(() => {
    if (loadingAction === 'gate') {
      return;
    }

    Animated.timing(gateSwipeX, {
      toValue: maxGateSwipe,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      void handleAction(undefined, { showSuccessAlert: false, showErrorAlert: true }).finally(() => {
        resetGateSwipe();
      });
    });
  }, [gateSwipeX, handleAction, loadingAction, maxGateSwipe, resetGateSwipe]);

  const gateSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => loadingAction !== 'gate' && maxGateSwipe > 0,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          loadingAction !== 'gate' &&
          maxGateSwipe > 0 &&
          Math.abs(gestureState.dx) > 2 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderGrant: () => {
          gateSwipeStartRef.current = gateSwipeValueRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextX = Math.min(Math.max(gateSwipeStartRef.current + gestureState.dx, 0), maxGateSwipe);
          gateSwipeX.setValue(nextX);
        },
        onPanResponderRelease: (_, gestureState) => {
          const reachedActionPoint =
            gateSwipeValueRef.current >= maxGateSwipe * 0.58 || (gestureState.vx > 0.7 && gestureState.dx > 12);
          if (reachedActionPoint) {
            runGateSwipeAction();
            return;
          }

          resetGateSwipe();
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderTerminate: () => {
          resetGateSwipe();
        },
      }),
    [gateSwipeX, loadingAction, maxGateSwipe, resetGateSwipe, runGateSwipeAction],
  );

  const pickVisitorPhoto = async () => {
    const permissions = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permissions.granted) {
      Alert.alert('Permissão necessária', 'Permita acesso à galeria para anexar foto.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
    });

    if (result.canceled) {
      return;
    }

    setVisitorPhoto(result.assets[0].uri);
  };

  const handleRegisterVisitor = async () => {
    if (!profile || !authUid) {
      return;
    }

    if (!visitorName.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do visitante.');
      return;
    }

    try {
      setLoadingAction('registerVisitor');
      let photoUrl: string | undefined;

      if (visitorPhoto) {
        photoUrl = await withTimeout(
          uploadImageAsync(
            visitorPhoto,
            `visitantes/${authUid}/${Date.now()}-${visitorName.replace(/\s+/g, '-')}.jpg`,
          ),
        );
      }

      await withTimeout(
        createVisitor({
          moradorId: authUid,
          moradorNome: profile.nome,
          nome: visitorName.trim(),
          fotoUrl: photoUrl,
          status: 'Esperado',
        }),
        20000,
      );

      setVisitorName('');
      setVisitorPhoto(null);
      try {
        await withTimeout(loadVisitors(), 20000);
      } catch {
        // Se a recarga falhar, o cadastro ainda foi concluído.
      }
      Alert.alert('Visitante cadastrado', 'Quando chegar ao portão, você poderá liberar pelo app.');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      const message = error instanceof Error ? error.message : '';
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'Cadastro demorou demais para responder. Tente novamente.'
          : String(code).includes('permission-denied')
            ? 'Sem permissão para cadastrar visitante. Verifique regras e perfil do usuário.'
            : String(code).includes('failed-precondition')
              ? 'A consulta não está pronta no banco. O cadastro pode ter sido salvo.'
              : message || 'Não foi possível cadastrar o visitante.',
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const pendingVisitors = useMemo(
    () => visitors.filter((visitor) => visitor.status === 'No portao' || visitor.status === 'Esperado'),
    [visitors],
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadVisitors()
      .catch(() => undefined)
      .finally(() => {
        setRefreshing(false);
      });
  }, [loadVisitors]);

  const gateStatusTone = gateStatus === 'aberto' ? 'success' : 'neutral';
  const tenantRemainingOpenings = Math.max(tenantGateRule.maxOpensPerDay - tenantOpensToday, 0);

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <AppCard>
        <View style={[styles.mainGateArea, gateStatus === 'aberto' ? styles.mainGateOpen : styles.mainGateClosed, isDark ? styles.mainGateDark : null]}>
          <View style={styles.statusRow}>
            <Text style={[styles.title, { color: themeColors.textPrimary }]}>Portão principal</Text>
            <StatusBadge text={gateStatus === 'aberto' ? 'Aberto' : 'Fechado'} tone={gateStatusTone} />
          </View>

          <Animated.View style={[styles.gateIconWrap, { transform: [{ scale: pulseAnim }] }]}>
            {gateStatus === 'aberto' ? (
              <DoorOpen size={42} color={colors.primary} />
            ) : (
              <DoorClosed size={42} color={themeColors.textSecondary} />
            )}
          </Animated.View>

          <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>
            {isOwner
              ? gateStatus === 'aberto'
                ? 'Portão marcado como aberto. Deslize para a direita para fechar.'
                : 'Deslize para a direita para abrir o portão.'
              : 'Deslize para a direita para abrir o portão.'}
          </Text>
          {!isOwner ? (
            <Text style={[styles.subtitleSmall, { color: themeColors.textSecondary }]}>
              Regras da sua casa: horário {tenantGateRule.windowStart}-{tenantGateRule.windowEnd} • limite diário{' '}
              {tenantGateRule.maxOpensPerDay} • restante hoje {tenantRemainingOpenings}
            </Text>
          ) : null}

          <View style={styles.mainActionButtons}>
            <View
              {...gateSwipeResponder.panHandlers}
              style={[
                styles.swipeTrack,
                { backgroundColor: isDark ? darkColors.surfaceAlt : colors.surface },
                loadingAction === 'gate' ? styles.swipeTrackDisabled : null,
              ]}
              onLayout={(event) => {
                setGateSwipeWidth(event.nativeEvent.layout.width);
              }}
            >
              <Text style={[styles.swipeHint, { color: themeColors.textSecondary }]}>
                {loadingAction === 'gate'
                  ? 'Enviando comando...'
                  : isOwner && gateStatus === 'aberto'
                    ? 'Deslize para fechar o portão'
                    : 'Deslize para abrir o portão'}
              </Text>
              <Animated.View
                style={[
                  styles.swipeKnob,
                  { transform: [{ translateX: gateSwipeX }] },
                  loadingAction === 'gate' ? styles.swipeKnobDisabled : null,
                ]}
              >
                <ChevronRight size={24} color={colors.textOnPrimary} />
              </Animated.View>
            </View>
          </View>
        </View>
      </AppCard>

      <AppCard>
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>Registrar visitante</Text>

        <AppInput
          label="Nome do visitante"
          value={visitorName}
          onChangeText={setVisitorName}
          placeholder="Ex: João da transportadora"
        />

        <Pressable style={[styles.photoButton, isDark ? styles.photoButtonDark : null]} onPress={pickVisitorPhoto}>
          <ImagePlus size={20} color={colors.primary} />
          <Text style={styles.photoButtonText}>{visitorPhoto ? 'Trocar foto' : 'Adicionar foto (opcional)'}</Text>
        </Pressable>

        {visitorPhoto ? <Image source={{ uri: visitorPhoto }} style={styles.previewImage} /> : null}

        <AppButton
          label="Cadastrar visitante"
          onPress={handleRegisterVisitor}
          loading={loadingAction === 'registerVisitor'}
        />
      </AppCard>

      <AppCard>
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>Visitantes aguardando</Text>

        {pendingVisitors.length ? (
          pendingVisitors.map((visitor) => (
            <View key={visitor.id} style={[styles.visitorRow, isDark ? styles.visitorRowDark : null]}>
              <View style={styles.visitorHeader}>
                {visitor.fotoUrl ? (
                  <Image source={{ uri: visitor.fotoUrl }} style={styles.visitorAvatar} />
                ) : (
                  <View style={[styles.visitorAvatarPlaceholder, isDark ? styles.visitorAvatarPlaceholderDark : null]}>
                    <User size={20} color={themeColors.textSecondary} />
                  </View>
                )}

                <View style={styles.visitorInfo}>
                  <Text style={[styles.visitorName, { color: themeColors.textPrimary }]}>{visitor.nome}</Text>
                  <Text style={[styles.visitorMeta, { color: themeColors.textSecondary }]}>Status: {visitor.status}</Text>
                </View>
              </View>

              <View style={styles.inlineButtons}>
                <View style={styles.inlineButtonItem}>
                  <AppButton
                    label="Liberar"
                    variant="secondary"
                    onPress={async () => {
                      try {
                        setLoadingAction(`visitor:${visitor.id}`);
                        await withTimeout(updateVisitorStatus(visitor.id, 'Liberado'));
                        await handleAction();
                        await withTimeout(loadVisitors());
                      } catch {
                        Alert.alert('Erro', 'Não foi possível liberar o visitante.');
                      } finally {
                        setLoadingAction(null);
                      }
                    }}
                    loading={loadingAction === `visitor:${visitor.id}`}
                  />
                </View>
                <View style={styles.inlineButtonItem}>
                  <AppButton
                    label="Negar"
                    variant="danger"
                    onPress={async () => {
                      try {
                        setLoadingAction(`visitor:${visitor.id}`);
                        await withTimeout(updateVisitorStatus(visitor.id, 'Negado'));
                        await withTimeout(loadVisitors());
                      } catch {
                        Alert.alert('Erro', 'Não foi possível negar o visitante.');
                      } finally {
                        setLoadingAction(null);
                      }
                    }}
                    loading={loadingAction === `visitor:${visitor.id}`}
                  />
                </View>
              </View>
            </View>
          ))
        ) : (
          <EmptyState title="Nenhum visitante pendente" subtitle="Quando houver solicitações elas aparecerão aqui." />
        )}
      </AppCard>

      <AppCard>
        <Text style={[styles.title, { color: themeColors.textPrimary }]}>Histórico de acessos</Text>
        {accessLogs.length ? (
          accessLogs.map((item) => (
            <View key={String(item.id)} style={styles.logRow}>
              <Text style={[styles.logText, { color: themeColors.textPrimary }]}>
                {item.status === 'aberto' ? 'Portão aberto' : 'Portão fechado'} por {String(item.userName ?? '-')}
              </Text>
              <Text style={[styles.logDate, { color: themeColors.textSecondary }]}>
                {formatDateBR(String(item.createdAt), 'dd/MM HH:mm')}
              </Text>
            </View>
          ))
        ) : (
          <EmptyState title="Sem registros" subtitle="O histórico de acessos aparecerá aqui." />
        )}
      </AppCard>

      <Modal transparent visible={pinModalVisible} animationType="fade" onRequestClose={() => closePinModal(null)}>
        <View style={styles.pinBackdrop}>
          <View style={[styles.pinCard, { backgroundColor: isDark ? darkColors.surface : colors.surface }]}>
            <Text style={[styles.pinTitle, { color: themeColors.textPrimary }]}>{currentPinTitle}</Text>
            <Text style={[styles.pinSubtitle, { color: themeColors.textSecondary }]}>
              Para segurança, confirme o PIN antes de abrir o portão.
            </Text>
            <AppInput
              label="PIN de acesso"
              value={pinInput}
              onChangeText={(value) => {
                setPinInput(value.replace(/\D/g, '').slice(0, 8));
                setPinError('');
              }}
              keyboardType="numeric"
              secureTextEntry
              placeholder="Digite o PIN"
            />
            {pinError ? <Text style={styles.pinError}>{pinError}</Text> : null}
            <View style={styles.pinActions}>
              <View style={styles.pinAction}>
                <AppButton label="Cancelar" variant="ghost" onPress={() => closePinModal(null)} />
              </View>
              <View style={styles.pinAction}>
                <AppButton
                  label="Confirmar"
                  onPress={() => {
                    if (!pinInput.trim()) {
                      setPinError('Informe o PIN para continuar.');
                      return;
                    }
                    closePinModal(pinInput.trim());
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  mainGateArea: {
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  mainGateOpen: {
    backgroundColor: colors.successLight,
  },
  mainGateClosed: {
    backgroundColor: colors.primaryLight,
  },
  mainGateDark: {
    backgroundColor: '#213126',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  subtitle: {
    fontSize: typography.size.xs,
  },
  subtitleSmall: {
    fontSize: typography.size.xs,
    lineHeight: 18,
  },
  gateIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  mainActionButtons: {
    gap: spacing.sm,
  },
  swipeTrack: {
    height: 66,
    borderRadius: radius.full,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    position: 'relative',
  },
  swipeTrackDisabled: {
    opacity: 0.72,
  },
  swipeHint: {
    textAlign: 'center',
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    paddingHorizontal: 72,
  },
  swipeKnob: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 62,
    height: 62,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    elevation: 3,
  },
  swipeKnobDisabled: {
    backgroundColor: colors.textMuted,
  },
  photoButton: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  photoButtonDark: {
    borderColor: darkColors.border,
    backgroundColor: darkColors.surfaceAlt,
  },
  photoButtonText: {
    color: colors.primary,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
  },
  visitorRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  visitorRowDark: {
    borderColor: darkColors.border,
    backgroundColor: darkColors.surface,
  },
  visitorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  visitorAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
  },
  visitorAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitorAvatarPlaceholderDark: {
    backgroundColor: darkColors.surfaceAlt,
  },
  visitorInfo: {
    flex: 1,
    gap: 2,
  },
  visitorName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  visitorMeta: {
    fontSize: typography.size.sm,
  },
  inlineButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inlineButtonItem: {
    flex: 1,
  },
  logRow: {
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    gap: 3,
  },
  logText: {
    fontSize: typography.size.sm,
  },
  logDate: {
    fontSize: typography.size.xs,
  },
  pinBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 12, 16, 0.58)',
    justifyContent: 'center',
    padding: spacing.md,
  },
  pinCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pinTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  pinSubtitle: {
    fontSize: typography.size.sm,
  },
  pinError: {
    color: colors.danger,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  pinActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  pinAction: {
    flex: 1,
  },
});
