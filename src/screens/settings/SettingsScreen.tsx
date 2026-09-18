import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppCheckbox } from '../../components/AppCheckbox';
import { AppInput } from '../../components/AppInput';
import { AppSelect } from '../../components/AppSelect';
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
import { AppUser, GateHouseAccessRule, House } from '../../types/models';

type EditableGateHouseRule = {
  houseId: string;
  houseName: string;
  enabled: boolean;
  windowStart: string;
  windowEnd: string;
  cooldownSeconds: string;
  maxOpensPerDay: string;
  requireProximity: boolean;
  maxDistanceMeters: string;
  requireBiometric: boolean;
  accessPin: string;
};

const normalizeHm = (raw: unknown, fallback: string) => {
  const text = String(raw ?? '').trim();
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(text) ? text : fallback;
};

const toIntString = (value: unknown, fallback: number, min = 0) => {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? Math.max(min, Math.trunc(parsed)) : fallback;
  return String(safe);
};

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
  const [tarifaEnergia, setTarifaEnergia] = useState(String(config.tarifaEnergia ?? 0));
  const [latitude, setLatitude] = useState(String(config.latitude ?? -23.55052));
  const [longitude, setLongitude] = useState(String(config.longitude ?? -46.633308));

  const [notifications, setNotifications] = useState(config.notificacoes);
  const [tenantGateAccessEnabled, setTenantGateAccessEnabled] = useState(config.tenantGateAccess?.enabled ?? true);
  const [tenantGateWindowStart, setTenantGateWindowStart] = useState(
    normalizeHm(config.tenantGateAccess?.defaultWindowStart, '06:00'),
  );
  const [tenantGateWindowEnd, setTenantGateWindowEnd] = useState(
    normalizeHm(config.tenantGateAccess?.defaultWindowEnd, '23:00'),
  );
  const [tenantGateCooldownSeconds, setTenantGateCooldownSeconds] = useState(
    toIntString(config.tenantGateAccess?.defaultCooldownSeconds, 30, 0),
  );
  const [tenantGateMaxOpensPerDay, setTenantGateMaxOpensPerDay] = useState(
    toIntString(config.tenantGateAccess?.defaultMaxOpensPerDay, 10, 1),
  );
  const [tenantGateRequireProximity, setTenantGateRequireProximity] = useState(
    config.tenantGateAccess?.defaultRequireProximity ?? true,
  );
  const [tenantGateMaxDistanceMeters, setTenantGateMaxDistanceMeters] = useState(
    toIntString(config.tenantGateAccess?.defaultMaxDistanceMeters, 200, 20),
  );
  const [tenantGateRequireBiometric, setTenantGateRequireBiometric] = useState(
    config.tenantGateAccess?.defaultRequireBiometric ?? true,
  );
  const [houseGateRules, setHouseGateRules] = useState<EditableGateHouseRule[]>([]);

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
    const tenantGate = config.tenantGateAccess;
    setPropertyName(config.propriedadeNome);
    setCoverPhoto(config.fotoCapaUrl ?? '');
    setPixKey(config.chavePix);
    setGateWebhook(config.gateWebhookUrl ?? config.gateCloseWebhookUrl ?? '');
    setTarifaEnergia(String(config.tarifaEnergia ?? 0));
    setLatitude(String(config.latitude ?? -23.55052));
    setLongitude(String(config.longitude ?? -46.633308));
    setNotifications(config.notificacoes);
    setTenantGateAccessEnabled(tenantGate?.enabled ?? true);
    setTenantGateWindowStart(normalizeHm(tenantGate?.defaultWindowStart, '06:00'));
    setTenantGateWindowEnd(normalizeHm(tenantGate?.defaultWindowEnd, '23:00'));
    setTenantGateCooldownSeconds(toIntString(tenantGate?.defaultCooldownSeconds, 30, 0));
    setTenantGateMaxOpensPerDay(toIntString(tenantGate?.defaultMaxOpensPerDay, 10, 1));
    setTenantGateRequireProximity(tenantGate?.defaultRequireProximity ?? true);
    setTenantGateMaxDistanceMeters(toIntString(tenantGate?.defaultMaxDistanceMeters, 200, 20));
    setTenantGateRequireBiometric(tenantGate?.defaultRequireBiometric ?? true);
  }, [config]);

  useEffect(() => {
    if (!houses.length) {
      setHouseGateRules([]);
      return;
    }

    const tenantGate = config.tenantGateAccess;
    const defaultStart = normalizeHm(tenantGate?.defaultWindowStart, '06:00');
    const defaultEnd = normalizeHm(tenantGate?.defaultWindowEnd, '23:00');
    const defaultCooldown = toIntString(tenantGate?.defaultCooldownSeconds, 30, 0);
    const defaultDailyLimit = toIntString(tenantGate?.defaultMaxOpensPerDay, 10, 1);
    const defaultRequireProximity = tenantGate?.defaultRequireProximity ?? true;
    const defaultMaxDistance = toIntString(tenantGate?.defaultMaxDistanceMeters, 200, 20);
    const defaultRequireBiometric = tenantGate?.defaultRequireBiometric ?? true;

    const ruleMap = new Map<string, GateHouseAccessRule>();
    (tenantGate?.houseRules ?? []).forEach((rule) => {
      const houseId = String(rule.houseId ?? '').trim();
      if (houseId) {
        ruleMap.set(houseId, rule);
      }
    });

    setHouseGateRules(
      houses.map((house) => {
        const houseRule = ruleMap.get(house.id);
        return {
          houseId: house.id,
          houseName: house.nome || house.id,
          enabled: houseRule?.enabled ?? tenantGate?.enabled ?? true,
          windowStart: normalizeHm(houseRule?.windowStart, defaultStart),
          windowEnd: normalizeHm(houseRule?.windowEnd, defaultEnd),
          cooldownSeconds: toIntString(houseRule?.cooldownSeconds, Number(defaultCooldown), 0),
          maxOpensPerDay: toIntString(houseRule?.maxOpensPerDay, Number(defaultDailyLimit), 1),
          requireProximity: houseRule?.requireProximity ?? defaultRequireProximity,
          maxDistanceMeters: toIntString(houseRule?.maxDistanceMeters, Number(defaultMaxDistance), 20),
          requireBiometric: houseRule?.requireBiometric ?? defaultRequireBiometric,
          accessPin: String(houseRule?.accessPin ?? ''),
        };
      }),
    );
  }, [config.tenantGateAccess, houses]);

  useEffect(() => {
    setAccountPhoto(profile?.photoURL ?? '');
  }, [profile?.photoURL]);

  const tenantUsers = useMemo(() => users.filter((user) => !user.isOwner), [users]);

  const updateHouseGateRule = useCallback((houseId: string, patch: Partial<EditableGateHouseRule>) => {
    setHouseGateRules((current) =>
      current.map((item) => (item.houseId === houseId ? { ...item, ...patch } : item)),
    );
  }, []);

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
    if (!isOwner) {
      Alert.alert('Sem permissão', 'Somente o proprietário pode alterar configurações globais.');
      return;
    }

    try {
      setActionLoading('saveConfig');

      let coverUrl = coverPhoto;
      if (coverPhoto && !coverPhoto.startsWith('http')) {
        coverUrl = await withTimeout(uploadImageAsync(coverPhoto, `configuracoes/capa-${Date.now()}.jpg`));
      }

      const parsedDefaultCooldown = Math.max(0, Math.trunc(Number(tenantGateCooldownSeconds) || 0));
      const parsedDefaultDailyLimit = Math.max(1, Math.trunc(Number(tenantGateMaxOpensPerDay) || 1));
      const parsedDefaultDistance = Math.max(20, Math.trunc(Number(tenantGateMaxDistanceMeters) || 20));
      const houseRulesPayload: GateHouseAccessRule[] = houseGateRules.map((rule) => ({
        houseId: rule.houseId,
        enabled: rule.enabled,
        windowStart: normalizeHm(rule.windowStart, normalizeHm(tenantGateWindowStart, '06:00')),
        windowEnd: normalizeHm(rule.windowEnd, normalizeHm(tenantGateWindowEnd, '23:00')),
        cooldownSeconds: Math.max(0, Math.trunc(Number(rule.cooldownSeconds) || 0)),
        maxOpensPerDay: Math.max(1, Math.trunc(Number(rule.maxOpensPerDay) || 1)),
        requireProximity: rule.requireProximity,
        maxDistanceMeters: Math.max(20, Math.trunc(Number(rule.maxDistanceMeters) || 20)),
        requireBiometric: rule.requireBiometric,
        accessPin: String(rule.accessPin ?? '').replace(/\D/g, '').slice(0, 8),
      }));

      await withTimeout(
        saveConfig({
          propriedadeNome: propertyName.trim() || config.propriedadeNome,
          fotoCapaUrl: coverUrl,
          chavePix: pixKey.trim(),
          gateWebhookUrl: gateWebhook.trim(),
          gateCloseWebhookUrl: gateWebhook.trim(),
          tarifaEnergia: Number(tarifaEnergia.replace(',', '.')) || 0,
          latitude: Number(latitude) || 0,
          longitude: Number(longitude) || 0,
          tenantGateAccess: {
            enabled: tenantGateAccessEnabled,
            defaultWindowStart: normalizeHm(tenantGateWindowStart, '06:00'),
            defaultWindowEnd: normalizeHm(tenantGateWindowEnd, '23:00'),
            defaultCooldownSeconds: parsedDefaultCooldown,
            defaultMaxOpensPerDay: parsedDefaultDailyLimit,
            defaultRequireProximity: tenantGateRequireProximity,
            defaultMaxDistanceMeters: parsedDefaultDistance,
            defaultRequireBiometric: tenantGateRequireBiometric,
            houseRules: houseRulesPayload,
          },
          temaEscuroAtivo: false,
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

      {isOwner ? (
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
          <AppButton label="Selecionar foto" variant="ghost" onPress={pickCoverPhoto} />
          {coverPhoto ? <Image source={{ uri: coverPhoto }} style={styles.coverPreview} /> : null}
        </AppCard>
      ) : null}

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Webhooks e localização</Text>
          <AppInput
            label="Webhook do portão (pulso único)"
            value={gateWebhook}
            onChangeText={setGateWebhook}
            placeholder="http://IP_DO_DISPOSITIVO/gate/open?k=..."
          />
          <Text style={styles.readOnlyHint}>No modo botoeira (MS-111), abrir e fechar usam o mesmo webhook.</Text>
          <AppInput label="Latitude" value={latitude} onChangeText={setLatitude} keyboardType="numeric" />
          <AppInput label="Longitude" value={longitude} onChangeText={setLongitude} keyboardType="numeric" />
        </AppCard>
      ) : null}

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Acesso do portão (inquilinos)</Text>

          <AppCheckbox
            label="Permitir inquilino abrir portão"
            checked={tenantGateAccessEnabled}
            onChange={setTenantGateAccessEnabled}
          />
          <AppInput
            label="Janela de horário (início HH:mm)"
            value={tenantGateWindowStart}
            onChangeText={setTenantGateWindowStart}
            placeholder="06:00"
          />
          <AppInput
            label="Janela de horário (fim HH:mm)"
            value={tenantGateWindowEnd}
            onChangeText={setTenantGateWindowEnd}
            placeholder="23:00"
          />
          <AppInput
            label="Cooldown padrão (segundos)"
            value={tenantGateCooldownSeconds}
            onChangeText={setTenantGateCooldownSeconds}
            keyboardType="numeric"
          />
          <AppInput
            label="Limite diário padrão (aberturas)"
            value={tenantGateMaxOpensPerDay}
            onChangeText={setTenantGateMaxOpensPerDay}
            keyboardType="numeric"
          />
          <AppCheckbox
            label="Exigir proximidade da chácara"
            checked={tenantGateRequireProximity}
            onChange={setTenantGateRequireProximity}
          />
          <AppInput
            label="Raio máximo padrão (metros)"
            value={tenantGateMaxDistanceMeters}
            onChangeText={setTenantGateMaxDistanceMeters}
            keyboardType="numeric"
          />
          <AppCheckbox
            label="Exigir biometria (ou PIN da casa)"
            checked={tenantGateRequireBiometric}
            onChange={setTenantGateRequireBiometric}
          />

          {houseGateRules.length ? (
            houseGateRules.map((rule) => (
              <View key={rule.houseId} style={styles.userCard}>
                <Text style={styles.userName}>{rule.houseName}</Text>
                <AppCheckbox
                  label="Permitir abertura nesta casa"
                  checked={rule.enabled}
                  onChange={(value) => updateHouseGateRule(rule.houseId, { enabled: value })}
                />
                <AppInput
                  label="Horário início (HH:mm)"
                  value={rule.windowStart}
                  onChangeText={(value) => updateHouseGateRule(rule.houseId, { windowStart: value })}
                  placeholder="06:00"
                />
                <AppInput
                  label="Horário fim (HH:mm)"
                  value={rule.windowEnd}
                  onChangeText={(value) => updateHouseGateRule(rule.houseId, { windowEnd: value })}
                  placeholder="23:00"
                />
                <AppInput
                  label="Cooldown (segundos)"
                  value={rule.cooldownSeconds}
                  onChangeText={(value) => updateHouseGateRule(rule.houseId, { cooldownSeconds: value })}
                  keyboardType="numeric"
                />
                <AppInput
                  label="Limite diário"
                  value={rule.maxOpensPerDay}
                  onChangeText={(value) => updateHouseGateRule(rule.houseId, { maxOpensPerDay: value })}
                  keyboardType="numeric"
                />
                <AppCheckbox
                  label="Exigir proximidade nesta casa"
                  checked={rule.requireProximity}
                  onChange={(value) => updateHouseGateRule(rule.houseId, { requireProximity: value })}
                />
                <AppInput
                  label="Raio máximo (metros)"
                  value={rule.maxDistanceMeters}
                  onChangeText={(value) => updateHouseGateRule(rule.houseId, { maxDistanceMeters: value })}
                  keyboardType="numeric"
                />
                <AppCheckbox
                  label="Exigir biometria nesta casa"
                  checked={rule.requireBiometric}
                  onChange={(value) => updateHouseGateRule(rule.houseId, { requireBiometric: value })}
                />
                <AppInput
                  label="PIN da casa (opcional)"
                  value={rule.accessPin}
                  onChangeText={(value) =>
                    updateHouseGateRule(rule.houseId, { accessPin: value.replace(/\D/g, '').slice(0, 8) })}
                  keyboardType="numeric"
                  secureTextEntry
                  placeholder="Ex: 4321"
                />
              </View>
            ))
          ) : (
            <EmptyState
              title="Sem casas para configurar"
              subtitle="Carregue as casas para aplicar regras de acesso por casa."
            />
          )}
        </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.cardTitle}>Notificações</Text>

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
            <AppSelect
              label="Casa vinculada"
              value={tenantHouseId || houses[0].id}
              onChange={setTenantHouseId}
              options={houses.map((house) => ({ label: house.nome || house.id, value: house.id }))}
            />
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
        {isOwner ? (
          <AppButton label="Salvar configurações" onPress={handleSaveConfig} loading={actionLoading === 'saveConfig'} />
        ) : null}
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
    <AppCheckbox label={label} checked={value} onChange={onChange} />
  </View>
);

const styles = StyleSheet.create({
  cardTitle: {
    color: palette.gray900,
    fontSize: 17,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  label: {
    color: palette.gray700,
    fontSize: 15,
    fontWeight: '700',
  },
  coverPreview: {
    width: '100%',
    height: 170,
    borderRadius: radii.md,
  },
  readOnlyHint: {
    color: palette.gray500,
    fontSize: 14,
    fontWeight: '600',
  },
  toggleRow: {
    borderBottomWidth: 1,
    borderBottomColor: palette.gray100,
    paddingVertical: spacing.sm,
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
    fontSize: 14,
  },
  userActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
