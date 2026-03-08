import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { AppInput } from '../../components/AppInput';
import { EmptyState } from '../../components/EmptyState';
import { ScreenContainer } from '../../components/ScreenContainer';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { palette, radii, spacing } from '../../constants/theme';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import { useDataSync } from '../../contexts/DataSyncContext';
import {
  getAllHouses,
  getHouseProfile,
  getRentalPayments,
  markPaymentAsNotifiedByTenant,
  upsertRentalPayment,
} from '../../services/firestoreService';
import { generateReceiptPdf, sharePdf } from '../../services/pdfService';
import { cacheKeys, getCache, saveCache } from '../../services/cacheService';
import { House, RentalPayment } from '../../types/models';
import { formatCurrencyBRL, formatDateBR } from '../../utils/format';

const currentCompetencia = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const toInputCurrency = (value: number) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return '';
  }

  return amount.toFixed(2).replace('.', ',');
};

const normalizePhoneForWhatsApp = (raw?: string | null) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }

  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }

  // Assume Brasil quando vier somente DDD + número (10/11 dígitos).
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
};

const getHouseWhatsAppPhone = (house: House) => {
  const dynamic = house as House & {
    inquilinoTelefone?: string;
    inquilinoWhatsapp?: string;
    telefone?: string;
    whatsapp?: string;
  };

  const firstResidentContact = house.moradores?.[0]?.contato;
  const anyResidentContact = house.moradores?.find((item) => String(item?.contato ?? '').trim())?.contato;

  const candidates = [
    firstResidentContact,
    anyResidentContact,
    dynamic.inquilinoTelefone,
    dynamic.inquilinoWhatsapp,
    dynamic.telefone,
    dynamic.whatsapp,
  ];

  for (const value of candidates) {
    const normalized = normalizePhoneForWhatsApp(value);
    if (normalized) {
      return normalized;
    }
  }

  return '';
};

export const FinanceScreen = () => {
  const { profile } = useAuth();
  const { config } = useAppConfig();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [payments, setPayments] = useState<RentalPayment[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCharge, setSendingCharge] = useState(false);

  const [competencia, setCompetencia] = useState(currentCompetencia());
  const [valor, setValor] = useState('');
  const [formaPagamento, setFormaPagamento] = useState<'Pix' | 'Dinheiro' | 'Transferencia'>('Pix');

  const selectedHouse = useMemo(
    () => houses.find((house) => house.id === selectedHouseId) ?? null,
    [houses, selectedHouseId],
  );

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

  const loadPayments = useCallback(async (houseId: string) => {
    try {
      const data = await getRentalPayments(houseId);
      setPayments(data);
      await saveCache(cacheKeys.finance, data);
    } catch {
      const cached = await getCache<RentalPayment[]>(cacheKeys.finance);
      if (cached) {
        setPayments(cached);
      } else {
        throw new Error('Falha ao carregar pagamentos');
      }
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!profile) {
      return;
    }

    try {
      setLoadingData(true);
      if (isOwner) {
        const list = await getAllHouses();
        setHouses(list);

        if (list.length) {
          const houseId = selectedHouseId ?? list[0].id;
          setSelectedHouseId(houseId);
          const defaultHouse = list.find((item) => item.id === houseId);
          setValor(toInputCurrency(defaultHouse?.aluguelMensal ?? 0));
          await loadPayments(houseId);
        }
      } else if (profile.casaId) {
        const house = await getHouseProfile(profile.casaId);
        if (house) {
          setHouses([house]);
          setSelectedHouseId(house.id);
          await loadPayments(house.id);
        }
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar o módulo financeiro.');
    } finally {
      setLoadingData(false);
    }
  }, [isOwner, loadPayments, profile, selectedHouseId]);

  useFocusEffect(
    useCallback(() => {
      void loadData();
      return undefined;
    }, [dataVersion, loadData]),
  );

  const handleRefresh = useCallback(() => {
    void loadData();
  }, [loadData]);

  const monthlySummary = useMemo(() => {
    const current = currentCompetencia();
    const monthPayments = payments.filter((item) => item.competencia === current);
    const pago = monthPayments.filter((item) => item.status === 'pago').reduce((sum, item) => sum + Number(item.valor), 0);
    const pendente = monthPayments
      .filter((item) => item.status !== 'pago')
      .reduce((sum, item) => sum + Number(item.valor), 0);

    return {
      pago,
      pendente,
      inadimplencia: pendente,
    };
  }, [payments]);

  const handleRegisterPayment = async () => {
    if (!selectedHouseId || !profile) {
      return;
    }

    const numericValue = Number(valor.replace(',', '.'));

    if (!competencia || Number.isNaN(numericValue)) {
      Alert.alert('Dados inválidos', 'Informe competência e valor válidos.');
      return;
    }

    try {
      setSubmitting(true);
      const paymentId = competencia;
      await withTimeout(
        upsertRentalPayment(selectedHouseId, paymentId, {
          competencia,
          valor: numericValue,
          status: 'pago',
          formaPagamento,
          dataPagamento: new Date().toISOString(),
        }),
      );

      const receiptUri = await withTimeout(
        generateReceiptPdf({
          tenantName: selectedHouse?.inquilinoNome ?? 'Inquilino',
          houseName: selectedHouse?.nome ?? selectedHouse?.numero ?? 'Casa',
          payment: {
            id: paymentId,
            competencia,
            valor: numericValue,
            status: 'pago',
            formaPagamento,
            dataPagamento: new Date().toISOString(),
          },
          ownerName: profile.nome,
        }),
      );

      await withTimeout(sharePdf(receiptUri));

      setValor(toInputCurrency(selectedHouse?.aluguelMensal ?? 0));
      await withTimeout(loadPayments(selectedHouseId));
      Alert.alert('Pagamento lançado', 'Pagamento registrado e recibo gerado com sucesso.');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A operação demorou demais para responder. Tente novamente.'
          : 'Não foi possível registrar o pagamento.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleShareReceipt = async (payment: RentalPayment) => {
    if (!profile) {
      return;
    }

    try {
      const uri = await withTimeout(
        generateReceiptPdf({
          tenantName: selectedHouse?.inquilinoNome ?? 'Inquilino',
          houseName: selectedHouse?.nome ?? selectedHouse?.numero ?? 'Casa',
          payment,
          ownerName: profile.nome,
        }),
      );

      await withTimeout(sharePdf(uri));
    } catch {
      Alert.alert('Erro', 'Não foi possível gerar/compartilhar o recibo.');
    }
  };

  const sendWhatsAppCharge = async () => {
    if (!selectedHouse || !profile) {
      return;
    }

    try {
      setSendingCharge(true);

      const tenantName = selectedHouse.inquilinoNome || selectedHouse.moradores?.[0]?.nome || 'morador';
      const vencimentoDia = Number(selectedHouse.diaVencimento ?? 0);
      const vencimentoTexto = Number.isFinite(vencimentoDia) && vencimentoDia > 0
        ? `dia ${vencimentoDia}`
        : 'não informado';
      const pendingPayment = payments.find((item) => item.status !== 'pago');
      const chargeCompetencia = pendingPayment?.competencia || competencia || currentCompetencia();
      const chargeValue = Number(pendingPayment?.valor ?? selectedHouse.aluguelMensal ?? 0);

      const messageLines = [
        `Olá, ${tenantName}. Lembrete: o aluguel da sua casa está pendente.`,
        `Periodo: ${chargeCompetencia}`,
        `Vencimento: ${vencimentoTexto}`,
        `Valor: ${formatCurrencyBRL(chargeValue)}`,
      ];

      if (config.chavePix?.trim()) {
        messageLines.push(`Chave Pix: ${config.chavePix.trim()}`);
      }

      const encodedText = encodeURIComponent(messageLines.join('\n'));
      const phone = getHouseWhatsAppPhone(selectedHouse);
      const candidates = phone
        ? [
            `whatsapp://send?phone=${phone}&text=${encodedText}`,
            `https://wa.me/${phone}?text=${encodedText}`,
          ]
        : [
            `whatsapp://send?text=${encodedText}`,
            `https://wa.me/?text=${encodedText}`,
          ];

      let opened = false;
      for (const url of candidates) {
        const canOpen = await Linking.canOpenURL(url);
        if (!canOpen) {
          continue;
        }

        await Linking.openURL(url);
        opened = true;
        break;
      }

      if (!opened) {
        Alert.alert(
          'WhatsApp indisponível',
          'Não foi possível abrir o WhatsApp neste aparelho. Verifique se ele está instalado.',
        );
        return;
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível abrir o WhatsApp.');
    } finally {
      setSendingCharge(false);
    }
  };

  const handleTenantAlreadyPaid = async (paymentId: string) => {
    if (!profile?.casaId || !profile.id) {
      return;
    }

    try {
      await withTimeout(markPaymentAsNotifiedByTenant(profile.casaId, paymentId, profile.id));
      await withTimeout(loadPayments(profile.casaId));
      Alert.alert('Aviso enviado', 'O proprietário foi notificado para confirmar seu pagamento.');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A confirmação demorou demais para responder. Tente novamente.'
          : 'Não foi possível enviar a confirmação.',
      );
    }
  };

  return (
    <ScreenContainer refreshing={loadingData} onRefresh={handleRefresh}>
      <SectionHeader
        title="Financeiro e aluguel"
        subtitle={isOwner ? 'Gestão completa de cobranças e recibos' : 'Seu histórico de pagamentos'}
      />

      <AppCard>
        <Text style={styles.cardTitle}>Casa selecionada</Text>
        {houses.length ? (
          <View style={styles.houseChips}>
            {houses.map((house) => (
              <Pressable
                key={house.id}
                style={[styles.houseChip, selectedHouseId === house.id && styles.houseChipActive]}
                onPress={async () => {
                  setSelectedHouseId(house.id);
                  setValor(toInputCurrency(house.aluguelMensal ?? 0));
                  await loadPayments(house.id);
                }}
              >
                <Text style={[styles.houseChipText, selectedHouseId === house.id && styles.houseChipTextActive]}>
                  {house.nome || house.id}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyState title="Nenhuma casa encontrada" subtitle="Cadastre as casas para iniciar o financeiro." />
        )}
      </AppCard>

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Lançar pagamento recebido</Text>

          <AppInput
            label="Competência (AAAA-MM)"
            value={competencia}
            onChangeText={() => undefined}
            placeholder="2026-03"
            editable={false}
          />
          <AppInput
            label="Valor"
            value={valor}
            onChangeText={() => undefined}
            keyboardType="numeric"
            placeholder="1500,00"
            editable={false}
          />

          <View style={styles.houseChips}>
            {(['Pix', 'Dinheiro', 'Transferencia'] as const).map((method) => (
              <Pressable
                key={method}
                style={[styles.houseChip, formaPagamento === method && styles.houseChipActive]}
                onPress={() => setFormaPagamento(method)}
              >
                <Text style={[styles.houseChipText, formaPagamento === method && styles.houseChipTextActive]}>
                  {method}
                </Text>
              </Pressable>
            ))}
          </View>

          <AppButton
            label="Registrar pagamento e gerar recibo"
            onPress={handleRegisterPayment}
            loading={submitting}
          />

          <AppButton
            label="Enviar cobrança por WhatsApp"
            variant="ghost"
            onPress={sendWhatsAppCharge}
            loading={sendingCharge}
          />
        </AppCard>
      ) : (
        <AppCard>
          <Text style={styles.cardTitle}>Pagamento do aluguel</Text>
          <Text style={styles.subtitle}>Valor mensal: {formatCurrencyBRL(selectedHouse?.aluguelMensal ?? 0)}</Text>
          <Text style={styles.subtitle}>Vencimento: dia {selectedHouse?.diaVencimento ?? '-'}</Text>
          <Text style={styles.subtitle}>Chave Pix do proprietário: {config.chavePix || 'Não configurada'}</Text>
        </AppCard>
      )}

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Relatório mensal (competência atual)</Text>
          <Text style={styles.subtitle}>Total recebido: {formatCurrencyBRL(monthlySummary.pago)}</Text>
          <Text style={styles.subtitle}>Total pendente: {formatCurrencyBRL(monthlySummary.pendente)}</Text>
          <Text style={styles.subtitle}>Inadimplência: {formatCurrencyBRL(monthlySummary.inadimplencia)}</Text>
        </AppCard>
      ) : null}

      <AppCard>
        <Text style={styles.cardTitle}>Histórico de pagamentos</Text>
        {payments.length ? (
          payments.map((payment) => (
            <View key={payment.id} style={styles.paymentItem}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentTitle}>{payment.competencia}</Text>
                <StatusBadge
                  text={
                    payment.status === 'pago'
                      ? 'Pago'
                      : payment.status === 'vencido'
                        ? 'Vencido'
                        : payment.status === 'aguardando_confirmacao'
                          ? 'Aguardando confirmação'
                          : 'Pendente'
                  }
                  tone={
                    payment.status === 'pago'
                      ? 'success'
                      : payment.status === 'vencido'
                        ? 'danger'
                        : payment.status === 'aguardando_confirmacao'
                          ? 'info'
                          : 'warning'
                  }
                />
              </View>
              <Text style={styles.subtitle}>{formatCurrencyBRL(payment.valor)}</Text>
              <Text style={styles.caption}>Data: {formatDateBR(payment.dataPagamento)}</Text>

              <View style={styles.paymentActions}>
                <AppButton label="Recibo PDF" variant="ghost" onPress={() => handleShareReceipt(payment)} />
                {!isOwner && payment.status !== 'pago' ? (
                  <AppButton label="Já paguei" variant="secondary" onPress={() => handleTenantAlreadyPaid(payment.id)} />
                ) : null}
              </View>
            </View>
          ))
        ) : (
          <EmptyState title="Sem pagamentos registrados" subtitle="Quando houver lançamentos eles aparecerão aqui." />
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
  subtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
  caption: {
    color: palette.gray500,
    fontSize: 12,
  },
  houseChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  houseChip: {
    borderWidth: 1,
    borderColor: palette.gray300,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: palette.white,
  },
  houseChipActive: {
    backgroundColor: palette.greenDark,
    borderColor: palette.greenDark,
  },
  houseChipText: {
    color: palette.gray900,
    fontWeight: '700',
  },
  houseChipTextActive: {
    color: palette.white,
  },
  paymentItem: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  paymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.gray900,
  },
  paymentActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
