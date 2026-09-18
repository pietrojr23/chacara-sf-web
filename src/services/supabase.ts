import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const normalizeEnv = (value: string | undefined) => value?.trim() ?? '';

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const base64 = `${normalized}${padding}`;

  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(base64);
  }

  throw new Error('Não foi possível decodificar a chave Supabase para descobrir o Project URL.');
};

const extractProjectRefFromJwt = (jwt: string) => {
  const parts = jwt.split('.');
  if (parts.length < 2) {
    return '';
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { ref?: string };
    return String(payload.ref ?? '').trim();
  } catch {
    return '';
  }
};

const configuredUrl = normalizeEnv(process.env.EXPO_PUBLIC_SUPABASE_URL);
const configuredAnonKey = normalizeEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const configuredPublishableKey = normalizeEnv(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

const inferredProjectRef = extractProjectRefFromJwt(configuredAnonKey);
const inferredUrl = inferredProjectRef ? `https://${inferredProjectRef}.supabase.co` : '';

const supabaseUrl = configuredUrl || inferredUrl;
const supabaseKey = configuredAnonKey || configuredPublishableKey;

let client: SupabaseClient<any, any, any> | null = null;

const ensureSupabaseConfig = () => {
  const missing: string[] = [];

  if (!supabaseUrl) {
    missing.push('EXPO_PUBLIC_SUPABASE_URL');
  }

  if (!supabaseKey) {
    missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY ou EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }

  if (missing.length) {
    throw new Error(
      `Configuração Supabase ausente: ${missing.join(', ')}. ` +
        'Preencha o .env com os dados do Supabase e reinicie o Expo com -c.',
    );
  }
};

export const getSupabase = () => {
  ensureSupabaseConfig();

  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        storage: AsyncStorage as any,
        autoRefreshToken: true,
        persistSession: true,
        // No web, o navegador recebe o token de confirmação/recuperação na URL
        // (#access_token=...) e o SDK precisa processá-lo automaticamente.
        detectSessionInUrl: Platform.OS === 'web',
      },
      // As tabelas relacionais do app vivem no schema "api" (exposed schema do PostgREST).
      db: { schema: 'api' },
    });
  }

  return client;
};

export const createEphemeralSupabaseClient = () => {
  ensureSupabaseConfig();

  const memoryStorage = {
    _state: {} as Record<string, string>,
    getItem(key: string) {
      return this._state[key] ?? null;
    },
    setItem(key: string, value: string) {
      this._state[key] = value;
    },
    removeItem(key: string) {
      delete this._state[key];
    },
  };

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      storage: memoryStorage as any,
      storageKey: `supabase-ephemeral-${Date.now()}`,
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: { schema: 'api' },
  });
};

export const getSupabaseStorageBucket = () =>
  normalizeEnv(process.env.EXPO_PUBLIC_SUPABASE_STORAGE_BUCKET) || 'app-files';
