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
import { format } from 'date-fns';
import {
  AppConfig,
  AppUser,
  CameraConfig,
  ChatMessage,
  EmergencyContact,
  GateStatus,
  HouseDocument,
  House,
  MaintenanceTicket,
  Notice,
  RentalPayment,
  Visitor,
} from '../types/models';
import { getFirebaseDb } from './firebase';
import { sendPushToUsers } from './notificationService';

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
          const contatoRaw = record.contato ?? record.telefone ?? record.phone;
          const fotoRaw = record.fotoUrl ?? record.fotoURL ?? record.photoUrl;

          return {
            nome,
            contato: contatoRaw ? String(contatoRaw).trim() : undefined,
            fotoUrl: fotoRaw ? String(fotoRaw).trim() : undefined,
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

      if (!nome) {
        return null;
      }

      return {
        nome,
        ...(contato ? { contato } : {}),
        ...(fotoUrl ? { fotoUrl } : {}),
      };
    })
    .filter((item): item is { nome: string; contato?: string; fotoUrl?: string } => Boolean(item));

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

export const getRentalPayments = async (houseId: string): Promise<RentalPayment[]> => {
  const paymentsRef = collection(db, 'alugueis', houseId, 'pagamentos');
  const snapshot = await getDocs(query(paymentsRef, orderBy('competencia', 'desc')));

  return snapshot.docs.map((item) => {
    const data = item.data();

    return {
      ...(data as RentalPayment),
      id: item.id,
      dataPagamento: toIso(data.dataPagamento),
    };
  });
};

export const upsertRentalPayment = async (
  houseId: string,
  paymentId: string,
  payload: Partial<RentalPayment>,
) => {
  await setDoc(doc(db, 'alugueis', houseId, 'pagamentos', paymentId), payload, {
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
        body: `Seu pagamento da competência ${paymentId} foi confirmado.`,
        data: {
          type: 'payment_confirmed',
          houseId,
          paymentId,
        },
      });
    } catch (error) {
      if (__DEV__) {
        console.warn('[push] falha ao notificar pagamento confirmado:', error);
      }
    }
  }
};

export const markPaymentAsNotifiedByTenant = async (houseId: string, paymentId: string, userId: string) => {
  await setDoc(
    doc(db, 'alugueis', houseId, 'pagamentos', paymentId),
    {
      status: 'aguardando_confirmacao',
      marcadoComoPagoPeloInquilino: true,
      confirmadoPeloInquilinoEm: serverTimestamp(),
      confirmadoPeloInquilinoId: userId,
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
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
};

export const publishNotice = async (payload: Omit<Notice, 'id' | 'criadoEm' | 'leitores'>) => {
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

export const getGeneralMessages = async (): Promise<ChatMessage[]> => {
  const snapshot = await getDocs(query(getGeneralChatMessagesRef(), orderBy('enviadoEm', 'asc'), limit(150)));

  return snapshot.docs.map((item) => {
    const data = item.data();

    return {
      ...(data as ChatMessage),
      id: item.id,
      chatId: 'geral',
      enviadoEm: toIso(data.enviadoEm),
    };
  });
};

export const getPrivateMessages = async (chatId: string): Promise<ChatMessage[]> => {
  const snapshot = await getDocs(
    query(getPrivateChatMessagesRef(chatId), orderBy('enviadoEm', 'asc'), limit(150)),
  );

  return snapshot.docs.map((item) => {
    const data = item.data();

    return {
      ...(data as ChatMessage),
      id: item.id,
      chatId,
      enviadoEm: toIso(data.enviadoEm),
    };
  });
};

export const subscribeGeneralMessages = (callback: (messages: ChatMessage[]) => void) =>
  subscribeByPolling(getGeneralMessages, callback, 2500);

export const subscribePrivateMessages = (chatId: string, callback: (messages: ChatMessage[]) => void) =>
  subscribeByPolling(() => getPrivateMessages(chatId), callback, 2500);

export const sendChatMessage = async (params: {
  chatId: string;
  isPrivate: boolean;
  text?: string;
  imageUrl?: string;
  senderId: string;
  senderName: string;
  senderPhotoURL?: string;
}) => {
  const ref = params.isPrivate ? getPrivateChatMessagesRef(params.chatId) : getGeneralChatMessagesRef();

  await addDoc(ref, {
    chatId: params.chatId,
    texto: params.text ?? null,
    imagemUrl: params.imageUrl ?? null,
    enviadoPor: params.senderId,
    enviadoPorNome: params.senderName,
    enviadoPorFotoURL: params.senderPhotoURL ?? null,
    lidoPor: [params.senderId],
    enviadoEm: serverTimestamp(),
  });

  try {
    const users = await getAllUsers();
    let recipients: string[] = [];

    if (params.isPrivate) {
      if (params.chatId === 'owner_private') {
        recipients = users.filter((user) => user.ativo).map((user) => user.id);
      } else {
        recipients = params.chatId.split('_').filter(Boolean);
      }
    } else {
      recipients = users.filter((user) => user.ativo).map((user) => user.id);
    }

    const body = params.text?.trim()
      ? params.text.trim().slice(0, 120)
      : 'Enviou um arquivo no chat.';

    notifyUsersSafe({
      topic: 'chat',
      userIds: recipients.filter((id) => id !== params.senderId),
      title: params.isPrivate ? `Mensagem de ${params.senderName}` : `Mensagem no grupo`,
      body,
      data: {
        type: 'chat_message',
        chatId: params.chatId,
        isPrivate: params.isPrivate,
        senderId: params.senderId,
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
