import { getSupabase } from './supabase';
import { notifyDataChanged } from './dataSync';

export type DocumentData = Record<string, any>;

export interface DocumentReference<T extends DocumentData = DocumentData> {
  id: string;
  path: string;
}

export interface CollectionReference<T extends DocumentData = DocumentData> {
  path: string;
}

interface QueryWhereConstraint {
  type: 'where';
  field: string;
  op: '==';
  value: unknown;
}

interface QueryOrderConstraint {
  type: 'orderBy';
  field: string;
  direction: 'asc' | 'desc';
}

interface QueryLimitConstraint {
  type: 'limit';
  count: number;
}

type QueryConstraint = QueryWhereConstraint | QueryOrderConstraint | QueryLimitConstraint;

interface QueryReference<T extends DocumentData = DocumentData> {
  path: string;
  constraints: QueryConstraint[];
}

export interface DocumentSnapshot<T extends DocumentData = DocumentData> {
  id: string;
  exists: () => boolean;
  data: () => T;
}

export interface QueryDocumentSnapshot<T extends DocumentData = DocumentData> {
  id: string;
  data: () => T;
}

export interface QuerySnapshot<T extends DocumentData = DocumentData> {
  empty: boolean;
  docs: Array<QueryDocumentSnapshot<T>>;
}

interface SetDocOptions {
  merge?: boolean;
}

interface ServerTimestampMarker {
  __serverTimestamp: true;
}

interface RelationalCollectionRoute {
  table: string;
  filters: Record<string, string>;
  onConflict: string;
  collectionPath: string;
}

interface RelationalDocumentRoute extends RelationalCollectionRoute {
  id: string;
}

interface RelationalRow {
  id: string;
  data: DocumentData;
}

const nowIso = () => new Date().toISOString();

const normalizePathSegment = (segment: string) => String(segment).replace(/^\/+|\/+$/g, '').trim();

const buildPath = (segments: string[]) => {
  const normalized = segments.map(normalizePathSegment).filter(Boolean);
  if (!normalized.length) {
    throw Object.assign(new Error('Caminho inválido para documento/coleção.'), {
      code: 'invalid-argument',
    });
  }

  return normalized.join('/');
};

const parsePathSegments = (path: string) => path.split('/').filter(Boolean);

const getLastPathSegment = (path: string) => {
  const segments = parsePathSegments(path);
  return segments[segments.length - 1] ?? '';
};

const normalizeError = (error: unknown) => {
  const value = error as { code?: string; message?: string; status?: number } | undefined;
  const code = String(value?.code ?? value?.status ?? 'supabase-error');
  const message = String(value?.message ?? 'Falha ao acessar banco de dados (Supabase).');

  let mappedCode = code;
  if (code === '42501') {
    mappedCode = 'permission-denied';
  }

  if (code === 'PGRST116') {
    mappedCode = 'not-found';
  }

  return Object.assign(new Error(message), { code: mappedCode });
};

const isServerTimestampMarker = (value: unknown): value is ServerTimestampMarker =>
  Boolean(value) && typeof value === 'object' && (value as ServerTimestampMarker).__serverTimestamp === true;

const resolveSpecialValues = (value: unknown): unknown => {
  if (isServerTimestampMarker(value)) {
    return nowIso();
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveSpecialValues(item));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, item]) => {
      acc[key] = resolveSpecialValues(item);
      return acc;
    }, {});
  }

  return value;
};

const compareValues = (left: unknown, right: unknown) => {
  if (left == null && right == null) {
    return 0;
  }

  if (left == null) {
    return -1;
  }

  if (right == null) {
    return 1;
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  const leftDate = new Date(String(left));
  const rightDate = new Date(String(right));

  if (!Number.isNaN(leftDate.getTime()) && !Number.isNaN(rightDate.getTime())) {
    return leftDate.getTime() - rightDate.getTime();
  }

  return String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' });
};

const topLevelCollectionMap: Record<string, string> = {
  users: 'users',
  casas: 'casas',
  chamados: 'chamados',
  avisos: 'avisos',
  visitantes: 'visitantes',
  acessos: 'acessos',
  configuracoes: 'configuracoes',
  chatThreads: 'chat_threads',
  contatosEmergencia: 'contatos_emergencia',
};

const resolveCollectionRoute = (collectionPath: string): RelationalCollectionRoute | null => {
  const segments = parsePathSegments(collectionPath);

  if (segments.length === 1 && topLevelCollectionMap[segments[0]]) {
    return {
      table: topLevelCollectionMap[segments[0]],
      filters: {},
      onConflict: 'id',
      collectionPath,
    };
  }

  if (segments.length === 3 && segments[0] === 'chat' && segments[1] === 'geral' && segments[2] === 'mensagens') {
    return {
      table: 'chat_mensagens',
      filters: { chat_type: 'geral', chat_id: 'geral' },
      onConflict: 'chat_type,chat_id,id',
      collectionPath,
    };
  }

  if (segments.length === 4 && segments[0] === 'chat' && segments[1] === 'privado' && segments[3] === 'mensagens') {
    return {
      table: 'chat_mensagens',
      filters: { chat_type: 'privado', chat_id: segments[2] },
      onConflict: 'chat_type,chat_id,id',
      collectionPath,
    };
  }

  if (segments.length === 3 && segments[0] === 'documentos' && segments[2] === 'docs') {
    return {
      table: 'casa_documentos',
      filters: { casa_id: segments[1] },
      onConflict: 'casa_id,id',
      collectionPath,
    };
  }

  if (segments.length === 3 && segments[0] === 'alugueis' && segments[2] === 'pagamentos') {
    return {
      table: 'alugueis_pagamentos',
      filters: { casa_id: segments[1] },
      onConflict: 'casa_id,id',
      collectionPath,
    };
  }

  return null;
};

const resolveDocumentRoute = (path: string): RelationalDocumentRoute | null => {
  const segments = parsePathSegments(path);

  if (segments.length === 2 && topLevelCollectionMap[segments[0]]) {
    return {
      table: topLevelCollectionMap[segments[0]],
      filters: {},
      onConflict: 'id',
      collectionPath: segments[0],
      id: segments[1],
    };
  }

  if (segments.length === 4 && segments[0] === 'chat' && segments[1] === 'geral' && segments[2] === 'mensagens') {
    return {
      table: 'chat_mensagens',
      filters: { chat_type: 'geral', chat_id: 'geral' },
      onConflict: 'chat_type,chat_id,id',
      collectionPath: 'chat/geral/mensagens',
      id: segments[3],
    };
  }

  if (segments.length === 5 && segments[0] === 'chat' && segments[1] === 'privado' && segments[3] === 'mensagens') {
    return {
      table: 'chat_mensagens',
      filters: { chat_type: 'privado', chat_id: segments[2] },
      onConflict: 'chat_type,chat_id,id',
      collectionPath: `chat/privado/${segments[2]}/mensagens`,
      id: segments[4],
    };
  }

  if (segments.length === 4 && segments[0] === 'documentos' && segments[2] === 'docs') {
    return {
      table: 'casa_documentos',
      filters: { casa_id: segments[1] },
      onConflict: 'casa_id,id',
      collectionPath: `documentos/${segments[1]}/docs`,
      id: segments[3],
    };
  }

  if (segments.length === 4 && segments[0] === 'alugueis' && segments[2] === 'pagamentos') {
    return {
      table: 'alugueis_pagamentos',
      filters: { casa_id: segments[1] },
      onConflict: 'casa_id,id',
      collectionPath: `alugueis/${segments[1]}/pagamentos`,
      id: segments[3],
    };
  }

  return null;
};

const ensureMappedRoute = <T>(route: T | null, path: string) => {
  if (!route) {
    throw Object.assign(
      new Error(`Rota não mapeada para tabela relacional: ${path}. Execute o schema relacional e atualize o mapeamento.`),
      { code: 'route-not-mapped' },
    );
  }

  return route;
};

const applyConstraints = (rows: RelationalRow[], constraints: QueryConstraint[]) => {
  let result = [...rows];

  constraints
    .filter((item): item is QueryWhereConstraint => item.type === 'where')
    .forEach((constraint) => {
      result = result.filter((row) => row.data?.[constraint.field] === constraint.value);
    });

  constraints
    .filter((item): item is QueryOrderConstraint => item.type === 'orderBy')
    .forEach((constraint) => {
      result.sort((left, right) => {
        const compared = compareValues(left.data?.[constraint.field], right.data?.[constraint.field]);
        return constraint.direction === 'desc' ? -compared : compared;
      });
    });

  const queryLimit = constraints.find((item): item is QueryLimitConstraint => item.type === 'limit');
  if (queryLimit) {
    result = result.slice(0, Math.max(0, queryLimit.count));
  }

  return result;
};

const toDocumentSnapshot = <T extends DocumentData>(collectionPath: string, row: RelationalRow): QueryDocumentSnapshot<T> => ({
  id: row.id,
  data: () => row.data as T,
});

const randomId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const readRelationalDoc = async (route: RelationalDocumentRoute): Promise<RelationalRow | null> => {
  let queryRef: any = getSupabase().from(route.table).select('id,data').eq('id', route.id);

  Object.entries(route.filters).forEach(([key, value]) => {
    queryRef = queryRef.eq(key, value);
  });

  const { data, error } = await queryRef.maybeSingle();

  if (error) {
    throw normalizeError(error);
  }

  if (!data) {
    return null;
  }

  return {
    id: String(data.id),
    data: (data.data ?? {}) as DocumentData,
  };
};

const listRelationalCollection = async (route: RelationalCollectionRoute): Promise<RelationalRow[]> => {
  let queryRef: any = getSupabase().from(route.table).select('id,data').limit(5000);

  Object.entries(route.filters).forEach(([key, value]) => {
    queryRef = queryRef.eq(key, value);
  });

  const { data, error } = await queryRef;

  if (error) {
    throw normalizeError(error);
  }

  return (data ?? []).map((row: any) => ({
    id: String(row.id),
    data: (row.data ?? {}) as DocumentData,
  }));
};

const upsertRelationalDoc = async (route: RelationalDocumentRoute, data: DocumentData) => {
  const payload: Record<string, unknown> = {
    id: route.id,
    data,
    ...route.filters,
  };

  const { error } = await getSupabase().from(route.table).upsert(payload, {
    onConflict: route.onConflict,
    ignoreDuplicates: false,
  });

  if (error) {
    throw normalizeError(error);
  }

  notifyDataChanged();
};

export const serverTimestamp = (): ServerTimestampMarker => ({ __serverTimestamp: true });

export const collection = <T extends DocumentData = DocumentData>(
  _db: unknown,
  ...segments: string[]
): CollectionReference<T> => ({
  path: buildPath(segments),
});

export const doc = <T extends DocumentData = DocumentData>(
  _db: unknown,
  ...segments: string[]
): DocumentReference<T> => {
  const path = buildPath(segments);
  return {
    path,
    id: getLastPathSegment(path),
  };
};

export const where = (field: string, op: '==', value: unknown): QueryWhereConstraint => ({
  type: 'where',
  field,
  op,
  value,
});

export const orderBy = (field: string, direction: 'asc' | 'desc' = 'asc'): QueryOrderConstraint => ({
  type: 'orderBy',
  field,
  direction,
});

export const limit = (count: number): QueryLimitConstraint => ({
  type: 'limit',
  count,
});

export const query = <T extends DocumentData = DocumentData>(
  collectionRef: CollectionReference<T>,
  ...constraints: QueryConstraint[]
): QueryReference<T> => ({
  path: collectionRef.path,
  constraints,
});

export const getDoc = async <T extends DocumentData = DocumentData>(
  ref: DocumentReference<T>,
): Promise<DocumentSnapshot<T>> => {
  const route = ensureMappedRoute(resolveDocumentRoute(ref.path), ref.path);
  const row = await readRelationalDoc(route);

  return {
    id: ref.id,
    exists: () => Boolean(row),
    data: () => ((row?.data ?? {}) as T),
  };
};

export const getDocs = async <T extends DocumentData = DocumentData>(
  source: CollectionReference<T> | QueryReference<T>,
): Promise<QuerySnapshot<T>> => {
  const path = source.path;
  const constraints = 'constraints' in source ? source.constraints : [];
  const route = ensureMappedRoute(resolveCollectionRoute(path), path);

  const rows = await listRelationalCollection(route);
  const filtered = applyConstraints(rows, constraints);
  const docs = filtered.map((row) => toDocumentSnapshot<T>(route.collectionPath, row));

  return {
    empty: docs.length === 0,
    docs,
  };
};

export const setDoc = async <T extends DocumentData = DocumentData>(
  ref: DocumentReference<T>,
  payload: Partial<T>,
  options?: SetDocOptions,
) => {
  const route = ensureMappedRoute(resolveDocumentRoute(ref.path), ref.path);
  const nextDataRaw = resolveSpecialValues(payload) as DocumentData;

  let nextData = nextDataRaw;
  if (options?.merge) {
    const existing = await readRelationalDoc(route);
    nextData = {
      ...(existing?.data ?? {}),
      ...nextDataRaw,
    };
  }

  await upsertRelationalDoc(route, nextData);
};

export const updateDoc = async <T extends DocumentData = DocumentData>(
  ref: DocumentReference<T>,
  payload: Partial<T>,
) => {
  const route = ensureMappedRoute(resolveDocumentRoute(ref.path), ref.path);
  const existing = await readRelationalDoc(route);

  if (!existing) {
    throw Object.assign(new Error(`Documento não encontrado: ${ref.path}`), {
      code: 'not-found',
    });
  }

  await upsertRelationalDoc(route, {
    ...existing.data,
    ...(resolveSpecialValues(payload) as DocumentData),
  });
};

export const addDoc = async <T extends DocumentData = DocumentData>(
  collectionRef: CollectionReference<T>,
  payload: Partial<T>,
): Promise<DocumentReference<T>> => {
  const route = ensureMappedRoute(resolveCollectionRoute(collectionRef.path), collectionRef.path);
  const id = randomId();
  const ref = doc<T>({}, collectionRef.path, id);
  const data = resolveSpecialValues(payload) as DocumentData;

  await upsertRelationalDoc(
    {
      ...route,
      id,
    },
    data,
  );

  return ref;
};
