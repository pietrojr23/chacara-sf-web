import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import {
  createPrivateChatThread,
  getOwnerUser,
  getTenantUsers,
  subscribeGeneralMessages,
  subscribePrivateChatThreadsForUser,
  subscribePrivateMessages,
} from '../../services/firestoreService';
import { AppUser, ChatMessage, PrivateChatThread } from '../../types/models';
import { RootStackParamList } from '../../types/navigation';
import { formatDateBR } from '../../utils/format';
import { buildPrivateChatId } from '../../utils/chat';

type ThreadMeta = {
  preview: string;
  timeLabel: string;
  lastSentAt: string;
  unreadCount: number;
};

type PrivateThreadListItem = {
  id: string;
  baseChatId: string;
  title: string;
  status: 'aberto' | 'concluido';
  isDefault: boolean;
  updatedAt?: string;
};

type ParticipantThreadGroups = {
  mainThread: PrivateThreadListItem;
  subjectThreads: PrivateThreadListItem[];
};

const formatNowLabel = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
};

export const ChatScreen = () => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const isOwner = Boolean(profile?.isOwner);
  const [participants, setParticipants] = useState<AppUser[]>([]);
  const [privateThreads, setPrivateThreads] = useState<PrivateChatThread[]>([]);
  const [threadMetaById, setThreadMetaById] = useState<Record<string, ThreadMeta>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [creatingThreadForUserId, setCreatingThreadForUserId] = useState<string | null>(null);
  const [expandedSubjectsByParticipantId, setExpandedSubjectsByParticipantId] = useState<Record<string, boolean>>({});

  const buildMessagePreview = useCallback((message?: ChatMessage) => {
    if (!message) {
      return 'Sem mensagens ainda.';
    }

    const text = String(message.texto ?? '').trim();
    if (text) {
      return text;
    }

    if (!message.imagemUrl) {
      return message.audioUrl ? 'Áudio' : 'Mensagem';
    }

    const lowerUrl = message.imagemUrl.toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic'].some((ext) => lowerUrl.includes(ext));
    return isImage ? 'Imagem' : 'Arquivo';
  }, []);

  const toThreadMeta = useCallback(
    (messages: ChatMessage[]): ThreadMeta => {
      if (!messages.length) {
        return {
          preview: 'Sem mensagens ainda.',
          timeLabel: '',
          lastSentAt: '',
          unreadCount: 0,
        };
      }

      const sorted = [...messages].sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm));
      const last = sorted[sorted.length - 1];
      const unreadCount = profile
        ? sorted.filter((message) => {
            if (message.enviadoPor === profile.id) {
              return false;
            }

            return !(message.lidoPor ?? []).includes(profile.id);
          }).length
        : 0;

      return {
        preview: buildMessagePreview(last),
        timeLabel: last.enviadoEm ? formatDateBR(last.enviadoEm, 'HH:mm') : '',
        lastSentAt: String(last.enviadoEm ?? ''),
        unreadCount,
      };
    },
    [buildMessagePreview, profile],
  );

  const loadParticipants = useCallback(async () => {
    if (!profile) {
      return;
    }

    try {
      setRefreshing(true);
      let nextParticipants: AppUser[] = [];
      if (isOwner) {
        nextParticipants = await getTenantUsers();
      } else {
        const owner = await getOwnerUser();
        nextParticipants = owner ? [owner] : [];
      }

      const dedupedParticipants = Array.from(
        new Map(nextParticipants.map((participant) => [participant.id, participant])).values(),
      );
      setParticipants(dedupedParticipants);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar os contatos do chat.');
    } finally {
      setRefreshing(false);
    }
  }, [isOwner, profile]);

  useFocusEffect(
    useCallback(() => {
      void loadParticipants();
      return undefined;
    }, [dataVersion, loadParticipants]),
  );

  const handleRefresh = useCallback(() => {
    void loadParticipants();
  }, [loadParticipants]);

  useEffect(() => {
    if (!profile || !isFocused) {
      return undefined;
    }

    return subscribePrivateChatThreadsForUser(profile.id, setPrivateThreads);
  }, [isFocused, profile]);

  const privateThreadsByBaseChatId = useMemo(() => {
    return privateThreads.reduce<Record<string, PrivateChatThread[]>>((acc, thread) => {
      const key = String(thread.baseChatId ?? '').trim();
      if (!key) {
        return acc;
      }

      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push(thread);
      return acc;
    }, {});
  }, [privateThreads]);

  useEffect(() => {
    if (!profile || !isFocused) {
      return undefined;
    }

    const privateChatIds = new Set<string>();
    participants.forEach((participant) => {
      const baseChatId = buildPrivateChatId(profile.id, participant.id);
      privateChatIds.add(baseChatId);

      const threadList = privateThreadsByBaseChatId[baseChatId] ?? [];
      threadList.forEach((thread) => {
        privateChatIds.add(thread.id);
      });
    });

    const threadEntries: Array<{ key: string; chatId: string; isPrivate: boolean }> = [
      { key: 'geral', chatId: 'geral', isPrivate: false },
      ...Array.from(privateChatIds).map((chatId) => ({ key: chatId, chatId, isPrivate: true })),
    ];

    const allowedKeys = new Set(threadEntries.map((entry) => entry.key));
    setThreadMetaById((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => allowedKeys.has(key)),
      ) as Record<string, ThreadMeta>,
    );

    const unsubscribers = threadEntries.map((entry) => {
      const handleMessages = (messages: ChatMessage[]) => {
        const nextMeta = toThreadMeta(messages);
        setThreadMetaById((current) => {
          const previous = current[entry.key];
          if (
            previous
            && previous.preview === nextMeta.preview
            && previous.timeLabel === nextMeta.timeLabel
            && previous.lastSentAt === nextMeta.lastSentAt
            && previous.unreadCount === nextMeta.unreadCount
          ) {
            return current;
          }

          return {
            ...current,
            [entry.key]: nextMeta,
          };
        });
      };

      return entry.isPrivate
        ? subscribePrivateMessages(entry.chatId, handleMessages)
        : subscribeGeneralMessages(handleMessages);
    });

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }, [isFocused, participants, privateThreadsByBaseChatId, profile, toThreadMeta]);

  const buildPrivateThreadsForParticipant = useCallback(
    (participant: AppUser): ParticipantThreadGroups => {
      if (!profile) {
        return {
          mainThread: {
            id: '',
            baseChatId: '',
            title: 'Conversa principal',
            status: 'aberto',
            isDefault: true,
          },
          subjectThreads: [],
        };
      }

      const baseChatId = buildPrivateChatId(profile.id, participant.id);
      const defaultThread: PrivateThreadListItem = {
        id: baseChatId,
        baseChatId,
        title: 'Conversa principal',
        status: 'aberto',
        isDefault: true,
      };

      const subjectThreads = (privateThreadsByBaseChatId[baseChatId] ?? [])
        .filter((thread) => thread.id !== baseChatId)
        .filter((thread) => (isOwner ? true : thread.status !== 'concluido'))
        .map<PrivateThreadListItem>((thread) => ({
          id: thread.id,
          baseChatId,
          title: thread.title,
          status: thread.status,
          isDefault: false,
          updatedAt: thread.updatedAt,
        }))
        .sort((left, right) => {
          if (isOwner && left.status !== right.status) {
            return left.status === 'aberto' ? -1 : 1;
          }

          const leftMeta = threadMetaById[left.id];
          const rightMeta = threadMetaById[right.id];
          const leftEpoch = Date.parse(String(leftMeta?.lastSentAt ?? left.updatedAt ?? ''));
          const rightEpoch = Date.parse(String(rightMeta?.lastSentAt ?? right.updatedAt ?? ''));
          const safeLeftEpoch = Number.isFinite(leftEpoch) ? leftEpoch : 0;
          const safeRightEpoch = Number.isFinite(rightEpoch) ? rightEpoch : 0;
          if (safeRightEpoch !== safeLeftEpoch) {
            return safeRightEpoch - safeLeftEpoch;
          }
          return right.id.localeCompare(left.id);
        });

      return {
        mainThread: defaultThread,
        subjectThreads,
      };
    },
    [isOwner, privateThreadsByBaseChatId, profile, threadMetaById],
  );

  const toggleSubjectThreads = useCallback((participantId: string) => {
    setExpandedSubjectsByParticipantId((current) => ({
      ...current,
      [participantId]: !current[participantId],
    }));
  }, []);

  const orderedParticipants = useMemo(() => {
    if (!profile || !isOwner) {
      return participants;
    }

    const getThreadEpoch = (thread: PrivateChatThread) => {
      const lastSentAt = threadMetaById[thread.id]?.lastSentAt;
      const epoch = Date.parse(String(lastSentAt ?? thread.updatedAt ?? ''));
      return Number.isFinite(epoch) ? epoch : 0;
    };

    return [...participants].sort((left, right) => {
      const leftBase = buildPrivateChatId(profile.id, left.id);
      const rightBase = buildPrivateChatId(profile.id, right.id);
      const leftThreads = (privateThreadsByBaseChatId[leftBase] ?? []).filter((thread) => thread.id !== leftBase);
      const rightThreads = (privateThreadsByBaseChatId[rightBase] ?? []).filter((thread) => thread.id !== rightBase);

      const leftHasOpen = leftThreads.some((thread) => thread.status !== 'concluido');
      const rightHasOpen = rightThreads.some((thread) => thread.status !== 'concluido');
      if (leftHasOpen !== rightHasOpen) {
        return leftHasOpen ? -1 : 1;
      }

      const leftRelevant = leftHasOpen ? leftThreads.filter((thread) => thread.status !== 'concluido') : leftThreads;
      const rightRelevant = rightHasOpen ? rightThreads.filter((thread) => thread.status !== 'concluido') : rightThreads;
      const leftLatest = leftRelevant.reduce((max, thread) => Math.max(max, getThreadEpoch(thread)), 0);
      const rightLatest = rightRelevant.reduce((max, thread) => Math.max(max, getThreadEpoch(thread)), 0);
      if (leftLatest !== rightLatest) {
        return rightLatest - leftLatest;
      }

      return left.nome.localeCompare(right.nome, 'pt-BR', { sensitivity: 'base' });
    });
  }, [isOwner, participants, privateThreadsByBaseChatId, profile, threadMetaById]);

  const handleCreateThread = useCallback(
    async (participant: AppUser) => {
      if (!profile || participant.id === profile.id) {
        return;
      }

      const isParticipantOwner = Boolean(participant.isOwner || participant.role === 'owner');
      if (!profile.isOwner && !isParticipantOwner) {
        return;
      }

      try {
        setCreatingThreadForUserId(participant.id);
        const ownerId = profile.isOwner ? profile.id : participant.id;
        const tenantId = profile.isOwner ? participant.id : profile.id;

        const created = await createPrivateChatThread({
          ownerId,
          tenantId,
          title: `Assunto ${formatNowLabel()}`,
          createdById: profile.id,
          createdByName: profile.nome,
        });

        navigation.navigate('ChatRoom', {
          chatId: created.id,
          title: created.title,
          isPrivate: true,
        });
      } catch {
        Alert.alert('Erro', 'Não foi possível criar o novo chat para este inquilino.');
      } finally {
        setCreatingThreadForUserId(null);
      }
    },
    [navigation, profile],
  );

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <AppCard>
        <Text style={styles.cardTitle}>Conversa geral</Text>
        <Pressable
          style={styles.thread}
          onPress={() => navigation.navigate('ChatRoom', { chatId: 'geral', title: 'Grupo da Chácara' })}
        >
          <View style={styles.threadIcon}>
            <MaterialIcons name="groups" size={22} color={palette.greenDark} />
          </View>
          <View style={styles.threadContent}>
            <Text style={styles.threadTitle}>Todos os moradores</Text>
            <Text numberOfLines={1} style={styles.threadSubtitle}>
              {threadMetaById.geral?.preview ?? 'Troque mensagens, imagens e atualizações rápidas.'}
            </Text>
          </View>
          <View style={styles.threadMeta}>
            <Text style={styles.threadTime}>{threadMetaById.geral?.timeLabel ?? ''}</Text>
            {Number(threadMetaById.geral?.unreadCount ?? 0) > 0 ? (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {(threadMetaById.geral?.unreadCount ?? 0) > 9 ? '9+' : String(threadMetaById.geral?.unreadCount ?? 0)}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>{isOwner ? 'Conversas privadas' : 'Minhas conversas privadas'}</Text>

        {orderedParticipants.length ? (
          orderedParticipants.map((participant) => {
            const { mainThread, subjectThreads } = buildPrivateThreadsForParticipant(participant);
            const subjectsExpanded = Boolean(expandedSubjectsByParticipantId[participant.id]);
            const subjectUnreadCount = subjectThreads.reduce(
              (acc, thread) => acc + Number(threadMetaById[thread.id]?.unreadCount ?? 0),
              0,
            );
            const canCreateThread = Boolean(
              profile
              && participant.id !== profile.id
              && (isOwner || participant.isOwner || participant.role === 'owner'),
            );

            const renderThreadRow = (thread: PrivateThreadListItem) => {
              const threadMeta = threadMetaById[thread.id];
              return (
                <Pressable
                  key={thread.id}
                  style={[styles.threadRow, !thread.isDefault ? styles.threadRowSubject : null]}
                  onPress={() =>
                    navigation.navigate('ChatRoom', {
                      chatId: thread.id,
                      title: thread.title,
                      isPrivate: true,
                    })
                  }
                >
                  <View style={styles.threadRowMain}>
                    <Text numberOfLines={1} style={styles.threadRowTitle}>{thread.title}</Text>
                    <Text numberOfLines={1} style={styles.threadRowSubtitle}>
                      {threadMeta?.preview ?? 'Sem mensagens ainda.'}
                    </Text>
                  </View>

                  <View style={styles.threadRowMeta}>
                    <Text style={styles.threadTime}>{threadMeta?.timeLabel ?? ''}</Text>
                    {!thread.isDefault ? (
                      <View style={[
                        styles.statusPill,
                        thread.status === 'concluido' ? styles.statusPillDone : styles.statusPillOpen,
                      ]}
                      >
                        <Text style={styles.statusPillText}>{thread.status === 'concluido' ? 'Concluído' : 'Aberto'}</Text>
                      </View>
                    ) : null}
                    {Number(threadMeta?.unreadCount ?? 0) > 0 ? (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>
                          {(threadMeta?.unreadCount ?? 0) > 9 ? '9+' : String(threadMeta?.unreadCount ?? 0)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            };

            return (
              <View key={participant.id} style={styles.participantBlock}>
                <View style={styles.participantHeader}>
                  <View style={styles.participantHeaderLeft}>
                    <View style={styles.threadIcon}>
                      {participant.photoURL ? (
                        <Image source={{ uri: participant.photoURL }} style={styles.threadAvatar} />
                      ) : (
                        <MaterialIcons name="person" size={22} color={palette.greenDark} />
                      )}
                    </View>
                    <View style={styles.participantHeaderTextWrap}>
                      <Text style={styles.participantName}>{participant.nome}</Text>
                      <Text style={styles.participantHint}>Chats por assunto e chamados</Text>
                    </View>
                  </View>

                  {canCreateThread ? (
                    <AppButton
                      label="Novo chat"
                      variant="ghost"
                      onPress={() => {
                        void handleCreateThread(participant);
                      }}
                      loading={creatingThreadForUserId === participant.id}
                    />
                  ) : null}
                </View>

                <View style={styles.participantThreadsWrap}>
                  {renderThreadRow(mainThread)}

                  <Pressable
                    style={[styles.subjectToggleRow, !subjectThreads.length ? styles.subjectToggleRowDisabled : null]}
                    onPress={() => toggleSubjectThreads(participant.id)}
                    disabled={!subjectThreads.length}
                  >
                    <View style={styles.subjectToggleLeft}>
                      <MaterialIcons
                        name={subjectsExpanded ? 'keyboard-arrow-down' : 'keyboard-arrow-right'}
                        size={18}
                        color={palette.gray700}
                      />
                      <Text style={styles.subjectToggleTitle}>Chats por assunto ({subjectThreads.length})</Text>
                    </View>

                    {subjectUnreadCount > 0 ? (
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadBadgeText}>{subjectUnreadCount > 9 ? '9+' : String(subjectUnreadCount)}</Text>
                      </View>
                    ) : null}
                  </Pressable>

                  {subjectsExpanded ? subjectThreads.map((thread) => renderThreadRow(thread)) : null}
                </View>
              </View>
            );
          })
        ) : (
          <EmptyState title="Sem conversas privadas" subtitle="Nenhum contato disponível no momento." />
        )}
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 17,
    color: palette.gray900,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  thread: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.gray300,
    backgroundColor: '#F7FAF7',
    borderRadius: radii.lg,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  threadIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ECF3E7',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  threadAvatar: {
    width: '100%',
    height: '100%',
  },
  threadContent: {
    flex: 1,
    gap: spacing.xs,
  },
  threadMeta: {
    minWidth: 34,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  threadTime: {
    color: palette.gray500,
    fontSize: 13,
    fontWeight: '600',
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: palette.white,
    fontSize: 12,
    fontWeight: '800',
  },
  threadTitle: {
    color: palette.gray900,
    fontSize: 16,
    fontWeight: '800',
  },
  threadSubtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
  participantBlock: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.lg,
    padding: spacing.sm,
    backgroundColor: '#F8FAF8',
    gap: spacing.sm,
  },
  participantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
  },
  participantHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  participantHeaderTextWrap: {
    gap: spacing.xs,
    flex: 1,
  },
  participantName: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '800',
  },
  participantHint: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '600',
  },
  participantThreadsWrap: {
    gap: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.gray100,
    backgroundColor: palette.white,
    padding: spacing.xs,
  },
  subjectToggleRow: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: '#F2F5F2',
  },
  subjectToggleRowDisabled: {
    opacity: 0.7,
  },
  subjectToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  subjectToggleTitle: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '700',
  },
  threadRow: {
    borderWidth: 1,
    borderColor: '#E3E8E3',
    backgroundColor: '#FCFDFC',
    borderRadius: radii.md,
    minHeight: 62,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  threadRowSubject: {
    marginLeft: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: '#D6E4D4',
  },
  threadRowMain: {
    flex: 1,
    gap: 2,
  },
  threadRowTitle: {
    color: palette.gray900,
    fontSize: 14,
    fontWeight: '800',
  },
  threadRowSubtitle: {
    color: palette.gray700,
    fontSize: 13,
  },
  threadRowMeta: {
    minWidth: 86,
    alignItems: 'flex-end',
    gap: 4,
  },
  statusPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPillOpen: {
    backgroundColor: '#DBFCE7',
  },
  statusPillDone: {
    backgroundColor: '#F1F5F9',
  },
  statusPillText: {
    color: palette.gray900,
    fontSize: 11,
    fontWeight: '800',
  },
});
