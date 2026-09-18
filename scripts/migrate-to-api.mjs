import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf-8');
const pick = (k) => {
  const m = env.match(new RegExp(`^${k}=([^\\r\\n]+)`, 'm'));
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
};
const URL = pick('EXPO_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const ANON = pick('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const REF = URL.split('//')[1].split('.')[0];
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const H2 = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const mgmt = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  let b;
  try { b = await r.json(); } catch { b = await r.text(); }
  return { status: r.status, body: b };
};

const TABLES = [
  'users','documents','casas','chamados','avisos','visitantes','acessos','configuracoes',
  'contatos_emergencia','chat_threads','casa_documentos','alugueis_pagamentos','chat_mensagens',
];

console.log('== 0) cria schema api + grants base ==');
const s0 = await mgmt(`
  create schema if not exists api;
  grant usage on schema api to anon, authenticated, service_role;
  grant all on schema api to service_role;
`);
console.log('  HTTP', s0.status);

console.log('== 1) move cada tabela public -> api + grants ==');
for (const t of TABLES) {
  if (!t) continue;
  const r = await mgmt(`
    alter table if exists public.${t} set schema api;
    grant all on api.${t} to anon, authenticated, service_role;
  `);
  console.log(`  ${t.padEnd(22)} -> HTTP ${r.status}`);
}

console.log('== 2) reload schema (2x) ==');
for (let i = 0; i < 2; i++) {
  const rn = await mgmt(`select pg_notify('pgrst', 'reload schema');`);
  console.log(`  notify #${i + 1} -> HTTP ${rn.status}`);
  await new Promise((r) => setTimeout(r, 4000));
}

console.log('== 3) REST autenticado por tabela (agora deve ser api.*) ==');
const login = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'webcheck@chacara.test', password: 'Senha@123Teste!' }),
});
const sess = await login.json();
const token = sess?.access_token;
if (!token) { console.log('  LOGIN FALHOU:', JSON.stringify(sess).slice(0, 120)); process.exit(1); }
const RH = { apikey: ANON, Authorization: `Bearer ${token}` };

for (const t of TABLES) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=id&limit=1`, { headers: RH });
  console.log(`  ${t.padEnd(22)} -> ${r.status}${r.status === 200 ? '  OK' : ''}`);
}

console.log('== 4) escrita (upsert) em users + limpeza ==');
const probe = { id: 'write-probe-ok', data: { ok: true }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const up = await fetch(`${URL}/rest/v1/users`, {
  method: 'POST',
  headers: { ...RH, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(probe),
});
console.log(`  upsert users -> ${up.status}`);
if (up.status < 300) {
  const del = await fetch(`${URL}/rest/v1/users?id=eq.write-probe-ok`, { method: 'DELETE', headers: RH });
  console.log(`  cleanup delete -> ${del.status}`);
}
