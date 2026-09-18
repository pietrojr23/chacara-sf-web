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

console.log('== config PostgREST do projeto (Management API) ==');
try {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/database/postgres`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  console.log('  HTTP', r.statusapse);
  console.log(' ', JSON.stringify(await r.json()).slice(0, 600));
} catch (e) {
  console.log('  erro:', e.message);
}

console.log('\n== teste REST com Content-Profile: api vs public (login) ==');
const sess = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'webcheck@chacara.test', password: 'Senha@123Teste!' }),
}).then((r) => r.json());
const tok = sess?.access_token;
console.log('  login:', tok ? 'ok' : 'falhou ' + JSON.stringify(sess).slice(0, 100));
if (tok) {
  for (const profile of ['api', 'public', 'storage']) {
    const r = await fetch(`${URL}/rest/v1/users?select=id&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${tok}`, 'Content-Profile': profile },
    });
    console.log(`  Content-Profile: ${profile.padEnd(8)} -> ${r.status}`);
  }
}
