import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { EmptyState } from '../../components/EmptyState';
import { AppInput } from '../../components/AppInput';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { ensureSelfProfileDocument } from '../../services/authService';
import {
  getAllHouses,
  getHouseDocuments,
  getHouseProfile,
  updateHouseResidents,
  upsertHouse,
  upsertHouseDocument,
} from '../../services/firestoreService';
import { uploadFileAsync } from '../../services/storageService';
import { House, HouseDocument } from '../../types/models';
import { formatDateBR } from '../../utils/format';
import { getFileExtension } from '../../utils/file';

export const HouseProfileScreen = () => {
  const { profile, firebaseUser } = useAuth();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(profile?.casaId ?? null);
  const [house, setHouse] = useState<House | null>(null);
  const [documents, setDocuments] = useState<HouseDocument[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [actionLoading, setActionLoading] = useState<
    null | 'createHouse' | 'addResident' | 'uploadDocument' | 'removeResident'
  >(null);
  const [residentName, setResidentName] = useState('');
  const [residentContact, setResidentContact] = useState('');

  const resolvedHouseId = useMemo(() => {
    if (selectedHouseId && houses.some((item) => item.id === selectedHouseId)) {
      return selectedHouseId;
    }

    if (house?.id) {
      return house.id;
    }

    if (houses.length) {
      return houses[0].id;
    }

    return profile?.casaId ?? null;
  }, [house?.id, houses, profile?.casaId, selectedHouseId]);

  const selectedHouseLabel = useMemo(
    () =>
      houses.find((item) => item.id === resolvedHouseId)?.nome ||
      houses.find((item) => item.id === resolvedHouseId)?.id ||
      house?.nome ||
      house?.id ||
      'Casa',
    [house?.id, house?.nome, houses, resolvedHouseId],
  );

  const errorMessage = useCallback((error: unknown, fallback: string) => {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === 'permission-denied') {
      return 'Sem permissão para alterar moradores desta casa. Verifique se sua conta está como proprietário.';
    }

    if (code === 'operation-timeout') {
      return 'A operação demorou demais para responder. Verifique conexão e regras do banco.';
    }

    return fallback;
  }, []);

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

  const loadHouseDetails = useCallback(
    async (houseId: string) => {
      const houseData = await withTimeout(getHouseProfile(houseId), 10000);
      setHouse(houseData);

      try {
        const docs = await withTimeout(getHouseDocuments(houseId), 10000);
        setDocuments(docs);
      } catch (error) {
        console.warn('[HouseProfile] Falha ao carregar documentos da casa:', error);
        setDocuments([]);
      }
    },
    [withTimeout],
  );

  const loadData = useCallback(async () => {
    if (!profile) {
      return;
    }

    try {
      setLoadingData(true);

      if (isOwner) {
        try {
          const all = await getAllHouses();
          setHouses(all);

          const selectedExists = selectedHouseId ? all.some((item) => item.id === selectedHouseId) : false;
          const houseId = selectedExists ? selectedHouseId : all[0]?.id;
          if (houseId) {
            setSelectedHouseId(houseId);
            await loadHouseDetails(houseId);
          } else if (profile.casaId) {
            const fallbackHouse = await getHouseProfile(profile.casaId);
            if (fallbackHouse) {
              setHouses([fallbackHouse]);
              setSelectedHouseId(fallbackHouse.id);
              setHouse(fallbackHouse);
            }
          }
        } catch (error) {
          if (profile.casaId) {
            const fallbackHouse = await getHouseProfile(profile.casaId);
            if (fallbackHouse) {
              setHouses([fallbackHouse]);
              setSelectedHouseId(fallbackHouse.id);
              setHouse(fallbackHouse);
              return;
            }
          }

          throw error;
        }
      } else if (profile.casaId) {
        await loadHouseDetails(profile.casaId);
      }
    } catch (error) {
      console.error('[HouseProfile] Falha ao carregar casas/perfil:', error);
      Alert.alert('Erro', errorMessage(error, 'Falha ao carregar perfil da casa.'));
    } finally {
      setLoadingData(false);
    }
  }, [errorMessage, isOwner, loadHouseDetails, profile, selectedHouseId]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return undefined;
    }, [dataVersion, loadData]),
  );

  const handleRefresh = useCallback(() => {
    void loadData();
  }, [loadData]);

  const handleUploadDocument = async () => {
    if (!resolvedHouseId) {
      Alert.alert('Selecione uma casa', 'Escolha uma casa antes de enviar o documento.');
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      return;
    }

    try {
      setActionLoading('uploadDocument');
      const file = result.assets[0];
      const ext = getFileExtension(file.name) || getFileExtension(file.uri) || 'bin';
      const uploadUrl = await withTimeout(
        uploadFileAsync(file.uri, `documentos/${resolvedHouseId}/${Date.now()}-${file.name || `arquivo.${ext}`}`),
      );

      await withTimeout(
        upsertHouseDocument(resolvedHouseId, {
          id: `${Date.now()}`,
          titulo: file.name || `arquivo.${ext}`,
          tipo: 'contrato',
          arquivoUrl: uploadUrl,
        }),
      );

      await withTimeout(loadHouseDetails(resolvedHouseId));
      Alert.alert('Documento enviado', 'PDF enviado e vinculado à casa com sucesso.');
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'Não foi possível enviar o documento.'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddResident = async () => {
    if (!isOwner) {
      return;
    }

    if (!resolvedHouseId) {
      Alert.alert('Selecione uma casa', 'Escolha uma casa antes de adicionar morador.');
      return;
    }

    const nome = residentName.trim();
    const contato = residentContact.trim();

    if (!nome) {
      Alert.alert('Campo obrigatório', 'Informe o nome do morador.');
      return;
    }

    try {
      setActionLoading('addResident');
      const nextMoradores = [
        ...(house?.moradores ?? []),
        {
          nome,
          ...(contato ? { contato } : {}),
        },
      ];
      await withTimeout(updateHouseResidents(resolvedHouseId, nextMoradores));
      await withTimeout(loadHouseDetails(resolvedHouseId));
      setResidentName('');
      setResidentContact('');
      Alert.alert('Sucesso', 'Morador adicionado com sucesso.');
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'Não foi possível cadastrar o morador.'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveResident = async (indexToRemove: number) => {
    if (!isOwner || !resolvedHouseId) {
      return;
    }

    try {
      setActionLoading('removeResident');
      const nextMoradores = (house?.moradores ?? []).filter((_, index) => index !== indexToRemove);
      await withTimeout(updateHouseResidents(resolvedHouseId, nextMoradores));
      await withTimeout(loadHouseDetails(resolvedHouseId));
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'Não foi possível remover o morador.'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateHouse = async () => {
    if (!isOwner || !firebaseUser) {
      return;
    }

    const currentIndexes = houses
      .flatMap((item) => {
        const byIdMatch = /^casa-(\d+)$/i.exec(String(item.id ?? '').trim());
        const byId = byIdMatch ? Number(byIdMatch[1]) : NaN;
        const byNumero = Number(String(item.numero ?? '').trim());
        return [byId, byNumero];
      })
      .filter((value) => Number.isFinite(value) && value > 0);

    const nextNumber = (currentIndexes.length ? Math.max(...currentIndexes) : 0) + 1;
    const houseId = `casa-${String(nextNumber).padStart(2, '0')}`;
    const newHouse: House = {
      id: houseId,
      nome: `Casa ${nextNumber}`,
      numero: String(nextNumber),
      aluguelMensal: 0,
      diaVencimento: 5,
      moradores: [],
      veiculos: [],
      pets: [],
    };
    let stage: 'token' | 'perfil' | 'casa' = 'token';

    try {
      setActionLoading('createHouse');
      await withTimeout(firebaseUser.getIdToken(true), 10000);
      stage = 'perfil';

      // Repair owner fields before writing /casas, so strict rules can pass.
      await withTimeout(ensureSelfProfileDocument(firebaseUser, true), 10000);
      stage = 'casa';
      await withTimeout(upsertHouse(newHouse), 10000);

      setHouses((current) => {
        if (current.some((item) => item.id === newHouse.id)) {
          return current;
        }

        return [...current, newHouse];
      });
      setSelectedHouseId(newHouse.id);
      setHouse(newHouse);

      void loadData();
      Alert.alert('Sucesso', `Casa ${houseId} criada com sucesso.`);
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      const message = errorMessage(error, 'Não foi possível criar a casa.');
      console.error('[HouseProfile] Falha ao criar casa:', error);
      Alert.alert('Erro', `${message} [etapa: ${stage}] (${code ?? 'sem-codigo'})`);
    } finally {
      setActionLoading(null);
    }
  };

  if (!profile) {
    return null;
  }

  return (
    <ScreenContainer refreshing={loadingData} onRefresh={handleRefresh}>
      <SectionHeader title="Perfil da casa" subtitle="Moradores, contrato e documentos" />

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Selecionar casa</Text>
          {houses.length ? (
            <>
              <View style={styles.chips}>
                {houses.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.chip, selectedHouseId === item.id && styles.chipActive]}
                    onPress={async () => {
                      setSelectedHouseId(item.id);
                      await loadHouseDetails(item.id);
                    }}
                  >
                    <Text style={[styles.chipText, selectedHouseId === item.id && styles.chipTextActive]}>
                      {item.nome || item.id}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <AppButton
                label="Adicionar nova casa"
                onPress={handleCreateHouse}
                loading={actionLoading === 'createHouse'}
                variant="secondary"
              />
            </>
          ) : (
            <>
              <EmptyState
                title="Nenhuma casa visível"
                subtitle="Verifique se seu usuário está como proprietário no Supabase e se as policies foram aplicadas."
              />
              <AppButton
                label="Criar primeira casa"
                onPress={handleCreateHouse}
                loading={actionLoading === 'createHouse'}
                variant="secondary"
              />
            </>
          )}
        </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.cardTitle}>{selectedHouseLabel}</Text>
        {house?.fotoFachadaUrl ? <Image source={{ uri: house.fotoFachadaUrl }} style={styles.houseImage} /> : null}

        <Text style={styles.infoLine}>Número: {house?.numero ?? '-'}</Text>
        <Text style={styles.infoLine}>Aluguel: R$ {house?.aluguelMensal ?? 0}</Text>
        <Text style={styles.infoLine}>Vencimento: dia {house?.diaVencimento ?? '-'}</Text>
        <Text style={styles.infoLine}>Inquilino: {house?.inquilinoNome ?? '-'}</Text>
        <Text style={styles.infoLine}>CPF: {house?.inquilinoCpf ?? '-'}</Text>
        <Text style={styles.infoLine}>Início do contrato: {formatDateBR(house?.dataInicioContrato)}</Text>
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Moradores</Text>
        {isOwner ? (
          <View style={styles.residentForm}>
            <AppInput
              label="Nome do morador"
              value={residentName}
              onChangeText={setResidentName}
              placeholder="Ex: Maria Souza"
            />
            <AppInput
              label="Contato"
              value={residentContact}
              onChangeText={setResidentContact}
              placeholder="Telefone ou e-mail"
            />
            <AppButton
              label="Adicionar morador"
              onPress={handleAddResident}
              loading={actionLoading === 'addResident'}
            />
          </View>
        ) : null}

        {house?.moradores?.length ? (
          house.moradores.map((morador, index) => (
            <View key={`${morador.nome}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemTitle}>{morador.nome}</Text>
              <Text style={styles.itemText}>{morador.contato ?? 'Sem contato'}</Text>
              {isOwner ? (
                <Pressable onPress={() => handleRemoveResident(index)} style={styles.removeResidentButton}>
                  <Text style={styles.removeResidentText}>Remover</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <EmptyState
            title="Sem moradores cadastrados"
            subtitle={isOwner ? 'Use o formulário acima para adicionar moradores.' : 'Sem moradores cadastrados.'}
          />
        )}
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Veículos e pets</Text>
        <Text style={styles.infoLine}>Placas: {house?.veiculos?.join(', ') || 'Não informado'}</Text>
        <Text style={styles.infoLine}>
          Pets:{' '}
          {house?.pets?.length
            ? house.pets.map((pet) => `${pet.nome} (${pet.especie})`).join(', ')
            : 'Não informado'}
        </Text>
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Documentos</Text>
        {isOwner ? (
          <AppButton
            label="Upload de arquivo"
            onPress={handleUploadDocument}
            loading={actionLoading === 'uploadDocument'}
          />
        ) : null}

        {documents.length ? (
          documents.map((doc) => (
            <Pressable key={doc.id} style={styles.docRow} onPress={() => Linking.openURL(doc.arquivoUrl)}>
              <Text style={styles.itemTitle}>{doc.titulo}</Text>
              <Text style={styles.itemText}>Tipo: {doc.tipo}</Text>
              <Text style={styles.itemText}>Enviado em: {formatDateBR(doc.criadoEm, 'dd/MM/yyyy HH:mm')}</Text>
            </Pressable>
          ))
        ) : (
          <EmptyState title="Sem documentos" subtitle="Nenhum contrato ou laudo disponível para esta casa." />
        )}
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.gray900,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
  houseImage: {
    width: '100%',
    height: 180,
    borderRadius: radii.md,
  },
  infoLine: {
    color: palette.gray700,
    fontSize: 14,
  },
  residentForm: {
    gap: spacing.sm,
  },
  itemRow: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  itemTitle: {
    color: palette.gray900,
    fontWeight: '700',
  },
  itemText: {
    color: palette.gray700,
    fontSize: 13,
  },
  removeResidentButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  removeResidentText: {
    color: palette.danger,
    fontWeight: '700',
    fontSize: 12,
  },
  docRow: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
});
