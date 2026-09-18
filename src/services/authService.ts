import { AuthError, User as SupabaseUser } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { AppUser } from '../types/models';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from './firestoreLiteCompat';
import { getFirebaseDb } from './firebase';
import { createEphemeralSupabaseClient, getSupabase } from './supabase';

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  metadata?: Record<string, unknown>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

const db = getFirebaseDb();

const normalizeError = (error: unknown) => {
  const source = error as Partial<AuthError> & { status?: number };
  const code = String(source.code ?? source.status ?? 'supabase-auth-error');
  const message = source.message ?? 'Falha de autenticação no Supabase.';
  return Object.assign(new Error(message), { code });
};

const buildAuthUser = (user: SupabaseUser, accessToken?: string | null): AuthUser => {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    (typeof metadata.nome === 'string' && metadata.nome.trim()) ||
    (typeof metadata.name === 'string' && metadata.name.trim()) ||
    user.email?.split('@')[0] ||
    null;
  const photoURL =
    (typeof metadata.photoURL === 'string' && metadata.photoURL.trim()) ||
    (typeof metadata.avatar_url === 'string' && metadata.avatar_url.trim()) ||
    null;

  return {
    uid: user.id,
    email: user.email ?? null,
    displayName,
    photoURL,
    metadata,
    getIdToken: async () => {
      if (accessToken) {
        return accessToken;
      }

      const { data, error } = await getSupabase().auth.getSession();
      if (error) {
        throw normalizeError(error);
      }

      return data.session?.access_token ?? '';
    },
  };
};

const getCurrentSessionUser = async () => {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) {
    throw normalizeError(error);
  }

  if (!data.session?.user) {
    return null;
  }

  return buildAuthUser(data.session.user, data.session.access_token);
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const resolveEmailRedirectUrl = () => {
  // No web, o link de confirmação/reset precisa voltar para o próprio navegador
  // para que o SDK capture o token (#access_token=...) e inicie a sessão.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    // Usa origin + pathname: em subpasta (GitHub Pages: /<repo>/), o redirect
    // precisa voltar para dentro do app, não para a raiz do domínio.
    const pathname = window.location.pathname.replace(/[^/]*$/, '');
    return `${window.location.origin}${pathname}`;
  }

  const explicitRedirect = String(process.env.EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_URL ?? '').trim();
  if (explicitRedirect) {
    return explicitRedirect;
  }

  const resetRedirect = String(process.env.EXPO_PUBLIC_SUPABASE_PASSWORD_RESET_URL ?? '').trim();
  if (resetRedirect) {
    return resetRedirect;
  }

  return 'chacarasf://auth/callback';
};

const upsertUserProfile = async (payload: AppUser) => {
  try {
    await setDoc(
      doc(db, 'users', payload.id),
      {
        ...payload,
        photoURL: payload.photoURL ?? null,
      },
      { merge: true },
    );
  } catch (error) {
    const code = String((error as { code?: unknown } | undefined)?.code ?? '');
    const message = String((error as { message?: unknown } | undefined)?.message ?? '');
    if (message.toLowerCase().includes('invalid schema')) {
      throw Object.assign(
        new Error(
          'Supabase não está pronto para dados do app. Execute supabase/sql/bootstrap.sql e confirme em Settings > API > Exposed schemas que "public" está ativo.',
        ),
        { code: 'supabase-schema-not-ready' },
      );
    }

    if (code.includes('permission-denied') || /row-level security/i.test(message)) {
      throw Object.assign(
        new Error(
          'Sem permissão para gravar perfil de usuário no Supabase (RLS). Execute novamente o bootstrap.sql e ajuste as policies da tabela documents.',
        ),
        { code: 'supabase-rls-block' },
      );
    }

    throw error;
  }
};

export const onAuthUserStateChanged = (callback: (user: AuthUser | null) => void) => {
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      callback(null);
      return;
    }

    callback(buildAuthUser(session.user, session.access_token));
  });

  void getCurrentSessionUser()
    .then((user) => {
      callback(user);
    })
    .catch(() => {
      callback(null);
    });

  return () => {
    data.subscription.unsubscribe();
  };
};

export const loginWithEmail = async (email: string, password: string) => {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: normalizeEmail(email),
    password: password.trim(),
  });

  if (error) {
    throw normalizeError(error);
  }

  if (!data.user) {
    throw Object.assign(new Error('Autenticação concluída sem usuário válido.'), {
      code: 'auth-user-missing',
    });
  }

  return buildAuthUser(data.user, data.session?.access_token ?? null);
};

export const sendResetPasswordEmail = async (email: string) => {
  const { error } = await getSupabase().auth.resetPasswordForEmail(normalizeEmail(email), {
    redirectTo: resolveEmailRedirectUrl(),
  });

  if (error) {
    throw normalizeError(error);
  }
};

export const logout = async () => {
  const { error } = await getSupabase().auth.signOut();

  if (error) {
    throw normalizeError(error);
  }
};

export const ensureOwnerProfile = async (user: AuthUser, name: string) => {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return;
  }

  const currentUser = await getCurrentSessionUser();

  if (!currentUser || currentUser.uid !== user.uid || currentUser.displayName === normalizedName) {
    return;
  }

  const { error } = await getSupabase().auth.updateUser({
    data: {
      name: normalizedName,
      nome: normalizedName,
    },
  });

  if (error) {
    throw normalizeError(error);
  }
};

interface CreateTenantPayload {
  nome: string;
  email: string;
  senhaTemporaria: string;
  casaId: string;
  telefone?: string;
}

export const createTenantByOwner = async (payload: CreateTenantPayload) => {
  const email = normalizeEmail(payload.email);
  const nome = payload.nome.trim();
  const senhaTemporaria = payload.senhaTemporaria.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('E-mail inválido. Verifique e tente novamente.'), {
      code: 'email_address_invalid',
    });
  }

  if (senhaTemporaria.length < 6) {
    throw Object.assign(new Error('A senha temporária deve ter pelo menos 6 caracteres.'), {
      code: 'weak_password',
    });
  }

  const secondaryClient = createEphemeralSupabaseClient();
  const { data, error } = await secondaryClient.auth.signUp({
    email,
    password: senhaTemporaria,
    options: {
      emailRedirectTo: resolveEmailRedirectUrl(),
      data: {
        name: nome,
        nome,
        role: 'tenant',
        casaId: payload.casaId,
        casa_id: payload.casaId,
        houseId: payload.casaId,
      },
    },
  });

  if (error) {
    const code = String(error.code ?? '');
    const message = String(error.message ?? '');

    if (code === 'over_email_send_rate_limit' || /rate limit/i.test(message)) {
      throw Object.assign(
        new Error('Limite de envio de e-mail do Supabase atingido. Aguarde alguns minutos e tente novamente.'),
        { code: 'over_email_send_rate_limit' },
      );
    }

    if (code === 'email_address_invalid') {
      throw Object.assign(new Error('E-mail inválido. Use um e-mail real e válido.'), {
        code: 'email_address_invalid',
      });
    }

    if (code === 'user_already_exists') {
      throw Object.assign(
        new Error('Já existe uma conta com esse e-mail. Use outro e-mail ou redefina a senha do usuário existente.'),
        { code: 'user_already_exists' },
      );
    }

    throw normalizeError(error);
  }

  const tenantUser = data.user;

  if (!tenantUser) {
    throw Object.assign(new Error('Não foi possível criar o usuário de autenticação do inquilino.'), {
      code: 'tenant-auth-user-missing',
    });
  }

  await upsertUserProfile({
    id: tenantUser.id,
    nome,
    email,
    telefone: payload.telefone?.trim() || undefined,
    casaId: payload.casaId,
    role: 'tenant',
    isOwner: false,
    ativo: true,
    createdAt: new Date().toISOString(),
  });
};

export const setTenantStatusByOwner = async (userId: string, ativo: boolean) => {
  await setDoc(
    doc(db, 'users', userId),
    {
      ativo,
    },
    { merge: true },
  );
};

export const resetTenantPasswordByOwner = async (userId: string) => {
  const userSnapshot = await getDoc(doc(db, 'users', userId));

  if (!userSnapshot.exists()) {
    throw Object.assign(new Error('Usuário não encontrado para reset de senha.'), {
      code: 'tenant-not-found',
    });
  }

  const email = String(userSnapshot.data().email ?? '').trim().toLowerCase();
  if (!email) {
    throw Object.assign(new Error('Usuário sem e-mail cadastrado para reset de senha.'), {
      code: 'tenant-email-missing',
    });
  }

  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: resolveEmailRedirectUrl(),
  });

  if (error) {
    throw normalizeError(error);
  }
};

interface SelfRegisterPayload {
  nome: string;
  email: string;
  senha: string;
}

export const registerOwner = async ({ nome, email, senha }: SelfRegisterPayload) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = nome.trim();

  const { data, error } = await getSupabase().auth.signUp({
    email: normalizedEmail,
    password: senha,
    options: {
      emailRedirectTo: resolveEmailRedirectUrl(),
      data: {
        name: normalizedName,
        nome: normalizedName,
        role: 'owner',
      },
    },
  });

  if (error) {
    throw normalizeError(error);
  }

  if (!data.user) {
    throw Object.assign(new Error('Cadastro concluído sem usuário válido.'), {
      code: 'owner-auth-user-missing',
    });
  }

  const authUser = buildAuthUser(data.user, data.session?.access_token ?? null);
  const hasSession = Boolean(data.session?.access_token);

  if (hasSession) {
    await ensureOwnerProfile(authUser, normalizedName);
  }

  try {
    await upsertUserProfile({
      id: data.user.id,
      nome: normalizedName,
      email: normalizedEmail,
      role: 'owner',
      isOwner: true,
      ativo: true,
      photoURL: authUser.photoURL ?? undefined,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const code = String((error as { code?: unknown } | undefined)?.code ?? '');
    const message = String((error as { message?: unknown } | undefined)?.message ?? '');
    const rlsBlocked = code.includes('permission-denied') || code.includes('supabase-rls-block') || /row-level security/i.test(message);

    // When sign-up requires email confirmation, session can be null and RLS blocks profile write.
    // In this case we keep the auth account and profile will be repaired on first authenticated login.
    if (!hasSession && rlsBlocked) {
      return authUser;
    }

    throw error;
  }

  return authUser;
};

export const ensureFirstOwnerProfileIfMissing = async (user: AuthUser) => {
  const ownersByFlag = await getDocs(query(collection(db, 'users'), where('isOwner', '==', true), limit(1)));
  const ownersByRole = await getDocs(query(collection(db, 'users'), where('role', '==', 'owner'), limit(1)));

  if (!ownersByFlag.empty || !ownersByRole.empty) {
    return false;
  }

  await upsertUserProfile({
    id: user.uid,
    nome: user.displayName?.trim() || 'Proprietário',
    email: user.email?.trim().toLowerCase() || '',
    role: 'owner',
    isOwner: true,
    ativo: true,
    photoURL: user.photoURL ?? undefined,
    createdAt: new Date().toISOString(),
  });

  return true;
};

export const ensureSelfProfileDocument = async (user: AuthUser, assumeOwner = true): Promise<AppUser> => {
  const userRef = doc(db, 'users', user.uid);
  const existingProfile = await getDoc(userRef);
  const metadata = user.metadata ?? {};
  const metadataHouseIdRaw =
    metadata.casaId ?? metadata.casa_id ?? metadata.houseId ?? metadata.house_id ?? null;
  const metadataHouseId =
    metadataHouseIdRaw == null ? undefined : String(metadataHouseIdRaw).trim() || undefined;

  if (existingProfile.exists()) {
    const existingData = existingProfile.data() as AppUser;

    if (assumeOwner && existingData.isOwner !== true) {
      await setDoc(
        userRef,
        {
          role: 'owner',
          isOwner: true,
          ativo: true,
        },
        { merge: true },
      );

      return {
        ...existingData,
        id: existingProfile.id,
        role: 'owner',
        isOwner: true,
        ativo: true,
      };
    }

    const existingCasaId = existingData.casaId == null ? '' : String(existingData.casaId).trim();
    if (!assumeOwner && !existingCasaId && metadataHouseId) {
      await setDoc(
        userRef,
        {
          casaId: metadataHouseId,
        },
        { merge: true },
      );

      return {
        ...existingData,
        id: existingProfile.id,
        casaId: metadataHouseId,
      };
    }

    return {
      ...existingData,
      id: existingProfile.id,
    };
  }

  const nomeBase = user.displayName?.trim() || user.email?.split('@')[0] || 'Usuário';
  const emailBase = user.email?.trim().toLowerCase() || '';

  const fallbackProfile: AppUser = {
    id: user.uid,
    nome: nomeBase,
    email: emailBase,
    role: assumeOwner ? 'owner' : 'tenant',
    isOwner: assumeOwner,
    casaId: assumeOwner ? undefined : metadataHouseId,
    ativo: true,
    photoURL: user.photoURL ?? undefined,
    createdAt: new Date().toISOString(),
  };

  if (!assumeOwner && !fallbackProfile.casaId) {
    throw Object.assign(
      new Error(
        'Conta de inquilino sem casa vinculada. Defina casaId no perfil do usuário antes do login.',
      ),
      { code: 'tenant-house-not-linked' },
    );
  }

  await upsertUserProfile(fallbackProfile);

  return fallbackProfile;
};
