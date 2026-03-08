import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
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
import { getAllHouses, getNotices, markNoticeRead, publishNotice } from '../../services/firestoreService';
import { uploadImageAsync } from '../../services/storageService';
import { cacheKeys, getCache, saveCache } from '../../services/cacheService';
import { Notice } from '../../types/models';
import { formatDateBR } from '../../utils/format';
import { getFileExtension, getFileNameFromPath, inferFileKind } from '../../utils/file';

export const NoticesScreen = () => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [notices, setNotices] = useState<Notice[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [targetHouse, setTargetHouse] = useState<string | null>(null);
  const [houses, setHouses] = useState<Array<{ id: string; nome: string }>>([]);
  const [pinned, setPinned] = useState(false);
  const [attachment, setAttachment] = useState<{ uri: string; name: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [readingNoticeId, setReadingNoticeId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const loadNotices = useCallback(async () => {
    if (!profile) {
      return;
    }

    try {
      const data = await getNotices({ isOwner, houseId: profile.casaId });
      setNotices(data);
      await saveCache(cacheKeys.notices, data);
    } catch {
      const cached = await getCache<Notice[]>(cacheKeys.notices);
      if (cached) {
        setNotices(cached);
      } else {
        Alert.alert('Erro', 'Não foi possível carregar os avisos.');
      }
    }
  }, [isOwner, profile]);

  const loadData = useCallback(async () => {
    if (!profile) {
      return;
    }

    await loadNotices();

    if (isOwner) {
      try {
        const result = await getAllHouses();
        setHouses(result.map((house) => ({ id: house.id, nome: house.nome || house.id })));
      } catch {
        setHouses([]);
      }
    } else {
      setHouses([]);
    }
  }, [isOwner, loadNotices, profile]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return undefined;
    }, [dataVersion, loadData]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadData().finally(() => {
      setRefreshing(false);
    });
  }, [loadData]);

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
    if (result.canceled) {
      return;
    }

    setAttachment({
      uri: result.assets[0].uri,
      name: result.assets[0].name || `arquivo-${Date.now()}`,
    });
  };

  const handlePublish = async () => {
    if (!profile) {
      return;
    }

    if (!title.trim() || !text.trim()) {
      Alert.alert('Campos obrigatórios', 'Informe título e conteúdo do aviso.');
      return;
    }

    try {
      setPublishing(true);

      let imageUrl: string | undefined;
      if (attachment) {
        const ext = getFileExtension(attachment.name) || getFileExtension(attachment.uri) || 'bin';
        imageUrl = await withTimeout(uploadImageAsync(attachment.uri, `avisos/${profile.id}/${Date.now()}.${ext}`));
      }

      await withTimeout(
        publishNotice({
          titulo: title.trim(),
          texto: text.trim(),
          imagemUrl: imageUrl,
          pinned,
          alvoCasaId: targetHouse,
          autorId: profile.id,
          autorNome: profile.nome,
        }),
      );

      setTitle('');
      setText('');
      setPinned(false);
      setAttachment(null);
      setTargetHouse(null);
      await withTimeout(loadNotices());
      Alert.alert('Publicado', 'Aviso publicado e notificação enviada aos moradores.');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A publicação demorou demais para responder. Tente novamente.'
          : 'Não foi possível publicar o aviso.',
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleRead = async (notice: Notice) => {
    if (!profile) {
      return;
    }

    if (notice.leitores?.includes(profile.id)) {
      return;
    }

    try {
      setReadingNoticeId(notice.id);
      await withTimeout(markNoticeRead(notice.id, profile.id));
      await withTimeout(loadNotices());
    } catch {
      Alert.alert('Erro', 'Não foi possível atualizar leitura do aviso.');
    } finally {
      setReadingNoticeId(null);
    }
  };

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <SectionHeader title="Mural de avisos" subtitle="Comunicação oficial da propriedade" />

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Publicar novo aviso</Text>

          <AppInput label="Título" value={title} onChangeText={setTitle} placeholder="Ex: Manutenção da piscina" />
          <AppInput
            label="Texto"
            value={text}
            onChangeText={setText}
            placeholder="Detalhes do aviso"
            multiline
          />

          <View style={styles.rowWrap}>
            <Pressable
              style={[styles.toggle, pinned && styles.toggleActive]}
              onPress={() => setPinned((state) => !state)}
            >
              <Text style={[styles.toggleText, pinned && styles.toggleTextActive]}>Fixar no topo</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Destino</Text>
          <View style={styles.rowWrap}>
            <Pressable
              style={[styles.chip, targetHouse === null && styles.chipActive]}
              onPress={() => setTargetHouse(null)}
            >
              <Text style={[styles.chipText, targetHouse === null && styles.chipTextActive]}>Todos</Text>
            </Pressable>
            {houses.map((house) => (
              <Pressable
                key={house.id}
                style={[styles.chip, targetHouse === house.id && styles.chipActive]}
                onPress={() => setTargetHouse(house.id)}
              >
                <Text style={[styles.chipText, targetHouse === house.id && styles.chipTextActive]}>{house.nome}</Text>
              </Pressable>
            ))}
          </View>

          <AppButton label="Anexar arquivo" variant="ghost" onPress={handlePickFile} />
          {attachment ? (
            inferFileKind(attachment.name || attachment.uri) === 'image' ? (
              <Image source={{ uri: attachment.uri }} style={styles.noticeImage} />
            ) : (
              <Pressable style={styles.fileRow} onPress={() => Linking.openURL(attachment.uri)}>
                <Text style={styles.fileRowText}>{getFileNameFromPath(attachment.name, 'Arquivo anexado')}</Text>
              </Pressable>
            )
          ) : null}

          <AppButton label="Publicar aviso" onPress={handlePublish} loading={publishing} />
        </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.cardTitle}>Avisos recentes</Text>

        {notices.length ? (
          notices.map((notice) => {
            const wasRead = notice.leitores?.includes(profile?.id ?? '');

            return (
              <Pressable key={notice.id} style={styles.noticeItem} onPress={() => handleRead(notice)}>
                <View style={styles.noticeHeader}>
                  <Text style={styles.noticeTitle}>{notice.titulo}</Text>
                  <View style={styles.badges}>
                    {notice.pinned ? <StatusBadge text="Fixado" tone="info" /> : null}
                    <StatusBadge
                      text={readingNoticeId === notice.id ? 'Atualizando' : wasRead ? 'Lido' : 'Não lido'}
                      tone={wasRead ? 'success' : 'warning'}
                    />
                  </View>
                </View>
                <Text style={styles.noticeText}>{notice.texto}</Text>
                {notice.imagemUrl ? (
                  inferFileKind(notice.imagemUrl) === 'image' ? (
                    <Pressable onPress={() => Linking.openURL(notice.imagemUrl as string)}>
                      <Image source={{ uri: notice.imagemUrl }} style={styles.noticeImage} />
                    </Pressable>
                  ) : (
                    <Pressable style={styles.fileRow} onPress={() => Linking.openURL(notice.imagemUrl as string)}>
                      <Text style={styles.fileRowText}>{getFileNameFromPath(notice.imagemUrl, 'Abrir anexo')}</Text>
                    </Pressable>
                  )
                ) : null}
                <Text style={styles.meta}>Publicado em {formatDateBR(notice.criadoEm, 'dd/MM HH:mm')}</Text>
              </Pressable>
            );
          })
        ) : (
          <EmptyState title="Sem avisos" subtitle="O proprietário ainda não publicou nenhum aviso." />
        )}
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  cardTitle: {
    color: palette.gray900,
    fontSize: 16,
    fontWeight: '800',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  toggle: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleActive: {
    backgroundColor: palette.greenDark,
    borderColor: palette.greenDark,
  },
  toggleText: {
    color: palette.gray900,
    fontWeight: '700',
  },
  toggleTextActive: {
    color: palette.white,
  },
  label: {
    fontSize: 13,
    color: palette.gray700,
    fontWeight: '700',
  },
  chip: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipActive: {
    borderColor: palette.greenDark,
    backgroundColor: palette.greenDark,
  },
  chipText: {
    color: palette.gray900,
    fontWeight: '700',
  },
  chipTextActive: {
    color: palette.white,
  },
  noticeItem: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noticeHeader: {
    gap: spacing.sm,
  },
  badges: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  noticeTitle: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '800',
  },
  noticeText: {
    color: palette.gray700,
    fontSize: 14,
  },
  noticeImage: {
    width: '100%',
    height: 180,
    borderRadius: radii.md,
  },
  fileRow: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  fileRowText: {
    color: palette.gray700,
    fontWeight: '700',
    fontSize: 12,
  },
  meta: {
    color: palette.gray500,
    fontSize: 12,
  },
});
