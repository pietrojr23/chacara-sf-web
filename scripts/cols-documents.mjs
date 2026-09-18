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

const mgmt = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ query }),
  });
  let b; try { b = await r.json(); } catch { b = await r.text(); }
  return { status: r.status, body: b };
};

const rows = await mgmt(`
  select column_name, data_type, is_nullable, is_identity
  from information_schema.columns
  where table_schema = 'api' and table_name = 'documents'
  order by ordinal_position;
`);
console.log('HTTP', rows.status);
for (const c of Array.isArray(rows.body) ? rows.body : []) {
  console.log(`  ${String(c.column_name).padEnd(16)} ${String(c.data_type).padEnd(14)} ident=${String(c.is_identity)} null=${String(c.is_nullable)}`);
}
