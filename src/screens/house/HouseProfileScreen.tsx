import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppSelect } from '../../components/AppSelect';
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
  updateHousePets,
  updateHouseResidents,
  updateHouseVehicles,
  upsertHouse,
  upsertHouseDocument,
} from '../../services/firestoreService';
import { uploadFileAsync } from '../../services/storageService';
import { House, HouseDocument } from '../../types/models';
import { formatDateBR } from '../../utils/format';
import { getFileExtension } from '../../utils/file';

const onlyDigits = (value: string) => String(value ?? '').replace(/\D/g, '');

const formatCpf = (value?: string) => {
  const digits = onlyDigits(String(value ?? ''));
  if (digits.length !== 11) {
    return value || '-';
  }

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

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
    null
    | 'createHouse'
    | 'addResident'
    | 'uploadDocument'
    | 'removeResident'
    | 'addPet'
    | 'removePet'
    | 'addVehicle'
    | 'removeVehicle'
  >(null);
  const [residentName, setResidentName] = useState('');
  const [residentContact, setResidentContact] = useState('');
  const [residentCpf, setResidentCpf] = useState('');
  const [residentPhone, setResidentPhone] = useState('');
  const [residentEmail, setResidentEmail] = useState('');
  const [residentRelation, setResidentRelation] = useState('');
  const [residentBirthDate, setResidentBirthDate] = useState('');
  const [residentNotes, setResidentNotes] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [petName, setPetName] = useState('');
  const [petSpecies, setPetSpecies] = useState('');
  const [petBreed, setPetBreed] = useState('');

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

    if (code === 'cloudinary-upload-failed') {
      return 'Falha no upload do arquivo. O app tentou Cloudinary e fallback automático; confira conexão e regras do storage.';
    }

    if (code === 'supabase-storage-upload-failed') {
      return 'Sem permissão para upload no Storage. Execute o bootstrap.sql para criar bucket/policies do `app-files`.';
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
      Alert.alert('Documento enviado', 'Arquivo enviado e vinculado à casa com sucesso.');
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
    const contato = residentContact.trim() || residentPhone.trim() || residentEmail.trim();
    const cpf = onlyDigits(residentCpf);
    const telefone = residentPhone.trim();
    const email = residentEmail.trim().toLowerCase();
    const parentesco = residentRelation.trim();
    const dataNascimento = residentBirthDate.trim();
    const observacoes = residentNotes.trim();

    if (!nome) {
      Alert.alert('Campo obrigatório', 'Informe o nome do morador.');
      return;
    }

    if (residentCpf.trim() && cpf.length !== 11) {
      Alert.alert('CPF inválido', 'Informe um CPF válido com 11 dígitos.');
      return;
    }

    try {
      setActionLoading('addResident');
      const nextMoradores = [
        ...(house?.moradores ?? []),
        {
          nome,
          ...(contato ? { contato } : {}),
          ...(cpf ? { cpf } : {}),
          ...(telefone ? { telefone } : {}),
          ...(email ? { email } : {}),
          ...(parentesco ? { parentesco } : {}),
          ...(dataNascimento ? { dataNascimento } : {}),
          ...(observacoes ? { observacoes } : {}),
        },
      ];
      await withTimeout(updateHouseResidents(resolvedHouseId, nextMoradores));
      await withTimeout(loadHouseDetails(resolvedHouseId));
      setResidentName('');
      setResidentContact('');
      setResidentCpf('');
      setResidentPhone('');
      setResidentEmail('');
      setResidentRelation('');
      setResidentBirthDate('');
      setResidentNotes('');
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

  const handleAddVehicle = async () => {
    if (!isOwner) {
      return;
    }

    if (!resolvedHouseId) {
      Alert.alert('Selecione uma casa', 'Escolha uma casa antes de adicionar placa.');
      return;
    }

    const plate = vehiclePlate.trim().toUpperCase();
    if (!plate) {
      Alert.alert('Campo obrigatório', 'Informe a placa do veículo.');
      return;
    }

    const currentVehicles = house?.veiculos ?? [];
    const duplicated = currentVehicles.some((item) => String(item ?? '').trim().toUpperCase() === plate);
    if (duplicated) {
      Alert.alert('Duplicado', 'Essa placa já está cadastrada para esta casa.');
      return;
    }

    try {
      setActionLoading('addVehicle');
      const nextVehicles = [...currentVehicles, plate];
      await withTimeout(updateHouseVehicles(resolvedHouseId, nextVehicles));
      await withTimeout(loadHouseDetails(resolvedHouseId));
      setVehiclePlate('');
      Alert.alert('Sucesso', 'Placa adicionada com sucesso.');
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'Não foi possível cadastrar a placa.'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveVehicle = async (indexToRemove: number) => {
    if (!isOwner || !resolvedHouseId) {
      return;
    }

    try {
      setActionLoading('removeVehicle');
      const nextVehicles = (house?.veiculos ?? []).filter((_, index) => index !== indexToRemove);
      await withTimeout(updateHouseVehicles(resolvedHouseId, nextVehicles));
      await withTimeout(loadHouseDetails(resolvedHouseId));
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'Não foi possível remover a placa.'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddPet = async () => {
    if (!isOwner) {
      return;
    }

    if (!resolvedHouseId) {
      Alert.alert('Selecione uma casa', 'Escolha uma casa antes de adicionar pet.');
      return;
    }

    const nome = petName.trim();
    const especie = petSpecies.trim();
    const raca = petBreed.trim();

    if (!nome || !especie) {
      Alert.alert('Campos obrigatórios', 'Informe nome e espécie do pet.');
      return;
    }

    try {
      setActionLoading('addPet');
      const nextPets = [
        ...(house?.pets ?? []),
        {
          nome,
          especie,
          ...(raca ? { raca } : {}),
        },
      ];
      await withTimeout(updateHousePets(resolvedHouseId, nextPets));
      await withTimeout(loadHouseDetails(resolvedHouseId));
      setPetName('');
      setPetSpecies('');
      setPetBreed('');
      Alert.alert('Sucesso', 'Pet adicionado com sucesso.');
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'Não foi possível cadastrar o pet.'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemovePet = async (indexToRemove: number) => {
    if (!isOwner || !resolvedHouseId) {
      return;
    }

    try {
      setActionLoading('removePet');
      const nextPets = (house?.pets ?? []).filter((_, index) => index !== indexToRemove);
      await withTimeout(updateHousePets(resolvedHouseId, nextPets));
      await withTimeout(loadHouseDetails(resolvedHouseId));
    } catch (error) {
      Alert.alert('Erro', errorMessage(error, 'Não foi possível remover o pet.'));
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
              <AppSelect
                label="Casa"
                value={selectedHouseId ?? houses[0].id}
                onChange={(value) => {
                  setSelectedHouseId(value);
                  void loadHouseDetails(value);
                }}
                options={houses.map((item) => ({ label: item.nome || item.id, value: item.id }))}
              />
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
            <Text style={styles.ownerExtraFieldsTitle}>Dados importantes (proprietário)</Text>
            <AppInput
              label="CPF"
              value={residentCpf}
              onChangeText={setResidentCpf}
              placeholder="Somente números"
              keyboardType="numeric"
            />
            <AppInput
              label="Telefone"
              value={residentPhone}
              onChangeText={setResidentPhone}
              placeholder="(DDD) 9xxxx-xxxx"
              keyboardType="phone-pad"
            />
            <AppInput
              label="E-mail"
              value={residentEmail}
              onChangeText={setResidentEmail}
              placeholder="morador@email.com"
              keyboardType="email-address"
            />
            <AppInput
              label="Parentesco / vínculo"
              value={residentRelation}
              onChangeText={setResidentRelation}
              placeholder="Ex: titular, cônjuge, filho"
            />
            <AppInput
              label="Data de nascimento"
              value={residentBirthDate}
              onChangeText={setResidentBirthDate}
              placeholder="dd/mm/aaaa"
            />
            <AppInput
              label="Observações"
              value={residentNotes}
              onChangeText={setResidentNotes}
              placeholder="Informações úteis sobre o morador"
              multiline
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
              <Text style={styles.itemText}>Contato: {morador.contato ?? morador.telefone ?? morador.email ?? 'Sem contato'}</Text>
              {isOwner && morador.cpf ? <Text style={styles.itemText}>CPF: {formatCpf(morador.cpf)}</Text> : null}
              {isOwner && morador.telefone ? <Text style={styles.itemText}>Telefone: {morador.telefone}</Text> : null}
              {isOwner && morador.email ? <Text style={styles.itemText}>E-mail: {morador.email}</Text> : null}
              {isOwner && morador.parentesco ? <Text style={styles.itemText}>Vínculo: {morador.parentesco}</Text> : null}
              {isOwner && morador.dataNascimento ? (
                <Text style={styles.itemText}>Nascimento: {morador.dataNascimento}</Text>
              ) : null}
              {isOwner && morador.observacoes ? (
                <Text style={styles.itemText}>Observações: {morador.observacoes}</Text>
              ) : null}
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
        {isOwner ? (
          <View style={styles.residentForm}>
            <AppInput
              label="Placa do veículo"
              value={vehiclePlate}
              onChangeText={setVehiclePlate}
              placeholder="Ex: ABC1D23"
            />
            <AppButton
              label="Adicionar placa"
              onPress={handleAddVehicle}
              loading={actionLoading === 'addVehicle'}
            />
          </View>
        ) : null}

        {house?.veiculos?.length ? (
          house.veiculos.map((placa, index) => (
            <View key={`${placa}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemTitle}>{placa}</Text>
              {isOwner ? (
                <Pressable onPress={() => handleRemoveVehicle(index)} style={styles.removeResidentButton}>
                  <Text style={styles.removeResidentText}>Remover</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.infoLine}>Placas: Não informado</Text>
        )}

        {isOwner ? (
          <View style={styles.residentForm}>
            <AppInput
              label="Nome do pet"
              value={petName}
              onChangeText={setPetName}
              placeholder="Ex: Thor"
            />
            <AppInput
              label="Espécie"
              value={petSpecies}
              onChangeText={setPetSpecies}
              placeholder="Ex: Cão"
            />
            <AppInput
              label="Raça (opcional)"
              value={petBreed}
              onChangeText={setPetBreed}
              placeholder="Ex: Shih-tzu"
            />
            <AppButton
              label="Adicionar pet"
              onPress={handleAddPet}
              loading={actionLoading === 'addPet'}
            />
          </View>
        ) : null}

        {house?.pets?.length ? (
          house.pets.map((pet, index) => (
            <View key={`${pet.nome}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemTitle}>{pet.nome}</Text>
              <Text style={styles.itemText}>Espécie: {pet.especie}</Text>
              {pet.raca ? <Text style={styles.itemText}>Raça: {pet.raca}</Text> : null}
              {isOwner ? (
                <Pressable onPress={() => handleRemovePet(index)} style={styles.removeResidentButton}>
                  <Text style={styles.removeResidentText}>Remover</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.infoLine}>Pets: Não informado</Text>
        )}
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
    fontSize: 17,
    fontWeight: '800',
    color: palette.gray900,
    textTransform: 'uppercase',
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
  ownerExtraFieldsTitle: {
    color: palette.gray900,
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.xs,
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
    fontSize: 14,
  },
  removeResidentButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  removeResidentText: {
    color: palette.danger,
    fontWeight: '700',
    fontSize: 14,
  },
  docRow: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
});
