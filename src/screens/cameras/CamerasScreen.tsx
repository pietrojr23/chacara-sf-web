import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ResizeMode, Video } from 'expo-av';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppInput } from '../../components/AppInput';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { getAllHouses, getCameraConfigs, saveCameraConfigs } from '../../services/firestoreService';
import { CameraConfig, House } from '../../types/models';

const sortByName = (items: CameraConfig[]) =>
  [...items].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

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
  const normalized = playbackUrl.trim();
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

const mapPlaybackError = (detail: string, streamUrl: string) => {
  const lower = detail.toLowerCase();
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
  ) {
    return hasPrivateHost(streamUrl)
      ? 'Sem conexão com o servidor da câmera. No Android, conecte no mesmo Wi-Fi do MediaMTX ou use uma URL pública.'
      : 'Sem conexão com o servidor da câmera. Verifique internet e URL HLS.';
  }

  return `Não foi possível reproduzir este stream no player interno. ${detail ? `Detalhe: ${detail.slice(0, 140)}` : 'Use HLS (.m3u8) do MediaMTX em H264.'
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
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerAndroidImpl, setPlayerAndroidImpl] = useState<'ExoPlayer' | 'MediaPlayer'>('MediaPlayer');
  const videoRef = useRef<Video | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState('');
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
    setRtspUrl('');
    setPlaybackUrl('');
    setAllowedHouses([]);
    setActive(true);
  };

  const handleEditCamera = (camera: CameraConfig) => {
    setEditingId(camera.id);
    setName(camera.nome);
    setRtspUrl(camera.rtspUrl);
    setPlaybackUrl(camera.playbackUrl ?? '');
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
    const normalizedRtsp = rtspUrl.trim();
    const normalizedPlayback = playbackUrl.trim();

    if (!normalizedName || !normalizedRtsp) {
      Alert.alert('Campos obrigatórios', 'Informe nome e URL RTSP da câmera.');
      return;
    }

    const now = new Date().toISOString();
    const nextCamera: CameraConfig = {
      id: editingId ?? `camera-${Date.now()}`,
      nome: normalizedName,
      rtspUrl: normalizedRtsp,
      playbackUrl: normalizedPlayback || undefined,
      casasPermitidas: allowedHouses,
      ativo: active,
      criadoEm: cameras.find((item) => item.id === editingId)?.criadoEm ?? now,
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
    setPlayerError(null);
    setPlayerLoading(true);
    // MediaPlayer first: better compatibility for some HLS streams on Android devices.
    setPlayerAndroidImpl('MediaPlayer');
    setSelectedCamera(camera);

    const streamUrl = String(camera.playbackUrl ?? '').trim() || camera.rtspUrl;
    const isRtsp = /^rtsp:\/\//i.test(streamUrl);

    if (isRtsp) {
      setPlayerLoading(false);
      setPlayerError(
        'RTSP puro costuma falhar no player interno. Cadastre também a URL de reprodução interna (HLS .m3u8).',
      );
    }
  };

  const closePlayer = () => {
    setSelectedCamera(null);
    setPlayerLoading(false);
    setPlayerError(null);
  };

  const selectedStreamUrl = useMemo(() => {
    if (!selectedCamera) {
      return '';
    }

    return String(selectedCamera.playbackUrl ?? '').trim() || selectedCamera.rtspUrl;
  }, [selectedCamera]);

  const selectedStreamSource = useMemo(
    () => buildPlaybackSource(selectedStreamUrl),
    [selectedStreamUrl],
  );

  return (
    <ScreenContainer refreshing={loadingData} onRefresh={handleRefresh}>
      <SectionHeader
        title="CAMERAS"
        subtitle={isOwner ? 'Cadastro de câmeras e permissão por casa' : 'Câmeras permitidas para sua casa'}
      />

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
            label="URL RTSP"
            value={rtspUrl}
            onChangeText={setRtspUrl}
            placeholder="rtsp://usuario:senha@ip:554/stream"
          />
          <AppInput
            label="URL de reprodução interna (opcional)"
            value={playbackUrl}
            onChangeText={setPlaybackUrl}
            placeholder="https://.../stream.m3u8"
          />
          <Text style={styles.helperText}>
            Dica: informe URL HLS (.m3u8) do MediaMTX para reproduzir no player interno.
          </Text>

          <Text style={styles.label}>Casas que podem ver</Text>
          <View style={styles.wrap}>
            <Pressable
              style={[styles.chip, allowedHouses.length === 0 && styles.chipActive]}
              onPress={() => setAllowedHouses([])}
            >
              <Text style={[styles.chipText, allowedHouses.length === 0 && styles.chipTextActive]}>Todas</Text>
            </Pressable>
            {houses.map((house) => (
              <Pressable
                key={house.id}
                style={[styles.chip, allowedHouses.includes(house.id) && styles.chipActive]}
                onPress={() => toggleHousePermission(house.id)}
              >
                <Text style={[styles.chipText, allowedHouses.includes(house.id) && styles.chipTextActive]}>
                  {house.nome || house.id}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.wrap}>
            <Pressable
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setActive(true)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>Ativa</Text>
            </Pressable>
            <Pressable
              style={[styles.chip, !active && styles.chipActive]}
              onPress={() => setActive(false)}
            >
              <Text style={[styles.chipText, !active && styles.chipTextActive]}>Inativa</Text>
            </Pressable>
          </View>

          <AppButton label={editingId ? 'Salvar câmera' : 'Adicionar câmera'} onPress={handleSaveCamera} loading={saving} />
          {editingId ? <AppButton label="Cancelar edição" variant="ghost" onPress={resetForm} /> : null}
        </AppCard>
      ) : null}

      <AppCard>
        <View style={styles.inlineSpace}>
          <Text style={styles.cardTitle}>Lista de câmeras</Text>
          <StatusBadge text={`${visibleCameras.length}`} tone="info" />
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
                  <Text style={styles.urlText} numberOfLines={2}>
                    {camera.rtspUrl}
                  </Text>
                  {camera.playbackUrl ? (
                    <Text style={styles.urlText} numberOfLines={2}>
                      Player interno: {camera.playbackUrl}
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
                <AppButton label="Abrir stream" variant="secondary" onPress={() => openCamera(camera)} />
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
            subtitle={isOwner ? 'Cadastre sua primeira câmera RTSP.' : 'Nenhuma câmera liberada para sua casa.'}
          />
        )}
      </AppCard>

      <Modal visible={Boolean(selectedCamera)} transparent animationType="slide" onRequestClose={closePlayer}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedCamera?.nome ?? 'Stream'}</Text>
              <Pressable onPress={closePlayer} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseText}>Fechar</Text>
              </Pressable>
            </View>

            {selectedCamera ? (
              <Video
                key={`${selectedCamera.id}-${playerAndroidImpl}`}
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
                  void videoRef.current?.playAsync().catch(() => undefined);
                }}
                onError={(error) => {
                  console.warn('[Cameras] erro ao reproduzir stream:', error);
                  const detail = typeof error === 'string' ? error : JSON.stringify(error);

                  if (Platform.OS === 'android' && playerAndroidImpl === 'MediaPlayer') {
                    setPlayerAndroidImpl('ExoPlayer');
                    setPlayerLoading(true);
                    setPlayerError('Tentando modo de compatibilidade Android...');
                    return;
                  }

                  setPlayerLoading(false);
                  setPlayerError(mapPlaybackError(detail, selectedStreamUrl));
                }}
              />
            ) : null}

            {playerLoading ? (
              <View style={styles.playerStatusRow}>
                <ActivityIndicator size="small" color={palette.greenDark} />
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
    fontSize: 16,
    color: palette.gray900,
    fontWeight: '800',
  },
  label: {
    color: palette.gray700,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  helperText: {
    color: palette.gray700,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: palette.white,
  },
  chipActive: {
    borderColor: palette.greenDark,
    backgroundColor: '#EDF5EA',
  },
  chipText: {
    color: palette.gray700,
    fontWeight: '700',
    fontSize: 12,
  },
  chipTextActive: {
    color: palette.greenDark,
  },
  inlineSpace: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    fontSize: 15,
    flex: 1,
  },
  urlText: {
    color: palette.gray700,
    fontSize: 12,
  },
  infoText: {
    color: palette.gray700,
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: palette.white,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modalTitle: {
    color: palette.gray900,
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  modalCloseButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.gray300,
  },
  modalCloseText: {
    color: palette.gray700,
    fontWeight: '700',
    fontSize: 12,
  },
  video: {
    width: '100%',
    height: 240,
    borderRadius: radii.md,
    backgroundColor: '#000',
  },
  playerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  playerStatusText: {
    color: palette.gray700,
    fontSize: 13,
  },
  playerErrorText: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: '600',
  },
});
