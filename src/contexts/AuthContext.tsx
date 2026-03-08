import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AppUser } from '../types/models';
import {
  AuthUser,
  ensureSelfProfileDocument,
  ensureFirstOwnerProfileIfMissing,
  loginWithEmail,
  logout,
  onAuthUserStateChanged,
  registerOwner,
  sendResetPasswordEmail,
} from '../services/authService';
import { getUserProfile } from '../services/firestoreService';
import { registerForPushNotificationsAsync } from '../services/notificationService';
import { cacheKeys, getCache, saveCache } from '../services/cacheService';

interface AuthContextData {
  firebaseUser: AuthUser | null;
  profile: AppUser | null;
  loading: boolean;
  profileResolved: boolean;
  login: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  createOwner: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextData | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [firebaseUser, setFirebaseUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileResolved, setProfileResolved] = useState(false);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const isOwnerLike = (value: AppUser | null) => {
    if (!value) {
      return false;
    }

    const rawIsOwner = (value as unknown as { isOwner?: unknown }).isOwner;
    const rawRole = String((value as unknown as { role?: unknown }).role ?? '').trim().toLowerCase();
    return rawIsOwner === true || rawIsOwner === 'true' || rawRole === 'owner';
  };

  const normalizeProfile = (value: AppUser, user: AuthUser): AppUser => {
    const owner = isOwnerLike(value);
    const nome = value.nome?.trim() || user.displayName?.trim() || user.email?.split('@')[0] || 'Usuário';
    const email = (value.email?.trim() || user.email?.trim() || '').toLowerCase();
    const casaId = value.casaId == null ? undefined : String(value.casaId).trim() || undefined;

    return {
      ...value,
      id: value.id || user.uid,
      nome,
      email,
      casaId,
      role: owner ? 'owner' : 'tenant',
      isOwner: owner,
      ativo: value.ativo !== false,
    };
  };

  const buildLocalProfile = (user: AuthUser, assumeOwner: boolean): AppUser => ({
    id: user.uid,
    nome: user.displayName?.trim() || user.email?.split('@')[0] || (assumeOwner ? 'Proprietário' : 'Usuário'),
    email: user.email?.trim().toLowerCase() || '',
    role: assumeOwner ? 'owner' : 'tenant',
    isOwner: assumeOwner,
    ativo: true,
    photoURL: user.photoURL ?? undefined,
    createdAt: new Date().toISOString(),
  });

  const getUserProfileWithRetry = async (uid: string) => {
    const attempts = 5;
    let hadError = false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const userProfile = await getUserProfile(uid);
        if (userProfile) {
          return { profile: userProfile, hadError: false };
        }
      } catch {
        hadError = true;
      }

      if (attempt < attempts - 1) {
        await wait(350);
      }
    }

    return { profile: null, hadError };
  };

  const refreshProfile = async () => {
    if (!firebaseUser) {
      setProfile(null);
      return;
    }

    const nextProfile = await getUserProfile(firebaseUser.uid);
    setProfile(nextProfile);

    if (nextProfile) {
      await saveCache(`${cacheKeys.profile}/${firebaseUser.uid}`, nextProfile);
    }
  };

  useEffect(() => {
    let latestUser: AuthUser | null = null;

    const startupGuard = setTimeout(() => {
      setProfile((currentProfile) => currentProfile ?? (latestUser ? buildLocalProfile(latestUser, false) : null));
      setProfileResolved(true);
      setLoading(false);
    }, 7000);

    const unsubscribe = onAuthUserStateChanged(async (user) => {
      latestUser = user;
      setFirebaseUser(user);
      setProfileResolved(false);

      if (!user) {
        clearTimeout(startupGuard);
        setProfile(null);
        setProfileResolved(true);
        setLoading(false);
        return;
      }

      const profileCacheKey = `${cacheKeys.profile}/${user.uid}`;
      let cachedProfile: AppUser | null = null;

      try {
        cachedProfile = await getCache<AppUser>(profileCacheKey);
        if (cachedProfile) {
          setProfile(normalizeProfile(cachedProfile, user));
          setLoading(false);
        }

        const result = await getUserProfileWithRetry(user.uid);
        let userProfile = result.profile;

        if (!userProfile && !result.hadError) {
          try {
            const recovered = await ensureFirstOwnerProfileIfMissing(user);
            if (recovered) {
              userProfile = (await getUserProfileWithRetry(user.uid)).profile;
            }
          } catch (error) {
            console.warn(
              '[AuthContext] Não foi possível validar primeiro proprietário. Seguindo com auto-reparo do perfil.',
              error,
            );
          }
        }

        if (!userProfile) {
          try {
            // Nunca assumir proprietário por padrão no auto-reparo:
            // evita promover inquilinos em falhas temporárias de leitura.
            userProfile = await ensureSelfProfileDocument(user, false);
          } catch {
            userProfile = buildLocalProfile(user, false);
          }
        }

        if (userProfile) {
          const normalizedProfile = normalizeProfile(userProfile, user);

          const shouldRepairOwnerProfile =
            normalizedProfile.isOwner &&
            ((userProfile as unknown as { isOwner?: unknown }).isOwner !== true || userProfile.role !== 'owner');

          if (shouldRepairOwnerProfile) {
            try {
              const fixedProfile = await ensureSelfProfileDocument(user, true);
              const normalizedFixedProfile = normalizeProfile(fixedProfile, user);
              setProfile(normalizedFixedProfile);
              await saveCache(profileCacheKey, normalizedFixedProfile);
            } catch {
              setProfile(normalizedProfile);
              await saveCache(profileCacheKey, normalizedProfile);
            }
          } else {
            setProfile(normalizedProfile);
            await saveCache(profileCacheKey, normalizedProfile);
          }
        } else if (!result.hadError) {
          setProfile(null);
        } else if (cachedProfile) {
          setProfile(normalizeProfile(cachedProfile, user));
        }
      } catch (error) {
        console.error('[AuthContext] Falha ao carregar/criar perfil do usuário:', error);
        if (cachedProfile) {
          setProfile(normalizeProfile(cachedProfile, user));
        } else {
          setProfile(buildLocalProfile(user, false));
        }
      } finally {
        clearTimeout(startupGuard);
        setProfileResolved(true);
        setLoading(false);
      }

      void registerForPushNotificationsAsync(user.uid).catch(() => undefined);
    });

    return () => {
      clearTimeout(startupGuard);
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextData>(
    () => ({
      firebaseUser,
      profile,
      loading,
      profileResolved,
      login: async (email, password) => {
        await loginWithEmail(email, password);
      },
      resetPassword: async (email) => {
        await sendResetPasswordEmail(email);
      },
      createOwner: async (name, email, password) => {
        await registerOwner({ nome: name, email, senha: password });
      },
      signOut: async () => {
        await logout();
      },
      refreshProfile,
    }),
    [firebaseUser, loading, profile, profileResolved],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider');
  }

  return context;
};
