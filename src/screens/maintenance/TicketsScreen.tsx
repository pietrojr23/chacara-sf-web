import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { AppInput } from '../../components/AppInput';
import { AppSelect } from '../../components/AppSelect';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { addTicketComment, getTickets, updateTicket } from '../../services/firestoreService';
import { cacheKeys, getCache, saveCache } from '../../services/cacheService';
import { MaintenanceTicket, TicketStatus } from '../../types/models';
import { RootStackParamList } from '../../types/navigation';
import { formatDateBR } from '../../utils/format';
import { getFileNameFromPath, inferFileKind } from '../../utils/file';

const allStatus: TicketStatus[] = ['Pendente', 'Em andamento', 'Concluido', 'Cancelado'];
const statusFilterOptions = [
  { label: 'Todos', value: 'Todos' },
  ...allStatus.map((status) => ({ label: status, value: status })),
];

const getStatusTone = (status: TicketStatus): 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'Concluido') {
    return 'success';
  }
  if (status === 'Cancelado') {
    return 'danger';
  }
  if (status === 'Em andamento') {
    return 'info';
  }
  return 'warning';
};

export const TicketsScreen = () => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isOwner = Boolean(profile?.isOwner);

  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'Todos'>('Todos');
  const [comments, setComments] = useState<Record<string, string>>({});
  const [expandedCommentsByTicketId, setExpandedCommentsByTicketId] = useState<Record<string, boolean>>({});
  const [expandedDetailsByTicketId, setExpandedDetailsByTicketId] = useState<Record<string, boolean>>({});

  const collapseAllComments = useCallback(() => {
    setExpandedCommentsByTicketId({});
  }, []);

  const withTimeout = <T,>(promise: Promise<T>, timeoutMs = 12000): Promise<T> =>
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
    });

  const loadTickets = useCallback(async () => {
    if (!profile) {
      return;
    }

    try {
      setLoading(true);
      const result = await getTickets({
        isOwner,
        houseId: profile.casaId,
        userId: profile.id,
      });
      setTickets(result);
      await saveCache(cacheKeys.tickets, result);
    } catch {
      const cached = await getCache<MaintenanceTicket[]>(cacheKeys.tickets);
      if (cached) {
        setTickets(cached);
      } else {
        Alert.alert('Erro', 'Não foi possível carregar os chamados.');
      }
    } finally {
      setLoading(false);
    }
  }, [isOwner, profile]);

  useFocusEffect(
    useCallback(() => {
      void loadTickets();
      return () => {
        collapseAllComments();
      };
    }, [collapseAllComments, dataVersion, loadTickets]),
  );

  const handleRefresh = useCallback(() => {
    void loadTickets();
  }, [loadTickets]);

  const filtered = useMemo(() => {
    if (statusFilter === 'Todos') {
      return tickets;
    }

    return tickets.filter((ticket) => ticket.status === statusFilter);
  }, [statusFilter, tickets]);

  const statusSummary = useMemo(() => {
    const initial = { total: filtered.length, pendente: 0, andamento: 0, concluido: 0, cancelado: 0 };

    return filtered.reduce((acc, ticket) => {
      if (ticket.status === 'Pendente') {
        acc.pendente += 1;
      } else if (ticket.status === 'Em andamento') {
        acc.andamento += 1;
      } else if (ticket.status === 'Concluido') {
        acc.concluido += 1;
      } else if (ticket.status === 'Cancelado') {
        acc.cancelado += 1;
      }

      return acc;
    }, initial);
  }, [filtered]);

  const ownerUpdateStatus = async (ticketId: string, status: TicketStatus) => {
    try {
      await withTimeout(updateTicket(ticketId, { status }));
      await withTimeout(loadTickets());
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A atualização demorou demais para responder. Tente novamente.'
          : 'Falha ao atualizar o status do chamado.',
      );
    }
  };

  const submitComment = async (ticketId: string) => {
    if (!profile) {
      return;
    }

    const text = comments[ticketId]?.trim();
    if (!text) {
      return;
    }

    try {
      await withTimeout(addTicketComment(ticketId, profile.id, profile.nome, text));
      setComments((old) => ({ ...old, [ticketId]: '' }));
      await withTimeout(loadTickets());
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'O envio demorou demais para responder. Tente novamente.'
          : 'Falha ao enviar comentário.',
      );
    }
  };

  const toggleCommentsVisibility = useCallback((ticketId: string) => {
    setExpandedCommentsByTicketId((current) => ({
      ...current,
      [ticketId]: !current[ticketId],
    }));
  }, []);

  const toggleDetailsVisibility = useCallback((ticketId: string) => {
    setExpandedDetailsByTicketId((current) => {
      const isOpening = !current[ticketId];
      if (!isOpening) {
        setExpandedCommentsByTicketId((commentsState) => ({ ...commentsState, [ticketId]: false }));
      }
      return {
        ...current,
        [ticketId]: isOpening,
      };
    });
  }, []);

  const renderTicketItem = ({ item }: { item: MaintenanceTicket }) => {
    const detailsExpanded = Boolean(expandedDetailsByTicketId[item.id]);
    const commentsExpanded = Boolean(expandedCommentsByTicketId[item.id]);

    return (
      <AppCard>
        <View style={styles.ticketHeader}>
          <View style={styles.ticketHeaderMain}>
            <Text style={styles.ticketTitle} numberOfLines={1}>{item.titulo}</Text>
            <Text style={styles.ticketSubtitle} numberOfLines={2}>{item.descricao}</Text>
          </View>
          <StatusBadge text={item.status} tone={getStatusTone(item.status)} />
        </View>

        <View style={styles.metaGrid}>
          <Text style={styles.metaText}>Casa: {item.casaNome || item.casaId}</Text>
          <Text style={styles.metaText}>Abertura: {formatDateBR(item.criadoEm, 'dd/MM HH:mm')}</Text>
          <Text style={styles.metaText}>Categoria: {item.categoria}</Text>
          <Text style={styles.metaText}>Urgência: {item.urgencia}</Text>
        </View>

        <Pressable style={styles.expandToggle} onPress={() => toggleDetailsVisibility(item.id)}>
          <Text style={styles.expandToggleText}>{detailsExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}</Text>
          <MaterialIcons
            name={detailsExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
            size={20}
            color={palette.gray700}
          />
        </Pressable>

        {detailsExpanded ? (
          <View style={styles.detailsSection}>
            {item.fotos?.length ? (
              <View style={styles.attachmentsWrap}>
                <Text style={styles.sectionLabel}>ANEXOS</Text>
                <View style={styles.attachmentsRow}>
                  {item.fotos.map((url) => {
                    const kind = inferFileKind(url);
                    return kind === 'image' ? (
                      <Pressable key={url} onPress={() => Linking.openURL(url)}>
                        <Image source={{ uri: url }} style={styles.attachmentImage} />
                      </Pressable>
                    ) : (
                      <Pressable key={url} style={styles.attachmentChip} onPress={() => Linking.openURL(url)}>
                        <Text style={styles.attachmentChipText}>{getFileNameFromPath(url, 'Abrir arquivo')}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {item.prestador ? <Text style={styles.metaText}>Prestador: {item.prestador}</Text> : null}
            {item.prazoEstimado ? <Text style={styles.metaText}>Prazo: {formatDateBR(item.prazoEstimado)}</Text> : null}

            {isOwner ? (
              <AppSelect
                label="Atualizar status"
                value={item.status}
                options={allStatus.map((status) => ({ label: status, value: status }))}
                onChange={(value) => ownerUpdateStatus(item.id, value as TicketStatus)}
              />
            ) : null}

            {item.comentarios?.length ? (
              <View style={styles.commentSection}>
                <Pressable
                  style={styles.commentToggle}
                  onPress={() => toggleCommentsVisibility(item.id)}
                >
                  <Text style={styles.commentToggleText}>
                    {commentsExpanded ? 'Ocultar comentários' : `Mostrar comentários (${item.comentarios.length})`}
                  </Text>
                  <Text style={styles.commentToggleChevron}>{commentsExpanded ? '▴' : '▾'}</Text>
                </Pressable>
                {commentsExpanded ? (
                  <View style={styles.commentList}>
                    {item.comentarios.map((comment, commentIndex) => (
                      <View key={`${comment.autorId}-${commentIndex}`} style={styles.commentItem}>
                        <Text style={styles.commentAuthor}>{comment.autorNome}</Text>
                        <Text style={styles.commentText}>{comment.texto}</Text>
                        <Text style={styles.commentDate}>{formatDateBR(comment.data, 'dd/MM HH:mm')}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <AppInput
              label="Adicionar comentário"
              value={comments[item.id] ?? ''}
              onChangeText={(text) => setComments((old) => ({ ...old, [item.id]: text }))}
              placeholder="Digite uma atualização"
            />
            <AppButton label="Enviar comentário" variant="ghost" onPress={() => submitComment(item.id)} />
          </View>
        ) : null}
      </AppCard>
    );
  };

  const renderListHeader = () => (
    <AppCard>
      <Text style={styles.cardTitle}>CHAMADOS</Text>
      <View style={styles.summaryRow}>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{statusSummary.total}</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryLabel}>Pendentes</Text>
          <Text style={styles.summaryValue}>{statusSummary.pendente}</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryLabel}>Em andamento</Text>
          <Text style={styles.summaryValue}>{statusSummary.andamento}</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryLabel}>Concluídos</Text>
          <Text style={styles.summaryValue}>{statusSummary.concluido}</Text>
        </View>
        <View style={styles.summaryPill}>
          <Text style={styles.summaryLabel}>Cancelados</Text>
          <Text style={styles.summaryValue}>{statusSummary.cancelado}</Text>
        </View>
      </View>
      <AppSelect
        label="Filtrar por status"
        value={statusFilter}
        options={statusFilterOptions}
        onChange={(value) => setStatusFilter(value as TicketStatus | 'Todos')}
      />
      <AppButton label="Abrir novo chamado" onPress={() => navigation.navigate('TicketForm')} />
    </AppCard>
  );

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.root}>
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderTicketItem}
          ListHeaderComponent={renderListHeader}
          ListEmptyComponent={
            loading ? (
              <AppCard>
                <Text style={styles.loadingText}>Carregando chamados...</Text>
              </AppCard>
            ) : (
              <AppCard>
                <EmptyState
                  title="Nenhum chamado encontrado"
                  subtitle="Abra um chamado para manutenção elétrica, hidráulica, estrutural ou outros."
                />
              </AppCard>
            )
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={handleRefresh}
          refreshing={loading}
        />
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: spacing.lg,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.gray900,
    textTransform: 'uppercase',
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryPill: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.gray300,
    backgroundColor: palette.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    gap: 2,
  },
  summaryLabel: {
    color: palette.gray700,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryValue: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '800',
  },
  listContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  loadingText: {
    color: palette.gray700,
    fontSize: 14,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  ticketHeaderMain: {
    flex: 1,
    gap: spacing.xs,
  },
  ticketTitle: {
    color: palette.gray900,
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  ticketSubtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
  metaGrid: {
    gap: spacing.xs,
  },
  metaText: {
    color: palette.gray700,
    fontSize: 14,
  },
  expandToggle: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  expandToggleText: {
    color: palette.gray900,
    fontSize: 14,
    fontWeight: '700',
  },
  detailsSection: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: palette.gray900,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  attachmentsWrap: {
    gap: spacing.xs,
  },
  attachmentsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  attachmentImage: {
    width: 84,
    height: 84,
    borderRadius: radii.md,
  },
  attachmentChip: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    maxWidth: 200,
  },
  attachmentChipText: {
    color: palette.gray700,
    fontSize: 14,
    fontWeight: '700',
  },
  commentSection: {
    gap: spacing.sm,
  },
  commentToggle: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  commentToggleText: {
    color: palette.gray900,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  commentToggleChevron: {
    color: palette.gray700,
    fontSize: 14,
    fontWeight: '700',
  },
  commentList: {
    gap: spacing.sm,
  },
  commentItem: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  commentAuthor: {
    color: palette.gray900,
    fontWeight: '700',
    fontSize: 15,
  },
  commentText: {
    color: palette.gray700,
    fontSize: 14,
  },
  commentDate: {
    color: palette.gray500,
    fontSize: 13,
  },
});
