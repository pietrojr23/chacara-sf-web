import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppButton } from '../../components/AppButton';
import { AppCard } from '../../components/AppCard';
import { AppCheckbox } from '../../components/AppCheckbox';
import { AppInput } from '../../components/AppInput';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { palette, radii, spacing } from '../../constants/theme';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { useAuth } from '../../contexts/AuthContext';
import { getAllHouses } from '../../services/firestoreService';
import { getHeadlightsCatalog } from '../../services/headlightService';
import { HeadlightConfig, House } from '../../types/models';

type EditableHeadlight = {
  key: string;
  id: string;
  nome: string;
  descricao: string;
  casasPermitidas: string[];
  ativo: boolean;
};

const createRowKey = () => `headlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const toEditable = (item: HeadlightConfig): EditableHeadlight => ({
  key: createRowKey(),
  id: String(item.id ?? '').trim(),
  nome: String(item.nome ?? '').trim(),
  descricao: String(item.descricao ?? '').trim(),
  casasPermitidas: Array.isArray(item.casasPermitidas)
    ? item.casasPermitidas.map((houseId) => String(houseId ?? '').trim()).filter(Boolean)
    : [],
  ativo: item.ativo !== false,
});

const createEmptyRow = (): EditableHeadlight => ({
  key: createRowKey(),
  id: '',
  nome: '',
  descricao: '',
  casasPermitidas: [],
  ativo: true,
});

export const HeadlightsConfigScreen = () => {
  const { profile } = useAuth();
  const { config, saveConfig } = useAppConfig();
  const isOwner = Boolean(profile?.isOwner);

  const [items, setItems] = useState<EditableHeadlight[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loadingHouses, setLoadingHouses] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOwner) {
      return;
    }

    void (async () => {
      try {
        setLoadingHouses(true);
        const result = await getAllHouses();
        setHouses(result);
      } catch {
        setHouses([]);
      } finally {
        setLoadingHouses(false);
      }
    })();
  }, [isOwner]);

  useEffect(() => {
    const explicitConfigItems = Array.isArray(config.headlights)
      ? config.headlights.map(toEditable)
      : [];

    if (explicitConfigItems.length > 0) {
      setItems(explicitConfigItems);
      return;
    }

    const fallbackCatalog = getHeadlightsCatalog();
    const fallbackItems: EditableHeadlight[] = fallbackCatalog.map((item) => ({
      key: createRowKey(),
      id: item.id,
      nome: item.name,
      descricao: item.description ?? '',
      casasPermitidas: item.allowedHouseIds ?? [],
      ativo: item.active,
    }));

    setItems(fallbackItems);
  }, [config.headlights]);

  const hasRows = items.length > 0;

  const updateItem = (key: string, patch: Partial<EditableHeadlight>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const toggleHousePermission = (key: string, houseId: string) => {
    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) {
          return item;
        }

        if (item.casasPermitidas.includes(houseId)) {
          return {
            ...item,
            casasPermitidas: item.casasPermitidas.filter((entry) => entry !== houseId),
          };
        }

        return {
          ...item,
          casasPermitidas: [...item.casasPermitidas, houseId],
        };
      }),
    );
  };

  const removeItem = (item: EditableHeadlight) => {
    Alert.alert('Remover farol', `Deseja remover "${item.nome || 'farol'}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          setItems((current) => current.filter((entry) => entry.key !== item.key));
        },
      },
    ]);
  };

  const saveItems = async () => {
    if (!isOwner || saving) {
      return;
    }

    const normalizedRows = items
      .map((item) => ({
        id: item.id.trim(),
        nome: item.nome.trim(),
        descricao: item.descricao.trim(),
        casasPermitidas: item.casasPermitidas.map((houseId) => String(houseId ?? '').trim()).filter(Boolean),
        ativo: item.ativo,
      }))
      .filter((item) => item.id || item.nome || item.descricao);

    const invalidRow = normalizedRows.find((item) => !item.id || !item.nome);
    if (invalidRow) {
      Alert.alert('Campos obrigatórios', 'Preencha "virtual_id" e "Nome" em todos os faróis cadastrados.');
      return;
    }

    const ids = normalizedRows.map((item) => item.id);
    const hasDuplicateId = ids.some((id, index) => ids.indexOf(id) !== index);
    if (hasDuplicateId) {
      Alert.alert('virtual_id duplicado', 'Cada farol deve ter um virtual_id único.');
      return;
    }

    const payload: HeadlightConfig[] = normalizedRows.map((item) => ({
      id: item.id,
      nome: item.nome,
      ...(item.descricao ? { descricao: item.descricao } : {}),
      casasPermitidas: item.casasPermitidas,
      ativo: item.ativo,
    }));

    try {
      setSaving(true);
      await saveConfig({ headlights: payload });
      Alert.alert('Faróis salvos', 'Configuração atualizada com sucesso.');
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar a configuração dos faróis.');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = useMemo(() => items.filter((item) => item.ativo).length, [items]);

  if (!isOwner) {
    return (
      <ScreenContainer>
        <SectionHeader title="Configurar faróis" subtitle="Somente proprietário pode editar esta área." />
        <EmptyState title="Sem permissão" subtitle="Entre com conta de proprietário para editar os faróis." />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <SectionHeader
        title="Configurar faróis"
        subtitle={`${activeCount} ativo(s) • cadastre os virtual_id do Tuya`}
      />

      {!hasRows ? (
        <EmptyState
          title="Nenhum farol cadastrado"
          subtitle="Adicione o primeiro farol com nome e virtual_id."
        />
      ) : null}

      {items.map((item, index) => (
        <AppCard key={item.key}>
          <View style={styles.rowHeader}>
            <View style={styles.rowTitleWrap}>
              <Text style={styles.rowTitle}>Farol {index + 1}</Text>
              <Text style={styles.rowSubtitle}>Configure nome, id virtual, permissões e status.</Text>
            </View>
            <Pressable style={styles.deleteButton} onPress={() => removeItem(item)}>
              <MaterialIcons name="delete-outline" size={20} color={palette.danger} />
            </Pressable>
          </View>

          <AppInput
            label="Nome do farol"
            value={item.nome}
            onChangeText={(value) => updateItem(item.key, { nome: value })}
            placeholder="Ex.: Farol entrada"
          />
          <AppInput
            label="virtual_id (Tuya)"
            value={item.id}
            onChangeText={(value) => updateItem(item.key, { id: value })}
            placeholder="Ex.: bf34982d74bfeccf87av8b"
          />
          <AppInput
            label="Descrição (opcional)"
            value={item.descricao}
            onChangeText={(value) => updateItem(item.key, { descricao: value })}
            placeholder="Ex.: Frente da casa principal"
          />
          <Text style={styles.label}>Casas que podem controlar</Text>
          <AppCheckbox
            label="Disponível para todas as casas"
            checked={item.casasPermitidas.length === 0}
            onChange={(checked) => {
              if (checked) {
                updateItem(item.key, { casasPermitidas: [] });
              } else if (houses.length) {
                updateItem(item.key, { casasPermitidas: [houses[0].id] });
              }
            }}
          />
          {item.casasPermitidas.length > 0 ? (
            <View style={styles.checkboxList}>
              {houses.map((house) => (
                <AppCheckbox
                  key={`${item.key}:${house.id}`}
                  label={house.nome || house.id}
                  checked={item.casasPermitidas.includes(house.id)}
                  onChange={() => toggleHousePermission(item.key, house.id)}
                />
              ))}
              {!houses.length ? (
                <Text style={styles.helperText}>Nenhuma casa carregada para definir permissões.</Text>
              ) : null}
            </View>
          ) : null}
          <AppCheckbox
            label="Farol ativo"
            checked={item.ativo}
            onChange={(value) => updateItem(item.key, { ativo: value })}
          />
        </AppCard>
      ))}

      <AppCard>
        {loadingHouses ? <Text style={styles.helperText}>Carregando casas...</Text> : null}
        <AppButton
          label="Adicionar farol"
          variant="secondary"
          onPress={() => setItems((current) => [...current, createEmptyRow()])}
        />
        <AppButton
          label="Salvar configuração"
          onPress={saveItems}
          loading={saving}
        />
      </AppCard>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowTitleWrap: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: palette.gray900,
    fontWeight: '800',
    fontSize: 16,
  },
  rowSubtitle: {
    color: palette.gray700,
    fontSize: 12,
  },
  label: {
    color: palette.gray700,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  checkboxList: {
    gap: spacing.xs,
  },
  helperText: {
    color: palette.gray700,
    fontSize: 13,
  },
  deleteButton: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#F6D6D6',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDECEC',
  },
});
