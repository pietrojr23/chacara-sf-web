import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ResizeMode, Video } from 'expo-av';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppCheckbox } from '../../components/AppCheckbox';
import { AppInput } from '../../components/AppInput';
import { AppSelect } from '../../components/AppSelect';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { getAllHouses, getCameraConfigs, saveCameraConfigs } from '../../services/firestoreService';
import { CameraConfig, House } from '../../types/models';

const sortByName = (items: CameraConfig[]) =>
  [...items].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

const isRtspUrl = (value: string) => /^rtsp:\/\//i.test(value.trim());
const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

const normalizeStreamUrl = (rawUrl: string) => {
  const value = rawUrl.trim();
  if (!value) {
    return '';
  }

  if (isHttpUrl(value) || isRtspUrl(value)) {
    return value;
  }

  // Accept values like 192.168.0.20:8888/cam/index.m3u8 and normalize to HTTP.
  if (/^[\w.-]+(?::\d+)?\/.+$/.test(value)) {
    return `http://${value}`;
  }

  return value;
};

const toBase64 = (value: string) => {
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(value);
  }

  const bufferRef = (globalThis as unknown as { Buffer?: { from: (v: string, e: string) => { toString: (e: string) => string } } }).Buffer;
  if (bufferRef?.from) {
    return bufferRef.from(value, 'utf-8').toString('base64');
  }

  return '';
};

const extractCredentials = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl.trim());
    return {
      username: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
    };
  } catch {
    return { username: '', password: '' };
  }
};

const applyCredentialsToUrl = (rawUrl: string, username: string, password: string) => {
  if (!username && !password) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl.trim());
    if (!parsed.username && !parsed.password) {
      parsed.username = username;
      parsed.password = password;
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};

const buildPlaybackSource = (playbackUrl: string) => {
  const normalized = normalizeStreamUrl(playbackUrl);
  if (!normalized) {
    return { uri: '' };
  }

  const playbackCredentials = extractCredentials(normalized);
  const username = playbackCredentials.username;
  const password = playbackCredentials.password;
  const urlWithCredentials = applyCredentialsToUrl(normalized, username, password);
  const basicToken = username || password ? toBase64(`${username}:${password}`) : '';

  return {
    // Android/ExoPlayer can require credentials for both playlist and segment requests.
    uri: urlWithCredentials,
    ...(basicToken ? { headers: { Authorization: `Basic ${basicToken}` } } : {}),
  };
};

const hasPrivateHost = (rawUrl: string) => {
  try {
    const host = new URL(rawUrl).hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return true;
    }
    if (/^10\./.test(host) || /^192\.168\./.test(host)) {
      return true;
    }
    return /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
  } catch {
    return false;
  }
};

const withCacheBust = (rawUrl: string, token: number) => {
  if (!rawUrl || token <= 0) {
    return rawUrl;
  }

  const nonce = `${Date.now()}-${token}`;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('_ts', nonce);
    return parsed.toString();
  } catch {
    return `${rawUrl}${rawUrl.includes('?') ? '&' : '?'}_ts=${nonce}`;
  }
};

const mapPlaybackError = (detail: string, streamUrl: string) => {
  const lower = detail.toLowerCase();
  if (lower.includes('-1100') || lower.includes('error code -1100') || lower.includes('not found')) {
    return 'Stream indisponível no momento (HLS não encontrado). Verifique se essa câmera está ativa no MediaMTX.';
  }

  if (
    lower.includes('401')
    || lower.includes('403')
    || lower.includes('authentication')
    || lower.includes('forbidden')
  ) {
    return 'Falha de autenticação no stream. Confira usuário/senha da URL HLS no MediaMTX.';
  }

  if (
    lower.includes('unknownhost')
    || lower.includes('connectexception')
    || lower.includes('failed to connect')
    || lower.includes('timeout')
    || lower.includes('sockettimeoutexception')
    || lower.includes('network request failed')
  ) {
    return hasPrivateHost(streamUrl)
      ? 'Sem conexão com o servidor da câmera. No Android, conecte no mesmo Wi-Fi do MediaMTX ou use uma URL pública.'
      : 'Sem conexão com o servidor da câmera. Verifique internet e URL HLS.';
  }

  return `Não foi possível reproduzir este stream no player. ${detail ? `Detalhe: ${detail.slice(0, 140)}` : 'Use HLS (.m3u8) do MediaMTX em H264.'
    }`;
};

export const CamerasScreen = () => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraConfig | null>(null);
  const [selectedExternalUrl, setSelectedExternalUrl] = useState('');
  const [playerReloadToken, setPlayerReloadToken] = useState(0);
  const [playerRetryCount, setPlayerRetryCount] = useState(0);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerAndroidImpl, setPlayerAndroidImpl] = useState<'ExoPlayer' | 'MediaPlayer'>('ExoPlayer');
  const videoRef = useRef<Video | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [playbackUrlExternal, setPlaybackUrlExternal] = useState('');
  const [allowedHouses, setAllowedHouses] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoadingData(true);
      const [cameraData, houseData] = await Promise.all([
        getCameraConfigs(),
        getAllHouses().catch(() => [] as House[]),
      ]);
      setCameras(sortByName(cameraData));
      setHouses(houseData);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar câmeras.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return undefined;
    }, [dataVersion, loadData]),
  );

  const handleRefresh = useCallback(() => {
    void loadData();
  }, [loadData]);

  const houseNameMap = useMemo(() => {
    const map = new Map<string, string>();
    houses.forEach((house) => {
      map.set(house.id, house.nome || house.id);
    });
    return map;
  }, [houses]);

  const visibleCameras = useMemo(() => {
    if (isOwner) {
      return cameras;
    }

    const tenantHouseId = profile?.casaId ?? '';
    return cameras.filter((camera) => {
      if (!camera.ativo) {
        return false;
      }

      if (!camera.casasPermitidas?.length) {
        return true;
      }

      return tenantHouseId ? camera.casasPermitidas.includes(tenantHouseId) : false;
    });
  }, [cameras, isOwner, profile?.casaId]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setPlaybackUrlExternal('');
    setAllowedHouses([]);
    setActive(true);
  };

  const handleEditCamera = (camera: CameraConfig) => {
    setEditingId(camera.id);
    setName(camera.nome);
    setPlaybackUrlExternal(camera.playbackUrlExternal ?? camera.playbackUrl ?? '');
    setAllowedHouses(camera.casasPermitidas ?? []);
    setActive(camera.ativo !== false);
  };

  const toggleHousePermission = (houseId: string) => {
    setAllowedHouses((current) => {
      if (current.includes(houseId)) {
        return current.filter((item) => item !== houseId);
      }
      return [...current, houseId];
    });
  };

  const handleSaveCamera = async () => {
    const normalizedName = name.trim();
    const normalizedExternal = normalizeStreamUrl(playbackUrlExternal);

    if (!normalizedName || !isHttpUrl(normalizedExternal)) {
      Alert.alert('Campos obrigatórios', 'Informe nome e URL de reprodução externa (http/https).');
      return;
    }

    const now = new Date().toISOString();
    const existingCamera = cameras.find((item) => item.id === editingId);
    const nextCamera: CameraConfig = {
      id: editingId ?? `camera-${Date.now()}`,
      nome: normalizedName,
      // Mantido só por compatibilidade com schema legado.
      rtspUrl: existingCamera?.rtspUrl || normalizedExternal,
      playbackUrl: undefined,
      playbackUrlExternal: normalizedExternal,
      casasPermitidas: allowedHouses,
      ativo: active,
      criadoEm: existingCamera?.criadoEm ?? now,
      atualizadoEm: now,
    };

    const nextList = editingId
      ? cameras.map((item) => (item.id === editingId ? nextCamera : item))
      : [...cameras, nextCamera];

    try {
      setSaving(true);
      await saveCameraConfigs(nextList);
      setCameras(sortByName(nextList));
      resetForm();
      Alert.alert('Sucesso', editingId ? 'Câmera atualizada com sucesso.' : 'Câmera adicionada com sucesso.');
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar a câmera.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCamera = async (cameraId: string) => {
    const nextList = cameras.filter((item) => item.id !== cameraId);

    try {
      setSaving(true);
      await saveCameraConfigs(nextList);
      setCameras(sortByName(nextList));
      if (editingId === cameraId) {
        resetForm();
      }
      Alert.alert('Removida', 'Câmera removida com sucesso.');
    } catch {
      Alert.alert('Erro', 'Não foi possível remover a câmera.');
    } finally {
      setSaving(false);
    }
  };

  const openCamera = (camera: CameraConfig) => {
    setSelectedCamera(camera);
    setPlayerAndroidImpl('ExoPlayer');
    const externalUrl = normalizeStreamUrl(camera.playbackUrlExternal ?? camera.playbackUrl ?? '');
    setSelectedExternalUrl(externalUrl);
    setPlayerReloadToken(0);
    setPlayerRetryCount(0);
    setPlayerError(null);
    setPlayerLoading(Boolean(externalUrl));

    if (isHttpUrl(externalUrl)) {
      return;
    }

    if (!externalUrl) {
      setPlayerLoading(false);
      setPlayerError('Esta câmera não tem URL de reprodução externa configurada.');
      return;
    }

    setPlayerLoading(false);
    setPlayerError('A URL externa precisa começar com http:// ou https:// e apontar para HLS (.m3u8).');
  };

  const closePlayer = () => {
    setSelectedCamera(null);
    setSelectedExternalUrl('');
    setPlayerReloadToken(0);
    setPlayerRetryCount(0);
    setPlayerLoading(false);
    setPlayerError(null);
    setPlayerAndroidImpl('ExoPlayer');
  };

  const selectedStreamUrl = selectedExternalUrl;

  const selectedStreamSource = useMemo(
    () => buildPlaybackSource(withCacheBust(selectedStreamUrl, playerReloadToken)),
    [playerReloadToken, selectedStreamUrl],
  );

  const canUseNativePlayer = useMemo(() => isHttpUrl(selectedStreamUrl), [selectedStreamUrl]);
  const showNativePlayer = Boolean(selectedCamera && selectedStreamUrl && canUseNativePlayer);
  const showEmptyPlayer = Boolean(selectedCamera && !showNativePlayer);

  return (
    <ScreenContainer refreshing={loadingData} onRefresh={handleRefresh}>

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>{editingId ? 'Editar câmera' : 'Adicionar câmera'}</Text>
          <AppInput
            label="Nome"
            value={name}
            onChangeText={setName}
            placeholder="Ex: Entrada principal"
          />
          <AppInput
            label="URL de reprodução externa"
            value={playbackUrlExternal}
            onChangeText={setPlaybackUrlExternal}
            placeholder="https://seu-dominio/camera/index.m3u8"
          />
          <Text style={styles.helperText}>
            Apenas player externo: use uma URL HTTP/HTTPS HLS (.m3u8).
          </Text>

          <Text style={styles.label}>Casas que podem ver</Text>
          <AppCheckbox
            label="Disponível para todas as casas"
            checked={allowedHouses.length === 0}
            onChange={(checked) => {
              if (checked) {
                setAllowedHouses([]);
              } else if (!houses.length) {
                setAllowedHouses([]);
              } else {
                setAllowedHouses([houses[0].id]);
              }
            }}
          />
          {allowedHouses.length > 0 ? (
            <View style={styles.checkboxList}>
              {houses.map((house) => (
                <AppCheckbox
                  key={house.id}
                  label={house.nome || house.id}
                  checked={allowedHouses.includes(house.id)}
                  onChange={() => toggleHousePermission(house.id)}
                />
              ))}
            </View>
          ) : null}

          <AppSelect
            label="Status da câmera"
            value={active ? 'ativa' : 'inativa'}
            onChange={(value) => setActive(value === 'ativa')}
            options={[
              { label: 'Ativa', value: 'ativa' },
              { label: 'Inativa', value: 'inativa' },
            ]}
          />

          <AppButton label={editingId ? 'Salvar câmera' : 'Adicionar câmera'} onPress={handleSaveCamera} loading={saving} />
          {editingId ? <AppButton label="Cancelar edição" variant="ghost" onPress={resetForm} /> : null}
        </AppCard>
      ) : null}

      <AppCard>
        <View style={styles.inlineSpace}>
          <Text style={styles.cardTitle}>Lista de câmeras</Text>
          <View style={styles.inlineActions}>
            <StatusBadge text={`${visibleCameras.length}`} tone="info" />
          </View>
        </View>

        {loadingData ? (
          <Text style={styles.infoText}>Carregando câmeras...</Text>
        ) : visibleCameras.length ? (
          visibleCameras.map((camera) => (
            <View key={camera.id} style={styles.cameraRow}>
              <View style={styles.cameraHeader}>
                <Text style={styles.cameraName}>{camera.nome}</Text>
                <StatusBadge text={camera.ativo ? 'Ativa' : 'Inativa'} tone={camera.ativo ? 'success' : 'neutral'} />
              </View>
              {isOwner ? (
                <>
                  {camera.playbackUrlExternal || camera.playbackUrl ? (
                    <Text style={styles.urlText} numberOfLines={2}>
                      Player externo: {camera.playbackUrlExternal ?? camera.playbackUrl}
                    </Text>
                  ) : null}

                  {camera.casasPermitidas?.length ? (
                    <Text style={styles.infoText}>
                      Casas: {camera.casasPermitidas.map((houseId) => houseNameMap.get(houseId) ?? houseId).join(', ')}
                    </Text>
                  ) : (
                    <Text style={styles.infoText}>Disponível para todas as casas</Text>
                  )}
                </>
              ) : null}
              <View style={styles.actionsRow}>
                <AppButton label="Abrir video" variant="secondary" onPress={() => openCamera(camera)} />
                {isOwner ? (
                  <>
                    <AppButton label="Editar" variant="ghost" onPress={() => handleEditCamera(camera)} />
                    <AppButton
                      label="Remover"
                      variant="danger"
                      onPress={() => handleDeleteCamera(camera.id)}
                      loading={saving}
                    />
                  </>
                ) : null}
              </View>
            </View>
          ))
        ) : (
          <EmptyState
            title="Sem câmeras disponíveis"
            subtitle={isOwner ? 'Cadastre sua primeira câmera com URL externa.' : 'Nenhuma câmera liberada para sua casa.'}
          />
        )}
      </AppCard>
      <Modal visible={Boolean(selectedCamera)} transparent animationType="slide" onRequestClose={closePlayer}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                <Text style={styles.modalEyebrow}>MONITORAMENTO AO VIVO</Text>
                <Text style={styles.modalTitle}>{selectedCamera?.nome ?? 'Stream'}</Text>
              </View>
              <Pressable onPress={closePlayer} style={[styles.modalCloseButton, styles.modalCloseButtonDark]}>
                <Text style={styles.modalCloseTextDark}>Fechar</Text>
              </Pressable>
            </View>

            <View style={styles.streamMetaRow}>
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>AO VIVO</Text>
              </View>
            </View>

            <View style={styles.videoShell}>
              {showNativePlayer ? (
                <Video
                  key={`${selectedCamera?.id ?? 'camera'}-${selectedStreamUrl}-${playerAndroidImpl}-${playerReloadToken}`}
                  ref={(ref) => {
                    videoRef.current = ref;
                  }}
                  source={selectedStreamSource}
                  style={styles.video}
                  useNativeControls
                  shouldPlay
                  {...(Platform.OS === 'android' ? { androidImplementation: playerAndroidImpl } : {})}
                  resizeMode={ResizeMode.CONTAIN}
                  onLoadStart={() => {
                    setPlayerLoading(true);
                    setPlayerError(null);
                  }}
                  onReadyForDisplay={() => {
                    setPlayerLoading(false);
                    setPlayerError(null);
                    setPlayerRetryCount(0);
                    void videoRef.current?.playAsync().catch(() => undefined);
                  }}
                  onError={(error) => {
                    console.warn('[Cameras] erro ao reproduzir stream externo:', error);
                    const rawError = error as unknown;
                    const detail =
                      typeof rawError === 'string'
                        ? rawError
                        : rawError && typeof rawError === 'object' && 'message' in rawError
                          ? String((rawError as { message?: unknown }).message ?? '')
                          : String(rawError ?? '');
                    const lower = detail.toLowerCase();
                    const isNotFound1100 = lower.includes('-1100') || lower.includes('error code -1100') || lower.includes('not found');

                    if (isNotFound1100 && playerRetryCount < 2) {
                      setPlayerRetryCount((current) => current + 1);
                      setPlayerReloadToken((current) => current + 1);
                      setPlayerLoading(true);
                      setPlayerError('Reconectando stream...');
                      return;
                    }

                    if (Platform.OS === 'android' && playerAndroidImpl === 'ExoPlayer') {
                      setPlayerAndroidImpl('MediaPlayer');
                      setPlayerRetryCount(0);
                      setPlayerReloadToken(0);
                      setPlayerLoading(true);
                      setPlayerError('Tentando modo de compatibilidade...');
                      return;
                    }

                    setPlayerLoading(false);
                    setPlayerError(mapPlaybackError(detail, selectedStreamUrl));
                  }}
                />
              ) : null}

              {showEmptyPlayer ? (
                <View style={styles.videoPlaceholder}>
                  <Text style={styles.playerStatusText}>
                    Configure uma URL de reprodução (.m3u8) desta câmera para visualizar aqui.
                  </Text>
                </View>
              ) : null}
            </View>

            {playerLoading ? (
              <View style={styles.playerStatusRow}>
                <ActivityIndicator size="small" color="#00D1B2" />
                <Text style={styles.playerStatusText}>Conectando ao stream...</Text>
              </View>
            ) : null}

            {playerError ? <Text style={styles.playerErrorText}>{playerError}</Text> : null}

          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 17,
    color: palette.gray900,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  label: {
    color: palette.gray700,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  helperText: {
    color: palette.gray700,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  checkboxList: {
    gap: spacing.xs,
  },
  inlineSpace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  inlineActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  cameraRow: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cameraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cameraName: {
    color: palette.gray900,
    fontWeight: '800',
    fontSize: 16,
    flex: 1,
  },
  urlText: {
    color: palette.gray700,
    fontSize: 13,
  },
  infoText: {
    color: palette.gray700,
    fontSize: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(3,10,14,0.86)',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: '#0B151B',
    borderRadius: 22,
    padding: spacing.md,
    gap: spacing.sm,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#1A3A46',
    shadowColor: '#00D1B2',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modalTitleWrap: {
    flex: 1,
    gap: 2,
  },
  modalEyebrow: {
    color: '#58D8C8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  modalTitle: {
    color: '#E7FAF7',
    fontSize: 19,
    fontWeight: '800',
  },
  modalCloseButton: {
    paddingHorizontal: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  modalCloseButtonDark: {
    borderColor: '#2C5560',
    backgroundColor: '#0F252D',
  },
  modalCloseTextDark: {
    color: '#BEECE6',
    fontWeight: '700',
    fontSize: 13,
  },
  streamMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  liveBadge: {
    borderWidth: 1,
    borderColor: '#1DBE95',
    backgroundColor: 'rgba(29,190,149,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  liveBadgeText: {
    color: '#8CFFD8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  streamMetaText: {
    color: '#8FB8C3',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  videoShell: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#1C4250',
    backgroundColor: '#03080B',
    padding: 4,
    shadowColor: '#00A4C8',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  video: {
    width: '100%',
    height: 250,
    borderRadius: radii.md,
    backgroundColor: '#000',
  },
  videoPlaceholder: {
    width: '100%',
    height: 250,
    borderRadius: radii.md,
    backgroundColor: '#081218',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#223E49',
  },
  playerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playerStatusText: {
    color: '#B7D7DE',
    fontSize: 13,
  },
  playerErrorText: {
    color: '#FF7A8A',
    fontSize: 13,
    fontWeight: '700',
  },
});
