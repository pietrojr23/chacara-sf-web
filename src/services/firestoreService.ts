import {
  addDoc,
  collection,
  CollectionReference,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from './firestoreLiteCompat';
import { addMonths, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import {
  AppConfig,
  AppUser,
  CameraConfig,
  ChatMessage,
  PrivateChatThread,
  PrivateChatThreadStatus,
  EmergencyContact,
  GateStatus,
  HouseDocument,
  House,
  MaintenanceTicket,
  Notice,
  RentalPayment,
  RentalStatus,
  Visitor,
} from '../types/models';
import { getFirebaseDb } from './firebase';
import { sendPushToUsers } from './notificationService';
import { buildPrivateChatId } from '../utils/chat';

const db = getFirebaseDb();

const toIso = (value?: { toDate?: () => Date } | string | null) => {
  if (!value) {
    return new Date().toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }

  return new Date().toISOString();
};

const mapDoc = <T>(id: string, data: DocumentData): T => ({
  id,
  ...data,
} as T);

const normalizeBoolean = (value: unknown, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
};

const normalizeOptionalString = (value: unknown) => {
  if (value == null) {
    return undefined;
  }

  const text = String(value).trim();
  return text ? text : undefined;
};

const normalizeAppUser = (id: string, data: DocumentData): AppUser => {
  const rawRole = String(data.role ?? '').trim().toLowerCase();
  const isOwner = normalizeBoolean(data.isOwner, rawRole === 'owner');
  const role: AppUser['role'] = isOwner || rawRole === 'owner' ? 'owner' : 'tenant';
  const createdAtRaw = data.createdAt;

  return {
    ...(data as AppUser),
    id,
    nome: normalizeOptionalString(data.nome) ?? 'Usuário',
    email: (normalizeOptionalString(data.email) ?? '').toLowerCase(),
    telefone: normalizeOptionalString(data.telefone),
    casaId: normalizeOptionalString(data.casaId),
    role,
    isOwner: role === 'owner',
    ativo: normalizeBoolean(data.ativo, true),
    photoURL: normalizeOptionalString(data.photoURL),
    createdAt:
      typeof createdAtRaw === 'string'
        ? createdAtRaw
        : typeof createdAtRaw?.toDate === 'function'
          ? createdAtRaw.toDate().toISOString()
          : undefined,
  };
};

const normalizeHouse = (id: string, data: DocumentData): House => {
  const moradores = Array.isArray(data.moradores)
    ? data.moradores
        .map((item) => {
          if (typeof item === 'string') {
            const nome = item.trim();
            return nome ? { nome } : null;
          }

          if (!item || typeof item !== 'object') {
            return null;
          }

          const record = item as Record<string, unknown>;
          const nome = String(record.nome ?? record.name ?? record.moradorNome ?? '').trim();
          const telefone = normalizeOptionalString(record.telefone ?? record.phone);
          const email = normalizeOptionalString(record.email ?? record.mail);
          const contatoRaw = record.contato ?? telefone ?? email;
          const fotoRaw = record.fotoUrl ?? record.fotoURL ?? record.photoUrl;
          const cpfRaw = String(record.cpf ?? record.CPF ?? '').replace(/\D/g, '');
          const parentesco = normalizeOptionalString(record.parentesco ?? record.relacao ?? record.relacionamento);
          const dataNascimento = normalizeOptionalString(
            record.dataNascimento ?? record.nascimento ?? record.birthDate,
          );
          const observacoes = normalizeOptionalString(record.observacoes ?? record.observacao ?? record.notas);

          return {
            nome,
            contato: contatoRaw ? String(contatoRaw).trim() : undefined,
            fotoUrl: fotoRaw ? String(fotoRaw).trim() : undefined,
            cpf: cpfRaw || undefined,
            telefone,
            email,
            parentesco,
            dataNascimento,
            observacoes,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .filter((item) => item.nome)
    : [];

  const veiculos = Array.isArray(data.veiculos)
    ? data.veiculos.map((item) => String(item)).filter(Boolean)
    : typeof data.veiculos === 'string' && data.veiculos.trim()
      ? [data.veiculos.trim()]
      : [];

  const pets = Array.isArray(data.pets)
    ? data.pets
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          nome: String(item.nome ?? '').trim(),
          especie: String(item.especie ?? '').trim(),
          raca: item.raca ? String(item.raca).trim() : undefined,
        }))
        .filter((item) => item.nome && item.especie)
    : [];

  return {
    ...(data as House),
    id,
    nome: String(data.nome ?? ''),
    numero: String(data.numero ?? ''),
    aluguelMensal: Number(data.aluguelMensal ?? 0),
    diaVencimento: Number(data.diaVencimento ?? 0),
    moradores,
    veiculos,
    pets,
  };
};

const sanitizeResidentsForWrite = (moradores: NonNullable<House['moradores']>) =>
  moradores
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const nome = String(item.nome ?? '').trim();
      const contato = item.contato ? String(item.contato).trim() : '';
      const fotoUrl = item.fotoUrl ? String(item.fotoUrl).trim() : '';
      const cpf = String(item.cpf ?? '').replace(/\D/g, '').trim();
      const telefone = item.telefone ? String(item.telefone).trim() : '';
      const email = item.email ? String(item.email).trim() : '';
      const parentesco = item.parentesco ? String(item.parentesco).trim() : '';
      const dataNascimento = item.dataNascimento ? String(item.dataNascimento).trim() : '';
      const observacoes = item.observacoes ? String(item.observacoes).trim() : '';

      if (!nome) {
        return null;
      }

      return {
        nome,
        ...(contato ? { contato } : {}),
        ...(fotoUrl ? { fotoUrl } : {}),
        ...(cpf ? { cpf } : {}),
        ...(telefone ? { telefone } : {}),
        ...(email ? { email } : {}),
        ...(parentesco ? { parentesco } : {}),
        ...(dataNascimento ? { dataNascimento } : {}),
        ...(observacoes ? { observacoes } : {}),
      };
    })
    .filter((item): item is {
      nome: string;
      contato?: string;
      fotoUrl?: string;
      cpf?: string;
      telefone?: string;
      email?: string;
      parentesco?: string;
      dataNascimento?: string;
      observacoes?: string;
    } => Boolean(item));

const sanitizeVehiclesForWrite = (veiculos: NonNullable<House['veiculos']>) =>
  Array.from(
    new Set(
      veiculos
        .map((item) => String(item ?? '').trim().toUpperCase())
        .filter(Boolean),
    ),
  );

const sanitizePetsForWrite = (pets: NonNullable<House['pets']>) =>
  pets
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const nome = String(item.nome ?? '').trim();
      const especie = String(item.especie ?? '').trim();
      const raca = item.raca ? String(item.raca).trim() : '';

      if (!nome || !especie) {
        return null;
      }

      return {
        nome,
        especie,
        ...(raca ? { raca } : {}),
      };
    })
    .filter((item): item is { nome: string; especie: string; raca?: string } => Boolean(item));

const normalizeCameraConfigs = (value: unknown): CameraConfig[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map<CameraConfig | null>((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const row = item as Record<string, unknown>;
      const nome = String(row.nome ?? '').trim();
      const rtspUrl = String(row.rtspUrl ?? row.url ?? '').trim();
      const playbackUrl = String(row.playbackUrl ?? row.hlsUrl ?? row.streamUrl ?? '').trim();
      const playbackUrlExternal = String(
        row.playbackUrlExternal ?? row.hlsUrlExternal ?? row.externalPlaybackUrl ?? '',
      ).trim();
      const casasPermitidas = Array.isArray(row.casasPermitidas)
        ? row.casasPermitidas.map((houseId) => String(houseId).trim()).filter(Boolean)
        : [];

      if (!nome || !rtspUrl) {
        return null;
      }

      const camera: CameraConfig = {
        id: String(row.id ?? `camera-${index + 1}`),
        nome,
        rtspUrl,
        playbackUrl: playbackUrl || undefined,
        playbackUrlExternal: playbackUrlExternal || undefined,
        casasPermitidas,
        ativo: normalizeBoolean(row.ativo, true),
        criadoEm: normalizeOptionalString(row.criadoEm),
        atualizadoEm: normalizeOptionalString(row.atualizadoEm),
      };

      return camera;
    })
    .filter((item): item is CameraConfig => Boolean(item));
};

const currentCompetencia = () => format(new Date(), 'yyyy-MM');

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const toCurrencyBRL = (value: number) => currencyFormatter.format(Number(value || 0));

const getDaysInMonth = (year: number, monthZeroBased: number) =>
  new Date(year, monthZeroBased + 1, 0).getDate();

const getNextDueDate = (today: Date, dueDayRaw: number) => {
  const dueDay = Math.min(31, Math.max(1, Math.trunc(Number(dueDayRaw || 1))));
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const currentMonthDayLimit = getDaysInMonth(currentYear, currentMonth);
  let dueDate = new Date(currentYear, currentMonth, Math.min(dueDay, currentMonthDayLimit));

  if (dueDate <= today) {
    const nextMonthDate = addMonths(new Date(currentYear, currentMonth, 1), 1);
    const nextYear = nextMonthDate.getFullYear();
    const nextMonth = nextMonthDate.getMonth();
    const nextMonthDayLimit = getDaysInMonth(nextYear, nextMonth);
    dueDate = new Date(nextYear, nextMonth, Math.min(dueDay, nextMonthDayLimit));
  }

  return startOfDay(dueDate);
};

const subscribeByPolling = <T>(
  fetcher: () => Promise<T>,
  callback: (value: T) => void,
  intervalMs = 4000,
) => {
  let active = true;
  let pending = false;

  const run = async () => {
    if (!active || pending) {
      return;
    }

    pending = true;
    try {
      const value = await fetcher();
      if (active) {
        callback(value);
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[firestoreService] polling error:', error);
      }
    } finally {
      pending = false;
    }
  };

  void run();
  const intervalId = setInterval(() => {
    void run();
  }, intervalMs);

  return () => {
    active = false;
    clearInterval(intervalId);
  };
};

const getGateStatus = async (): Promise<GateStatus> => {
  const snapshot = await getDoc(doc(db, 'configuracoes', 'gateStatus'));
  return (snapshot.data()?.status ?? 'fechado') as GateStatus;
};

const getAccessLogs = async (userId: string, isOwner: boolean) => {
  const baseQuery = isOwner
    ? query(collection(db, 'acessos'), orderBy('createdAt', 'desc'), limit(50))
    : query(
        collection(db, 'acessos'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(50),
      );

  const snapshot = await getDocs(baseQuery);
  return snapshot.docs.map((docItem) => {
    const data = docItem.data();
    return {
      id: docItem.id,
      ...data,
      createdAt: toIso(data.createdAt),
    };
  });
};

export const getUserProfile = async (uid: string): Promise<AppUser | null> => {
  const snapshot = await getDoc(doc(db, 'users', uid));

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeAppUser(snapshot.id, snapshot.data());
};

export const subscribeGateStatus = (callback: (status: GateStatus) => void) =>
  subscribeByPolling(getGateStatus, callback, 3000);

export const subscribeAccessLogs = (
  userId: string,
  isOwner: boolean,
  callback: (logs: Array<Record<string, unknown>>) => void,
) => subscribeByPolling(() => getAccessLogs(userId, isOwner), callback, 4000);

export const getGlobalConfig = async (): Promise<AppConfig> => {
  const snapshot = await getDoc(doc(db, 'configuracoes', 'global'));

  if (!snapshot.exists()) {
    return {
      propriedadeNome: 'Chácara São Francisco',
      chavePix: '',
      headlights: [],
      tenantGateAccess: {
        enabled: true,
        defaultWindowStart: '06:00',
        defaultWindowEnd: '23:00',
        defaultCooldownSeconds: 30,
        defaultMaxOpensPerDay: 10,
        defaultRequireProximity: true,
        defaultMaxDistanceMeters: 200,
        defaultRequireBiometric: true,
        houseRules: [],
      },
      tarifaEnergia: 0,
      temaEscuroAtivo: false,
      notificacoes: {
        avisos: true,
        chamados: true,
        financeiro: true,
        chat: true,
        visitantes: true,
      },
    };
  }

  return snapshot.data() as AppConfig;
};

export const updateGlobalConfig = async (payload: Partial<AppConfig>) => {
  await setDoc(doc(db, 'configuracoes', 'global'), payload, { merge: true });
};

export const getCameraConfigs = async (): Promise<CameraConfig[]> => {
  const snapshot = await getDoc(doc(db, 'configuracoes', 'cameras'));

  if (!snapshot.exists()) {
    return [];
  }

  const data = snapshot.data();
  const rawItems = Array.isArray(data.items) ? data.items : data.cameras;

  return normalizeCameraConfigs(rawItems).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
};

export const saveCameraConfigs = async (items: CameraConfig[]) => {
  const normalized = normalizeCameraConfigs(items).map((item) => ({
    id: item.id,
    nome: item.nome,
    rtspUrl: item.rtspUrl,
    playbackUrl: item.playbackUrl ?? null,
    playbackUrlExternal: item.playbackUrlExternal ?? null,
    casasPermitidas: item.casasPermitidas,
    ativo: item.ativo,
    criadoEm: item.criadoEm ?? new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  }));

  await setDoc(
    doc(db, 'configuracoes', 'cameras'),
    {
      items: normalized,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
};

export const getHouseProfile = async (houseId: string): Promise<House | null> => {
  const snapshot = await getDoc(doc(db, 'casas', houseId));

  if (!snapshot.exists()) {
    return null;
  }

  return normalizeHouse(snapshot.id, snapshot.data());
};

export const getAllHouses = async (): Promise<House[]> => {
  const snapshot = await getDocs(collection(db, 'casas'));

  return snapshot.docs
    .map((item) => normalizeHouse(item.id, item.data()))
    .sort((a, b) => {
      const numeroA = String(a.numero ?? '').trim();
      const numeroB = String(b.numero ?? '').trim();

      if (numeroA && numeroB) {
        return numeroA.localeCompare(numeroB, 'pt-BR', { numeric: true });
      }

      if (numeroA) {
        return -1;
      }

      if (numeroB) {
        return 1;
      }

      return String(a.nome ?? '').localeCompare(String(b.nome ?? ''), 'pt-BR');
    });
};

export const upsertHouse = async (payload: House) => {
  await setDoc(doc(db, 'casas', payload.id), payload, { merge: true });
};

export const updateHouseResidents = async (
  houseId: string,
  moradores: NonNullable<House['moradores']>,
) => {
  const normalizedResidents = sanitizeResidentsForWrite(moradores);

  await setDoc(
    doc(db, 'casas', houseId),
    {
      moradores: normalizedResidents,
    },
    { merge: true },
  );
};

export const updateHouseVehicles = async (
  houseId: string,
  veiculos: NonNullable<House['veiculos']>,
) => {
  const normalizedVehicles = sanitizeVehiclesForWrite(veiculos);

  await setDoc(
    doc(db, 'casas', houseId),
    {
      veiculos: normalizedVehicles,
    },
    { merge: true },
  );
};

export const updateHousePets = async (
  houseId: string,
  pets: NonNullable<House['pets']>,
) => {
  const normalizedPets = sanitizePetsForWrite(pets);

  await setDoc(
    doc(db, 'casas', houseId),
    {
      pets: normalizedPets,
    },
    { merge: true },
  );
};

export const getHouseDocuments = async (houseId: string): Promise<HouseDocument[]> => {
  const snapshot = await getDocs(
    query(collection(db, 'documentos', houseId, 'docs'), orderBy('criadoEm', 'desc'), limit(40)),
  );

  return snapshot.docs.map((item) => {
    const data = item.data();
    return {
      ...(data as HouseDocument),
      id: item.id,
      criadoEm: toIso(data.criadoEm),
    };
  });
};

export const upsertHouseDocument = async (houseId: string, payload: HouseDocument) => {
  await setDoc(
    doc(db, 'documentos', houseId, 'docs', payload.id),
    {
      ...payload,
      criadoEm: payload.criadoEm ?? serverTimestamp(),
    },
    { merge: true },
  );
};

const getPaymentType = (paymentId: string, tipo?: RentalPayment['tipo']): NonNullable<RentalPayment['tipo']> =>
  tipo === 'luz' || paymentId.startsWith('luz-') ? 'luz' : 'aluguel';

const resolvePaymentCompetencia = (
  paymentId: string,
  competencia?: string,
  tipo?: RentalPayment['tipo'],
) => {
  const fallback = getPaymentType(paymentId, tipo) === 'luz'
    ? paymentId.replace(/^luz-/, '').trim()
    : paymentId.trim();
  return String(competencia ?? fallback).trim();
};

const getCanonicalPaymentId = (params: { paymentId: string; competencia?: string; tipo?: RentalPayment['tipo'] }) => {
  const tipo = getPaymentType(params.paymentId, params.tipo);
  const competencia = resolvePaymentCompetencia(params.paymentId, params.competencia, tipo);
  if (!competencia) {
    return params.paymentId;
  }

  return tipo === 'luz' ? `luz-${competencia}` : competencia;
};

const getPaymentStatusScore = (status?: RentalStatus) => {
  if (status === 'pago') {
    return 4;
  }
  if (status === 'aguardando_confirmacao') {
    return 3;
  }
  if (status === 'vencido') {
    return 2;
  }
  return 1;
};

const shouldReplacePaymentRecord = (current: RentalPayment, candidate: RentalPayment) => {
  const candidateScore = getPaymentStatusScore(candidate.status);
  const currentScore = getPaymentStatusScore(current.status);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const candidateDate = new Date(String(candidate.dataPagamento ?? '')).getTime();
  const currentDate = new Date(String(current.dataPagamento ?? '')).getTime();
  if (Number.isFinite(candidateDate) && Number.isFinite(currentDate) && candidateDate !== currentDate) {
    return candidateDate > currentDate;
  }

  const candidateCanonicalId = getCanonicalPaymentId({
    paymentId: candidate.id,
    competencia: candidate.competencia,
    tipo: candidate.tipo,
  });
  return candidate.id === candidateCanonicalId && current.id !== candidateCanonicalId;
};

export const getRentalPayments = async (houseId: string): Promise<RentalPayment[]> => {
  const paymentsRef = collection(db, 'alugueis', houseId, 'pagamentos');
  const snapshot = await getDocs(query(paymentsRef, orderBy('competencia', 'desc')));
  const mapped = snapshot.docs.map((item) => {
    const data = item.data();
    const tipo = getPaymentType(item.id, data.tipo as RentalPayment['tipo']);
    const competencia = resolvePaymentCompetencia(item.id, data.competencia as string | undefined, tipo);

    return {
      ...(data as RentalPayment),
      id: item.id,
      tipo,
      competencia,
      dataPagamento: toIso(data.dataPagamento),
    } as RentalPayment;
  });

  const dedupedByMonth = new Map<string, RentalPayment>();
  mapped.forEach((payment) => {
    const key = `${payment.tipo ?? 'aluguel'}:${payment.competencia}`;
    const existing = dedupedByMonth.get(key);
    if (!existing || shouldReplacePaymentRecord(existing, payment)) {
      dedupedByMonth.set(key, payment);
    }
  });

  return Array.from(dedupedByMonth.values()).sort((left, right) => right.competencia.localeCompare(left.competencia));
};

export const upsertRentalPayment = async (
  houseId: string,
  paymentId: string,
  payload: Partial<RentalPayment>,
) => {
  const canonicalType = getPaymentType(paymentId, payload.tipo);
  const canonicalCompetencia = resolvePaymentCompetencia(paymentId, payload.competencia, canonicalType);
  const canonicalPaymentId = getCanonicalPaymentId({
    paymentId,
    competencia: canonicalCompetencia,
    tipo: canonicalType,
  });

  await setDoc(doc(db, 'alugueis', houseId, 'pagamentos', canonicalPaymentId), {
    ...payload,
    tipo: canonicalType,
    ...(canonicalCompetencia ? { competencia: canonicalCompetencia } : {}),
  }, {
    merge: true,
  });

  if (payload.status === 'pago') {
    try {
      const users = await getAllUsers();
      const tenantIds = getActiveTenantIdsByHouse(users, houseId);

      notifyUsersSafe({
        topic: 'financeiro',
        userIds: tenantIds,
        title: 'Pagamento confirmado',
        body: `Seu pagamento da competência ${canonicalCompetencia || paymentId} foi confirmado.`,
        data: {
          type: 'payment_confirmed',
          houseId,
          paymentId: canonicalPaymentId,
        },
      });
    } catch (error) {
      if (__DEV__) {
        console.warn('[push] falha ao notificar pagamento confirmado:', error);
      }
    }
  }
};

export const markPaymentAsNotifiedByTenant = async (
  houseId: string,
  paymentId: string,
  userId: string,
  comprovantePagamentoUrl?: string,
) => {
  await setDoc(
    doc(db, 'alugueis', houseId, 'pagamentos', paymentId),
    {
      status: 'aguardando_confirmacao',
      marcadoComoPagoPeloInquilino: true,
      confirmadoPeloInquilinoEm: serverTimestamp(),
      confirmadoPeloInquilinoId: userId,
      ...(comprovantePagamentoUrl ? { comprovantePagamentoUrl } : {}),
    },
    { merge: true },
  );

  try {
    const users = await getAllUsers();
    const ownerIds = getOwnerIds(users);

    notifyUsersSafe({
      topic: 'financeiro',
      userIds: ownerIds.filter((id) => id !== userId),
      title: 'Confirmação pendente de pagamento',
      body: `Casa ${houseId} informou pagamento da competência ${paymentId}.`,
      data: {
        type: 'payment_marked_by_tenant',
        houseId,
        paymentId,
        tenantId: userId,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar pagamento marcado pelo inquilino:', error);
    }
  }
};

export const getTickets = async (params: {
  isOwner: boolean;
  houseId?: string;
  userId: string;
}): Promise<MaintenanceTicket[]> => {
  let ticketsQuery;

  if (params.isOwner) {
    ticketsQuery = query(collection(db, 'chamados'), orderBy('criadoEm', 'desc'));
  } else {
    ticketsQuery = query(
      collection(db, 'chamados'),
      where('casaId', '==', params.houseId),
      orderBy('criadoEm', 'desc'),
    );
  }

  const snapshot = await getDocs(ticketsQuery);

  return snapshot.docs.map((item) => {
    const data = item.data();

    return {
      ...(data as MaintenanceTicket),
      id: item.id,
      criadoEm: toIso(data.criadoEm),
      fechadoEm: toIso(data.fechadoEm),
    };
  });
};

export const createTicket = async (payload: Omit<MaintenanceTicket, 'id'>) => {
  const ref = await addDoc(collection(db, 'chamados'), {
    ...payload,
    criadoEm: serverTimestamp(),
  });

  try {
    const users = await getAllUsers();
    const ownerIds = getOwnerIds(users);
    const tenantsFromHouse = getActiveTenantIdsByHouse(users, payload.casaId);
    const senderIsOwner = ownerIds.includes(payload.criadorId);
    const recipients = senderIsOwner ? tenantsFromHouse : ownerIds;

    notifyUsersSafe({
      topic: 'chamados',
      userIds: recipients.filter((id) => id !== payload.criadorId),
      title: 'Novo chamado',
      body: `${payload.casaNome ?? payload.casaId}: ${payload.titulo}`,
      data: {
        type: 'ticket_created',
        ticketId: ref.id,
        houseId: payload.casaId,
        urgency: payload.urgencia,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar novo chamado:', error);
    }
  }

  return ref.id;
};

export const updateTicket = async (ticketId: string, payload: Partial<MaintenanceTicket>) => {
  const ticketRef = doc(db, 'chamados', ticketId);
  const ticketSnapshot = await getDoc(ticketRef);
  const ticketData = ticketSnapshot.exists() ? (ticketSnapshot.data() as MaintenanceTicket) : null;

  await setDoc(
    ticketRef,
    {
      ...payload,
      ...(payload.status === 'Concluido' ? { fechadoEm: serverTimestamp() } : {}),
    },
    { merge: true },
  );

  if (!ticketData) {
    return;
  }

  try {
    const users = await getAllUsers();
    const ownerIds = getOwnerIds(users);
    const recipients = new Set<string>([ticketData.criadorId, ...ownerIds]);

    notifyUsersSafe({
      topic: 'chamados',
      userIds: Array.from(recipients),
      title: 'Chamado atualizado',
      body: payload.status
        ? `${ticketData.titulo} agora está: ${payload.status}.`
        : `O chamado "${ticketData.titulo}" recebeu uma atualização.`,
      data: {
        type: 'ticket_updated',
        ticketId,
        houseId: ticketData.casaId,
        status: payload.status ?? ticketData.status,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar atualização de chamado:', error);
    }
  }
};

export const addTicketComment = async (
  ticketId: string,
  userId: string,
  userName: string,
  text: string,
) => {
  const ticketRef = doc(db, 'chamados', ticketId);
  const ticket = await getDoc(ticketRef);
  const comments = (ticket.data()?.comentarios ?? []) as NonNullable<MaintenanceTicket['comentarios']>;
  const ticketData = ticket.data() as MaintenanceTicket;

  await updateDoc(ticketRef, {
    comentarios: [
      ...comments,
      {
        autorId: userId,
        autorNome: userName,
        texto: text,
        data: new Date().toISOString(),
      },
    ],
  });

  try {
    const users = await getAllUsers();
    const ownerIds = getOwnerIds(users);
    const recipients = new Set<string>([ticketData.criadorId, ...ownerIds]);
    recipients.delete(userId);

    notifyUsersSafe({
      topic: 'chamados',
      userIds: Array.from(recipients),
      title: 'Novo comentário em chamado',
      body: `${userName}: ${text.trim().slice(0, 120)}`,
      data: {
        type: 'ticket_comment',
        ticketId,
        houseId: ticketData.casaId,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar comentário de chamado:', error);
    }
  }
};

export const getNotices = async (params: {
  isOwner: boolean;
  houseId?: string;
}): Promise<Notice[]> => {
  const snapshot = await getDocs(query(collection(db, 'avisos'), orderBy('criadoEm', 'desc')));

  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        ...(data as Notice),
        id: item.id,
        criadoEm: toIso(data.criadoEm),
      };
    })
    .filter((notice) => params.isOwner || !notice.alvoCasaId || notice.alvoCasaId === params.houseId)
    .sort((a, b) => {
      const pinnedDiff = Number(b.pinned) - Number(a.pinned);
      if (pinnedDiff !== 0) {
        return pinnedDiff;
      }
      return b.criadoEm.localeCompare(a.criadoEm);
    });
};

export const publishNotice = async (payload: Omit<Notice, 'id' | 'criadoEm' | 'leitores'>) => {
  if (payload.pinned) {
    const pinnedSnapshot = await getDocs(
      query(collection(db, 'avisos'), where('pinned', '==', true)),
    );

    await Promise.all(
      pinnedSnapshot.docs.map((item) =>
        updateDoc(doc(db, 'avisos', item.id), {
          pinned: false,
        }),
      ),
    );
  }

  const ref = await addDoc(collection(db, 'avisos'), {
    ...payload,
    leitores: [],
    criadoEm: serverTimestamp(),
  });

  try {
    const users = await getAllUsers();
    const recipients = users
      .filter((user) => !user.isOwner && user.ativo)
      .filter((user) => !payload.alvoCasaId || user.casaId === payload.alvoCasaId)
      .map((user) => user.id);

    notifyUsersSafe({
      topic: 'avisos',
      userIds: recipients.filter((id) => id !== payload.autorId),
      title: 'Novo aviso',
      body: payload.titulo,
      data: {
        type: 'notice_created',
        noticeId: ref.id,
        targetHouseId: payload.alvoCasaId ?? null,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar novo aviso:', error);
    }
  }
};

export const markNoticeRead = async (noticeId: string, userId: string) => {
  const noticeRef = doc(db, 'avisos', noticeId);
  const snapshot = await getDoc(noticeRef);

  if (!snapshot.exists()) {
    return;
  }

  const readers = snapshot.data().leitores as string[] | undefined;
  const dedup = new Set([...(readers ?? []), userId]);

  await updateDoc(noticeRef, {
    leitores: Array.from(dedup),
  });
};

const getGeneralChatMessagesRef = () =>
  collection(db, 'chat', 'geral', 'mensagens') as CollectionReference<DocumentData>;

const getPrivateChatMessagesRef = (chatId: string) =>
  collection(db, 'chat', 'privado', chatId, 'mensagens') as CollectionReference<DocumentData>;

const getPrivateChatThreadsCollectionRef = () =>
  collection(db, 'chatThreads') as CollectionReference<DocumentData>;

const getPrivateChatThreadRef = (threadId: string) =>
  doc(db, 'chatThreads', threadId);

const getLegacyPrivateChatThreadsConfigRef = () =>
  doc(db, 'configuracoes', 'chatThreads');

let privateChatThreadsCache: Record<string, DocumentData> | null = null;
let privateChatThreadsStorageMode: 'unknown' | 'table' | 'legacy' = 'unknown';
let privateChatThreadsMigratedFromLegacy = false;

const normalizePrivateChatThread = (id: string, data: DocumentData): PrivateChatThread => ({
  id,
  baseChatId: normalizeOptionalString(data.baseChatId) ?? id,
  ownerId: normalizeOptionalString(data.ownerId) ?? '',
  tenantId: normalizeOptionalString(data.tenantId) ?? '',
  participantIds: Array.isArray(data.participantIds)
    ? data.participantIds.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
    : [],
  title: normalizeOptionalString(data.title) ?? 'Conversa privada',
  status: String(data.status ?? '').trim().toLowerCase() === 'concluido' ? 'concluido' : 'aberto',
  createdById: normalizeOptionalString(data.createdById) ?? '',
  createdByName: normalizeOptionalString(data.createdByName) ?? '',
  createdAt: toIso(data.createdAt),
  updatedAt: toIso(data.updatedAt),
  closedAt: normalizeOptionalString(data.closedAt) ?? (typeof data.closedAt?.toDate === 'function'
    ? data.closedAt.toDate().toISOString()
    : undefined),
  closedById: normalizeOptionalString(data.closedById),
  closedByName: normalizeOptionalString(data.closedByName),
  autoTitleGenerated: normalizeBoolean(data.autoTitleGenerated, false),
  autoTitleUpdatedAt:
    normalizeOptionalString(data.autoTitleUpdatedAt)
    ?? (typeof data.autoTitleUpdatedAt?.toDate === 'function'
      ? data.autoTitleUpdatedAt.toDate().toISOString()
      : undefined),
  autoTitleMessageCount: Number.isFinite(Number(data.autoTitleMessageCount ?? Number.NaN))
    ? Number(data.autoTitleMessageCount)
    : undefined,
});

const extractBasePrivateChatId = (chatId: string) => {
  const raw = String(chatId ?? '').trim();
  if (!raw) {
    return '';
  }

  const separatorIndex = raw.indexOf('__');
  if (separatorIndex < 0) {
    return raw;
  }

  return raw.slice(0, separatorIndex);
};

const isPrivateChatThreadsTableUnavailableError = (error: unknown) => {
  const value = error as { code?: unknown; message?: unknown } | undefined;
  const code = String(value?.code ?? '').trim().toLowerCase();
  const message = String(value?.message ?? '').trim().toLowerCase();

  if (code === '42p01' || code === 'route-not-mapped') {
    return true;
  }

  return message.includes('chat_threads') && message.includes('exist');
};

const getLegacyPrivateChatThreadsMap = async (): Promise<Record<string, DocumentData>> => {
  const snapshot = await getDoc(getLegacyPrivateChatThreadsConfigRef());
  if (!snapshot.exists()) {
    return {};
  }

  const raw = snapshot.data().threadsById;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }

  return { ...(raw as Record<string, DocumentData>) };
};

const saveLegacyPrivateChatThreadsMap = async (threadsById: Record<string, DocumentData>) => {
  await setDoc(
    getLegacyPrivateChatThreadsConfigRef(),
    {
      threadsById,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

const getTablePrivateChatThreadsMap = async (): Promise<Record<string, DocumentData>> => {
  const snapshot = await getDocs(query(getPrivateChatThreadsCollectionRef(), orderBy('updatedAt', 'desc'), limit(5000)));
  return snapshot.docs.reduce<Record<string, DocumentData>>((acc, item) => {
    const data = item.data();
    if (data && typeof data === 'object') {
      acc[item.id] = data;
    }
    return acc;
  }, {});
};

const migrateLegacyPrivateChatThreadsToTable = async (legacyThreadsById: Record<string, DocumentData>) => {
  const entries = Object.entries(legacyThreadsById).filter(
    ([threadId, data]) => Boolean(String(threadId ?? '').trim()) && Boolean(data && typeof data === 'object'),
  );
  if (!entries.length) {
    privateChatThreadsMigratedFromLegacy = true;
    return;
  }

  await Promise.all(
    entries.map(([threadId, data]) =>
      setDoc(getPrivateChatThreadRef(threadId), data, { merge: true }),
    ),
  );
  privateChatThreadsMigratedFromLegacy = true;
};

const getPrivateChatThreadsMap = async (): Promise<Record<string, DocumentData>> => {
  if (privateChatThreadsStorageMode === 'legacy') {
    const legacyThreads = await getLegacyPrivateChatThreadsMap();
    privateChatThreadsCache = legacyThreads;
    return { ...legacyThreads };
  }

  try {
    let tableThreads = await getTablePrivateChatThreadsMap();
    privateChatThreadsStorageMode = 'table';

    if (!Object.keys(tableThreads).length && !privateChatThreadsMigratedFromLegacy) {
      const legacyThreads = await getLegacyPrivateChatThreadsMap();
      if (Object.keys(legacyThreads).length) {
        await migrateLegacyPrivateChatThreadsToTable(legacyThreads);
        tableThreads = await getTablePrivateChatThreadsMap();
      } else {
        privateChatThreadsMigratedFromLegacy = true;
      }
    }

    privateChatThreadsCache = tableThreads;
    return { ...tableThreads };
  } catch (error) {
    if (!isPrivateChatThreadsTableUnavailableError(error)) {
      throw error;
    }

    privateChatThreadsStorageMode = 'legacy';
    const legacyThreads = await getLegacyPrivateChatThreadsMap();
    privateChatThreadsCache = legacyThreads;
    return { ...legacyThreads };
  }
};

const savePrivateChatThreadsMap = async (threadsById: Record<string, DocumentData>) => {
  const previous = privateChatThreadsCache ?? {};
  const changedEntries = Object.entries(threadsById).filter(([threadId, data]) => previous[threadId] !== data);

  if (privateChatThreadsStorageMode !== 'legacy') {
    try {
      const entriesToPersist = changedEntries.length ? changedEntries : Object.entries(threadsById);
      if (entriesToPersist.length) {
        await Promise.all(
          entriesToPersist.map(([threadId, data]) =>
            setDoc(getPrivateChatThreadRef(threadId), data, { merge: true }),
          ),
        );
      }
      privateChatThreadsStorageMode = 'table';
    } catch (error) {
      if (!isPrivateChatThreadsTableUnavailableError(error)) {
        throw error;
      }
      privateChatThreadsStorageMode = 'legacy';
    }
  }

  try {
    await saveLegacyPrivateChatThreadsMap(threadsById);
  } catch (error) {
    if (__DEV__) {
      console.warn('[chat] falha ao sincronizar threads legado:', error);
    }
  }

  privateChatThreadsCache = { ...threadsById };
};

const touchPrivateChatThread = async (threadId: string) => {
  const normalizedThreadId = String(threadId ?? '').trim();
  if (!normalizedThreadId) {
    return;
  }

  const threadsById = await getPrivateChatThreadsMap();
  const existing = threadsById[normalizedThreadId];
  if (!existing || typeof existing !== 'object') {
    return;
  }

  threadsById[normalizedThreadId] = {
    ...existing,
    updatedAt: new Date().toISOString(),
  };
  await savePrivateChatThreadsMap(threadsById);
};

export const getGeneralMessages = async (): Promise<ChatMessage[]> => {
  const snapshot = await getDocs(query(getGeneralChatMessagesRef(), orderBy('enviadoEm', 'desc'), limit(150)));

  return snapshot.docs
    .map((item) => {
      const data = item.data();

      return {
        ...(data as ChatMessage),
        id: item.id,
        chatId: 'geral',
        enviadoEm: toIso(data.enviadoEm),
      };
    })
    .sort((left, right) => left.enviadoEm.localeCompare(right.enviadoEm));
};

export const getPrivateMessages = async (chatId: string): Promise<ChatMessage[]> => {
  const snapshot = await getDocs(
    query(getPrivateChatMessagesRef(chatId), orderBy('enviadoEm', 'desc'), limit(150)),
  );

  return snapshot.docs
    .map((item) => {
      const data = item.data();

      return {
        ...(data as ChatMessage),
        id: item.id,
        chatId,
        enviadoEm: toIso(data.enviadoEm),
      };
    })
    .sort((left, right) => left.enviadoEm.localeCompare(right.enviadoEm));
};

export const subscribeGeneralMessages = (callback: (messages: ChatMessage[]) => void) =>
  subscribeByPolling(getGeneralMessages, callback, 2500);

export const subscribePrivateMessages = (chatId: string, callback: (messages: ChatMessage[]) => void) =>
  subscribeByPolling(() => getPrivateMessages(chatId), callback, 2500);

export const getPrivateChatThreadsForUser = async (userId: string): Promise<PrivateChatThread[]> => {
  const normalizedUserId = String(userId ?? '').trim();
  if (!normalizedUserId) {
    return [];
  }

  const threadsById = await getPrivateChatThreadsMap();
  return Object.entries(threadsById)
    .map(([id, data]) => normalizePrivateChatThread(id, data))
    .filter((thread) => thread.participantIds.includes(normalizedUserId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const subscribePrivateChatThreadsForUser = (
  userId: string,
  callback: (threads: PrivateChatThread[]) => void,
) => subscribeByPolling(() => getPrivateChatThreadsForUser(userId), callback, 4000);

export const getPrivateChatThreadById = async (threadId: string): Promise<PrivateChatThread | null> => {
  const normalizedThreadId = String(threadId ?? '').trim();
  if (!normalizedThreadId) {
    return null;
  }

  const threadsById = await getPrivateChatThreadsMap();
  const raw = threadsById[normalizedThreadId];
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  return normalizePrivateChatThread(normalizedThreadId, raw);
};

export const createPrivateChatThread = async (params: {
  ownerId: string;
  tenantId: string;
  title: string;
  createdById: string;
  createdByName: string;
}): Promise<PrivateChatThread> => {
  const ownerId = String(params.ownerId ?? '').trim();
  const tenantId = String(params.tenantId ?? '').trim();
  const createdById = String(params.createdById ?? '').trim();
  const createdByName = String(params.createdByName ?? '').trim() || 'Usuário';
  const title = String(params.title ?? '').trim() || 'Novo assunto';

  if (!ownerId || !tenantId || !createdById) {
    throw new Error('Dados inválidos para criar a conversa privada.');
  }

  const baseChatId = buildPrivateChatId(ownerId, tenantId);
  const now = new Date().toISOString();
  const threadId = `${baseChatId}__${Date.now()}`;
  const threadsById = await getPrivateChatThreadsMap();
  threadsById[threadId] = {
    baseChatId,
    ownerId,
    tenantId,
    participantIds: [ownerId, tenantId],
    title,
    status: 'aberto',
    createdById,
    createdByName,
    createdAt: now,
    updatedAt: now,
    autoTitleGenerated: false,
    autoTitleUpdatedAt: '',
    autoTitleMessageCount: 0,
  };
  await savePrivateChatThreadsMap(threadsById);

  return {
    id: threadId,
    baseChatId,
    ownerId,
    tenantId,
    participantIds: [ownerId, tenantId],
    title,
    status: 'aberto',
    createdById,
    createdByName,
    createdAt: now,
    updatedAt: now,
    autoTitleGenerated: false,
    autoTitleUpdatedAt: '',
    autoTitleMessageCount: 0,
  };
};

export const setPrivateChatThreadStatus = async (params: {
  threadId: string;
  status: PrivateChatThreadStatus;
  actorId: string;
  actorName: string;
}) => {
  const threadId = String(params.threadId ?? '').trim();
  const actorId = String(params.actorId ?? '').trim();
  const actorName = String(params.actorName ?? '').trim() || 'Usuário';
  const status = params.status === 'concluido' ? 'concluido' : 'aberto';
  const baseChatId = extractBasePrivateChatId(threadId);
  const members = extractPrivateChatMembers(threadId);
  const ownerIdFromMembers = members[0] ?? '';
  const tenantIdFromMembers = members[1] ?? '';

  if (!threadId || !actorId) {
    throw new Error('Dados inválidos para atualizar o chat.');
  }

  const now = new Date().toISOString();
  const threadsById = await getPrivateChatThreadsMap();
  const currentRaw = threadsById[threadId];
  const currentThread = currentRaw && typeof currentRaw === 'object'
    ? normalizePrivateChatThread(threadId, currentRaw)
    : null;
  const resolvedTitle = currentThread?.title ?? 'Conversa privada';
  const resolvedParticipants = currentThread?.participantIds?.length ? currentThread.participantIds : members;
  const resolvedOwnerId = currentThread?.ownerId || ownerIdFromMembers;
  const resolvedTenantId = currentThread?.tenantId || tenantIdFromMembers;
  const createdById = currentThread?.createdById || actorId;
  const createdByName = currentThread?.createdByName || actorName;
  const createdAt = currentThread?.createdAt || now;
  const autoTitleGenerated = Boolean(currentThread?.autoTitleGenerated);
  const autoTitleUpdatedAt = String(currentThread?.autoTitleUpdatedAt ?? '').trim();
  const autoTitleMessageCount = Number(currentThread?.autoTitleMessageCount ?? 0);

  if (status === 'concluido') {
    threadsById[threadId] = {
      baseChatId,
      ownerId: resolvedOwnerId,
      tenantId: resolvedTenantId,
      participantIds: resolvedParticipants,
      title: resolvedTitle,
      status: 'concluido',
      createdById,
      createdByName,
      createdAt,
      updatedAt: now,
      closedAt: now,
      closedById: actorId,
      closedByName: actorName,
      autoTitleGenerated,
      autoTitleUpdatedAt,
      autoTitleMessageCount,
    };
    await savePrivateChatThreadsMap(threadsById);
    return;
  }

  threadsById[threadId] = {
    baseChatId,
    ownerId: resolvedOwnerId,
    tenantId: resolvedTenantId,
    participantIds: resolvedParticipants,
    title: resolvedTitle,
    status: 'aberto',
    createdById,
    createdByName,
    createdAt,
    updatedAt: now,
    closedAt: '',
    closedById: '',
    closedByName: '',
    autoTitleGenerated,
    autoTitleUpdatedAt,
    autoTitleMessageCount,
  };
  await savePrivateChatThreadsMap(threadsById);
};

export const updatePrivateChatThreadTitle = async (params: {
  threadId: string;
  title: string;
  actorId: string;
  actorName: string;
  autoGenerated?: boolean;
  messageCount?: number;
}) => {
  const threadId = String(params.threadId ?? '').trim();
  const actorId = String(params.actorId ?? '').trim();
  const actorName = String(params.actorName ?? '').trim() || 'Usuário';
  const title = String(params.title ?? '').trim();
  const autoGenerated = Boolean(params.autoGenerated);
  const messageCount = Number(params.messageCount ?? 0);

  if (!threadId || !actorId || !title) {
    throw new Error('Dados inválidos para atualizar título do chat.');
  }

  const now = new Date().toISOString();
  const threadsById = await getPrivateChatThreadsMap();
  const currentRaw = threadsById[threadId];
  const currentThread = currentRaw && typeof currentRaw === 'object'
    ? normalizePrivateChatThread(threadId, currentRaw)
    : null;

  const baseChatId = currentThread?.baseChatId ?? extractBasePrivateChatId(threadId);
  const members = extractPrivateChatMembers(threadId);
  const ownerId = currentThread?.ownerId ?? members[0] ?? '';
  const tenantId = currentThread?.tenantId ?? members[1] ?? '';
  const participantIds = currentThread?.participantIds?.length ? currentThread.participantIds : members;
  const createdById = currentThread?.createdById || actorId;
  const createdByName = currentThread?.createdByName || actorName;
  const createdAt = currentThread?.createdAt || now;
  const status: PrivateChatThreadStatus = currentThread?.status === 'concluido' ? 'concluido' : 'aberto';

  threadsById[threadId] = {
    baseChatId,
    ownerId,
    tenantId,
    participantIds,
    title,
    status,
    createdById,
    createdByName,
    createdAt,
    updatedAt: now,
    closedAt: String(currentThread?.closedAt ?? ''),
    closedById: String(currentThread?.closedById ?? ''),
    closedByName: String(currentThread?.closedByName ?? ''),
    autoTitleGenerated: autoGenerated ? true : Boolean(currentThread?.autoTitleGenerated),
    autoTitleUpdatedAt: autoGenerated ? now : String(currentThread?.autoTitleUpdatedAt ?? ''),
    autoTitleMessageCount: autoGenerated
      ? (Number.isFinite(messageCount) ? messageCount : Number(currentThread?.autoTitleMessageCount ?? 0))
      : Number(currentThread?.autoTitleMessageCount ?? 0),
  };

  await savePrivateChatThreadsMap(threadsById);
};

const extractPrivateChatMembers = (chatId: string) => {
  const normalizedChatId = extractBasePrivateChatId(chatId);
  const members = normalizedChatId.split('_').filter(Boolean);
  if (members.length !== 2) {
    return [] as string[];
  }

  return members;
};

const normalizePrivateChatId = (chatId: string, senderId: string, ownerId?: string) => {
  if (chatId !== 'owner_private') {
    return chatId;
  }

  if (!ownerId) {
    return chatId;
  }

  return buildPrivateChatId(senderId, ownerId);
};

export const sendChatMessage = async (params: {
  chatId: string;
  isPrivate: boolean;
  text?: string;
  imageUrl?: string;
  audioUrl?: string;
  audioDurationMs?: number;
  notifyUserIdsOverride?: string[];
  replyTo?: {
    messageId: string;
    senderId: string;
    senderName: string;
    text?: string;
    imageUrl?: string;
    audioUrl?: string;
  } | null;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
}) => {
  let targetChatId = params.chatId;
  let users: AppUser[] = [];
  let threadMeta: PrivateChatThread | null = null;

  if (params.isPrivate) {
    users = await getAllUsers();
    const ownerId = users.find((user) => user.isOwner && user.ativo)?.id;
    targetChatId = normalizePrivateChatId(params.chatId, params.senderId, ownerId);
    try {
      threadMeta = await getPrivateChatThreadById(targetChatId);
    } catch {
      threadMeta = null;
    }
  }

  const ref = params.isPrivate ? getPrivateChatMessagesRef(targetChatId) : getGeneralChatMessagesRef();

  await addDoc(ref, {
    chatId: targetChatId,
    texto: params.text ?? null,
    imagemUrl: params.imageUrl ?? null,
    audioUrl: params.audioUrl ?? null,
    audioDurationMs: Number.isFinite(params.audioDurationMs) ? params.audioDurationMs : null,
    replyTo: params.replyTo ?? null,
    enviadoPor: params.senderId,
    enviadoPorNome: params.senderName,
    enviadoPorFotoURL: params.senderPhotoURL ?? null,
    lidoPor: [params.senderId],
    enviadoEm: serverTimestamp(),
  });

  if (params.isPrivate && threadMeta) {
    try {
      await touchPrivateChatThread(targetChatId);
    } catch {
      // falha não bloqueia envio da mensagem
    }
  }

  try {
    const usersFromScope = users.length ? users : await getAllUsers();
    const recipients =
      params.notifyUserIdsOverride?.filter(Boolean)?.length
        ? params.notifyUserIdsOverride
        : params.isPrivate
          ? (threadMeta?.participantIds?.length ? threadMeta.participantIds : extractPrivateChatMembers(targetChatId))
          : usersFromScope.filter((user) => user.ativo).map((user) => user.id);

    const body = params.text?.trim()
      ? params.text.trim().slice(0, 120)
      : params.audioUrl
        ? 'Enviou um áudio no chat.'
        : 'Enviou um arquivo no chat.';

    notifyUsersSafe({
      topic: 'chat',
      userIds: recipients.filter((id) => id !== params.senderId),
      title: params.isPrivate ? `Mensagem de ${params.senderName}` : `Mensagem no grupo`,
      body,
      data: {
        type: 'chat_message',
        chatId: targetChatId,
        chatTitle: threadMeta?.title ?? '',
        isPrivate: params.isPrivate,
        senderId: params.senderId,
        senderName: params.senderName,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar nova mensagem de chat:', error);
    }
  }
};

export const markChatMessageAsRead = async (params: {
  chatId: string;
  isPrivate: boolean;
  messageId: string;
  userId: string;
}) => {
  const messageRef = params.isPrivate
    ? doc(db, 'chat', 'privado', params.chatId, 'mensagens', params.messageId)
    : doc(db, 'chat', 'geral', 'mensagens', params.messageId);

  const snapshot = await getDoc(messageRef);

  if (!snapshot.exists()) {
    return;
  }

  const currentReaders = snapshot.data().lidoPor as string[];
  if (currentReaders.includes(params.userId)) {
    return;
  }

  await updateDoc(messageRef, {
    lidoPor: [...currentReaders, params.userId],
  });
};

export const getEmergencyContacts = async (): Promise<EmergencyContact[]> => {
  const snapshot = await getDocs(query(collection(db, 'contatosEmergencia'), orderBy('nome', 'asc')));

  return snapshot.docs.map((item) => mapDoc<EmergencyContact>(item.id, item.data()));
};

export const saveEmergencyContact = async (contact: EmergencyContact) => {
  await setDoc(doc(db, 'contatosEmergencia', contact.id), contact, { merge: true });
};

export const getOwnerUser = async (): Promise<AppUser | null> => {
  const byIsOwnerSnapshot = await getDocs(query(collection(db, 'users'), where('isOwner', '==', true), limit(1)));
  if (!byIsOwnerSnapshot.empty) {
    const item = byIsOwnerSnapshot.docs[0];
    return normalizeAppUser(item.id, item.data());
  }

  const byRoleSnapshot = await getDocs(query(collection(db, 'users'), where('role', '==', 'owner'), limit(1)));
  if (byRoleSnapshot.empty) {
    return null;
  }

  const item = byRoleSnapshot.docs[0];
  return normalizeAppUser(item.id, item.data());
};

export const getTenantUsers = async (): Promise<AppUser[]> => {
  const snapshot = await getDocs(query(collection(db, 'users'), limit(100)));
  return snapshot.docs
    .map((item) => normalizeAppUser(item.id, item.data()))
    .filter((item) => !item.isOwner && item.ativo);
};

export const getAllUsers = async (): Promise<AppUser[]> => {
  const snapshot = await getDocs(query(collection(db, 'users'), limit(100)));
  return snapshot.docs.map((item) => normalizeAppUser(item.id, item.data()));
};

export const triggerAutomaticRentChatReminderIfNeeded = async (params?: { ownerUserId?: string; force?: boolean }) => {
  const users = await getAllUsers();
  const ownerId = params?.ownerUserId ?? users.find((user) => user.isOwner && user.ativo)?.id;
  const ownerUser = users.find((user) => user.id === ownerId);

  if (!ownerId) {
    return { sentCount: 0 };
  }

  const activeTenants = users.filter((user) => !user.isOwner && user.ativo && user.casaId);
  if (!activeTenants.length) {
    return { sentCount: 0 };
  }

  const houses = await getAllHouses();
  if (!houses.length) {
    return { sentCount: 0 };
  }

  const trackerRef = doc(db, 'configuracoes', 'rentAutoReminder');
  const trackerSnapshot = await getDoc(trackerRef);
  const trackerRaw = trackerSnapshot.exists()
    ? (trackerSnapshot.data() as { sentByHouseCompetencia?: Record<string, string> })
    : {};
  const sentByHouseCompetencia = { ...(trackerRaw.sentByHouseCompetencia ?? {}) };

  const now = new Date().toISOString();
  const today = startOfDay(new Date());
  let sentCount = 0;

  for (const house of houses) {
    const houseId = String(house.id ?? '').trim();
    if (!houseId) {
      continue;
    }

    const dueDay = Number(house.diaVencimento ?? 0);
    if (!Number.isFinite(dueDay) || dueDay <= 0) {
      continue;
    }

    const nextDueDate = getNextDueDate(today, dueDay);
    const daysUntilDue = differenceInCalendarDays(nextDueDate, today);
    if (daysUntilDue !== 5) {
      continue;
    }

    const competencia = format(nextDueDate, 'yyyy-MM');
    const sentKey = `${houseId}:${competencia}`;
    if (!params?.force && sentByHouseCompetencia[sentKey]) {
      continue;
    }

    const paymentRef = doc(db, 'alugueis', houseId, 'pagamentos', competencia);
    const paymentSnapshot = await getDoc(paymentRef);
    if (paymentSnapshot.exists()) {
      const status = String(paymentSnapshot.data().status ?? '').trim().toLowerCase();
      if (status === 'pago' || status === 'aguardando_confirmacao') {
        sentByHouseCompetencia[sentKey] = now;
        continue;
      }
    }

    const currentStatus = paymentSnapshot.exists()
      ? String(paymentSnapshot.data().status ?? '').trim().toLowerCase()
      : '';
    const normalizedStatus: RentalPayment['status'] =
      currentStatus === 'vencido'
        ? 'vencido'
        : currentStatus === 'aguardando_confirmacao'
          ? 'aguardando_confirmacao'
          : 'pendente';

    await setDoc(
      paymentRef,
      {
        competencia,
        valor: Number(house.aluguelMensal ?? 0),
        tipo: 'aluguel',
        status: normalizedStatus,
      } as Partial<RentalPayment>,
      { merge: true },
    );

    const tenantsFromHouse = activeTenants.filter((tenant) => tenant.casaId === houseId);
    if (!tenantsFromHouse.length) {
      continue;
    }

    const dueDayLabel = nextDueDate.getDate();
    const valorLabel = toCurrencyBRL(Number(house.aluguelMensal ?? 0));
    const houseLabel = String(house.nome ?? house.numero ?? houseId).trim() || houseId;
    const reminderText =
      `Lembrete automático: faltam ${daysUntilDue} dias para o vencimento do aluguel ` +
      `da competência ${competencia} da casa ${houseLabel} (dia ${dueDayLabel}). ` +
      `Valor: ${valorLabel}. O boleto está disponível no menu Financeiro.`;

    for (const tenant of tenantsFromHouse) {
      try {
        const privateChatId = buildPrivateChatId(ownerId, tenant.id);
        await sendChatMessage({
          chatId: privateChatId,
          isPrivate: true,
          text: reminderText,
          senderId: ownerId,
          senderName: ownerUser?.nome ?? 'Proprietário',
          senderPhotoURL: ownerUser?.photoURL ?? undefined,
          notifyUserIdsOverride: [tenant.id],
        });
        sentCount += 1;
      } catch (error) {
        if (__DEV__) {
          console.warn('[rent-auto-reminder] falha ao enviar lembrete para inquilino:', tenant.id, error);
        }
      }
    }

    sentByHouseCompetencia[sentKey] = now;
  }

  await setDoc(
    trackerRef,
    {
      sentByHouseCompetencia,
      lastRunAt: now,
      lastSentCount: sentCount,
    },
    { merge: true },
  );

  return { sentCount };
};

export const updateUserProfile = async (
  userId: string,
  payload: Partial<Omit<AppUser, 'id' | 'photoURL'>> & { photoURL?: string | null },
) => {
  await setDoc(doc(db, 'users', userId), payload, { merge: true });
};

const notifyUsersSafe = (params: {
  topic: 'avisos' | 'chamados' | 'financeiro' | 'chat' | 'visitantes';
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) => {
  const recipients = Array.from(new Set(params.userIds.filter(Boolean)));
  if (!recipients.length) {
    return;
  }

  void sendPushToUsers({
    ...params,
    userIds: recipients,
  }).catch((error) => {
    if (__DEV__) {
      console.warn('[push] falha ao enviar notificação:', error);
    }
  });
};

const getOwnerIds = (users: AppUser[]) => users.filter((user) => user.isOwner && user.ativo).map((user) => user.id);

const getActiveTenantIdsByHouse = (users: AppUser[], houseId?: string) =>
  users
    .filter((user) => !user.isOwner && user.ativo && (!houseId || user.casaId === houseId))
    .map((user) => user.id);

export const createVisitor = async (payload: Omit<Visitor, 'id' | 'criadoEm' | 'atualizadoEm'>) => {
  const ref = await addDoc(collection(db, 'visitantes'), {
    ...payload,
    criadoEm: serverTimestamp(),
    atualizadoEm: serverTimestamp(),
  });

  try {
    const users = await getAllUsers();
    const recipients = new Set<string>(getOwnerIds(users));
    if (payload.moradorId) {
      recipients.delete(payload.moradorId);
    }

    notifyUsersSafe({
      topic: 'visitantes',
      userIds: Array.from(recipients),
      title: 'Novo visitante cadastrado',
      body: `${payload.nome} foi cadastrado por ${payload.moradorNome}.`,
      data: {
        type: 'visitor_created',
        visitorId: ref.id,
        status: payload.status,
        moradorId: payload.moradorId,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar visitante cadastrado:', error);
    }
  }
};

export const updateVisitorStatus = async (visitorId: string, status: Visitor['status']) => {
  const ref = doc(db, 'visitantes', visitorId);
  const snapshot = await getDoc(ref);
  const current = snapshot.exists() ? (snapshot.data() as Visitor) : null;

  await updateDoc(ref, {
    status,
    atualizadoEm: serverTimestamp(),
  });

  if (!current) {
    return;
  }

  try {
    const users = await getAllUsers();
    const recipients = new Set<string>([...getOwnerIds(users), current.moradorId]);

    notifyUsersSafe({
      topic: 'visitantes',
      userIds: Array.from(recipients),
      title: 'Status do visitante atualizado',
      body: `${current.nome}: ${status}.`,
      data: {
        type: 'visitor_status_updated',
        visitorId,
        status,
        moradorId: current.moradorId,
      },
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[push] falha ao notificar status de visitante:', error);
    }
  }
};

export const getVisitors = async (params: {
  isOwner: boolean;
  userId: string;
}): Promise<Visitor[]> => {
  const base = collection(db, 'visitantes');
  const ownerQuery = query(base, orderBy('criadoEm', 'desc'), limit(80));
  const tenantQueryWithOrder = query(base, where('moradorId', '==', params.userId), orderBy('criadoEm', 'desc'), limit(80));
  const tenantQueryFallback = query(base, where('moradorId', '==', params.userId), limit(80));

  let snapshot;
  try {
    snapshot = await getDocs(params.isOwner ? ownerQuery : tenantQueryWithOrder);
  } catch (error) {
    const code = String((error as { code?: unknown } | undefined)?.code ?? '');

    if (!params.isOwner && code.includes('failed-precondition')) {
      snapshot = await getDocs(tenantQueryFallback);
    } else {
      throw error;
    }
  }

  return snapshot.docs
    .map((item) => {
      const data = item.data();
      return {
        ...(data as Visitor),
        id: item.id,
        criadoEm: toIso(data.criadoEm),
        atualizadoEm: toIso(data.atualizadoEm),
      };
    })
    .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime());
};

export const seedEmergencyContacts = async () => {
  const defaults: EmergencyContact[] = [
    { id: 'samu', nome: 'SAMU', telefone: '192', especialidade: 'Emergência médica', icon: 'medical' },
    { id: 'bombeiros', nome: 'Bombeiros', telefone: '193', especialidade: 'Incêndio e resgate', icon: 'flame' },
    { id: 'policia', nome: 'Polícia', telefone: '190', especialidade: 'Segurança', icon: 'shield' },
  ];

  await Promise.all(
    defaults.map((item) => setDoc(doc(db, 'contatosEmergencia', item.id), item, { merge: true })),
  );
};

export const getOwnerDashboardSummary = async () => {
  const houses = await getAllHouses();
  const competencia = currentCompetencia();

  let paidCount = 0;
  let totalReceived = 0;

  await Promise.all(
    houses.map(async (house) => {
      const paymentSnapshot = await getDoc(doc(db, 'alugueis', house.id, 'pagamentos', competencia));

      if (!paymentSnapshot.exists()) {
        return;
      }

      const payment = paymentSnapshot.data() as RentalPayment;
      if (payment.status === 'pago') {
        paidCount += 1;
        totalReceived += Number(payment.valor ?? house.aluguelMensal ?? 0);
      }
    }),
  );

  const ticketSnapshot = await getDocs(query(collection(db, 'chamados'), orderBy('criadoEm', 'desc'), limit(50)));
  const openTickets = ticketSnapshot.docs.filter((item) => {
    const status = item.data().status as string;
    return status !== 'Concluido' && status !== 'Cancelado';
  }).length;

  const noticesSnapshot = await getDocs(query(collection(db, 'avisos'), orderBy('criadoEm', 'desc'), limit(3)));
  const latestNotices = noticesSnapshot.docs.map((item) => mapDoc<Notice>(item.id, item.data()));

  return {
    paidCount,
    totalReceived,
    totalHouses: houses.length,
    openTickets,
    latestNotices,
  };
};

export const getTenantDashboardSummary = async (houseId: string) => {
  const competencia = currentCompetencia();
  const paymentSnapshot = await getDoc(doc(db, 'alugueis', houseId, 'pagamentos', competencia));
  const house = await getHouseProfile(houseId);

  const paymentRaw = paymentSnapshot.exists()
    ? ({ id: paymentSnapshot.id, ...paymentSnapshot.data() } as RentalPayment)
    : null;

  const payment = paymentRaw
    ? ({
        ...paymentRaw,
        valor: Number(paymentRaw.valor ?? house?.aluguelMensal ?? 0),
      } as RentalPayment)
    : house
      ? ({
          id: competencia,
          competencia,
          valor: Number(house.aluguelMensal ?? 0),
          status: 'pendente',
        } as RentalPayment)
      : null;

  const dueDate = house
    ? new Date(new Date().getFullYear(), new Date().getMonth(), house.diaVencimento || 5).toISOString()
    : null;

  const noticesSnapshot = await getDocs(query(collection(db, 'avisos'), orderBy('criadoEm', 'desc'), limit(3)));

  return {
    payment,
    dueDate,
    latestNotices: noticesSnapshot.docs
      .map((item) => mapDoc<Notice>(item.id, item.data()))
      .filter((notice) => !notice.alvoCasaId || notice.alvoCasaId === houseId),
  };
};
