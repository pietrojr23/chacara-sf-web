"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyRentConfirmed = exports.notifyRentDue = exports.notifyVisitorRequest = exports.notifyNewPrivateChatMessage = exports.notifyNewGeneralChatMessage = exports.notifyTicketStatusChange = exports.notifyNewTicket = exports.notifyNewNotice = exports.resetTenantPassword = exports.setTenantStatus = exports.createTenantUser = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firebase_functions_1 = require("firebase-functions");
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const db = admin.firestore();
const ensureOwner = async (uid) => {
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Usuário não autenticado.');
    }
    const userDoc = await db.collection('users').doc(uid).get();
    const data = userDoc.data();
    const rawIsOwner = data?.isOwner;
    const rawRole = String(data?.role ?? '').trim().toLowerCase();
    const isOwner = rawIsOwner === true || rawIsOwner === 'true' || rawRole === 'owner';
    if (!userDoc.exists || !isOwner) {
        throw new https_1.HttpsError('permission-denied', 'Somente o proprietário pode executar esta ação.');
    }
    return data;
};
const getUserPushTokens = async (uids) => {
    if (!uids.length) {
        return [];
    }
    const snapshots = await Promise.all(uids.map((uid) => db.collection('users').doc(uid).get()));
    return snapshots
        .map((snapshot) => snapshot.data()?.pushToken)
        .filter((token) => Boolean(token));
};
const sendPush = async (tokens, title, body, data) => {
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
            body: JSON.stringify(expoTokens.map((token) => ({
                to: token,
                title,
                body,
                sound: 'default',
                data,
            }))),
        });
    }
};
exports.createTenantUser = (0, https_1.onCall)(async (request) => {
    await ensureOwner(request.auth?.uid);
    const { nome, email, senhaTemporaria, casaId, telefone } = request.data;
    if (!nome || !email || !senhaTemporaria || !casaId) {
        throw new https_1.HttpsError('invalid-argument', 'Campos obrigatórios ausentes.');
    }
    const normalizedPhone = typeof telefone === 'string' ? telefone.trim() : '';
    const phoneNumber = normalizedPhone && normalizedPhone.startsWith('+') ? normalizedPhone : undefined;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = nome.trim();
    let tenant;
    try {
        tenant = await admin.auth().createUser({
            email: normalizedEmail,
            password: senhaTemporaria,
            displayName: normalizedName,
            ...(phoneNumber ? { phoneNumber } : {}),
        });
    }
    catch (error) {
        const code = error?.code ?? '';
        if (code === 'auth/email-already-exists') {
            throw new https_1.HttpsError('already-exists', 'Já existe um usuário com este e-mail.');
        }
        if (code === 'auth/invalid-password' || code === 'auth/invalid-phone-number') {
            throw new https_1.HttpsError('invalid-argument', 'Senha ou telefone inválidos para criar usuário.');
        }
        firebase_functions_1.logger.error('[createTenantUser] Falha ao criar usuário no Auth', error);
        throw new https_1.HttpsError('internal', 'Não foi possível criar o usuário no Firebase Auth.');
    }
    await db.collection('users').doc(tenant.uid).set({
        id: tenant.uid,
        nome: normalizedName,
        email: normalizedEmail,
        telefone: telefone ?? null,
        casaId,
        role: 'tenant',
        isOwner: false,
        ativo: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true, uid: tenant.uid };
});
exports.setTenantStatus = (0, https_1.onCall)(async (request) => {
    await ensureOwner(request.auth?.uid);
    const { userId, ativo } = request.data;
    if (!userId) {
        throw new https_1.HttpsError('invalid-argument', 'Informe userId.');
    }
    await admin.auth().updateUser(userId, { disabled: !ativo });
    await db.collection('users').doc(userId).set({
        ativo,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true };
});
exports.resetTenantPassword = (0, https_1.onCall)(async (request) => {
    await ensureOwner(request.auth?.uid);
    const { userId } = request.data;
    if (!userId) {
        throw new https_1.HttpsError('invalid-argument', 'Informe userId.');
    }
    const temporaryPassword = `Chacara@${Math.floor(100000 + Math.random() * 900000)}`;
    await admin.auth().updateUser(userId, {
        password: temporaryPassword,
    });
    await db.collection('users').doc(userId).set({
        senhaTemporariaCriadaEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { success: true, temporaryPassword };
});
exports.notifyNewNotice = (0, firestore_1.onDocumentCreated)('avisos/{avisoId}', async (event) => {
    const aviso = event.data?.data();
    if (!aviso) {
        return;
    }
    const usersSnapshot = await db.collection('users').where('ativo', '==', true).get();
    const targetUsers = usersSnapshot.docs
        .map((docSnapshot) => docSnapshot.data())
        .filter((user) => !aviso.alvoCasaId || user.casaId === aviso.alvoCasaId || user.isOwner === true);
    const tokens = targetUsers.map((user) => user.pushToken).filter((token) => Boolean(token));
    await sendPush(tokens, 'Novo aviso publicado', aviso.titulo ?? 'Confira no mural', {
        type: 'notice',
        avisoId: event.params.avisoId,
    });
});
exports.notifyNewTicket = (0, firestore_1.onDocumentCreated)('chamados/{chamadoId}', async (event) => {
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
exports.notifyTicketStatusChange = (0, firestore_1.onDocumentUpdated)('chamados/{chamadoId}', async (event) => {
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
const notifyChatParticipants = async (message) => {
    const usersSnapshot = await db.collection('users').where('ativo', '==', true).get();
    const tokens = usersSnapshot.docs
        .map((docSnapshot) => docSnapshot.data())
        .filter((user) => user.id !== message.enviadoPor)
        .map((user) => user.pushToken)
        .filter((token) => Boolean(token));
    await sendPush(tokens, 'Nova mensagem no chat', message.texto ?? 'Imagem recebida', {
        type: 'chat',
        chatId: message.chatId ?? 'geral',
    });
};
exports.notifyNewGeneralChatMessage = (0, firestore_1.onDocumentCreated)('chat/geral/mensagens/{messageId}', async (event) => {
    const message = event.data?.data();
    if (!message) {
        return;
    }
    await notifyChatParticipants(message);
});
exports.notifyNewPrivateChatMessage = (0, firestore_1.onDocumentCreated)('chat/privado/{chatId}/mensagens/{messageId}', async (event) => {
    const message = event.data?.data();
    if (!message) {
        return;
    }
    await notifyChatParticipants(message);
});
exports.notifyVisitorRequest = (0, firestore_1.onDocumentCreated)('visitantes/{visitanteId}', async (event) => {
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
exports.notifyRentDue = (0, scheduler_1.onSchedule)({
    schedule: '0 8 * * *',
    timeZone: 'America/Sao_Paulo',
}, async () => {
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
            .filter((token) => Boolean(token));
        await sendPush(tokens, diffDays === 3 ? 'Aluguel vence em 3 dias' : 'Aluguel vence hoje', `Casa ${house.nome ?? houseDoc.id} - confira seu pagamento.`, {
            type: 'rent:due',
            houseId: houseDoc.id,
        });
    }
    firebase_functions_1.logger.info('Rotina de lembrete de aluguel finalizada.');
});
exports.notifyRentConfirmed = (0, firestore_1.onDocumentUpdated)('alugueis/{casaId}/pagamentos/{mes}', async (event) => {
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
        .filter((token) => Boolean(token));
    await sendPush(tokens, 'Pagamento confirmado', `Aluguel ${event.params.mes} confirmado como pago.`, {
        type: 'rent:paid',
        casaId: event.params.casaId,
    });
});
