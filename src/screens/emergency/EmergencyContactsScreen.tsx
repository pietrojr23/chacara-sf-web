import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppInput } from '../../components/AppInput';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { getEmergencyContacts, saveEmergencyContact, seedEmergencyContacts } from '../../services/firestoreService';
import { EmergencyContact } from '../../types/models';

export const EmergencyContactsScreen = () => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [loading, setLoading] = useState(false);
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

  const loadContacts = useCallback(async () => {
    try {
      const data = await withTimeout(getEmergencyContacts());
      if (!data.length) {
        await withTimeout(seedEmergencyContacts());
        const seeded = await withTimeout(getEmergencyContacts());
        setContacts(seeded);
        return;
      }

      setContacts(data);
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar contatos de emergência.');
    }
  }, [withTimeout]);

  useFocusEffect(
    useCallback(() => {
      void loadContacts();
      return undefined;
    }, [dataVersion, loadContacts]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadContacts().finally(() => {
      setRefreshing(false);
    });
  }, [loadContacts]);

  const handleCreate = async () => {
    if (!nome.trim() || !telefone.trim() || !especialidade.trim()) {
      Alert.alert('Campos obrigatórios', 'Preencha nome, telefone e especialidade.');
      return;
    }

    try {
      setLoading(true);
      const id = `${nome.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
      await withTimeout(
        saveEmergencyContact({
          id,
          nome: nome.trim(),
          telefone: telefone.trim(),
          especialidade: especialidade.trim(),
        }),
      );

      setNome('');
      setTelefone('');
      setEspecialidade('');
      await withTimeout(loadContacts());
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A operação demorou demais para responder. Tente novamente.'
          : 'Não foi possível salvar contato de emergência.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <SectionHeader title="Contatos de emergência" subtitle="Acesso rápido a números essenciais da propriedade" />

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Adicionar contato personalizado</Text>
          <AppInput label="Nome" value={nome} onChangeText={setNome} placeholder="Ex: Eletricista João" />
          <AppInput label="Telefone" value={telefone} onChangeText={setTelefone} keyboardType="phone-pad" />
          <AppInput
            label="Especialidade"
            value={especialidade}
            onChangeText={setEspecialidade}
            placeholder="Ex: elétrica"
          />
          <AppButton label="Salvar contato" onPress={handleCreate} loading={loading} />
        </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.cardTitle}>Lista de contatos</Text>
        {contacts.length ? (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.contactRow}>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.nome}</Text>
                <Text style={styles.contactMeta}>{contact.especialidade}</Text>
                <Text style={styles.contactMeta}>{contact.telefone}</Text>
              </View>
              <Pressable style={styles.callButton} onPress={() => Linking.openURL(`tel:${contact.telefone}`)}>
                <Text style={styles.callText}>Ligar</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <EmptyState title="Sem contatos" subtitle="Cadastre contatos de emergência para acesso rápido." />
        )}
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: palette.gray900,
    textTransform: 'uppercase',
  },

  contactRow: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  contactInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  contactName: {
    color: palette.gray900,
    fontWeight: '800',
    fontSize: 15,
  },
  contactMeta: {
    color: palette.gray700,
    fontSize: 14,
  },
  callButton: {
    backgroundColor: palette.greenDark,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    minHeight: 44,
    justifyContent: 'center',
  },
  callText: {
    color: palette.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
