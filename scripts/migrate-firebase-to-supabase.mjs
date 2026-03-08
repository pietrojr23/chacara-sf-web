#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';

const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 200);
const CLEAR_DESTINATION = String(process.env.CLEAR_SUPABASE_DOCUMENTS || '').toLowerCase() === 'true';

if (!FIREBASE_SERVICE_ACCOUNT_PATH) {
  throw new Error('Defina FIREBASE_SERVICE_ACCOUNT_PATH com o caminho do JSON da service account Firebase.');
}

if (!SUPABASE_URL) {
  throw new Error('Defina SUPABASE_URL (ou EXPO_PUBLIC_SUPABASE_URL).');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY para gravar no Supabase sem bloqueio de RLS.');
}

const serviceAccountJson = JSON.parse(
  await fs.readFile(path.resolve(FIREBASE_SERVICE_ACCOUNT_PATH), 'utf8'),
);

initializeApp({
  credential: cert(serviceAccountJson),
});

const firestore = getFirestore();
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const toPlainValue = (value) => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toPlainValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, item]) => {
      acc[key] = toPlainValue(item);
      return acc;
    }, {});
  }

  return value;
};

const rows = [];

const visitCollection = async (collectionRef, prefixSegments = []) => {
  const snapshot = await collectionRef.get();

  for (const documentSnapshot of snapshot.docs) {
    const pathSegments = [...prefixSegments, collectionRef.id, documentSnapshot.id];
    const docPath = pathSegments.join('/');

    rows.push({
      path: docPath,
      data: toPlainValue(documentSnapshot.data()),
    });

    const subCollections = await documentSnapshot.ref.listCollections();
    for (const subCollection of subCollections) {
      await visitCollection(subCollection, pathSegments);
    }
  }
};

const flushBatch = async (batch) => {
  const { error } = await supabase
    .from('documents')
    .upsert(batch, { onConflict: 'path', ignoreDuplicates: false });

  if (error) {
    throw new Error(`Falha ao gravar lote no Supabase: ${error.message}`);
  }
};

const run = async () => {
  if (CLEAR_DESTINATION) {
    console.log('Limpando tabela public.documents no Supabase...');
    const { error } = await supabase.from('documents').delete().neq('path', '');
    if (error) {
      throw new Error(`Falha ao limpar tabela documents: ${error.message}`);
    }
  }

  console.log('Listando coleções raiz do Firebase...');
  const rootCollections = await firestore.listCollections();

  for (const rootCollection of rootCollections) {
    console.log(`Lendo coleção: ${rootCollection.id}`);
    await visitCollection(rootCollection, []);
  }

  console.log(`Total de documentos lidos: ${rows.length}`);

  let written = 0;
  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    await flushBatch(batch);
    written += batch.length;
    console.log(`Lote gravado: ${written}/${rows.length}`);
  }

  console.log('Migração concluída com sucesso.');
};

run().catch((error) => {
  console.error('Erro na migração:', error);
  process.exitCode = 1;
});
