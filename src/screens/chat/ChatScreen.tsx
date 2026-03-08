import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { AppCard } from '../../components/AppCard';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { getOwnerUser, getTenantUsers } from '../../services/firestoreService';
import { AppUser } from '../../types/models';
import { RootStackParamList } from '../../types/navigation';
import { buildPrivateChatId } from '../../utils/chat';

export const ChatScreen = () => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isOwner = Boolean(profile?.isOwner);
  const [participants, setParticipants] = useState<AppUser[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadParticipants = useCallback(async () => {
    if (!profile) {
      return;
    }

    try {
      setRefreshing(true);
      if (isOwner) {
        const tenants = await getTenantUsers();
        setParticipants(tenants);
      } else {
        const owner = await getOwnerUser();
        setParticipants(owner ? [owner] : []);
      }
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

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <SectionHeader title="Chat" subtitle="Conversa geral e chat privado com o proprietário" />

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
            <Text style={styles.threadSubtitle}>Troque mensagens, imagens e atualizações rápidas.</Text>
          </View>
        </Pressable>
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>{isOwner ? 'Conversas privadas (inquilinos)' : 'Conversa privada'}</Text>

        {participants.length ? (
          participants.map((participant) => {
            const privateChatId = isOwner
              ? (profile ? buildPrivateChatId(profile.id, participant.id) : '')
              : 'owner_private';
            return (
              <Pressable
                key={participant.id}
                style={styles.thread}
                onPress={() =>
                  navigation.navigate('ChatRoom', {
                    chatId: privateChatId,
                    title: participant.nome,
                    isPrivate: true,
                  })
                }
                >
                <View style={styles.threadIcon}>
                  {participant.photoURL ? (
                    <Image source={{ uri: participant.photoURL }} style={styles.threadAvatar} />
                  ) : (
                    <MaterialIcons name="person" size={22} color={palette.greenDark} />
                  )}
                </View>
                <View style={styles.threadContent}>
                  <Text style={styles.threadTitle}>{participant.nome}</Text>
                  <Text style={styles.threadSubtitle}>{participant.casaId ? `Casa ${participant.casaId}` : 'Conversa direta'}</Text>
                </View>
              </Pressable>
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
    fontSize: 16,
    color: palette.gray900,
    fontWeight: '800',
  },
  thread: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
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
  threadTitle: {
    color: palette.gray900,
    fontSize: 15,
    fontWeight: '800',
  },
  threadSubtitle: {
    color: palette.gray700,
    fontSize: 13,
  },
});
