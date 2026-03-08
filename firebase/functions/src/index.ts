import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();

const ensureOwner = async (uid?: string) => {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  const userDoc = await db.collection('users').doc(uid).get();

  if (!userDoc.exists || userDoc.data()?.isOwner !== true) {
    throw new HttpsError('permission-denied', 'Somente o proprietário pode executar esta ação.');
  }

  return userDoc.data();
};

const getUserPushTokens = async (uids: string[]) => {
  if (!uids.length) {
    return [] as string[];
  }

  const snapshots = await Promise.all(uids.map((uid) => db.collection('users').doc(uid).get()));
  return snapshots
    .map((snapshot) => snapshot.data()?.pushToken)
    .filter((token): token is string => Boolean(token));
};

const sendPush = async (tokens: string[], title: string, body: string, data?: Record<string, string>) => {
  if (!tokens.length) {
    return;
  }

  const expoTokens = tokens.filter((token) => token.startsWith('ExponentPushToken'));
  const fcmTokens = tokens.filter((token) => !token.startsWith('ExponentPushToken'));

  if (fcmTokens.length) {
    await admin.messaging().sendEachForMulticast({
      tokens: fcmTokens,
      notification: {
        title,
        body,
      },
      data,
    });
  }

  if (expoTokens.length) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        expoTokens.map((token) => ({
          to: token,
          title,
          body,
          sound: 'default',
          data,
        })),
      ),
    });
  }
};

export const createTenantUser = onCall(async (request) => {
  await ensureOwner(request.auth?.uid);

  const { nome, email, senhaTemporaria, casaId, telefone } = request.data as {
    nome: string;
    email: string;
    senhaTemporaria: string;
    casaId: string;
    telefone?: string;
  };

  if (!nome || !email || !senhaTemporaria || !casaId) {
    throw new HttpsError('invalid-argument', 'Campos obrigatórios ausentes.');
  }

  const tenant = await admin.auth().createUser({
    email,
    password: senhaTemporaria,
    displayName: nome,
    phoneNumber: telefone,
  });

  await db.collection('users').doc(tenant.uid).set(
    {
      id: tenant.uid,
      nome,
      email,
      telefone: telefone ?? null,
      casaId,
      role: 'tenant',
      isOwner: false,
      ativo: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { success: true, uid: tenant.uid };
});

export const setTenantStatus = onCall(async (request) => {
  await ensureOwner(request.auth?.uid);

  const { userId, ativo } = request.data as { userId: string; ativo: boolean };

  if (!userId) {
    throw new HttpsError('invalid-argument', 'Informe userId.');
  }

  await admin.auth().updateUser(userId, { disabled: !ativo });

  await db.collection('users').doc(userId).set(
    {
      ativo,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { success: true };
});

export const resetTenantPassword = onCall(async (request) => {
  await ensureOwner(request.auth?.uid);

  const { userId } = request.data as { userId: string };

  if (!userId) {
    throw new HttpsError('invalid-argument', 'Informe userId.');
  }

  const temporaryPassword = `Chacara@${Math.floor(100000 + Math.random() * 900000)}`;

  await admin.auth().updateUser(userId, {
    password: temporaryPassword,
  });

  await db.collection('users').doc(userId).set(
    {
      senhaTemporariaCriadaEm: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { success: true, temporaryPassword };
});

export const notifyNewNotice = onDocumentCreated('avisos/{avisoId}', async (event) => {
  const aviso = event.data?.data();

  if (!aviso) {
    return;
  }

  const usersSnapshot = await db.collection('users').where('ativo', '==', true).get();
  const targetUsers = usersSnapshot.docs
    .map((docSnapshot) => docSnapshot.data())
    .filter((user) => !aviso.alvoCasaId || user.casaId === aviso.alvoCasaId || user.isOwner === true);

  const tokens = targetUsers.map((user) => user.pushToken).filter((token): token is string => Boolean(token));

  await sendPush(tokens, 'Novo aviso publicado', aviso.titulo ?? 'Confira no mural', {
    type: 'notice',
    avisoId: event.params.avisoId,
  });
});

export const notifyNewTicket = onDocumentCreated('chamados/{chamadoId}', async (event) => {
  const chamado = event.data?.data();

  if (!chamado) {
    return;
  }

  const ownerSnapshot = await db.collection('users').where('isOwner', '==', true).limit(1).get();
  const ownerToken = ownerSnapshot.docs[0]?.data()?.pushToken;

  if (ownerToken) {
    await sendPush([ownerToken], 'Novo chamado de manutenção', chamado.titulo ?? 'Ver chamado', {
      type: 'ticket:new',
      chamadoId: event.params.chamadoId,
    });
  }
});

export const notifyTicketStatusChange = onDocumentUpdated('chamados/{chamadoId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!before || !after || before.status === after.status) {
    return;
  }

  const creatorSnapshot = await db.collection('users').doc(after.criadorId).get();
  const token = creatorSnapshot.data()?.pushToken;

  if (token) {
    await sendPush([token], 'Status do chamado atualizado', `${after.titulo}: ${after.status}`, {
      type: 'ticket:status',
      chamadoId: event.params.chamadoId,
    });
  }
});

const notifyChatParticipants = async (message: FirebaseFirestore.DocumentData) => {
  const usersSnapshot = await db.collection('users').where('ativo', '==', true).get();
  const tokens = usersSnapshot.docs
    .map((docSnapshot) => docSnapshot.data())
    .filter((user) => user.id !== message.enviadoPor)
    .map((user) => user.pushToken)
    .filter((token): token is string => Boolean(token));

  await sendPush(tokens, 'Nova mensagem no chat', message.texto ?? 'Imagem recebida', {
    type: 'chat',
    chatId: message.chatId ?? 'geral',
  });
};

export const notifyNewGeneralChatMessage = onDocumentCreated('chat/geral/mensagens/{messageId}', async (event) => {
  const message = event.data?.data();
  if (!message) {
    return;
  }
  await notifyChatParticipants(message);
});

export const notifyNewPrivateChatMessage = onDocumentCreated(
  'chat/privado/{chatId}/mensagens/{messageId}',
  async (event) => {
    const message = event.data?.data();
    if (!message) {
      return;
    }
    await notifyChatParticipants(message);
  },
);

export const notifyVisitorRequest = onDocumentCreated('visitantes/{visitanteId}', async (event) => {
  const visitor = event.data?.data();

  if (!visitor) {
    return;
  }

  const ownerSnapshot = await db.collection('users').where('isOwner', '==', true).limit(1).get();
  const ownerToken = ownerSnapshot.docs[0]?.data()?.pushToken;

  if (ownerToken) {
    await sendPush([ownerToken], 'Visitante aguardando', `${visitor.nome} foi registrado no portão.`, {
      type: 'visitor',
      visitorId: event.params.visitanteId,
    });
  }
});

export const notifyRentDue = onSchedule(
  {
    schedule: '0 8 * * *',
    timeZone: 'America/Sao_Paulo',
  },
  async () => {
    const housesSnapshot = await db.collection('casas').get();
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const houseDoc of housesSnapshot.docs) {
      const house = houseDoc.data();
      const dueDay = Number(house.diaVencimento ?? 5);
      const dueDate = new Date(now.getFullYear(), now.getMonth(), dueDay);
      const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays !== 3 && diffDays !== 0) {
        continue;
      }

      const paymentSnapshot = await db.collection('alugueis').doc(houseDoc.id).collection('pagamentos').doc(yearMonth).get();
      const payment = paymentSnapshot.data();

      if (payment?.status === 'pago') {
        continue;
      }

      const usersSnapshot = await db
        .collection('users')
        .where('casaId', '==', houseDoc.id)
        .where('ativo', '==', true)
        .get();

      const tokens = usersSnapshot.docs
        .map((docSnapshot) => docSnapshot.data()?.pushToken)
        .filter((token): token is string => Boolean(token));

      await sendPush(
        tokens,
        diffDays === 3 ? 'Aluguel vence em 3 dias' : 'Aluguel vence hoje',
        `Casa ${house.nome ?? houseDoc.id} - confira seu pagamento.`,
        {
          type: 'rent:due',
          houseId: houseDoc.id,
        },
      );
    }

    logger.info('Rotina de lembrete de aluguel finalizada.');
  },
);

export const notifyRentConfirmed = onDocumentUpdated('alugueis/{casaId}/pagamentos/{mes}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!before || !after || before.status === after.status || after.status !== 'pago') {
    return;
  }

  const usersSnapshot = await db
    .collection('users')
    .where('casaId', '==', event.params.casaId)
    .where('ativo', '==', true)
    .get();

  const tokens = usersSnapshot.docs
    .map((docSnapshot) => docSnapshot.data()?.pushToken)
    .filter((token): token is string => Boolean(token));

  await sendPush(tokens, 'Pagamento confirmado', `Aluguel ${event.params.mes} confirmado como pago.`, {
    type: 'rent:paid',
    casaId: event.params.casaId,
  });
});
