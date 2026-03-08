#!/usr/bin/env node

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = Number(process.env.MIGRATION_BATCH_SIZE || 500);
const CLEAR_RELATIONAL_TABLES = String(process.env.CLEAR_RELATIONAL_TABLES || '').toLowerCase() === 'true';

if (!SUPABASE_URL) {
  throw new Error('Defina SUPABASE_URL (ou EXPO_PUBLIC_SUPABASE_URL).');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY para migrar dados sem bloqueio de RLS.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const topLevelTableMap = {
  users: 'users',
  casas: 'casas',
  chamados: 'chamados',
  avisos: 'avisos',
  visitantes: 'visitantes',
  acessos: 'acessos',
  configuracoes: 'configuracoes',
  contatosEmergencia: 'contatos_emergencia',
};

const toSegments = (path) => String(path || '').split('/').filter(Boolean);

const mapDocumentPathToRelational = (path, data) => {
  const segments = toSegments(path);

  if (segments.length === 2 && topLevelTableMap[segments[0]]) {
    return {
      table: topLevelTableMap[segments[0]],
      onConflict: 'id',
      row: {
        id: segments[1],
        data: data ?? {},
      },
    };
  }

  if (segments.length === 4 && segments[0] === 'chat' && segments[1] === 'geral' && segments[2] === 'mensagens') {
    return {
      table: 'chat_mensagens',
      onConflict: 'chat_type,chat_id,id',
      row: {
        chat_type: 'geral',
        chat_id: 'geral',
        id: segments[3],
        data: data ?? {},
      },
    };
  }

  if (segments.length === 5 && segments[0] === 'chat' && segments[1] === 'privado' && segments[3] === 'mensagens') {
    return {
      table: 'chat_mensagens',
      onConflict: 'chat_type,chat_id,id',
      row: {
        chat_type: 'privado',
        chat_id: segments[2],
        id: segments[4],
        data: data ?? {},
      },
    };
  }

  if (segments.length === 4 && segments[0] === 'documentos' && segments[2] === 'docs') {
    return {
      table: 'casa_documentos',
      onConflict: 'casa_id,id',
      row: {
        casa_id: segments[1],
        id: segments[3],
        data: data ?? {},
      },
    };
  }

  if (segments.length === 4 && segments[0] === 'alugueis' && segments[2] === 'pagamentos') {
    return {
      table: 'alugueis_pagamentos',
      onConflict: 'casa_id,id',
      row: {
        casa_id: segments[1],
        id: segments[3],
        data: data ?? {},
      },
    };
  }

  return null;
};

const clearTables = async () => {
  const deletions = [
    ['users', (query) => query.not('id', 'is', null)],
    ['casas', (query) => query.not('id', 'is', null)],
    ['chamados', (query) => query.not('id', 'is', null)],
    ['avisos', (query) => query.not('id', 'is', null)],
    ['visitantes', (query) => query.not('id', 'is', null)],
    ['acessos', (query) => query.not('id', 'is', null)],
    ['configuracoes', (query) => query.not('id', 'is', null)],
    ['contatos_emergencia', (query) => query.not('id', 'is', null)],
    ['chat_mensagens', (query) => query.not('chat_id', 'is', null)],
    ['casa_documentos', (query) => query.not('casa_id', 'is', null)],
    ['alugueis_pagamentos', (query) => query.not('casa_id', 'is', null)],
  ];

  for (const [table, applyFilter] of deletions) {
    const baseQuery = supabase.from(table).delete();
    const { error } = await applyFilter(baseQuery);
    if (error) {
      throw new Error(`Falha ao limpar tabela ${table}: ${error.message}`);
    }
  }
};

const readAllDocuments = async () => {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from('documents')
      .select('path,data')
      .order('path', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Falha ao ler documents: ${error.message}`);
    }

    const batch = data ?? [];
    if (!batch.length) {
      break;
    }

    rows.push(...batch);

    if (batch.length < BATCH_SIZE) {
      break;
    }

    from += BATCH_SIZE;
  }

  return rows;
};

const chunk = (items, size) => {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
};

const run = async () => {
  if (CLEAR_RELATIONAL_TABLES) {
    console.log('Limpando tabelas relacionais...');
    await clearTables();
  }

  console.log('Lendo tabela documents...');
  const docs = await readAllDocuments();
  console.log(`Documentos lidos: ${docs.length}`);

  const mappedByTarget = new Map();
  let ignored = 0;

  for (const item of docs) {
    const mapped = mapDocumentPathToRelational(item.path, item.data);
    if (!mapped) {
      ignored += 1;
      continue;
    }

    const key = `${mapped.table}|${mapped.onConflict}`;
    if (!mappedByTarget.has(key)) {
      mappedByTarget.set(key, {
        table: mapped.table,
        onConflict: mapped.onConflict,
        rows: [],
      });
    }

    mappedByTarget.get(key).rows.push(mapped.row);
  }

  let written = 0;
  for (const target of mappedByTarget.values()) {
    const chunks = chunk(target.rows, BATCH_SIZE);
    for (const currentChunk of chunks) {
      const { error } = await supabase
        .from(target.table)
        .upsert(currentChunk, { onConflict: target.onConflict, ignoreDuplicates: false });

      if (error) {
        throw new Error(`Falha ao gravar em ${target.table}: ${error.message}`);
      }

      written += currentChunk.length;
      console.log(`Migrados ${written} registros...`);
    }
  }

  console.log('Migração concluída.');
  console.log(`Total migrado: ${written}`);
  console.log(`Ignorados (paths não mapeados): ${ignored}`);
};

run().catch((error) => {
  console.error('Erro na migração documents -> relational:', error);
  process.exitCode = 1;
});
