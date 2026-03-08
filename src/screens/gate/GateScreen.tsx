import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { AppInput } from '../../components/AppInput';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing } from '../../constants/theme';
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
import { formatDateBR } from '../../utils/format';
import { Visitor } from '../../types/models';

export const GateScreen = () => {
  const { profile, firebaseUser } = useAuth();
  const { dataVersion } = useDataSync();
  const [gateStatus, setGateStatus] = useState<'aberto' | 'fechado'>('fechado');
  const [loadingAction, setLoadingAction] = useState<null | 'gate' | 'registerVisitor' | `visitor:${string}`>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [accessLogs, setAccessLogs] = useState<Array<Record<string, any>>>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhoto, setVisitorPhoto] = useState<string | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const isOwner = Boolean(profile?.isOwner);
  const authUid = firebaseUser?.uid ?? profile?.id ?? '';

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
      return;
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

  const handleAction = async (status: 'aberto' | 'fechado') => {
    if (!profile || !authUid) {
      return;
    }

    try {
      setLoadingAction('gate');
      await withTimeout(updateGateStatus(status, authUid, profile.nome), 20000);
      Alert.alert('Portão', status === 'aberto' ? 'Portão aberto com sucesso.' : 'Portão fechado com sucesso.');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'Ação demorou demais para responder. Verifique conexão e webhook.'
          : 'Falha ao acionar o portão. Verifique o webhook configurado.',
      );
    } finally {
      setLoadingAction(null);
    }
  };

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
        // O cadastro já foi salvo; se a listagem falhar, não deve marcar como erro de criação.
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

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <SectionHeader title="Controle do portão" subtitle="Abertura remota, visitantes e histórico de acessos" />

      <AppCard>
        <View style={styles.statusHeader}>
          <Text style={styles.cardTitle}>Status atual</Text>
          <StatusBadge text={gateStatus === 'aberto' ? 'Aberto' : 'Fechado'} tone={gateStatus === 'aberto' ? 'success' : 'neutral'} />
        </View>

        <Animated.View style={[styles.gateIconContainer, { transform: [{ scale: pulseAnim }] }]}>
          <MaterialIcons
            name={gateStatus === 'aberto' ? 'door-sliding' : 'door-front'}
            size={80}
            color={gateStatus === 'aberto' ? palette.greenLight : palette.gray700}
          />
        </Animated.View>

        <View style={styles.actionsRow}>
          <AppButton label="ABRIR O PORTÃO" onPress={() => handleAction('aberto')} loading={loadingAction === 'gate'} />
          <AppButton
            label="Fechar"
            variant="danger"
            onPress={() => handleAction('fechado')}
            loading={loadingAction === 'gate'}
          />
        </View>
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Registrar visitante esperado</Text>

        <AppInput
          label="Nome do visitante"
          value={visitorName}
          onChangeText={setVisitorName}
          placeholder="Ex: João da Transportadora"
        />

        <Pressable style={styles.photoButton} onPress={pickVisitorPhoto}>
          <MaterialIcons name="add-a-photo" size={18} color={palette.greenDark} />
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
        <Text style={styles.cardTitle}>Visitantes aguardando/liberação</Text>

        {pendingVisitors.length ? (
          pendingVisitors.map((visitor) => (
            <View key={visitor.id} style={styles.visitorRow}>
              <View style={styles.visitorHeader}>
                {visitor.fotoUrl ? (
                  <Image source={{ uri: visitor.fotoUrl }} style={styles.visitorAvatar} />
                ) : (
                  <View style={styles.visitorAvatarPlaceholder}>
                    <MaterialIcons name="person" size={22} color={palette.gray500} />
                  </View>
                )}

                <View style={styles.visitorInfo}>
                  <Text style={styles.visitorName}>{visitor.nome}</Text>
                  <Text style={styles.visitorMeta}>Status: {visitor.status}</Text>
                </View>
              </View>

              <View style={styles.inlineButtons}>
                <AppButton
                  label="Liberar"
                  variant="secondary"
                  onPress={async () => {
                    try {
                      setLoadingAction(`visitor:${visitor.id}`);
                      await withTimeout(updateVisitorStatus(visitor.id, 'Liberado'));
                      await handleAction('aberto');
                      await withTimeout(loadVisitors());
                    } catch {
                      Alert.alert('Erro', 'Não foi possível liberar o visitante.');
                    } finally {
                      setLoadingAction(null);
                    }
                  }}
                  loading={loadingAction === `visitor:${visitor.id}`}
                />
                <AppButton
                  label="Negar"
                  variant="ghost"
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
          ))
        ) : (
          <EmptyState title="Nenhum visitante pendente" subtitle="Quando houver solicitações elas aparecerão aqui." />
        )}
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Histórico de acessos</Text>
        {accessLogs.length ? (
          accessLogs.map((item) => (
            <View key={String(item.id)} style={styles.logRow}>
              <Text style={styles.logText}>
                {item.status === 'aberto' ? 'Portão aberto' : 'Portão fechado'} por {String(item.userName ?? '-')}
              </Text>
              <Text style={styles.logDate}>{formatDateBR(String(item.createdAt), 'dd/MM HH:mm')}</Text>
            </View>
          ))
        ) : (
          <EmptyState title="Sem registros" subtitle="O histórico de acessos aparecerá aqui." />
        )}
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.gray900,
  },
  gateIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: palette.gray100,
    borderRadius: radii.lg,
    paddingVertical: spacing.lg,
  },
  actionsRow: {
    gap: spacing.sm,
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  photoButtonText: {
    color: palette.greenDark,
    fontWeight: '700',
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: radii.md,
  },
  visitorRow: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  visitorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  visitorAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  visitorAvatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.gray100,
  },
  visitorInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  visitorName: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.gray900,
  },
  visitorMeta: {
    color: palette.gray700,
    fontSize: 13,
  },
  inlineButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logRow: {
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
  },
  logText: {
    color: palette.gray900,
    fontSize: 14,
  },
  logDate: {
    color: palette.gray700,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
