import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { openApplication as openAndroidApplication } from 'expo-intent-launcher';
import { AppCard } from '../../components/AppCard';
import { AppButton } from '../../components/AppButton';
import { AppSelect } from '../../components/AppSelect';
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
  getAllUsers,
  getAllHouses,
  getHouseProfile,
  getRentalPayments,
  markPaymentAsNotifiedByTenant,
  sendChatMessage,
  upsertRentalPayment,
} from '../../services/firestoreService';
import { generateReceiptPdf, sharePdf } from '../../services/pdfService';
import { cacheKeys, getCache, saveCache } from '../../services/cacheService';
import { uploadFileAsync } from '../../services/storageService';
import { House, RentalPayment } from '../../types/models';
import { formatCurrencyBRL, formatDateBR } from '../../utils/format';
import { getFileNameFromPath } from '../../utils/file';
import { buildPrivateChatId } from '../../utils/chat';

const currentCompetencia = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const parseCurrencyInput = (value: string) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return Number.NaN;
  }

  if (normalized.includes(',')) {
    return Number(normalized.replace(/\./g, '').replace(',', '.'));
  }

  return Number(normalized);
};

const sanitizeFilename = (name: string) => {
  const normalized = String(name ?? '').trim() || `conta-luz-${Date.now()}.pdf`;
  return normalized.replace(/[^\w.-]+/g, '-');
};

const buildLightPaymentId = (competencia: string) => `luz-${competencia}`;

type PixBankOption = {
  id: string;
  label: string;
  schemeUrls: string[];
  androidIntentUrls?: string[];
  androidPackageCandidates?: string[];
};

const uniqueUrls = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const extractSchemeName = (url: string) => String(url).trim().replace(/:.*$/, '').trim();

const expandSchemeCandidates = (schemeUrl: string) => {
  const base = String(schemeUrl ?? '').trim();
  if (!base) {
    return [] as string[];
  }

  const normalized = base.endsWith('://') ? base : `${base}://`;
  const withPath = normalized.endsWith('/') ? normalized : `${normalized}/`;
  return uniqueUrls([
    normalized,
    `${withPath}home`,
    `${withPath}pix`,
    `${withPath}payments`,
    `${withPath}open`,
  ]);
};

const PIX_BANK_OPTIONS: PixBankOption[] = [
  {
    id: 'nubank',
    label: 'Nubank',
    schemeUrls: ['nubank://', 'nu://'],
    androidIntentUrls: ['intent://#Intent;package=com.nu.production;end'],
    androidPackageCandidates: ['com.nu.production'],
  },
  {
    id: 'inter',
    label: 'Inter',
    schemeUrls: ['inter://', 'bancointer://'],
    androidIntentUrls: ['intent://#Intent;package=br.com.intermedium;end'],
    androidPackageCandidates: ['br.com.intermedium'],
  },
  {
    id: 'itau',
    label: 'Itaú',
    schemeUrls: ['itauaplicativo://', 'itau://'],
    androidIntentUrls: ['intent://#Intent;package=com.itau;end'],
    androidPackageCandidates: ['com.itau'],
  },
  {
    id: 'bradesco',
    label: 'Bradesco',
    schemeUrls: ['bradesco://', 'bradesconetempresa://'],
    androidIntentUrls: ['intent://#Intent;package=com.bradesco;end'],
    androidPackageCandidates: ['com.bradesco'],
  },
  {
    id: 'caixa',
    label: 'Caixa',
    schemeUrls: ['caixatem://', 'caixa://'],
    androidIntentUrls: ['intent://#Intent;package=br.gov.caixa.tem;end'],
    androidPackageCandidates: ['br.gov.caixa.tem'],
  },
  {
    id: 'santander',
    label: 'Santander',
    schemeUrls: ['santander://'],
    androidIntentUrls: ['intent://#Intent;package=com.santander.app;end'],
    androidPackageCandidates: ['com.santander.app'],
  },
  {
    id: 'sicoob',
    label: 'Sicoob',
    schemeUrls: ['sicoob://'],
    androidIntentUrls: ['intent://#Intent;package=br.com.sicoob.mobile;end'],
    androidPackageCandidates: ['br.com.sicoob.mobile'],
  },
  {
    id: 'picpay',
    label: 'PicPay',
    schemeUrls: ['picpay://'],
    androidIntentUrls: ['intent://#Intent;package=com.picpay;end'],
    androidPackageCandidates: ['com.picpay'],
  },
  {
    id: 'mercado_pago',
    label: 'Mercado Pago',
    schemeUrls: ['mercadopago://'],
    androidIntentUrls: ['intent://#Intent;package=com.mercadopago.wallet;end'],
    androidPackageCandidates: ['com.mercadopago.wallet'],
  },
];

type PickedPdfFile = {
  uri: string;
  name: string;
  url?: string;
};

type OwnerPendingConfirmation = {
  houseId: string;
  houseLabel: string;
  payment: RentalPayment;
};

type OwnerFinanceEntry = {
  houseId: string;
  houseLabel: string;
  payment: RentalPayment;
};

const getDaysInMonth = (year: number, monthZeroBased: number) => new Date(year, monthZeroBased + 1, 0).getDate();

const getNextDueDateFromDay = (dueDayRaw: number) => {
  const dueDay = Math.min(31, Math.max(1, Math.trunc(Number(dueDayRaw || 1))));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const currentDayLimit = getDaysInMonth(today.getFullYear(), today.getMonth());
  let dueDate = new Date(today.getFullYear(), today.getMonth(), Math.min(dueDay, currentDayLimit));

  if (dueDate < today) {
    const nextMonthDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const nextMonthDayLimit = getDaysInMonth(nextMonthDate.getFullYear(), nextMonthDate.getMonth());
    dueDate = new Date(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), Math.min(dueDay, nextMonthDayLimit));
  }

  return dueDate;
};

const getCompetenciaFromDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const getDaysUntilDate = (date: Date) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const getDueDateFromCompetencia = (competencia: string, dueDayRaw: number) => {
  const match = String(competencia ?? '').match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
    return null;
  }

  const dueDay = Math.min(31, Math.max(1, Math.trunc(Number(dueDayRaw || 1))));
  const dayLimit = getDaysInMonth(year, month);
  return new Date(year, month, Math.min(dueDay, dayLimit));
};

const getPaymentTypeLabel = (payment: RentalPayment) => (payment.tipo === 'luz' ? 'Luz' : 'Aluguel');

const getEffectivePaymentAmount = (payment: RentalPayment, monthlyRentFallback = 0) => {
  const amount = Number(payment.valor ?? 0);
  if (payment.tipo === 'luz') {
    return Number.isFinite(amount) ? amount : 0;
  }

  if (Number.isFinite(amount) && amount > 0) {
    return amount;
  }

  const rent = Number(monthlyRentFallback ?? 0);
  return Number.isFinite(rent) ? rent : 0;
};

const getPaymentStatusLabel = (status: RentalPayment['status']) => {
  if (status === 'pago') {
    return 'Pago';
  }
  if (status === 'vencido') {
    return 'Vencido';
  }
  if (status === 'aguardando_confirmacao') {
    return 'Aguardando confirmação';
  }
  return 'Pendente';
};

const getPaymentStatusTone = (
  status: RentalPayment['status'],
): 'success' | 'warning' | 'danger' | 'info' => {
  if (status === 'pago') {
    return 'success';
  }
  if (status === 'vencido') {
    return 'danger';
  }
  if (status === 'aguardando_confirmacao') {
    return 'info';
  }
  return 'warning';
};

const canTenantMarkAsPaid = (payment: RentalPayment) =>
  payment.status !== 'pago'
  && payment.status !== 'aguardando_confirmacao'
  && !payment.marcadoComoPagoPeloInquilino;

const hasPaymentProof = (payment: RentalPayment) => Boolean(String(payment.comprovantePagamentoUrl ?? '').trim());
const OWNER_OVERVIEW_OPTION_VALUE = '__owner_overview__';

export const FinanceScreen = () => {
  const { profile } = useAuth();
  const { config } = useAppConfig();
  const { dataVersion } = useDataSync();
  const isOwner = Boolean(profile?.isOwner);

  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [payments, setPayments] = useState<RentalPayment[]>([]);
  const [ownerFinanceEntries, setOwnerFinanceEntries] = useState<OwnerFinanceEntry[]>([]);
  const [ownerPendingConfirmations, setOwnerPendingConfirmations] = useState<OwnerPendingConfirmation[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [uploadingLightPdf, setUploadingLightPdf] = useState(false);
  const [submittingLightPayment, setSubmittingLightPayment] = useState(false);
  const [sendingLightCharge, setSendingLightCharge] = useState(false);
  const [confirmingOwnerPaymentKey, setConfirmingOwnerPaymentKey] = useState<string | null>(null);
  const [uploadingProofKey, setUploadingProofKey] = useState<string | null>(null);

  const [lightCompetencia, setLightCompetencia] = useState(currentCompetencia());
  const [lightValor, setLightValor] = useState('');
  const [lightFormaPagamento, setLightFormaPagamento] = useState<'Pix' | 'Dinheiro' | 'Transferencia'>('Pix');
  const [lightPdfFile, setLightPdfFile] = useState<PickedPdfFile | null>(null);
  const [tenantPixBankId, setTenantPixBankId] = useState<string>('nubank');

  const selectedHouse = useMemo(
    () => houses.find((house) => house.id === selectedHouseId) ?? null,
    [houses, selectedHouseId],
  );

  const receiptTenantName = useMemo(() => {
    if (!selectedHouse) {
      return profile?.nome?.trim() || 'Inquilino';
    }

    if (!isOwner) {
      return profile?.nome?.trim() || selectedHouse.moradores?.[0]?.nome || 'Inquilino';
    }

    return selectedHouse.moradores?.[0]?.nome || `Morador da ${selectedHouse.nome || selectedHouse.numero || selectedHouse.id}`;
  }, [isOwner, profile?.nome, selectedHouse]);

  const houseRentById = useMemo(
    () =>
      houses.reduce<Record<string, number>>((acc, house) => {
        acc[house.id] = Number(house.aluguelMensal ?? 0);
        return acc;
      }, {}),
    [houses],
  );

  useEffect(() => {
    if (!selectedHouseId || !isOwner || selectedHouseId === OWNER_OVERVIEW_OPTION_VALUE) {
      return;
    }

    setLightCompetencia(currentCompetencia());
    setLightValor('');
    setLightFormaPagamento('Pix');
    setLightPdfFile(null);
  }, [isOwner, selectedHouseId]);

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

  const ensureLightPdfUrl = useCallback(
    async (houseId: string) => {
      if (!lightPdfFile?.uri) {
        return null;
      }

      if (lightPdfFile.url) {
        return lightPdfFile.url;
      }

      try {
        setUploadingLightPdf(true);
        const safeName = sanitizeFilename(lightPdfFile.name);
        const finalFileName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
        const path = `financeiro/luz/${houseId}/${Date.now()}-${finalFileName}`;
        const url = await withTimeout(uploadFileAsync(lightPdfFile.uri, path), 45000);

        setLightPdfFile((current) => (current ? { ...current, url } : current));
        return url;
      } finally {
        setUploadingLightPdf(false);
      }
    },
    [lightPdfFile],
  );

  const handlePickLightPdf = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets[0];
      const fileName = String(asset.name ?? '').trim() || `conta-luz-${Date.now()}.pdf`;
      setLightPdfFile({
        uri: asset.uri,
        name: fileName,
      });
    } catch {
      Alert.alert('Erro', 'Não foi possível selecionar o PDF da conta de luz.');
    }
  }, []);

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

  const loadOwnerFinanceData = useCallback(async (houseList: House[]) => {
    if (!houseList.length) {
      setOwnerFinanceEntries([]);
      setOwnerPendingConfirmations([]);
      return;
    }

    const entriesByHouse = await Promise.all(
      houseList.map(async (house) => {
        const housePayments = await withTimeout(getRentalPayments(house.id));
        const houseLabel = house.nome || house.numero || house.id;

        return housePayments.map<OwnerFinanceEntry>((payment) => ({
          houseId: house.id,
          houseLabel,
          payment,
        }));
      }),
    );

    const flattened = entriesByHouse
      .flat()
      .sort((left, right) => right.payment.competencia.localeCompare(left.payment.competencia));
    setOwnerFinanceEntries(flattened);

    const pending = flattened.filter(
      (entry) => entry.payment.status === 'aguardando_confirmacao' || entry.payment.marcadoComoPagoPeloInquilino,
    );
    setOwnerPendingConfirmations(
      pending.map<OwnerPendingConfirmation>((entry) => ({
        houseId: entry.houseId,
        houseLabel: entry.houseLabel,
        payment: entry.payment,
      })),
    );
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
          const selectedIsValidHouse = Boolean(
            selectedHouseId
            && selectedHouseId !== OWNER_OVERVIEW_OPTION_VALUE
            && list.some((house) => house.id === selectedHouseId),
          );
          const nextSelected = selectedIsValidHouse ? (selectedHouseId as string) : OWNER_OVERVIEW_OPTION_VALUE;
          setSelectedHouseId(nextSelected);
          if (nextSelected !== OWNER_OVERVIEW_OPTION_VALUE) {
            await loadPayments(nextSelected);
          } else {
            setPayments([]);
          }
          await loadOwnerFinanceData(list);
        } else {
          setSelectedHouseId(null);
          setPayments([]);
          setOwnerFinanceEntries([]);
          setOwnerPendingConfirmations([]);
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
  }, [isOwner, loadOwnerFinanceData, loadPayments, profile, selectedHouseId]);

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
    const ownerEntriesFromSelectedHouse = ownerFinanceEntries.filter((entry) => entry.houseId === selectedHouseId);
    const monthEntries = isOwner
      ? ownerEntriesFromSelectedHouse.filter((entry) => entry.payment.competencia === current)
      : payments
          .filter((item) => item.competencia === current)
          .map((payment) => ({
            houseId: selectedHouseId ?? '',
            payment,
          }));

    const pago = monthEntries
      .filter((entry) => entry.payment.status === 'pago')
      .reduce(
        (sum, entry) => sum + getEffectivePaymentAmount(entry.payment, houseRentById[entry.houseId] ?? selectedHouse?.aluguelMensal ?? 0),
        0,
      );
    const pendente = monthEntries
      .filter((entry) => entry.payment.status !== 'pago')
      .reduce(
        (sum, entry) => sum + getEffectivePaymentAmount(entry.payment, houseRentById[entry.houseId] ?? selectedHouse?.aluguelMensal ?? 0),
        0,
      );
    const inadimplencia = monthEntries
      .filter((entry) => entry.payment.status === 'vencido')
      .reduce(
        (sum, entry) => sum + getEffectivePaymentAmount(entry.payment, houseRentById[entry.houseId] ?? selectedHouse?.aluguelMensal ?? 0),
        0,
      );

    if (isOwner && selectedHouse) {
      const hasCurrentMonthRentEntry = monthEntries.some((entry) => (entry.payment.tipo ?? 'aluguel') === 'aluguel');
      const rentPendingMissingRecords = hasCurrentMonthRentEntry ? 0 : Number(selectedHouse.aluguelMensal ?? 0);

      return {
        pago,
        pendente: pendente + rentPendingMissingRecords,
        inadimplencia,
      };
    }

    return {
      pago,
      pendente,
      inadimplencia,
    };
  }, [houseRentById, isOwner, ownerFinanceEntries, payments, selectedHouse, selectedHouseId]);

  const ownerMonthlyHouseOverview = useMemo(() => {
    if (!isOwner) {
      return null;
    }

    const competencia = currentCompetencia();
    const monthRentEntries = ownerFinanceEntries.filter(
      (entry) => entry.payment.competencia === competencia && (entry.payment.tipo ?? 'aluguel') === 'aluguel',
    );

    const statusByHouseId = new Map<string, RentalPayment['status']>();
    monthRentEntries.forEach((entry) => {
      const previousStatus = statusByHouseId.get(entry.houseId);
      const nextStatus = entry.payment.status;

      if (!previousStatus) {
        statusByHouseId.set(entry.houseId, nextStatus);
        return;
      }

      if (previousStatus !== 'pago' && nextStatus === 'pago') {
        statusByHouseId.set(entry.houseId, nextStatus);
      }
    });

    const paid: string[] = [];
    const awaitingConfirmation: string[] = [];
    const pending: string[] = [];

    houses.forEach((house) => {
      const status = statusByHouseId.get(house.id);
      const label = house.nome || house.numero || house.id;

      if (status === 'pago') {
        paid.push(label);
        return;
      }

      if (status === 'aguardando_confirmacao') {
        awaitingConfirmation.push(label);
        return;
      }

      pending.push(label);
    });

    return {
      competencia,
      total: houses.length,
      paid,
      awaitingConfirmation,
      pending,
    };
  }, [houses, isOwner, ownerFinanceEntries]);

  const ownerMonthlyLightOverview = useMemo(() => {
    if (!isOwner) {
      return null;
    }

    const competencia = currentCompetencia();
    const monthLightEntries = ownerFinanceEntries.filter(
      (entry) => entry.payment.competencia === competencia && entry.payment.tipo === 'luz',
    );

    const statusByHouseId = new Map<string, RentalPayment['status']>();
    monthLightEntries.forEach((entry) => {
      const previousStatus = statusByHouseId.get(entry.houseId);
      const nextStatus = entry.payment.status;

      if (!previousStatus) {
        statusByHouseId.set(entry.houseId, nextStatus);
        return;
      }

      if (previousStatus !== 'pago' && nextStatus === 'pago') {
        statusByHouseId.set(entry.houseId, nextStatus);
      }
    });

    const paid: string[] = [];
    const awaitingConfirmation: string[] = [];
    const pending: string[] = [];

    houses.forEach((house) => {
      const status = statusByHouseId.get(house.id);
      const label = house.nome || house.numero || house.id;

      if (status === 'pago') {
        paid.push(label);
        return;
      }

      if (status === 'aguardando_confirmacao') {
        awaitingConfirmation.push(label);
        return;
      }

      pending.push(label);
    });

    return {
      competencia,
      total: houses.length,
      paid,
      awaitingConfirmation,
      pending,
    };
  }, [houses, isOwner, ownerFinanceEntries]);

  const ownerPendingConfirmationsFiltered = useMemo(
    () => ownerPendingConfirmations.filter((entry) => entry.houseId === selectedHouseId),
    [ownerPendingConfirmations, selectedHouseId],
  );
  const ownerOverviewSelected = isOwner && selectedHouseId === OWNER_OVERVIEW_OPTION_VALUE;
  const ownerHouseSelected = isOwner && Boolean(selectedHouseId) && selectedHouseId !== OWNER_OVERVIEW_OPTION_VALUE;

  const tenantCurrentLightPayment = useMemo(() => {
    const lightPayments = payments.filter((item) => item.tipo === 'luz');
    if (!lightPayments.length) {
      return null;
    }

    const current = currentCompetencia();
    const currentLight = lightPayments.find((item) => item.competencia === current);
    if (currentLight) {
      return currentLight;
    }

    return [...lightPayments].sort((left, right) => right.competencia.localeCompare(left.competencia))[0];
  }, [payments]);

  const tenantRentDueMeta = useMemo(() => {
    if (isOwner || !selectedHouse) {
      return null;
    }

    const dueDay = Number(selectedHouse.diaVencimento ?? 0);
    if (!Number.isFinite(dueDay) || dueDay <= 0) {
      return null;
    }

    const dueDate = getNextDueDateFromDay(dueDay);
    return {
      dueDate,
      daysUntilDue: getDaysUntilDate(dueDate),
      competencia: getCompetenciaFromDate(dueDate),
    };
  }, [isOwner, selectedHouse]);

  const tenantCurrentRentPayment = useMemo(() => {
    if (isOwner) {
      return null;
    }

    const rentPayments = payments.filter((item) => item.tipo !== 'luz');
    const currentMonthCompetencia = currentCompetencia();
    const currentMonthPayment = rentPayments.find((item) => item.competencia === currentMonthCompetencia);

    const targetCompetencia =
      currentMonthPayment?.status === 'pago'
        ? (tenantRentDueMeta?.competencia ?? currentMonthCompetencia)
        : currentMonthCompetencia;

    const targetedPayment = rentPayments.find((item) => item.competencia === targetCompetencia);
    if (targetedPayment) {
      return {
        ...targetedPayment,
        valor: getEffectivePaymentAmount(targetedPayment, Number(selectedHouse?.aluguelMensal ?? 0)),
      };
    }

    return {
      id: targetCompetencia,
      competencia: targetCompetencia,
      valor: Number(selectedHouse?.aluguelMensal ?? 0),
      status: 'pendente',
      tipo: 'aluguel',
    } as RentalPayment;
  }, [isOwner, payments, selectedHouse?.aluguelMensal, tenantRentDueMeta?.competencia]);

  const shouldShowTenantRentBill = useMemo(() => {
    if (isOwner || !tenantCurrentRentPayment) {
      return false;
    }

    const daysUntilDue = tenantRentDueMeta?.daysUntilDue;
    if (typeof daysUntilDue === 'number' && daysUntilDue <= 5) {
      return true;
    }

    return tenantCurrentRentPayment.status !== 'pago' || tenantCurrentRentPayment.marcadoComoPagoPeloInquilino;
  }, [isOwner, tenantCurrentRentPayment, tenantRentDueMeta?.daysUntilDue]);

  const tenantCurrentRentDueInfo = useMemo(() => {
    if (!tenantCurrentRentPayment || !selectedHouse) {
      return null;
    }

    const dueDate = getDueDateFromCompetencia(tenantCurrentRentPayment.competencia, Number(selectedHouse.diaVencimento ?? 0));
    if (!dueDate) {
      return null;
    }

    return {
      dueDate,
      daysUntilDue: getDaysUntilDate(dueDate),
    };
  }, [selectedHouse, tenantCurrentRentPayment]);

  const historyEntries = useMemo(() => {
    if (isOwner) {
      return ownerFinanceEntries
        .filter((entry) => entry.houseId === selectedHouseId)
        .map((entry) => ({
        key: `${entry.houseId}:${entry.payment.id}`,
        houseId: entry.houseId,
        houseLabel: entry.houseLabel,
        payment: entry.payment,
        }));
    }

    return payments.map((payment) => ({
      key: payment.id,
      houseId: selectedHouseId ?? '',
      houseLabel: '',
      payment,
    }));
  }, [isOwner, ownerFinanceEntries, payments, selectedHouseId]);

  const handleRegisterLightPayment = async () => {
    if (!selectedHouseId || !profile) {
      return;
    }

    const numericValue = parseCurrencyInput(lightValor);

    if (!lightCompetencia || Number.isNaN(numericValue) || numericValue <= 0) {
      Alert.alert('Dados inválidos', 'Informe competência e valor válidos para a conta de luz.');
      return;
    }

    try {
      setSubmittingLightPayment(true);
      const paymentId = buildLightPaymentId(lightCompetencia);
      const existingPayment = payments.find((item) => item.id === paymentId);
      const paidAt = new Date().toISOString();
      const uploadedPdfUrl = await ensureLightPdfUrl(selectedHouseId);
      const boletoPdfUrl = uploadedPdfUrl ?? existingPayment?.boletoPdfUrl;

      await withTimeout(
        upsertRentalPayment(selectedHouseId, paymentId, {
          competencia: lightCompetencia,
          valor: numericValue,
          status: 'pago',
          formaPagamento: lightFormaPagamento,
          dataPagamento: paidAt,
          tipo: 'luz',
          ...(boletoPdfUrl ? { boletoPdfUrl } : {}),
        }),
      );

      const receiptUri = await withTimeout(
        generateReceiptPdf({
          tenantName: receiptTenantName,
          houseName: selectedHouse?.nome ?? selectedHouse?.numero ?? 'Casa',
          payment: {
            id: paymentId,
            competencia: lightCompetencia,
            valor: numericValue,
            status: 'pago',
            formaPagamento: lightFormaPagamento,
            dataPagamento: paidAt,
            tipo: 'luz',
            ...(boletoPdfUrl ? { boletoPdfUrl } : {}),
          },
          ownerName: profile.nome,
        }),
      );

      await withTimeout(sharePdf(receiptUri));
      await withTimeout(loadPayments(selectedHouseId));
      Alert.alert('Conta de luz registrada', 'Pagamento registrado e recibo gerado com sucesso.');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A operação demorou demais para responder. Tente novamente.'
          : 'Não foi possível registrar o pagamento da conta de luz.',
      );
    } finally {
      setSubmittingLightPayment(false);
    }
  };

  const sendLightChargeByChat = async () => {
    if (!selectedHouse || !selectedHouseId || !profile) {
      return;
    }

    const numericValue = parseCurrencyInput(lightValor);
    if (!lightCompetencia || Number.isNaN(numericValue) || numericValue <= 0) {
      Alert.alert('Dados inválidos', 'Informe competência e valor válidos para enviar a cobrança da conta de luz.');
      return;
    }

    try {
      setSendingLightCharge(true);

      const uploadedPdfUrl = await ensureLightPdfUrl(selectedHouseId);
      const paymentId = buildLightPaymentId(lightCompetencia);
      const existingPayment = payments.find((item) => item.id === paymentId);
      const boletoPdfUrl = uploadedPdfUrl ?? existingPayment?.boletoPdfUrl;
      await withTimeout(
        upsertRentalPayment(selectedHouseId, paymentId, {
          competencia: lightCompetencia,
          valor: numericValue,
          status: existingPayment?.status === 'pago' ? 'pago' : 'pendente',
          formaPagamento: existingPayment?.formaPagamento,
          dataPagamento: existingPayment?.dataPagamento,
          tipo: 'luz',
          ...(boletoPdfUrl ? { boletoPdfUrl } : {}),
        }),
      );

      const users = await withTimeout(getAllUsers());
      const tenantUsers = users.filter((user) => !user.isOwner && user.ativo && user.casaId === selectedHouseId);

      if (!tenantUsers.length) {
        Alert.alert('Sem destinatário', 'Nenhum inquilino ativo encontrado para esta casa.');
        return;
      }

      const houseLabel = selectedHouse.nome || selectedHouse.numero || selectedHouseId;
      const vencimentoDia = Number(selectedHouse.diaVencimento ?? 0);
      const vencimentoTexto = Number.isFinite(vencimentoDia) && vencimentoDia > 0 ? `dia ${vencimentoDia}` : 'não informado';

      await Promise.all(
        tenantUsers.map(async (tenant) => {
          const lines = [
            `Olá, ${tenant.nome || 'morador'}.`,
            `Segue a cobrança da conta de luz da casa ${houseLabel}.`,
            `Competência: ${lightCompetencia}`,
            `Vencimento: ${vencimentoTexto}`,
            `Valor cobrado: ${formatCurrencyBRL(numericValue)}`,
          ];

          if (config.chavePix?.trim()) {
            lines.push(`Chave Pix: ${config.chavePix.trim()}`);
          }

          if (boletoPdfUrl) {
            lines.push('PDF da conta de luz anexado nesta mensagem.');
          }

          await sendChatMessage({
            chatId: buildPrivateChatId(profile.id, tenant.id),
            isPrivate: true,
            text: lines.join('\n'),
            ...(boletoPdfUrl ? { imageUrl: boletoPdfUrl } : {}),
            senderId: profile.id,
            senderName: profile.nome,
            senderPhotoURL: profile.photoURL ?? undefined,
            notifyUserIdsOverride: [tenant.id],
          });
        }),
      );

      await withTimeout(loadPayments(selectedHouseId));
      Alert.alert(
        'Cobrança enviada',
        boletoPdfUrl
          ? 'A cobrança da conta de luz foi enviada no chat privado com o PDF anexo.'
          : 'A cobrança da conta de luz foi enviada no chat privado.',
      );
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A operação demorou demais para responder. Tente novamente.'
          : 'Não foi possível enviar a cobrança da conta de luz pelo chat.',
      );
    } finally {
      setSendingLightCharge(false);
    }
  };

  const handleShareReceipt = async (payment: RentalPayment) => {
    if (!profile) {
      return;
    }

    try {
      const uri = await withTimeout(
        generateReceiptPdf({
          tenantName: receiptTenantName,
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

  const handleOpenPixBank = useCallback(async () => {
    const pixKey = String(config.chavePix ?? '').trim();
    if (!pixKey) {
      Alert.alert(
        'PIX não configurado',
        'O proprietário ainda não configurou a chave PIX nas configurações.',
        [{ text: 'Fechar' }, { text: 'Abrir configurações', onPress: () => undefined }],
      );
      return;
    }

    try {
      await Clipboard.setStringAsync(pixKey);
    } catch {
      // segue normalmente para abrir o app do banco
    }

    const selectedBank = PIX_BANK_OPTIONS.find((option) => option.id === tenantPixBankId) ?? PIX_BANK_OPTIONS[0];
    const expandedSchemeUrls = uniqueUrls(
      selectedBank.schemeUrls.flatMap((schemeUrl) => expandSchemeCandidates(schemeUrl)),
    );

    for (const scheme of expandedSchemeUrls) {
      try {
        await Linking.openURL(scheme);
        return;
      } catch {
        // tenta próximo esquema
      }
    }

    if (Platform.OS === 'android') {
      for (const packageName of selectedBank.androidPackageCandidates ?? []) {
        try {
          openAndroidApplication(packageName);
          return;
        } catch {
          // tenta próximo pacote
        }
      }

      const generatedIntentUrls = uniqueUrls(
        (selectedBank.androidPackageCandidates ?? []).flatMap((packageName) => [
          `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${packageName};end`,
          ...expandedSchemeUrls
            .map((schemeUrl) => extractSchemeName(schemeUrl))
            .filter(Boolean)
            .map((scheme) => `intent://open#Intent;scheme=${scheme};package=${packageName};end`),
        ]),
      );

      for (const intentUrl of uniqueUrls([...(selectedBank.androidIntentUrls ?? []), ...generatedIntentUrls])) {
        try {
          await Linking.openURL(intentUrl);
          return;
        } catch {
          // tenta próximo intent
        }
      }

      for (const packageName of selectedBank.androidPackageCandidates ?? []) {
        try {
          await Linking.openURL(`android-app://${packageName}`);
          return;
        } catch {
          // tenta próximo pacote
        }
      }

      const fallbackPackage = selectedBank.androidPackageCandidates?.[0];
      if (fallbackPackage) {
        try {
          await Linking.openURL(`market://details?id=${fallbackPackage}`);
          return;
        } catch {
          try {
            await Linking.openURL(`https://play.google.com/store/apps/details?id=${fallbackPackage}`);
            return;
          } catch {
            // segue para alerta final
          }
        }
      }
    }

    Alert.alert(
      'Falha ao abrir banco',
      `Não foi possível abrir ${selectedBank.label}. Confirme se o app está atualizado e tente outro banco no seletor.`,
      [{ text: 'Fechar' }, { text: 'Ok', style: 'cancel' }],
    );
  }, [config.chavePix, tenantPixBankId]);

  const handleTenantAlreadyPaid = async (paymentId: string) => {
    if (!profile?.casaId || !profile.id) {
      return;
    }

    const targetPayment = payments.find((payment) => payment.id === paymentId);
    const proofUrl = String(targetPayment?.comprovantePagamentoUrl ?? '').trim();
    if (!proofUrl) {
      Alert.alert('Comprovante obrigatório', 'Carregue o PDF do comprovante antes de clicar em "Já paguei".');
      return;
    }

    try {
      await withTimeout(markPaymentAsNotifiedByTenant(profile.casaId, paymentId, profile.id, proofUrl));
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

  const handleUploadTenantPaymentProof = async (payment: RentalPayment) => {
    if (!profile?.casaId || !profile.id) {
      return;
    }

    const key = `${profile.casaId}:${payment.id}`;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      setUploadingProofKey(key);

      const asset = result.assets[0];
      const safeName = sanitizeFilename(String(asset.name ?? '').trim() || `comprovante-${Date.now()}.pdf`);
      const finalFileName = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
      const path = `financeiro/comprovantes/${profile.casaId}/${payment.id}-${Date.now()}-${finalFileName}`;
      const uploadedUrl = await withTimeout(uploadFileAsync(asset.uri, path), 45000);

      await withTimeout(
        upsertRentalPayment(profile.casaId, payment.id, {
          comprovantePagamentoUrl: uploadedUrl,
        }),
      );
      await withTimeout(loadPayments(profile.casaId));
      Alert.alert('Comprovante anexado', 'Comprovante salvo com sucesso para este boleto.');
    } catch {
      Alert.alert('Erro', 'Não foi possível carregar o comprovante de pagamento.');
    } finally {
      setUploadingProofKey(null);
    }
  };

  const handleOwnerConfirmReceivedPayment = async (entry: OwnerPendingConfirmation) => {
    if (!profile?.id) {
      return;
    }

    const loadingKey = `${entry.houseId}:${entry.payment.id}`;

    try {
      setConfirmingOwnerPaymentKey(loadingKey);
      const paidAt = new Date().toISOString();
      await withTimeout(
        upsertRentalPayment(entry.houseId, entry.payment.id, {
          valor: getEffectivePaymentAmount(entry.payment, houseRentById[entry.houseId]),
          status: 'pago',
          dataPagamento: paidAt,
          formaPagamento: entry.payment.formaPagamento ?? 'Pix',
          marcadoComoPagoPeloInquilino: false,
        }),
      );

      await withTimeout(loadOwnerFinanceData(houses));
      if (selectedHouseId === entry.houseId) {
        await withTimeout(loadPayments(entry.houseId));
      }

      Alert.alert('Pagamento confirmado', 'Recebimento confirmado com sucesso.');
    } catch (error) {
      const code = (error as { code?: string } | undefined)?.code;
      Alert.alert(
        'Erro',
        code === 'operation-timeout'
          ? 'A confirmação demorou demais para responder. Tente novamente.'
          : 'Não foi possível confirmar o recebimento.',
      );
    } finally {
      setConfirmingOwnerPaymentKey(null);
    }
  };

  return (
    <ScreenContainer refreshing={loadingData} onRefresh={handleRefresh}>

      {isOwner ? (
        <AppCard>
          <Text style={styles.cardTitle}>Casa selecionada</Text>
          {houses.length ? (
            <AppSelect
              label="Casa"
              value={selectedHouseId ?? OWNER_OVERVIEW_OPTION_VALUE}
              onChange={(houseId) => {
                setSelectedHouseId(houseId);
                if (houseId === OWNER_OVERVIEW_OPTION_VALUE) {
                  setPayments([]);
                  return;
                }
                void loadPayments(houseId);
              }}
              options={[
                { label: 'Visão geral', value: OWNER_OVERVIEW_OPTION_VALUE },
                ...houses.map((house) => ({
                  label: house.nome || house.id,
                  value: house.id,
                })),
              ]}
            />
          ) : (
            <EmptyState title="Nenhuma casa encontrada" subtitle="Cadastre as casas para iniciar o financeiro." />
          )}
        </AppCard>
      ) : null}

      {ownerOverviewSelected && ownerMonthlyHouseOverview ? (
        <AppCard>
          <Text style={styles.cardTitle}>Visão geral de alugueis do mês</Text>
          <Text style={styles.subtitle}>Competência: {ownerMonthlyHouseOverview.competencia}</Text>

          <View style={styles.ownerOverviewStatsRow}>
            <View style={styles.ownerOverviewStatBox}>
              <Text style={styles.ownerOverviewStatValue}>{ownerMonthlyHouseOverview.paid.length}</Text>
              <Text style={styles.caption}>Pagaram</Text>
            </View>
            <View style={styles.ownerOverviewStatBox}>
              <Text style={styles.ownerOverviewStatValue}>{ownerMonthlyHouseOverview.awaitingConfirmation.length}</Text>
              <Text style={styles.caption}>Aguardando confirmação</Text>
            </View>
            <View style={styles.ownerOverviewStatBox}>
              <Text style={styles.ownerOverviewStatValue}>{ownerMonthlyHouseOverview.pending.length}</Text>
              <Text style={styles.caption}>Pendentes</Text>
            </View>
          </View>

          <View style={styles.ownerOverviewSection}>
            <View style={styles.paymentHeader}>
              <Text style={styles.paymentTitle}>Quem pagou este mês</Text>
              <StatusBadge text={`${ownerMonthlyHouseOverview.paid.length}/${ownerMonthlyHouseOverview.total}`} tone="success" />
            </View>
            {ownerMonthlyHouseOverview.paid.length ? (
              <Text style={styles.subtitle}>{ownerMonthlyHouseOverview.paid.join(' • ')}</Text>
            ) : (
              <Text style={styles.caption}>Nenhuma casa confirmou pagamento ainda.</Text>
            )}
          </View>

          {ownerMonthlyHouseOverview.pending.length ? (
            <View style={styles.ownerOverviewSection}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentTitle}>Pendentes para cobrança</Text>
                <StatusBadge text={String(ownerMonthlyHouseOverview.pending.length)} tone="warning" />
              </View>
              <Text style={styles.subtitle}>{ownerMonthlyHouseOverview.pending.join(' • ')}</Text>
            </View>
          ) : null}
        </AppCard>
      ) : null}

      {ownerOverviewSelected && ownerMonthlyLightOverview ? (
        <AppCard>
          <Text style={styles.cardTitle}>Visão geral da luz</Text>
          <Text style={styles.subtitle}>Competência: {ownerMonthlyLightOverview.competencia}</Text>

          <View style={styles.ownerOverviewStatsRow}>
            <View style={styles.ownerOverviewStatBox}>
              <Text style={styles.ownerOverviewStatValue}>{ownerMonthlyLightOverview.paid.length}</Text>
              <Text style={styles.caption}>Pagaram</Text>
            </View>
            <View style={styles.ownerOverviewStatBox}>
              <Text style={styles.ownerOverviewStatValue}>{ownerMonthlyLightOverview.awaitingConfirmation.length}</Text>
              <Text style={styles.caption}>Aguardando confirmação</Text>
            </View>
            <View style={styles.ownerOverviewStatBox}>
              <Text style={styles.ownerOverviewStatValue}>{ownerMonthlyLightOverview.pending.length}</Text>
              <Text style={styles.caption}>Pendentes</Text>
            </View>
          </View>

          <View style={styles.ownerOverviewSection}>
            <View style={styles.paymentHeader}>
              <Text style={styles.paymentTitle}>Quem pagou conta de luz</Text>
              <StatusBadge text={`${ownerMonthlyLightOverview.paid.length}/${ownerMonthlyLightOverview.total}`} tone="success" />
            </View>
            {ownerMonthlyLightOverview.paid.length ? (
              <Text style={styles.subtitle}>{ownerMonthlyLightOverview.paid.join(' • ')}</Text>
            ) : (
              <Text style={styles.caption}>Nenhuma casa confirmou a conta de luz ainda.</Text>
            )}
          </View>

          {ownerMonthlyLightOverview.awaitingConfirmation.length ? (
            <View style={styles.ownerOverviewSection}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentTitle}>Aguardando confirmação</Text>
                <StatusBadge text={String(ownerMonthlyLightOverview.awaitingConfirmation.length)} tone="info" />
              </View>
              <Text style={styles.subtitle}>{ownerMonthlyLightOverview.awaitingConfirmation.join(' • ')}</Text>
            </View>
          ) : null}

          {ownerMonthlyLightOverview.pending.length ? (
            <View style={styles.ownerOverviewSection}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentTitle}>Pendentes para cobrança</Text>
                <StatusBadge text={String(ownerMonthlyLightOverview.pending.length)} tone="warning" />
              </View>
              <Text style={styles.subtitle}>{ownerMonthlyLightOverview.pending.join(' • ')}</Text>
            </View>
          ) : null}
        </AppCard>
      ) : null}

      {ownerHouseSelected ? (
        <>
          <AppCard>
            <Text style={styles.cardTitle}>Confirmações de pagamento dos inquilinos</Text>
            {ownerPendingConfirmationsFiltered.length ? (
              ownerPendingConfirmationsFiltered.map((entry) => {
                const itemKey = `${entry.houseId}:${entry.payment.id}`;
                return (
                  <View key={itemKey} style={styles.paymentItem}>
                    <View style={styles.paymentHeader}>
                      <Text style={styles.paymentTitle}>
                        {getPaymentTypeLabel(entry.payment)} • {entry.payment.competencia}
                      </Text>
                      <StatusBadge text="Aguardando confirmação" tone="info" />
                    </View>
                    <Text style={styles.subtitle}>
                      Valor: {formatCurrencyBRL(getEffectivePaymentAmount(entry.payment, houseRentById[entry.houseId]))}
                    </Text>
                    <View style={styles.paymentActions}>
                      {entry.payment.tipo === 'luz' && entry.payment.boletoPdfUrl ? (
                        <AppButton
                          label="Abrir PDF da conta"
                          variant="ghost"
                          onPress={() => Linking.openURL(entry.payment.boletoPdfUrl as string)}
                        />
                      ) : null}
                      {entry.payment.comprovantePagamentoUrl ? (
                        <AppButton
                          label="Abrir comprovante"
                          variant="ghost"
                          onPress={() => Linking.openURL(entry.payment.comprovantePagamentoUrl as string)}
                        />
                      ) : null}
                      <AppButton
                        label="Confirmar recebimento"
                        onPress={() => handleOwnerConfirmReceivedPayment(entry)}
                        loading={confirmingOwnerPaymentKey === itemKey}
                        disabled={Boolean(confirmingOwnerPaymentKey && confirmingOwnerPaymentKey !== itemKey)}
                      />
                    </View>
                  </View>
                );
              })
            ) : (
              <EmptyState
                title="Sem confirmações pendentes"
                subtitle="Quando um inquilino marcar aluguel ou luz como pago, aparecerá aqui para confirmação."
              />
            )}
          </AppCard>

          <AppCard>
            <Text style={styles.cardTitle}>Conta de luz</Text>

            <AppInput
              label="Competência (AAAA-MM)"
              value={lightCompetencia}
              onChangeText={setLightCompetencia}
              placeholder="2026-03"
            />
            <AppInput
              label="Valor cobrado"
              value={lightValor}
              onChangeText={setLightValor}
              keyboardType="numeric"
              placeholder="180,90"
            />

            <AppButton
              label={lightPdfFile?.name ? `PDF: ${getFileNameFromPath(lightPdfFile.name, lightPdfFile.name)}` : 'Selecionar PDF da conta de luz (opcional)'}
              variant="ghost"
              onPress={handlePickLightPdf}
              disabled={uploadingLightPdf || submittingLightPayment || sendingLightCharge}
            />
            {lightPdfFile?.name ? <Text style={styles.caption}>Arquivo: {lightPdfFile.name}</Text> : null}

            <AppSelect
              label="Forma de pagamento"
              value={lightFormaPagamento}
              onChange={(value) => setLightFormaPagamento(value as 'Pix' | 'Dinheiro' | 'Transferencia')}
              options={[
                { label: 'Pix', value: 'Pix' },
                { label: 'Dinheiro', value: 'Dinheiro' },
                { label: 'Transferência', value: 'Transferencia' },
              ]}
            />

            <AppButton
              label="Enviar cobrança por chat privado"
              variant="ghost"
              onPress={sendLightChargeByChat}
              loading={sendingLightCharge}
              disabled={submittingLightPayment || uploadingLightPdf}
            />
          </AppCard>
        </>
      ) : !isOwner ? (
        <>
          <AppCard>
            <Text style={styles.cardTitle}>Aluguel atual</Text>
            {tenantCurrentRentPayment ? (
              <View style={styles.paymentItem}>
                <View style={styles.paymentHeader}>
                  <Text style={styles.paymentTitle}>{tenantCurrentRentPayment.competencia}</Text>
                  <StatusBadge
                    text={getPaymentStatusLabel(tenantCurrentRentPayment.status)}
                    tone={getPaymentStatusTone(tenantCurrentRentPayment.status)}
                  />
                </View>
                <Text style={styles.subtitle}>Valor: {formatCurrencyBRL(tenantCurrentRentPayment.valor)}</Text>
                <Text style={styles.subtitle}>
                  Vencimento: {tenantCurrentRentDueInfo?.dueDate ? formatDateBR(tenantCurrentRentDueInfo.dueDate.toISOString()) : '-'}
                </Text>
                <Text style={styles.subtitle}>Chave Pix: {config.chavePix || 'Não configurada'}</Text>
                {shouldShowTenantRentBill ? (
                  <Text style={styles.caption}>
                    {typeof tenantCurrentRentDueInfo?.daysUntilDue === 'number'
                      ? tenantCurrentRentDueInfo.daysUntilDue > 0
                        ? `Boleto disponível para pagamento • vence em ${tenantCurrentRentDueInfo.daysUntilDue} dia(s)`
                        : tenantCurrentRentDueInfo.daysUntilDue === 0
                          ? 'Boleto disponível para pagamento • vence hoje'
                          : `Boleto em atraso • vencido há ${Math.abs(tenantCurrentRentDueInfo.daysUntilDue)} dia(s)`
                      : 'Boleto disponível para pagamento'}
                  </Text>
                ) : (
                  <Text style={styles.caption}>O boleto aparece automaticamente faltando 5 dias para o vencimento.</Text>
                )}
                <View style={styles.paymentActions}>
                  {config.chavePix ? (
                    <>
                      <AppSelect
                        label="Banco para pagar com PIX"
                        value={tenantPixBankId}
                        onChange={setTenantPixBankId}
                        options={PIX_BANK_OPTIONS.map((option) => ({ label: option.label, value: option.id }))}
                      />
                      <AppButton
                        label={`Pagar com PIX (${PIX_BANK_OPTIONS.find((item) => item.id === tenantPixBankId)?.label ?? 'Banco'})`}
                        onPress={handleOpenPixBank}
                      />
                    </>
                  ) : null}
                  {canTenantMarkAsPaid(tenantCurrentRentPayment) && !hasPaymentProof(tenantCurrentRentPayment) ? (
                    <AppButton
                      label="Carregar comprovante PDF"
                      variant="ghost"
                      onPress={() => handleUploadTenantPaymentProof(tenantCurrentRentPayment)}
                      loading={uploadingProofKey === `${profile?.casaId ?? ''}:${tenantCurrentRentPayment.id}`}
                    />
                  ) : null}
                  {hasPaymentProof(tenantCurrentRentPayment) ? (
                    <AppButton
                      label="Abrir comprovante"
                      variant="ghost"
                      onPress={() => Linking.openURL(tenantCurrentRentPayment.comprovantePagamentoUrl as string)}
                    />
                  ) : null}
                  {shouldShowTenantRentBill && canTenantMarkAsPaid(tenantCurrentRentPayment) && hasPaymentProof(tenantCurrentRentPayment) ? (
                    <AppButton
                      label="Já paguei"
                      variant="secondary"
                      onPress={() => handleTenantAlreadyPaid(tenantCurrentRentPayment.id)}
                    />
                  ) : null}
                </View>
              </View>
            ) : (
              <EmptyState
                title="Sem aluguel lançado"
                subtitle="Quando o aluguel da competência atual estiver disponível, ele aparecerá aqui."
              />
            )}
          </AppCard>

          <AppCard>
            <Text style={styles.cardTitle}>Conta de luz atual</Text>
            {tenantCurrentLightPayment ? (
              <View style={styles.paymentItem}>
                <View style={styles.paymentHeader}>
                  <Text style={styles.paymentTitle}>{tenantCurrentLightPayment.competencia}</Text>
                  <StatusBadge
                    text={getPaymentStatusLabel(tenantCurrentLightPayment.status)}
                    tone={getPaymentStatusTone(tenantCurrentLightPayment.status)}
                  />
                </View>
                <Text style={styles.subtitle}>Valor: {formatCurrencyBRL(tenantCurrentLightPayment.valor)}</Text>
                <Text style={styles.caption}>
                  Data: {tenantCurrentLightPayment.dataPagamento ? formatDateBR(tenantCurrentLightPayment.dataPagamento) : '-'}
                </Text>
                <Text style={styles.subtitle}>Chave Pix: {config.chavePix || 'Não configurada'}</Text>
                <View style={styles.paymentActions}>
                  {config.chavePix ? (
                    <>
                      <AppSelect
                        label="Banco para pagar com PIX"
                        value={tenantPixBankId}
                        onChange={setTenantPixBankId}
                        options={PIX_BANK_OPTIONS.map((option) => ({ label: option.label, value: option.id }))}
                      />
                      <AppButton
                        label={`Pagar com PIX (${PIX_BANK_OPTIONS.find((item) => item.id === tenantPixBankId)?.label ?? 'Banco'})`}
                        onPress={handleOpenPixBank}
                      />
                    </>
                  ) : null}
                  {tenantCurrentLightPayment.boletoPdfUrl ? (
                    <AppButton
                      label="Abrir PDF da conta"
                      variant="ghost"
                      onPress={() => Linking.openURL(tenantCurrentLightPayment.boletoPdfUrl as string)}
                    />
                  ) : null}
                  {canTenantMarkAsPaid(tenantCurrentLightPayment) && !hasPaymentProof(tenantCurrentLightPayment) ? (
                    <AppButton
                      label="Carregar comprovante PDF"
                      variant="ghost"
                      onPress={() => handleUploadTenantPaymentProof(tenantCurrentLightPayment)}
                      loading={uploadingProofKey === `${profile?.casaId ?? ''}:${tenantCurrentLightPayment.id}`}
                    />
                  ) : null}
                  {hasPaymentProof(tenantCurrentLightPayment) ? (
                    <AppButton
                      label="Abrir comprovante"
                      variant="ghost"
                      onPress={() => Linking.openURL(tenantCurrentLightPayment.comprovantePagamentoUrl as string)}
                    />
                  ) : null}
                  {canTenantMarkAsPaid(tenantCurrentLightPayment) && hasPaymentProof(tenantCurrentLightPayment) ? (
                    <AppButton
                      label="Já paguei"
                      variant="secondary"
                      onPress={() => handleTenantAlreadyPaid(tenantCurrentLightPayment.id)}
                    />
                  ) : null}
                </View>
              </View>
            ) : (
              <EmptyState
                title="Sem conta de luz lançada"
                subtitle="Quando o proprietário lançar a cobrança da conta de luz, ela aparecerá aqui."
              />
            )}
          </AppCard>
        </>
      ) : null}

      {ownerHouseSelected ? (
        <AppCard>
          <Text style={styles.cardTitle}>Relatório mensal (competência atual)</Text>
          <Text style={styles.subtitle}>Total recebido: {formatCurrencyBRL(monthlySummary.pago)}</Text>
          <Text style={styles.subtitle}>Total pendente: {formatCurrencyBRL(monthlySummary.pendente)}</Text>
          <Text style={styles.subtitle}>Inadimplência: {formatCurrencyBRL(monthlySummary.inadimplencia)}</Text>
        </AppCard>
      ) : null}

      {(!isOwner || ownerHouseSelected) ? (
        <AppCard>
          <Text style={styles.cardTitle}>Histórico financeiro</Text>
          {historyEntries.length ? (
            historyEntries.map(({ key, houseId, houseLabel, payment }) => (
              <View key={key} style={styles.paymentItem}>
                <View style={styles.paymentHeader}>
                  <Text style={styles.paymentTitle}>
                    {isOwner && houseLabel
                      ? `${houseLabel} • ${payment.tipo === 'luz' ? 'Luz' : 'Aluguel'} • ${payment.competencia}`
                      : payment.tipo === 'luz'
                        ? `Luz • ${payment.competencia}`
                        : `Aluguel • ${payment.competencia}`}
                  </Text>
                  <StatusBadge
                    text={getPaymentStatusLabel(payment.status)}
                    tone={getPaymentStatusTone(payment.status)}
                  />
                </View>
                <Text style={styles.subtitle}>
                  {formatCurrencyBRL(
                    getEffectivePaymentAmount(payment, isOwner ? houseRentById[houseId] : selectedHouse?.aluguelMensal ?? 0),
                  )}
                </Text>
                <Text style={styles.caption}>Data: {payment.dataPagamento ? formatDateBR(payment.dataPagamento) : '-'}</Text>

                <View style={styles.historyActionsRow}>
                  <Pressable onPress={() => handleShareReceipt(payment)} style={styles.historyActionButton}>
                    <Text style={styles.historyActionText}>Recibo</Text>
                  </Pressable>

                  {payment.tipo === 'luz' && payment.boletoPdfUrl ? (
                    <Pressable onPress={() => Linking.openURL(payment.boletoPdfUrl as string)} style={styles.historyActionButton}>
                      <Text style={styles.historyActionText}>Boleto da Luz</Text>
                    </Pressable>
                  ) : null}

                  {(isOwner && hasPaymentProof(payment)) || (!isOwner && hasPaymentProof(payment)) ? (
                    <Pressable
                      onPress={() => Linking.openURL(payment.comprovantePagamentoUrl as string)}
                      style={styles.historyActionButton}
                    >
                      <Text style={styles.historyActionText}>Comprovante</Text>
                    </Pressable>
                  ) : null}

                  {!isOwner && canTenantMarkAsPaid(payment) && !hasPaymentProof(payment) ? (
                    <Pressable
                      onPress={() => handleUploadTenantPaymentProof(payment)}
                      style={styles.historyActionButton}
                      disabled={uploadingProofKey === `${profile?.casaId ?? ''}:${payment.id}`}
                    >
                      <Text style={styles.historyActionText}>
                        {uploadingProofKey === `${profile?.casaId ?? ''}:${payment.id}` ? 'Enviando...' : 'Enviar comprovante'}
                      </Text>
                    </Pressable>
                  ) : null}

                  {!isOwner && canTenantMarkAsPaid(payment) && hasPaymentProof(payment) ? (
                    <Pressable onPress={() => handleTenantAlreadyPaid(payment.id)} style={styles.historyActionButton}>
                      <Text style={styles.historyActionText}>Já paguei</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))
          ) : (
            <EmptyState title="Sem pagamentos registrados" subtitle="Quando houver lançamentos eles aparecerão aqui." />
          )}
        </AppCard>
      ) : null}
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
  subtitle: {
    color: palette.gray700,
    fontSize: 14,
  },
  caption: {
    color: palette.gray500,
    fontSize: 13,
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
    fontSize: 16,
    fontWeight: '700',
    color: palette.gray900,
  },
  paymentActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  historyActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  historyActionButton: {
    minHeight: 32,
    borderRadius: radii.pill,
    backgroundColor: palette.gray100,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
  },
  historyActionText: {
    color: palette.gray700,
    fontSize: 13,
    fontWeight: '700',
  },
  ownerOverviewStatsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ownerOverviewStatBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: spacing.xs,
  },
  ownerOverviewStatValue: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.gray900,
  },
  ownerOverviewSection: {
    borderWidth: 1,
    borderColor: palette.gray100,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
});
