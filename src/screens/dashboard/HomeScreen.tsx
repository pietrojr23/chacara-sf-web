import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppCard } from '../../components/AppCard';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { LoadingState } from '../../components/LoadingState';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import {
  getOwnerDashboardSummary,
  getOwnerUser,
  getTenantDashboardSummary,
  sendChatMessage,
} from '../../services/firestoreService';
import { getWeatherForecast } from '../../services/weatherService';
import { cacheKeys, getCache, saveCache } from '../../services/cacheService';
import { formatCurrencyBRL, formatDateBR, countdownDays } from '../../utils/format';
import { WeatherDay } from '../../types/models';
import { buildPrivateChatId } from '../../utils/chat';

const getWeatherIconName = (day: WeatherDay): keyof typeof MaterialIcons.glyphMap => {
  const icon = String(day.icon ?? '').toLowerCase();
  const description = String(day.description ?? '').toLowerCase();

  if (icon.startsWith('11') || description.includes('tempest')) {
    return 'flash-on';
  }

  if (icon.startsWith('13') || description.includes('neve') || description.includes('granizo')) {
    return 'ac-unit';
  }

  if (icon.startsWith('09') || icon.startsWith('10') || description.includes('chuva') || description.includes('garoa')) {
    return 'grain';
  }

  if (icon.startsWith('01') || description.includes('sol') || description.includes('limpo')) {
    return 'wb-sunny';
  }

  return 'cloud';
};

const getWeatherIconColor = (iconName: keyof typeof MaterialIcons.glyphMap) => {
  if (iconName === 'flash-on') {
    return '#D97706';
  }

  if (iconName === 'grain') {
    return '#2563EB';
  }

  if (iconName === 'wb-sunny') {
    return '#F59E0B';
  }

  return palette.gray700;
};

const withTimeout = async <T,>(task: Promise<T>, timeoutMs = 12000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('operation-timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

const padDate = (value: number) => String(value).padStart(2, '0');

const toLocalDateKey = (date: Date) => `${date.getFullYear()}-${padDate(date.getMonth() + 1)}-${padDate(date.getDate())}`;

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const formatDateOnlyBR = (isoDate: string) => {
  const [yearRaw, monthRaw, dayRaw] = String(isoDate ?? '').split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return formatDateBR(isoDate);
  }

  return `${padDate(day)}/${padDate(month)}/${year}`;
};

const getWeatherDayLabel = (date: string) => {
  const normalizedDate = String(date ?? '').slice(0, 10);
  if (!normalizedDate) {
    return 'Sem data';
  }

  const now = new Date();
  const todayKey = toLocalDateKey(now);
  const tomorrowKey = toLocalDateKey(addDays(now, 1));

  if (normalizedDate === todayKey) {
    return 'Hoje';
  }

  if (normalizedDate === tomorrowKey) {
    return 'Amanhã';
  }

  return formatDateOnlyBR(normalizedDate);
};

const normalizeWeatherDescription = (value: string) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return 'Sem previsão';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatTenantDueLabel = (dueDate?: string | null) => {
  if (!dueDate) {
    return 'Vencimento: Sem data';
  }

  const relative = countdownDays(dueDate);
  if (!relative || relative === 'Sem data') {
    return 'Vencimento: Sem data';
  }

  if (relative === 'em 0 dia' || relative === 'em 0 dias' || relative === 'há 0 dia' || relative === 'há 0 dias') {
    return 'Vence hoje';
  }

  if (relative.startsWith('há ')) {
    return `Vencido ${relative}`;
  }

  return `Próximo vencimento: ${relative}`;
};

export const HomeScreen = () => {
  const { profile } = useAuth();
  const { config } = useAppConfig();
  const { dataVersion } = useDataSync();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [ownerSummary, setOwnerSummary] = useState<{
    paidCount: number;
    totalReceived: number;
    totalHouses: number;
    openTickets: number;
    latestNotices: Array<{ id: string; titulo?: string }>;
  } | null>(null);
  const [tenantSummary, setTenantSummary] = useState<{
    payment: { status?: string; valor?: number } | null;
    dueDate: string | null;
    latestNotices: Array<{ id: string; titulo?: string }>;
  } | null>(null);
  const [weather, setWeather] = useState<WeatherDay[]>([]);
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState<string | null>(null);
  const [ownerPrivateChatId, setOwnerPrivateChatId] = useState<string | null>(null);
  const [sendingRemoteBatteryRequest, setSendingRemoteBatteryRequest] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const isOwner = Boolean(profile?.isOwner);

  const loadData = useCallback(async () => {
    if (!profile) {
      return;
    }

    let ownerData = null;
    let tenantData = null;
    let forecastData: WeatherDay[] = [];
    let weatherFetchedAt: string | null = null;

    try {
      setRefreshing(true);
      if (isOwner) {
        try {
          const summary = await withTimeout(getOwnerDashboardSummary(), 12000);
          setOwnerSummary(summary);
          ownerData = summary;
        } catch (error) {
          console.warn('[HomeScreen] Falha ao carregar resumo do proprietário:', error);
        }
      } else if (profile.casaId) {
        try {
          const summary = await withTimeout(getTenantDashboardSummary(profile.casaId), 12000);
          setTenantSummary(summary);
          tenantData = summary;
        } catch (error) {
          console.warn('[HomeScreen] Falha ao carregar resumo do inquilino:', error);
        }
      }

      if (Number.isFinite(config.latitude) && Number.isFinite(config.longitude)) {
        try {
          const forecast = await withTimeout(
            getWeatherForecast(Number(config.latitude), Number(config.longitude)),
            12000,
          );
          setWeather(forecast);
          forecastData = forecast;
          weatherFetchedAt = new Date().toISOString();
          setWeatherUpdatedAt(weatherFetchedAt);
        } catch (error) {
          console.warn('[HomeScreen] Falha ao carregar previsão do tempo:', error);
        }
      }

      void saveCache(cacheKeys.home, {
        ownerSummary: ownerData,
        tenantSummary: tenantData,
        weather: forecastData,
        weatherFetchedAt,
      }).catch(() => undefined);
    } catch {
      const cached = await getCache<{
        ownerSummary?: typeof ownerSummary;
        tenantSummary?: typeof tenantSummary;
        weather?: WeatherDay[];
        weatherFetchedAt?: string | null;
      }>(cacheKeys.home);

      if (cached) {
        setOwnerSummary(cached.ownerSummary ?? null);
        setTenantSummary(cached.tenantSummary ?? null);
        setWeather(cached.weather ?? []);
        setWeatherUpdatedAt(cached.weatherFetchedAt ?? null);
      }
    } finally {
      setRefreshing(false);
    }
  }, [config.latitude, config.longitude, isOwner, profile]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return undefined;
    }, [dataVersion, loadData]),
  );

  const handleRefresh = useCallback(() => {
    void loadData();
  }, [loadData]);

  const openOwnerPrivateChat = useCallback(async () => {
    if (!profile || isOwner) {
      return;
    }

    let targetChatId = ownerPrivateChatId;

    if (!targetChatId) {
      try {
        const owner = await getOwnerUser();
        if (owner) {
          targetChatId = buildPrivateChatId(profile.id, owner.id);
          setOwnerPrivateChatId(targetChatId);
        }
      } catch (error) {
        console.warn('[HomeScreen] Falha ao abrir chat privado com proprietário:', error);
      }
    }

    if (!targetChatId) {
      Alert.alert('Chat indisponível', 'Não foi possível localizar o chat do proprietário agora. Tente novamente.');
      return;
    }

    navigation.navigate('ChatRoom', {
      chatId: targetChatId,
      title: 'Proprietário',
      isPrivate: true,
    });
  }, [isOwner, navigation, ownerPrivateChatId, profile]);

  const requestRemoteBatterySupport = useCallback(async () => {
    if (!profile || isOwner || sendingRemoteBatteryRequest) {
      return;
    }

    try {
      setSendingRemoteBatteryRequest(true);
      const owner = await getOwnerUser();

      if (!owner?.id) {
        Alert.alert('Proprietário indisponível', 'Não foi possível localizar o proprietário agora. Tente novamente.');
        return;
      }

      const chatId = buildPrivateChatId(profile.id, owner.id);
      setOwnerPrivateChatId(chatId);

      const houseLabel = profile.casaId ? `Casa ${profile.casaId}` : 'casa do inquilino';
      const message = [
        'Solicitação de troca de pilha do controle do portão.',
        `Origem: ${houseLabel}.`,
        'A bateria do controle acabou. Pode providenciar a venda/troca da pilha, por favor?',
      ].join('\n');

      await sendChatMessage({
        chatId,
        isPrivate: true,
        text: message,
        senderId: profile.id,
        senderName: profile.nome,
        senderPhotoURL: profile.photoURL ?? undefined,
        notifyUserIdsOverride: [owner.id],
      });

      Alert.alert('Solicitação enviada', 'O proprietário recebeu sua solicitação de pilha do controle.');
    } catch {
      Alert.alert('Erro', 'Não foi possível enviar a solicitação agora. Tente novamente.');
    } finally {
      setSendingRemoteBatteryRequest(false);
    }
  }, [isOwner, profile, sendingRemoteBatteryRequest]);

  const paymentBadge = useMemo(() => {
    const status = tenantSummary?.payment?.status;

    if (status === 'pago') {
      return <StatusBadge text="Pago" tone="success" />;
    }

    if (status === 'vencido') {
      return <StatusBadge text="Vencido" tone="danger" />;
    }

    if (status === 'aguardando_confirmacao') {
      return <StatusBadge text="Aguardando confirmação" tone="info" />;
    }

    return <StatusBadge text="Pendente" tone="warning" />;
  }, [tenantSummary?.payment?.status]);

  const weatherUpdatedLabel = useMemo(() => {
    if (!weatherUpdatedAt) {
      return 'Puxe para baixo ou toque em atualizar para carregar a previsão.';
    }

    const date = new Date(weatherUpdatedAt);
    if (Number.isNaN(date.getTime())) {
      return 'Previsão atualizada recentemente.';
    }

    const dateKey = toLocalDateKey(date);
    const todayKey = toLocalDateKey(new Date());
    const dayLabel = dateKey === todayKey ? 'Hoje' : formatDateOnlyBR(dateKey);
    const timeLabel = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    return `Atualizado: ${dayLabel} às ${timeLabel}`;
  }, [weatherUpdatedAt]);

  const isTenantRentOverdue = useMemo(() => {
    if (isOwner) {
      return false;
    }

    const status = tenantSummary?.payment?.status;
    if (status === 'vencido') {
      return true;
    }

    if (status === 'pago' || status === 'aguardando_confirmacao') {
      return false;
    }

    const dueDateRaw = tenantSummary?.dueDate;
    if (!dueDateRaw) {
      return false;
    }

    const dueDate = new Date(dueDateRaw);
    if (Number.isNaN(dueDate.getTime())) {
      return false;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dueStart = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    return dueStart.getTime() < todayStart.getTime();
  }, [isOwner, tenantSummary?.dueDate, tenantSummary?.payment?.status]);

  const shouldShowTenantDueDate = useMemo(() => {
    if (isOwner) {
      return false;
    }

    const status = tenantSummary?.payment?.status;
    if (status === 'pendente' || status === 'vencido') {
      return true;
    }

    return isTenantRentOverdue;
  }, [isOwner, isTenantRentOverdue, tenantSummary?.payment?.status]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [profile?.photoURL]);

  if (!profile) {
    return <LoadingState label="Carregando perfil" />;
  }

  const firstName = (profile.nome ?? 'Usuário').trim().split(' ')[0];
  const avatarUri = String(profile.photoURL ?? '').trim();
  const showAvatarImage = Boolean(avatarUri) && !avatarFailed;

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <SectionHeader
        title={`Olá, ${firstName}`}
        subtitle={isOwner ? 'Painel do proprietário' : `Casa vinculada: ${profile.casaId ?? '-'}`}
        rightElement={
          <View style={styles.headerAvatar}>
            {showAvatarImage ? (
              <Image
                source={{ uri: avatarUri }}
                style={styles.headerAvatarImage}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <MaterialIcons name="person" size={24} color={palette.gray700} />
            )}
          </View>
        }
      />

      {isOwner ? (
        <AppCard>
          <View style={styles.inlineSpace}>
            <Text style={styles.cardTitle}>Resumo de aluguéis do mês</Text>
            <MaterialIcons name="paid" size={25} color={palette.greenDark} />
          </View>
          <Text style={styles.bigValue}>{ownerSummary ? `${ownerSummary.paidCount}/${ownerSummary.totalHouses}` : '--'} pagos</Text>
          <Text style={styles.cardSubtitle}>
            Total recebido:{' '}
            <Text style={styles.cardSubtitleStrong}>
              {ownerSummary ? formatCurrencyBRL(ownerSummary.totalReceived) : '--'}
            </Text>
          </Text>
          {Number(ownerSummary?.openTickets ?? 0) > 0 ? (
            <StatusBadge text={`${ownerSummary?.openTickets ?? 0} chamados abertos`} tone="warning" />
          ) : null}
        </AppCard>
      ) : (
        <AppCard style={isTenantRentOverdue ? styles.overdueRentCard : undefined}>
          <View style={styles.inlineSpace}>
            <Text style={styles.cardTitle}>Meu aluguel</Text>
            <MaterialIcons name="paid" size={25} color={palette.greenDark} />
          </View>
          {isTenantRentOverdue ? (
            <StatusBadge
              text="Atrasado"
              tone="danger"
              containerStyle={styles.overdueBadge}
              textStyle={styles.overdueBadgeText}
            />
          ) : paymentBadge}
          <Text style={styles.cardSubtitle}>
            Valor mensal:{' '}
            <Text style={styles.cardSubtitleStrong}>
              {formatCurrencyBRL(tenantSummary?.payment?.valor ?? 0)}
            </Text>
          </Text>
          {shouldShowTenantDueDate ? (
            <Text style={styles.cardSubtitle}>
              {formatTenantDueLabel(tenantSummary?.dueDate)}
            </Text>
          ) : null}
        </AppCard>
      )}

      <AppCard>
        <View style={styles.inlineSpace}>
          <Text style={styles.cardTitle}>Ações rápidas</Text>
          <MaterialIcons name="bolt" size={25} color={palette.greenDark} />
        </View>
        <View style={styles.quickActionsGrid}>
          {isOwner ? <QuickAction title="Abrir portão" icon="door-front" onPress={() => navigation.navigate('Gate')} /> : null}
          <QuickAction title="Novo chamado" icon="build" onPress={() => navigation.navigate('TicketForm')} />
          {!isOwner ? <QuickAction title="Avisos" icon="campaign" onPress={() => navigation.navigate('Notices')} /> : null}
          {!isOwner ? (
            <QuickAction title="Pilha do controle" icon="settings-remote" onPress={() => void requestRemoteBatterySupport()} />
          ) : null}
          <QuickAction
            title={isOwner ? 'Publicar aviso' : 'Falar com proprietário'}
            icon="chat"
            onPress={() => {
              if (isOwner) {
                navigation.navigate('Notices');
                return;
              }

              void openOwnerPrivateChat();
            }}
          />
        </View>
      </AppCard>

      <AppCard>
        <View style={styles.inlineSpace}>
          <Text style={styles.cardTitle}>Últimos avisos</Text>
          <Pressable onPress={() => navigation.navigate('Notices')}>
            <Text style={styles.link}>Ver todos</Text>
          </Pressable>
        </View>
        {(isOwner ? ownerSummary?.latestNotices : tenantSummary?.latestNotices)?.length ? (
          (isOwner ? ownerSummary?.latestNotices : tenantSummary?.latestNotices)?.map((notice) => (
            <Text key={notice.id} style={styles.noticeLine}>• {notice.titulo}</Text>
          ))
        ) : (
          <Text style={styles.cardSubtitle}>Nenhum aviso publicado recentemente.</Text>
        )}
      </AppCard>

      <AppCard>
        <View style={styles.weatherHeader}>
          <View style={styles.weatherHeaderLeft}>
            <View style={styles.weatherHeaderIcon}>
              <MaterialIcons name="wb-sunny" size={20} color={palette.greenDark} />
            </View>
            <View style={styles.weatherHeaderTextWrap}>
              <Text style={styles.cardTitle}>Previsão do tempo</Text>
              <Text style={styles.weatherHeaderSubtitle}>Próximos 3 dias</Text>
            </View>
          </View>
        </View>
        <Text style={styles.weatherUpdatedText}>{weatherUpdatedLabel}</Text>

        {weather.length ? (
          <View style={styles.weatherList}>
            {weather.map((day, index) => {
              const iconName = getWeatherIconName(day);
              const isLast = index === weather.length - 1;

              return (
                <View key={day.date} style={[styles.weatherRow, isLast && styles.weatherRowLast]}>
                  <View style={styles.weatherDayColumn}>
                    <Text style={styles.weatherDayLabel}>{getWeatherDayLabel(day.date)}</Text>
                    <Text numberOfLines={1} style={styles.weatherDescription}>
                      {normalizeWeatherDescription(day.description)}
                    </Text>
                  </View>

                  <View style={styles.weatherIconChip}>
                    <MaterialIcons name={iconName} size={22} color={getWeatherIconColor(iconName)} />
                  </View>

                  <View style={styles.weatherTempColumn}>
                    <Text style={styles.weatherTempMax}>{Math.round(day.tempMax)}°</Text>
                    <Text style={styles.weatherTempMin}>{Math.round(day.tempMin)}°</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : refreshing ? (
          <View style={styles.weatherEmptyState}>
            <ActivityIndicator size="small" color={palette.greenDark} />
            <Text style={styles.weatherEmptyText}>Atualizando previsão...</Text>
          </View>
        ) : (
          <View style={styles.weatherEmptyState}>
            <MaterialIcons name="cloud" size={20} color={palette.gray500} />
            <Text style={styles.weatherEmptyText}>Sem previsão disponível no momento.</Text>
            <Text style={styles.weatherEmptyHint}>Toque em atualizar ou puxe a tela para baixo.</Text>
          </View>
        )}
      </AppCard>
    </ScreenContainer>
  );
};

const QuickAction = ({ title, icon, onPress }: { title: string; icon: keyof typeof MaterialIcons.glyphMap; onPress: () => void }) => (
  <Pressable style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]} onPress={onPress}>
    <View style={styles.quickActionIconWrap}>
      <MaterialIcons name={icon} size={18} color={palette.greenDark} />
    </View>
    <Text style={styles.quickActionText}>{title}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 17,
    color: palette.gray900,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  bigValue: {
    fontSize: 40,
    color: palette.greenDark,
    fontWeight: '900',
  },
  cardSubtitle: {
    fontSize: 16,
    color: palette.gray700,
  },
  cardSubtitleStrong: {
    fontWeight: '800',
  },
  overdueRentCard: {
    backgroundColor: '#FDECEA',
    borderColor: '#F5C2C0',
  },
  overdueBadge: {
    backgroundColor: '#E05555',
  },
  overdueBadgeText: {
    color: palette.white,
  },
  inlineSpace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  quickAction: {
    width: '48%',
    backgroundColor: palette.gray100,
    borderRadius: radii.xl,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexDirection: 'row',
    minHeight: 54,
    gap: spacing.xs,
  },
  quickActionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.white,
  },
  quickActionPressed: {
    opacity: 0.7,
  },
  quickActionText: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'left',
    flex: 1,
  },
  weatherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  weatherHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  weatherHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.gray100,
  },
  weatherHeaderTextWrap: {
    flex: 1,
    gap: 1,
  },
  weatherHeaderSubtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
  weatherUpdatedText: {
    color: palette.gray500,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  weatherList: {
    borderTopWidth: 1,
    borderTopColor: palette.gray100,
  },
  weatherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
  },
  weatherRowLast: {
    borderBottomWidth: 0,
    paddingBottom: spacing.xs,
  },
  weatherDayColumn: {
    flex: 1,
    gap: 2,
  },
  weatherDayLabel: {
    color: palette.gray900,
    fontWeight: '700',
    fontSize: 16,
  },
  weatherDescription: {
    flex: 1,
    color: palette.gray700,
    fontSize: 15,
  },
  weatherIconChip: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    backgroundColor: palette.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherTempColumn: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  weatherTempMax: {
    color: palette.gray900,
    fontWeight: '800',
    fontSize: 19,
    lineHeight: 22,
  },
  weatherTempMin: {
    color: palette.gray500,
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 18,
  },
  weatherEmptyState: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  weatherEmptyText: {
    color: palette.gray700,
    fontSize: 15,
    textAlign: 'center',
  },
  weatherEmptyHint: {
    color: palette.gray500,
    fontSize: 13,
    textAlign: 'center',
  },
  headerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.gray300,
    backgroundColor: palette.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarImage: {
    width: '100%',
    height: '100%',
  },
  noticeLine: {
    color: palette.gray700,
    fontSize: 16,
  },
  link: {
    color: palette.greenDark,
    fontWeight: '700',
  },
});
