import { getSupabase } from './supabase';

interface CompatDb {
  provider: 'supabase-documents';
}

const db: CompatDb = {
  provider: 'supabase-documents',
};

export const getFirebaseApp = () => getSupabase();

export const getFirebaseAuth = () => getSupabase().auth;

export const getFirebaseDb = () => db;

export const getFirebaseStorage = () => getSupabase().storage;

export const getFirebaseFunctions = () => null;
