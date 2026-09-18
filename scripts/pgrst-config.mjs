import { readFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf-8');
const pick = (k) => {
  const m = env.match(new RegExp(`^${k}=([^\\r\\n]+)`, 'm'));
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
};
const URL = pick('EXPO_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
const ANON = pick('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = URL.split('//')[1].split('.')[0];

const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json() };
};

console.log('== config do PostgREST (pgrst.*) ==');
const c = await q(`
  select name, setting from pg_settings
  where name like 'pgrst.%' order by name;
`);
console.log('  HTTP', c.status);
for (const row of c.body || []) console.log(`  ${row.name.padEnd(28)} ${row.setting}`);
