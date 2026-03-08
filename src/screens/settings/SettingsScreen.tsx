import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppInput } from '../../components/AppInput';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { palette, radii, spacing } from '../../constants/theme';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import { createTenantByOwner, resetTenantPasswordByOwner, setTenantStatusByOwner } from '../../services/authService';
import { getAllHouses, getAllUsers, updateUserProfile } from '../../services/firestoreService';
import { uploadImageAsync } from '../../services/storageService';
import { AppUser, House } from '../../types/models';

export const SettingsScreen = () => {
  const { profile, signOut, refreshProfile } = useAuth();
  const { config, saveConfig } = useAppConfig();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [actionLoading, setActionLoading] = useState<
    | null
    | 'loadOwnerData'
    | 'saveConfig'
    | 'saveOwnPhoto'
    | 'createTenant'
    | `saveUserPhoto:${string}`
    | `toggleTenant:${string}`
    | `resetTenant:${string}`
  >(null);

  const [propertyName, setPropertyName] = useState(config.propriedadeNome);
  const [coverPhoto, setCoverPhoto] = useState(config.fotoCapaUrl ?? '');
  const [pixKey, setPixKey] = useState(config.chavePix);
  const [gateWebhook, setGateWebhook] = useState(config.gateWebhookUrl ?? '');
  const [gateCloseWebhook, setGateCloseWebhook] = useState(config.gateCloseWebhookUrl ?? '');
  const [tarifaEnergia, setTarifaEnergia] = useState(String(config.tarifaEnergia ?? 0));
  const [latitude, setLatitude] = useState(String(config.latitude ?? -23.55052));
  const [longitude, setLongitude] = useState(String(config.longitude ?? -46.633308));
  const [temaEscuroAtivo, setTemaEscuroAtivo] = useState(config.temaEscuroAtivo);

  const [notifications, setNotifications] = useState(config.notificacoes);

  const [houses, setHouses] = useState<House[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);

  const [tenantName, setTenantName] = useState('');
  const [tenantEmail, setTenantEmail] = useState('');
  const [tenantPhone, setTenantPhone] = useState('');
  const [tenantPassword, setTenantPassword] = useState('');
  const [tenantHouseId, setTenantHouseId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [accountPhoto, setAccountPhoto] = useState(profile?.photoURL ?? '');

  const withTimeout = useCallback(<T,>(promise: Promise<T>, timeoutMs = 12000): Promise<T> =>
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
    }), []);

  const asErrorMessage = (fallback: string, error: unknown) => {
    const code = String((error as { code?: unknown } | undefined)?.code ?? '');
    const message = String((error as { message?: unknown } | undefined)?.message ?? '');
    if (code === 'operation-timeout') {
      return 'A operação demorou demais para responder. Tente novamente.';
    }

    if (code === 'over_email_send_rate_limit') {
      return 'Limite de envio de e-mail do Supabase atingido. Aguarde alguns minutos e tente novamente.';
    }

    if (code === 'email_address_invalid') {
      return 'E-mail inválido. Use um e-mail real e válido.';
    }

    if (code === 'user_already_exists') {
      return 'Já existe uma conta com esse e-mail.';
    }

    if (code === 'supabase-rls-block' || /row-level security/i.test(message)) {
      return 'Permissão bloqueada no Supabase (RLS). Rode novamente o bootstrap.sql no SQL Editor.';
    }

    if (message.trim()) {
      return message;
    }

    return fallback;
  };

  const loadOwnerData = useCallback(
    async (showAlerts = true) => {
      if (!isOwner) {
        return;
      }

      try {
        setActionLoading('loadOwnerData');
        const [housesResult, usersResult] = await Promise.allSettled([
          withTimeout(getAllHouses()),
          withTimeout(getAllUsers()),
        ]);

        if (housesResult.status === 'fulfilled') {
          const nextHouses = housesResult.value;
          setHouses(nextHouses);
          setTenantHouseId((current) => {
            if (current && nextHouses.some((house) => house.id === current)) {
              return current;
            }

            return nextHouses[0]?.id ?? '';
          });
        } else {
          setHouses([]);
        }

        if (usersResult.status === 'fulfilled') {
          setUsers(usersResult.value);
        } else {
          setUsers([]);
        }

        if (showAlerts) {
          if (housesResult.status === 'rejected' && usersResult.status === 'rejected') {
            Alert.alert('Erro', 'Não foi possível carregar casas e usuários.');
          } else if (housesResult.status === 'rejected') {
            Alert.alert('Erro', 'Não foi possível carregar as casas.');
          } else if (usersResult.status === 'rejected') {
            Alert.alert('Aviso', 'As casas foram carregadas, mas os usuários não puderam ser atualizados agora.');
          }
        }
      } finally {
        setActionLoading(null);
      }
    },
    [isOwner, withTimeout],
  );

  useFocusEffect(
    useCallback(() => {
      if (!isOwner) {
        return undefined;
      }

      void loadOwnerData(false);
      return undefined;
    }, [dataVersion, isOwner, loadOwnerData]),
  );

  const handleRefresh = useCallback(() => {
    if (!isOwner) {
      return;
    }

    setRefreshing(true);
    void loadOwnerData(false).finally(() => {
      setRefreshing(false);
    });
  }, [isOwner, loadOwnerData]);

  useEffect(() => {
    setPropertyName(config.propriedadeNome);
    setCoverPhoto(config.fotoCapaUrl ?? '');
    setPixKey(config.chavePix);
    setGateWebhook(config.gateWebhookUrl ?? '');
    setGateCloseWebhook(config.gateCloseWebhookUrl ?? '');
    setTarifaEnergia(String(config.tarifaEnergia ?? 0));
    setLatitude(String(config.latitude ?? -23.55052));
    setLongitude(String(config.longitude ?? -46.633308));
    setNotifications(config.notificacoes);
    setTemaEscuroAtivo(config.temaEscuroAtivo);
  }, [config]);

  useEffect(() => {
    setAccountPhoto(profile?.photoURL ?? '');
  }, [profile?.photoURL]);

  const tenantUsers = useMemo(() => users.filter((user) => !user.isOwner), [users]);

  const pickImageFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permissão necessária', 'Permita acesso à galeria para selecionar a foto.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (result.canceled) {
      return null;
    }

    return result.assets[0].uri;
  }, []);

  const pickCoverPhoto = async () => {
    const uri = await pickImageFromLibrary();
    if (!uri) {
      return;
    }

    setCoverPhoto(uri);
  };

  const pickAccountPhoto = async () => {
    const uri = await pickImageFromLibrary();
    if (!uri) {
      return;
    }

    setAccountPhoto(uri);
  };

  const saveAccountPhoto = async () => {
    if (!profile) {
      return;
    }

    try {
      setActionLoading('saveOwnPhoto');

      const trimmed = accountPhoto.trim();
      let photoUrl: string | null = null;

      if (trimmed) {
        photoUrl = trimmed.startsWith('http')
          ? trimmed
          : await withTimeout(uploadImageAsync(trimmed, `users/${profile.id}/avatar-${Date.now()}.jpg`));
      }

      await withTimeout(updateUserProfile(profile.id, { photoURL: photoUrl }));
      await refreshProfile();
      Alert.alert('Foto atualizada', 'A foto da sua conta foi salva com sucesso.');
    } catch (error) {
      Alert.alert('Erro', asErrorMessage('Não foi possível salvar a foto da conta.', error));
    } finally {
      setActionLoading(null);
    }
  };

  const saveTenantPhoto = async (user: AppUser) => {
    try {
      const uri = await pickImageFromLibrary();
      if (!uri) {
        return;
      }

      setActionLoading(`saveUserPhoto:${user.id}`);
      const uploaded = await withTimeout(uploadImageAsync(uri, `users/${user.id}/avatar-${Date.now()}.jpg`));
      await withTimeout(updateUserProfile(user.id, { photoURL: uploaded }));
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, photoURL: uploaded } : item)));
      Alert.alert('Foto atualizada', `Foto da conta de ${user.nome} atualizada com sucesso.`);
    } catch (error) {
      Alert.alert('Erro', asErrorMessage('Não foi possível atualizar a foto do usuário.', error));
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setActionLoading('saveConfig');

      let coverUrl = coverPhoto;
      if (coverPhoto && !coverPhoto.startsWith('http')) {
        coverUrl = await withTimeout(uploadImageAsync(coverPhoto, `configuracoes/capa-${Date.now()}.jpg`));
      }

      await withTimeout(
        saveConfig({
          propriedadeNome: propertyName.trim() || config.propriedadeNome,
          fotoCapaUrl: coverUrl,
          chavePix: pixKey.trim(),
          gateWebhookUrl: gateWebhook.trim(),
          gateCloseWebhookUrl: gateCloseWebhook.trim(),
          tarifaEnergia: Number(tarifaEnergia.replace(',', '.')) || 0,
          latitude: Number(latitude) || 0,
          longitude: Number(longitude) || 0,
          temaEscuroAtivo,
          notificacoes: notifications,
        }),
      );

      Alert.alert('Configurações salvas', 'As alterações foram aplicadas com sucesso.');
    } catch (error) {
      Alert.alert('Erro', asErrorMessage('Não foi possível salvar as configurações.', error));
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateTenant = async () => {
    if (!tenantName.trim() || !tenantEmail.trim() || !tenantPassword.trim() || !tenantHouseId) {
      Alert.alert('Campos obrigatórios', 'Preencha nome, e-mail, senha temporária e casa.');
      return;
    }

    try {
      setActionLoading('createTenant');
      await withTimeout(
        createTenantByOwner({
          nome: tenantName.trim(),
          email: tenantEmail.trim(),
          senhaTemporaria: tenantPassword,
          telefone: tenantPhone.trim() || undefined,
          casaId: tenantHouseId,
        }),
        45000,
      );

      setTenantName('');
      setTenantEmail('');
      setTenantPhone('');
      setTenantPassword('');

      try {
        const usersResult = await withTimeout(getAllUsers(), 20000);
        setUsers(usersResult);
      } catch {
        // A conta pode ter sido criada mesmo sem conseguir recarregar a lista imediatamente.
      }

      Alert.alert('Inquilino criado', 'Conta vinculada à casa selecionada com sucesso.');
    } catch (error) {
      Alert.alert('Erro', asErrorMessage('Não foi possível criar a conta do inquilino.', error));
    } finally {
      setActionLoading(null);
    }
  };

  const toggleTenantStatus = async (user: AppUser) => {
    try {
      setActionLoading(`toggleTenant:${user.id}`);
      await withTimeout(setTenantStatusByOwner(user.id, !user.ativo));
      setUsers((current) =>
        current.map((item) => (item.id === user.id ? { ...item, ativo: !user.ativo } : item)),
      );

      try {
        setUsers(await withTimeout(getAllUsers(), 20000));
      } catch {
        // Mantém estado otimista se o refresh falhar.
      }
    } catch (error) {
      Alert.alert('Erro', asErrorMessage('Falha ao atualizar status do usuário.', error));
    } finally {
      setActionLoading(null);
    }
  };

  const resetTenantPassword = async (user: AppUser) => {
    try {
      setActionLoading(`resetTenant:${user.id}`);
      await withTimeout(resetTenantPasswordByOwner(user.id));
      Alert.alert('Senha resetada', 'Foi enviado um e-mail de redefinição para o inquilino.');
    } catch (error) {
      Alert.alert('Erro', asErrorMessage('Não foi possível resetar a senha.', error));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <ScreenContainer refreshing={refreshing} onRefresh={isOwner ? handleRefresh : undefined}>
      <SectionHeader title="Configurações" subtitle="Personalize a chácara e configure integrações" />

      <AppCard>
        <Text style={styles.cardTitle}>Minha conta</Text>
        <View style={styles.accountRow}>
          <View style={styles.accountAvatar}>
            {accountPhoto ? (
              <Image source={{ uri: accountPhoto }} style={styles.accountAvatarImage} />
            ) : (
              <MaterialIcons name="person" size={28} color={palette.gray700} />
            )}
          </View>
          <View style={styles.accountMeta}>
            <Text style={styles.userName}>{profile?.nome ?? 'Usuário'}</Text>
            <Text style={styles.userMeta}>{profile?.email ?? '-'}</Text>
          </View>
        </View>
        <AppButton label="Selecionar foto da conta" variant="ghost" onPress={pickAccountPhoto} />
        <AppButton
          label="Salvar foto da conta"
          onPress={saveAccountPhoto}
          loading={actionLoading === 'saveOwnPhoto'}
        />
      </AppCard>

      <AppCard>
        <Text style={styles.cardTitle}>Geral</Text>
        <AppInput
          label="Nome da propriedade"
          value={propertyName}
          onChangeText={setPropertyName}
          editable={isOwner}
        />
        <AppInput
          label="Chave Pix"
          value={pixKey}
          onChangeText={setPixKey}
          placeholder="Pix para aluguel"
          editable={isOwner}
        />
        <AppInput
          label="Tarifa da energia (R$/kWh)"
          value={tarifaEnergia}
          onChangeText={setTarifaEnergia}
          keyboardType="numeric"
          editable={isOwner}
        />

        <Text style={styles.label}>Foto de capa da propriedade</Text>
        <AppButton label="Selecionar foto" variant="ghost" onPress={pickCoverPhoto} disabled={!isOwner} />
        {!isOwner ? <Text style={styles.readOnlyHint}>Somente leitura para inquilinos.</Text> : null}
        {coverPhoto ? <Image source={{ uri: coverPhoto }} style={styles.coverPreview} /> : null}
      </AppCard>

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Webhooks e localização</Text>
          <AppInput
            label="Webhook abrir portão"
            value={gateWebhook}
            onChangeText={setGateWebhook}
            placeholder="https://..."
          />
          <AppInput
            label="Webhook fechar portão"
            value={gateCloseWebhook}
            onChangeText={setGateCloseWebhook}
            placeholder="https://..."
          />
          <AppInput label="Latitude" value={latitude} onChangeText={setLatitude} keyboardType="numeric" />
          <AppInput label="Longitude" value={longitude} onChangeText={setLongitude} keyboardType="numeric" />
        </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.cardTitle}>Tema e notificações</Text>

        <ToggleRow label="Tema escuro" value={temaEscuroAtivo} onChange={setTemaEscuroAtivo} />

        <ToggleRow
          label="Avisos"
          value={notifications.avisos}
          onChange={(value) => setNotifications((state) => ({ ...state, avisos: value }))}
        />
        <ToggleRow
          label="Chamados"
          value={notifications.chamados}
          onChange={(value) => setNotifications((state) => ({ ...state, chamados: value }))}
        />
        <ToggleRow
          label="Financeiro"
          value={notifications.financeiro}
          onChange={(value) => setNotifications((state) => ({ ...state, financeiro: value }))}
        />
        <ToggleRow
          label="Chat"
          value={notifications.chat}
          onChange={(value) => setNotifications((state) => ({ ...state, chat: value }))}
        />
        <ToggleRow
          label="Visitantes"
          value={notifications.visitantes}
          onChange={(value) => setNotifications((state) => ({ ...state, visitantes: value }))}
        />
      </AppCard>

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Gerenciamento de usuários</Text>
          <AppInput label="Nome do inquilino" value={tenantName} onChangeText={setTenantName} />
          <AppInput label="E-mail" value={tenantEmail} onChangeText={setTenantEmail} keyboardType="email-address" />
          <AppInput label="Telefone" value={tenantPhone} onChangeText={setTenantPhone} keyboardType="phone-pad" />
          <AppInput
            label="Senha temporária"
            value={tenantPassword}
            onChangeText={setTenantPassword}
            secureTextEntry
          />

          <Text style={styles.label}>Casa vinculada</Text>
          {houses.length ? (
            <View style={styles.chips}>
              {houses.map((house) => (
                <Pressable
                  key={house.id}
                  style={[styles.chip, tenantHouseId === house.id && styles.chipActive]}
                  onPress={() => setTenantHouseId(house.id)}
                >
                  <Text style={[styles.chipText, tenantHouseId === house.id && styles.chipTextActive]}>
                    {house.nome || house.id}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              <EmptyState
                title="Nenhuma casa carregada"
                subtitle="Toque em recarregar para buscar as casas novamente."
              />
              <AppButton
                label="Recarregar casas"
                variant="ghost"
                onPress={() => loadOwnerData(true)}
                loading={actionLoading === 'loadOwnerData'}
              />
            </>
          )}

          <AppButton
            label="Criar conta de inquilino"
            onPress={handleCreateTenant}
            loading={actionLoading === 'createTenant'}
          />

          {tenantUsers.length ? (
            tenantUsers.map((user) => (
              <View key={user.id} style={styles.userCard}>
                <View style={styles.tenantRow}>
                  <View style={styles.tenantAvatar}>
                    {user.photoURL ? (
                      <Image source={{ uri: user.photoURL }} style={styles.tenantAvatarImage} />
                    ) : (
                      <MaterialIcons name="person" size={18} color={palette.gray700} />
                    )}
                  </View>
                  <View style={styles.tenantMeta}>
                    <Text style={styles.userName}>{user.nome}</Text>
                    <Text style={styles.userMeta}>{user.email}</Text>
                    <Text style={styles.userMeta}>Casa: {user.casaId ?? '-'}</Text>
                  </View>
                </View>
                <View style={styles.userActions}>
                  <AppButton
                    label="Foto da conta"
                    variant="ghost"
                    onPress={() => saveTenantPhoto(user)}
                    loading={actionLoading === `saveUserPhoto:${user.id}`}
                  />
                  <AppButton
                    label={user.ativo ? 'Desativar conta' : 'Reativar conta'}
                    variant={user.ativo ? 'danger' : 'secondary'}
                    onPress={() => toggleTenantStatus(user)}
                    loading={actionLoading === `toggleTenant:${user.id}`}
                  />
                  <AppButton
                    label="Resetar senha"
                    variant="ghost"
                    onPress={() => resetTenantPassword(user)}
                    loading={actionLoading === `resetTenant:${user.id}`}
                  />
                </View>
              </View>
            ))
          ) : (
            <EmptyState title="Sem inquilinos" subtitle="Crie contas para vincular às casas da propriedade." />
          )}
        </AppCard>
      ) : null}

      <AppCard>
        <AppButton label="Salvar configurações" onPress={handleSaveConfig} loading={actionLoading === 'saveConfig'} />
        <AppButton label="Sair da conta" variant="ghost" onPress={signOut} />
      </AppCard>
    </ScreenContainer>
  );
};

const ToggleRow = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) => (
  <View style={styles.toggleRow}>
    <Text style={styles.toggleLabel}>{label}</Text>
    <Switch value={value} onValueChange={onChange} trackColor={{ true: palette.greenLight }} thumbColor={palette.white} />
  </View>
);

const styles = StyleSheet.create({
  cardTitle: {
    color: palette.gray900,
    fontSize: 16,
    fontWeight: '800',
  },
  label: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '700',
  },
  coverPreview: {
    width: '100%',
    height: 170,
    borderRadius: radii.md,
  },
  readOnlyHint: {
    color: palette.gray500,
    fontSize: 12,
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
    paddingVertical: spacing.sm,
  },
  toggleLabel: {
    color: palette.gray900,
    fontSize: 14,
    fontWeight: '600',
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
    fontSize: 12,
  },
  chipTextActive: {
    color: palette.white,
  },
  userCard: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  accountAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: palette.gray300,
    backgroundColor: palette.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  accountAvatarImage: {
    width: '100%',
    height: '100%',
  },
  accountMeta: {
    flex: 1,
    gap: 2,
  },
  tenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tenantAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.gray300,
    backgroundColor: palette.gray100,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tenantAvatarImage: {
    width: '100%',
    height: '100%',
  },
  tenantMeta: {
    flex: 1,
    gap: 1,
  },
  userName: {
    color: palette.gray900,
    fontWeight: '800',
    fontSize: 15,
  },
  userMeta: {
    color: palette.gray700,
    fontSize: 13,
  },
  userActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
