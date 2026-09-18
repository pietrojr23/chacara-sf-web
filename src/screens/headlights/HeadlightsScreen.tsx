import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing } from '../../constants/theme';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { useAuth } from '../../contexts/AuthContext';
import { getHeadlightsCatalog, toggleHeadlight } from '../../services/headlightService';
import { RootStackParamList } from '../../types/navigation';

export const HeadlightsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { profile, firebaseUser } = useAuth();
  const { config } = useAppConfig();
  const isOwner = Boolean(profile?.isOwner);
  const tenantHouseId = String(profile?.casaId ?? '').trim();

  const headlights = useMemo(() => getHeadlightsCatalog(config.headlights), [config.headlights]);
  const visibleHeadlights = useMemo(() => {
    if (isOwner) {
      return headlights;
    }

    return headlights.filter((headlight) => {
      if (!headlight.active) {
        return false;
      }

      if (!headlight.allowedHouseIds.length) {
        return true;
      }

      return tenantHouseId ? headlight.allowedHouseIds.includes(tenantHouseId) : false;
    });
  }, [headlights, isOwner, tenantHouseId]);
  const [stateById, setStateById] = useState<Record<string, boolean | undefined>>({});
  const [loadingById, setLoadingById] = useState<Record<string, boolean>>({});

  const getStatusText = (headlightId: string) => {
    const value = stateById[headlightId];
    if (value === true) return 'Ligado';
    if (value === false) return 'Desligado';
    return 'Sem leitura';
  };

  const getStatusTone = (headlightId: string): 'success' | 'neutral' => {
    return stateById[headlightId] === true ? 'success' : 'neutral';
  };

  const handleToggle = (headlightId: string, headlightName: string) => {
    if (!profile || loadingById[headlightId]) {
      return;
    }

    void (async () => {
      try {
        setLoadingById((current) => ({ ...current, [headlightId]: true }));
        const result = await toggleHeadlight(headlightId, firebaseUser?.uid ?? profile.id, profile.nome);
        const nextState = result?.state;

        if (typeof nextState === 'boolean') {
          setStateById((current) => ({ ...current, [headlightId]: nextState }));
        }

        Alert.alert('Faróis', `${headlightName}: ${nextState === false ? 'desligado' : 'ligado'}.`);
      } catch (error) {
        const code = (error as { code?: string } | undefined)?.code;
        Alert.alert(
          'Erro',
          code === 'headlights-webhook-missing'
            ? 'Webhook do portão não configurado. Configure em Ajustes para controlar os faróis.'
            : code === 'headlights-webhook-invalid'
              ? 'Webhook atual não é compatível. Use o bridge Tuya para habilitar /headlights/toggle.'
              : 'Não foi possível alternar este farol agora.',
        );
      } finally {
        setLoadingById((current) => ({ ...current, [headlightId]: false }));
      }
    })();
  };

  return (
    <ScreenContainer>
      <SectionHeader
        title="Faróis"
        subtitle="Controle os faróis da chácara. Toque para ligar ou desligar."
        rightElement={
          isOwner ? (
            <Pressable style={styles.configButton} onPress={() => navigation.navigate('HeadlightsConfig')}>
              <MaterialIcons name="settings" size={16} color={palette.greenDark} />
              <Text style={styles.configButtonText}>Configurar</Text>
            </Pressable>
          ) : undefined
        }
      />

      {!visibleHeadlights.length ? (
        <EmptyState
          title="Nenhum farol disponível"
          subtitle={isOwner
            ? 'Cadastre virtual_id dos faróis para começar o controle.'
            : 'Nenhum farol foi liberado para sua casa.'}
        />
      ) : null}

      {visibleHeadlights.map((headlight) => (
        <AppCard key={headlight.id}>
          <View style={styles.headerRow}>
            <View style={styles.iconWrap}>
              <MaterialIcons name="highlight" size={20} color={palette.greenDark} />
            </View>
            <View style={styles.meta}>
              <Text style={styles.name}>{headlight.name}</Text>
              {headlight.description ? <Text style={styles.description}>{headlight.description}</Text> : null}
              <Text style={styles.virtualId}>virtual_id: {headlight.id}</Text>
              {isOwner ? (
                <Text style={styles.permissionText}>
                  {headlight.allowedHouseIds.length
                    ? `Casas permitidas: ${headlight.allowedHouseIds.join(', ')}`
                    : 'Casas permitidas: todas'}
                </Text>
              ) : null}
            </View>
            <StatusBadge
              text={headlight.active ? getStatusText(headlight.id) : 'Inativo'}
              tone={headlight.active ? getStatusTone(headlight.id) : 'neutral'}
            />
          </View>

          <AppButton
            label={loadingById[headlight.id] ? 'Enviando comando...' : 'Ligar / Desligar'}
            onPress={() => handleToggle(headlight.id, headlight.name)}
            disabled={loadingById[headlight.id] || !headlight.active}
          />
        </AppCard>
      ))}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  configButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: '#D5E4D2',
    borderRadius: radii.pill,
    backgroundColor: '#EFF6EC',
  },
  configButtonText: {
    color: palette.greenDark,
    fontWeight: '700',
    fontSize: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    backgroundColor: '#ECF3E7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: palette.gray900,
    fontWeight: '800',
    fontSize: 15,
  },
  description: {
    color: palette.gray700,
    fontSize: 13,
  },
  virtualId: {
    color: palette.gray500,
    fontSize: 11,
  },
  permissionText: {
    color: palette.gray700,
    fontSize: 12,
  },
});
