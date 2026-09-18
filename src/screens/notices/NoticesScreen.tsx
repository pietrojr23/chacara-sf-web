import { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialIcons } from '@expo/vector-icons';
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

  const handleTenantViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ item?: Notice; isViewable?: boolean }> }) => {
      if (isOwner || !profile) {
        return;
      }

      viewableItems.forEach((viewable) => {
        if (viewable.isViewable && viewable.item) {
          void handleRead(viewable.item);
        }
      });
    },
    [handleRead, isOwner, profile],
  );

  const tenantViewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 60 });

  const renderNoticeItem = ({ item }: { item: Notice }) => {
    const wasRead = Boolean(item.leitores?.includes(profile?.id ?? ''));
    const audience = item.alvoCasaId ? `Casa ${item.alvoCasaId}` : 'Todos os moradores';

    return (
      <AppCard>
        <Pressable style={styles.noticeItem} onPress={() => handleRead(item)}>
          <View style={styles.noticeHeader}>
            <View style={styles.noticeTitleRow}>
              {!wasRead ? <View style={styles.unreadDot} /> : null}
              <Text style={styles.noticeTitle}>{item.titulo}</Text>
            </View>
            <View style={styles.badges}>
              {item.pinned ? <StatusBadge text="Fixado" tone="info" /> : null}
              <StatusBadge
                text={readingNoticeId === item.id ? 'Atualizando' : wasRead ? 'Lido' : 'Não lido'}
                tone={wasRead ? 'success' : 'warning'}
              />
            </View>
          </View>
          <Text style={styles.noticeText}>{item.texto}</Text>
          {item.imagemUrl ? (
            inferFileKind(item.imagemUrl) === 'image' ? (
              <Pressable onPress={() => Linking.openURL(item.imagemUrl as string)}>
                <Image source={{ uri: item.imagemUrl }} style={styles.noticeImage} />
              </Pressable>
            ) : (
              <Pressable style={styles.fileRow} onPress={() => Linking.openURL(item.imagemUrl as string)}>
                <MaterialIcons name="attach-file" size={18} color={palette.greenDark} />
                <Text style={styles.fileRowText}>{getFileNameFromPath(item.imagemUrl, 'Abrir anexo')}</Text>
              </Pressable>
            )
          ) : null}
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <MaterialIcons name="groups" size={14} color={palette.gray500} />
              <Text style={styles.meta}>{audience}</Text>
            </View>
            <View style={styles.metaItem}>
              <MaterialIcons name="schedule" size={14} color={palette.gray500} />
              <Text style={styles.meta}>{formatDateBR(item.criadoEm, 'dd/MM HH:mm')}</Text>
            </View>
          </View>
        </Pressable>
      </AppCard>
    );
  };

  const tenantListHeader = (
    <AppCard>
      <View style={styles.sectionHeader}>
        <Text style={styles.cardTitle}>Avisos recentes</Text>
        <Text style={styles.noticeCount}>{notices.length}</Text>
      </View>
    </AppCard>
  );

  return (
    <ScreenContainer scroll={isOwner} refreshing={isOwner ? refreshing : false} onRefresh={isOwner ? handleRefresh : undefined}>
      <View style={styles.root}>
        {isOwner ? (
          <AppCard>
            <View style={styles.sectionHeader}>
              <Text style={styles.cardTitle}>Publicar novo aviso</Text>
              <View style={styles.sectionHeaderPill}>
                <MaterialIcons name="campaign" size={16} color={palette.greenDark} />
                <Text style={styles.sectionHeaderPillText}>Comunicado</Text>
              </View>
            </View>

            <AppInput label="Título" value={title} onChangeText={setTitle} placeholder="Ex: Manutenção da piscina" />
            <AppInput
              label="Texto"
              value={text}
              onChangeText={setText}
              placeholder="Detalhes do aviso"
              multiline
            />

            <AppCheckbox label="Fixar no topo" checked={pinned} onChange={setPinned} />

            <AppSelect
              label="Destino"
              value={targetHouse ?? '__all__'}
              onChange={(value) => setTargetHouse(value === '__all__' ? null : value)}
              options={[
                { label: 'Todos', value: '__all__' },
                ...houses.map((house) => ({ label: house.nome, value: house.id })),
              ]}
            />

            <AppButton label="Anexar arquivo" variant="ghost" onPress={handlePickFile} />
            {attachment ? (
              inferFileKind(attachment.name || attachment.uri) === 'image' ? (
                <Image source={{ uri: attachment.uri }} style={styles.noticeImage} />
              ) : (
                <Pressable style={styles.fileRow} onPress={() => Linking.openURL(attachment.uri)}>
                  <MaterialIcons name="attach-file" size={18} color={palette.greenDark} />
                  <Text style={styles.fileRowText}>{getFileNameFromPath(attachment.name, 'Arquivo anexado')}</Text>
                </Pressable>
              )
            ) : null}

            <AppButton label="Publicar aviso" onPress={handlePublish} loading={publishing} />
          </AppCard>
        ) : null}

        {isOwner ? (
          <AppCard>
            <View style={styles.sectionHeader}>
              <Text style={styles.cardTitle}>Avisos recentes</Text>
              <Text style={styles.noticeCount}>{notices.length}</Text>
            </View>

            {notices.length ? (
              notices.map((notice) => {
                const wasRead = notice.leitores?.includes(profile?.id ?? '');
                const audience = notice.alvoCasaId ? `Casa ${notice.alvoCasaId}` : 'Todos os moradores';

                return (
                  <Pressable key={notice.id} style={styles.noticeItem} onPress={() => handleRead(notice)}>
                    <View style={styles.noticeHeader}>
                      <View style={styles.noticeTitleRow}>
                        {!wasRead ? <View style={styles.unreadDot} /> : null}
                        <Text style={styles.noticeTitle}>{notice.titulo}</Text>
                      </View>
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
                          <MaterialIcons name="attach-file" size={18} color={palette.greenDark} />
                          <Text style={styles.fileRowText}>{getFileNameFromPath(notice.imagemUrl, 'Abrir anexo')}</Text>
                        </Pressable>
                      )
                    ) : null}
                    <View style={styles.metaRow}>
                      <View style={styles.metaItem}>
                        <MaterialIcons name="groups" size={14} color={palette.gray500} />
                        <Text style={styles.meta}>{audience}</Text>
                      </View>
                      <View style={styles.metaItem}>
                        <MaterialIcons name="schedule" size={14} color={palette.gray500} />
                        <Text style={styles.meta}>{formatDateBR(notice.criadoEm, 'dd/MM HH:mm')}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <EmptyState title="Sem avisos" subtitle="O proprietário ainda não publicou nenhum aviso." />
            )}
          </AppCard>
        ) : notices.length ? (
          <FlatList
            data={notices}
            keyExtractor={(item) => item.id}
            renderItem={renderNoticeItem}
            ListHeaderComponent={tenantListHeader}
            contentContainerStyle={styles.tenantListContent}
            showsVerticalScrollIndicator={false}
            onViewableItemsChanged={handleTenantViewableItemsChanged}
            viewabilityConfig={tenantViewabilityConfigRef.current}
            onRefresh={handleRefresh}
            refreshing={refreshing}
          />
        ) : (
          <AppCard>
            <EmptyState title="Sem avisos" subtitle="O proprietário ainda não publicou nenhum aviso." />
          </AppCard>
        )}
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionHeaderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 28,
  },
  sectionHeaderPillText: {
    color: palette.greenDark,
    fontWeight: '700',
    fontSize: 12,
  },
  noticeCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    textAlign: 'center',
    textAlignVertical: 'center',
    overflow: 'hidden',
    color: palette.greenDark,
    backgroundColor: '#ECF3E7',
    fontWeight: '800',
    fontSize: 13,
    paddingTop: 6,
  },
  cardTitle: {
    color: palette.gray900,
    fontSize: 17,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  root: {
    flex: 1,
    gap: spacing.lg,
  },
  tenantListContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
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
  noticeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.warning,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  noticeTitle: {
    color: palette.gray900,
    fontSize: 16,
    fontWeight: '800',
  },
  noticeText: {
    color: palette.gray700,
    fontSize: 15,
    lineHeight: 22,
  },
  noticeImage: {
    width: '100%',
    height: 180,
    borderRadius: radii.md,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  fileRowText: {
    color: palette.gray700,
    fontWeight: '700',
    fontSize: 14,
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  meta: {
    color: palette.gray500,
    fontSize: 13,
  },
});
