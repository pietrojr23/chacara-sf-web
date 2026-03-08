import { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { AppButton } from '../../components/AppButton';
import { AppInput } from '../../components/AppInput';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { createTicket, getAllHouses, getHouseProfile } from '../../services/firestoreService';
import { uploadImageAsync } from '../../services/storageService';
import { TicketCategory, TicketUrgency } from '../../types/models';
import { RootStackParamList } from '../../types/navigation';
import { getFileExtension, getFileNameFromPath, inferFileKind } from '../../utils/file';

const categories: TicketCategory[] = ['Eletrica', 'Hidraulica', 'Estrutural', 'Paisagismo', 'Outro'];
const urgencies: TicketUrgency[] = ['Baixa', 'Media', 'Alta', 'Emergencia'];

type Props = NativeStackScreenProps<RootStackParamList, 'TicketForm'>;

interface SelectedAttachment {
  uri: string;
  name: string;
}

export const TicketFormScreen = ({ navigation }: Props) => {
  const { profile } = useAuth();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState<TicketCategory>('Hidraulica');
  const [urgencia, setUrgencia] = useState<TicketUrgency>('Media');
  const [houseId, setHouseId] = useState<string>(profile?.casaId ?? '');
  const [houseName, setHouseName] = useState<string>('');
  const [houseOptions, setHouseOptions] = useState<Array<{ id: string; nome: string }>>([]);
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([]);
  const [actionLoading, setActionLoading] = useState<null | 'pickAttachments' | 'submit'>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  const loadHouse = useCallback(async () => {
    if (!profile) {
      return;
    }

    if (isOwner) {
      const houses = await getAllHouses();
      setHouseOptions(houses.map((item) => ({ id: item.id, nome: item.nome })));

      if (!houseId && houses.length) {
        setHouseId(houses[0].id);
        setHouseName(houses[0].nome);
      }
    } else if (profile.casaId) {
      const house = await getHouseProfile(profile.casaId);
      if (house) {
        setHouseName(house.nome);
        setHouseId(house.id);
      }
    }
  }, [houseId, isOwner, profile]);

  useFocusEffect(
    useCallback(() => {
      void loadHouse();
      return undefined;
    }, [dataVersion, loadHouse]),
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadHouse().finally(() => {
      setRefreshing(false);
    });
  }, [loadHouse]);

  const handlePickAttachments = async () => {
    if (attachments.length >= 5) {
      Alert.alert('Limite atingido', 'Máximo de 5 arquivos por chamado.');
      return;
    }

    try {
      setActionLoading('pickAttachments');
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      setAttachments((current) => {
        const picked = result.assets.map((asset, index) => ({
          uri: asset.uri,
          name: asset.name || `arquivo-${Date.now()}-${index + 1}`,
        }));

        return [...current, ...picked].slice(0, 5);
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível selecionar arquivos.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmit = async () => {
    if (!profile) {
      return;
    }

    if (!titulo.trim() || !descricao.trim() || !houseId) {
      Alert.alert('Campos obrigatórios', 'Preencha título, descrição e casa de origem.');
      return;
    }

    try {
      setActionLoading('submit');

      const uploadedUrls = await withTimeout(
        Promise.all(
          attachments.map((item, index) => {
            const ext = getFileExtension(item.name) || getFileExtension(item.uri) || 'bin';
            const filename = `${Date.now()}-${index + 1}.${ext}`;
            return uploadImageAsync(item.uri, `chamados/${profile.id}/${filename}`);
          }),
        ),
      );

      await withTimeout(
        createTicket({
          titulo: titulo.trim(),
          descricao: descricao.trim(),
          categoria,
          urgencia,
          status: 'Pendente',
          casaId: houseId,
          casaNome: isOwner ? houseOptions.find((item) => item.id === houseId)?.nome ?? houseName : houseName,
          criadorId: profile.id,
          criadorNome: profile.nome,
          fotos: uploadedUrls,
          criadoEm: new Date().toISOString(),
        }),
      );

      Alert.alert('Chamado aberto', 'Seu chamado foi registrado e o proprietário recebeu notificação.');
      navigation.goBack();
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A criação do chamado demorou demais para responder. Tente novamente.'
          : 'Não foi possível abrir o chamado.',
      );
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={handleRefresh}>
      <SectionHeader title="Novo chamado" subtitle="Registre problemas para manutenção da propriedade" />

      <AppInput label="Título" value={titulo} onChangeText={setTitulo} placeholder="Ex: Vazamento na cozinha" />

      <AppInput
        label="Descrição detalhada"
        value={descricao}
        onChangeText={setDescricao}
        placeholder="Descreva o problema e contexto"
        multiline
      />

      <View style={styles.group}>
        <Text style={styles.label}>Categoria</Text>
        <View style={styles.chips}>
          {categories.map((item) => (
            <Pressable
              key={item}
              style={[styles.chip, categoria === item && styles.chipActive]}
              onPress={() => setCategoria(item)}
            >
              <Text style={[styles.chipText, categoria === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Urgência</Text>
        <View style={styles.chips}>
          {urgencies.map((item) => (
            <Pressable
              key={item}
              style={[styles.chip, urgencia === item && styles.chipActive]}
              onPress={() => setUrgencia(item)}
            >
              <Text style={[styles.chipText, urgencia === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Casa de origem</Text>

        {isOwner ? (
          <View style={styles.chips}>
            {houseOptions.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.chip, houseId === item.id && styles.chipActive]}
                onPress={() => {
                  setHouseId(item.id);
                  setHouseName(item.nome);
                }}
              >
                <Text style={[styles.chipText, houseId === item.id && styles.chipTextActive]}>{item.nome}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.houseText}>{houseName || profile?.casaId || 'Casa não vinculada'}</Text>
        )}
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Arquivos (até 5: foto, vídeo, PDF, etc.)</Text>
        <AppButton
          label="Selecionar arquivos"
          variant="ghost"
          onPress={handlePickAttachments}
          loading={actionLoading === 'pickAttachments'}
        />

        {attachments.length ? (
          <View style={styles.photoList}>
            {attachments.map((item) => {
              const kind = inferFileKind(item.name || item.uri);
              return kind === 'image' ? (
                <Image key={item.uri} source={{ uri: item.uri }} style={styles.photo} />
              ) : (
                <Pressable key={item.uri} style={styles.fileChip} onPress={() => Linking.openURL(item.uri)}>
                  <Text style={styles.fileChipText}>{getFileNameFromPath(item.name, 'Arquivo')}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <AppButton label="Abrir chamado" onPress={handleSubmit} loading={actionLoading === 'submit'} />
      <AppButton label="Cancelar" variant="ghost" onPress={() => navigation.goBack()} />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  label: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '700',
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
    backgroundColor: palette.greenDark,
    borderColor: palette.greenDark,
  },
  chipText: {
    color: palette.gray900,
    fontWeight: '700',
    fontSize: 12,
  },
  chipTextActive: {
    color: palette.white,
  },
  houseText: {
    color: palette.gray900,
    fontWeight: '700',
    fontSize: 15,
  },
  photoList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photo: {
    width: 90,
    height: 90,
    borderRadius: radii.md,
  },
  fileChip: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    maxWidth: 170,
  },
  fileChipText: {
    color: palette.gray700,
    fontSize: 12,
    fontWeight: '700',
  },
});
