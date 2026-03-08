import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { getOwnerDashboardSummary, getTenantDashboardSummary } from '../../services/firestoreService';
import { getWeatherForecast } from '../../services/weatherService';
import { cacheKeys, getCache, saveCache } from '../../services/cacheService';
import { formatCurrencyBRL, formatDateBR, countdownDays } from '../../utils/format';
import { WeatherDay } from '../../types/models';

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
  const [avatarFailed, setAvatarFailed] = useState(false);
  const isOwner = Boolean(profile?.isOwner);

  const loadData = useCallback(async () => {
    if (!profile) {
      return;
    }

    let ownerData = null;
    let tenantData = null;
    let forecastData: WeatherDay[] = [];

    try {
      setRefreshing(true);
      if (isOwner) {
        try {
          const summary = await getOwnerDashboardSummary();
          setOwnerSummary(summary);
          ownerData = summary;
        } catch (error) {
          console.warn('[HomeScreen] Falha ao carregar resumo do proprietário:', error);
        }
      } else if (profile.casaId) {
        try {
          const summary = await getTenantDashboardSummary(profile.casaId);
          setTenantSummary(summary);
          tenantData = summary;
        } catch (error) {
          console.warn('[HomeScreen] Falha ao carregar resumo do inquilino:', error);
        }
      }

      if (Number.isFinite(config.latitude) && Number.isFinite(config.longitude)) {
        try {
          const forecast = await getWeatherForecast(Number(config.latitude), Number(config.longitude));
          setWeather(forecast);
          forecastData = forecast;
        } catch (error) {
          console.warn('[HomeScreen] Falha ao carregar previsão do tempo:', error);
        }
      }

      await saveCache(cacheKeys.home, { ownerSummary: ownerData, tenantSummary: tenantData, weather: forecastData });
    } catch {
      const cached = await getCache<{
        ownerSummary?: typeof ownerSummary;
        tenantSummary?: typeof tenantSummary;
        weather?: WeatherDay[];
      }>(cacheKeys.home);

      if (cached) {
        setOwnerSummary(cached.ownerSummary ?? null);
        setTenantSummary(cached.tenantSummary ?? null);
        setWeather(cached.weather ?? []);
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
          <Text style={styles.cardTitle}>Resumo de aluguéis do mês</Text>
          <Text style={styles.bigValue}>{ownerSummary ? `${ownerSummary.paidCount}/${ownerSummary.totalHouses}` : '--'} pagos</Text>
          <Text style={styles.cardSubtitle}>
            Total recebido: {ownerSummary ? formatCurrencyBRL(ownerSummary.totalReceived) : '--'}
          </Text>
          <StatusBadge text={`${ownerSummary?.openTickets ?? 0} chamados abertos`} tone="warning" />
        </AppCard>
      ) : (
        <AppCard>
          <Text style={styles.cardTitle}>Meu aluguel</Text>
          {paymentBadge}
          <Text style={styles.cardSubtitle}>
            Valor mensal: {formatCurrencyBRL(tenantSummary?.payment?.valor ?? 0)}
          </Text>
          <Text style={styles.cardSubtitle}>
            Próximo vencimento: {tenantSummary?.dueDate ? countdownDays(tenantSummary.dueDate) : 'Sem data'}
          </Text>
        </AppCard>
      )}

      <AppCard>
        <View style={styles.inlineSpace}>
          <Text style={styles.cardTitle}>Ações rápidas</Text>
          <MaterialIcons name="bolt" size={18} color={palette.greenDark} />
        </View>
        <View style={styles.quickActionsGrid}>
          <QuickAction title="Abrir portão" icon="door-front" onPress={() => navigation.navigate('Gate')} />
          <QuickAction title="Novo chamado" icon="build" onPress={() => navigation.navigate('TicketForm')} />
          <QuickAction title="Avisos" icon="campaign" onPress={() => navigation.navigate('Notices')} />
          <QuickAction
            title={isOwner ? 'Publicar aviso' : 'Falar com proprietário'}
            icon="chat"
            onPress={() =>
              isOwner
                ? navigation.navigate('Notices')
                : navigation.navigate('ChatRoom', {
                    chatId: 'owner_private',
                    title: 'Proprietário',
                    isPrivate: true,
                  })
            }
          />
        </View>
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Previsão do tempo (3 dias)</Text>
        {weather.length ? (
          weather.map((day) => {
            const iconName = getWeatherIconName(day);
            return (
              <View key={day.date} style={styles.weatherItem}>
                <View style={styles.weatherMain}>
                  <MaterialIcons name={iconName} size={22} color={getWeatherIconColor(iconName)} />
                  <View style={styles.weatherInfo}>
                    <Text style={styles.weatherDate}>{formatDateBR(day.date)}</Text>
                    <Text style={styles.weatherText}>{day.description}</Text>
                  </View>
                </View>
                <Text style={styles.weatherTemp}>{Math.round(day.tempMin)}° / {Math.round(day.tempMax)}°</Text>
              </View>
            );
          })
        ) : (
          <Text style={styles.cardSubtitle}>Sem previsão disponível agora. Puxe para baixo para atualizar.</Text>
        )}
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
    </ScreenContainer>
  );
};

const QuickAction = ({ title, icon, onPress }: { title: string; icon: keyof typeof MaterialIcons.glyphMap; onPress: () => void }) => (
  <Pressable style={({ pressed }) => [styles.quickAction, pressed && styles.quickActionPressed]} onPress={onPress}>
    <MaterialIcons name={icon} size={20} color={palette.greenDark} />
    <Text style={styles.quickActionText}>{title}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 16,
    color: palette.gray900,
    fontWeight: '800',
  },
  bigValue: {
    fontSize: 32,
    color: palette.greenDark,
    fontWeight: '800',
  },
  cardSubtitle: {
    fontSize: 14,
    color: palette.gray700,
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
    gap: spacing.sm,
  },
  quickAction: {
    width: '48%',
    backgroundColor: palette.gray100,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: spacing.xs,
  },
  quickActionPressed: {
    opacity: 0.7,
  },
  quickActionText: {
    color: palette.gray900,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  weatherItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
  },
  weatherMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  weatherInfo: {
    flex: 1,
    gap: 2,
  },
  weatherDate: {
    color: palette.gray900,
    fontWeight: '700',
  },
  weatherText: {
    flex: 1,
    color: palette.gray700,
  },
  weatherTemp: {
    color: palette.gray900,
    fontWeight: '700',
  },
  headerAvatar: {
    width: 48,
    height: 48,
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
    fontSize: 14,
  },
  link: {
    color: palette.greenDark,
    fontWeight: '700',
  },
});
