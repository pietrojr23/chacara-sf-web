import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { addTicketComment, getTickets, updateTicket } from '../../services/firestoreService';
import { cacheKeys, getCache, saveCache } from '../../services/cacheService';
import { MaintenanceTicket, TicketStatus } from '../../types/models';
import { RootStackParamList } from '../../types/navigation';
import { formatDateBR } from '../../utils/format';
import { getFileNameFromPath, inferFileKind } from '../../utils/file';

const allStatus: TicketStatus[] = ['Pendente', 'Em andamento', 'Concluido', 'Cancelado'];

export const TicketsScreen = () => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isOwner = Boolean(profile?.isOwner);

  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'Todos'>('Todos');
  const [comments, setComments] = useState<Record<string, string>>({});

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
      return undefined;
    }, [dataVersion, loadTickets]),
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

  return (
    <ScreenContainer refreshing={loading} onRefresh={handleRefresh}>
      <SectionHeader
        title="Chamados de manutenção"
        subtitle={isOwner ? 'Gestão de todos os chamados' : 'Acompanhe os chamados da sua casa'}
      />

      <AppCard>
        <Text style={styles.cardTitle}>Filtro por status</Text>
        <View style={styles.filterRow}>
          {(['Todos', ...allStatus] as const).map((status) => (
            <Pressable
              key={status}
              style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
              onPress={() => setStatusFilter(status as TicketStatus | 'Todos')}
            >
              <Text style={[styles.filterText, statusFilter === status && styles.filterTextActive]}>{status}</Text>
            </Pressable>
          ))}
        </View>
        <AppButton label="Abrir novo chamado" onPress={() => navigation.navigate('TicketForm')} />
      </AppCard>

      {loading ? (
        <AppCard>
          <Text style={styles.subtitle}>Carregando chamados...</Text>
        </AppCard>
      ) : filtered.length ? (
        filtered.map((ticket) => (
          <AppCard key={ticket.id}>
            <View style={styles.ticketHeader}>
              <Text style={styles.ticketTitle}>{ticket.titulo}</Text>
              <StatusBadge
                text={ticket.status}
                tone={
                  ticket.status === 'Concluido'
                    ? 'success'
                    : ticket.status === 'Cancelado'
                      ? 'danger'
                      : ticket.status === 'Em andamento'
                        ? 'info'
                        : 'warning'
                }
              />
            </View>
            <Text style={styles.subtitle}>{ticket.descricao}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>Categoria: {ticket.categoria}</Text>
              <Text style={styles.metaText}>Urgência: {ticket.urgencia}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>Casa: {ticket.casaNome || ticket.casaId}</Text>
              <Text style={styles.metaText}>Abertura: {formatDateBR(ticket.criadoEm, 'dd/MM HH:mm')}</Text>
            </View>

            {ticket.fotos?.length ? (
              <View style={styles.attachmentsWrap}>
                <Text style={styles.metaText}>Arquivos anexados:</Text>
                <View style={styles.attachmentsRow}>
                  {ticket.fotos.map((url) => {
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

            {ticket.prestador ? <Text style={styles.metaText}>Prestador: {ticket.prestador}</Text> : null}
            {ticket.prazoEstimado ? <Text style={styles.metaText}>Prazo: {formatDateBR(ticket.prazoEstimado)}</Text> : null}

            {isOwner ? (
              <View style={styles.filterRow}>
                {allStatus.map((status) => (
                  <Pressable
                    key={status}
                    style={[styles.filterChip, ticket.status === status && styles.filterChipActive]}
                    onPress={() => ownerUpdateStatus(ticket.id, status)}
                  >
                    <Text style={[styles.filterText, ticket.status === status && styles.filterTextActive]}>{status}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {ticket.comentarios?.length ? (
              <View style={styles.commentList}>
                {ticket.comentarios.map((comment, index) => (
                  <View key={`${comment.autorId}-${index}`} style={styles.commentItem}>
                    <Text style={styles.commentAuthor}>{comment.autorNome}</Text>
                    <Text style={styles.commentText}>{comment.texto}</Text>
                    <Text style={styles.commentDate}>{formatDateBR(comment.data, 'dd/MM HH:mm')}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <AppInput
              label="Adicionar comentário"
              value={comments[ticket.id] ?? ''}
              onChangeText={(text) => setComments((old) => ({ ...old, [ticket.id]: text }))}
              placeholder="Digite uma atualização"
            />
            <AppButton label="Enviar comentário" variant="ghost" onPress={() => submitComment(ticket.id)} />
          </AppCard>
        ))
      ) : (
        <AppCard>
          <EmptyState
            title="Nenhum chamado encontrado"
            subtitle="Abra um chamado para manutenção elétrica, hidráulica, estrutural ou outros."
          />
        </AppCard>
      )}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.gray900,
  },
  subtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: palette.gray300,
    backgroundColor: palette.white,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterChipActive: {
    borderColor: palette.greenDark,
    backgroundColor: palette.greenDark,
  },
  filterText: {
    color: palette.gray900,
    fontWeight: '700',
    fontSize: 12,
  },
  filterTextActive: {
    color: palette.white,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  ticketTitle: {
    flex: 1,
    color: palette.gray900,
    fontSize: 16,
    fontWeight: '800',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metaText: {
    color: palette.gray700,
    fontSize: 12,
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
    maxWidth: 180,
  },
  attachmentChipText: {
    color: palette.gray700,
    fontSize: 12,
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
    fontSize: 13,
  },
  commentText: {
    color: palette.gray700,
    fontSize: 13,
  },
  commentDate: {
    color: palette.gray500,
    fontSize: 11,
  },
});
