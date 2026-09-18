import { request } from 'node:https';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = 'efhaysynvwxdcuhwbhzp';

if (!TOKEN) {
  console.error('Faltando SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}

const ghApi = (method: string, path: string, body?: unknown) =>
  new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request(
      {
        hostname: 'api.supabase.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });

const runSql = async (label: string, sql: string) => {
  const res = await ghApi('POST', `/v1/projects/${REF}/database/query`, { query: sql });
  const ok = res.status === 200 || res.status === 201;
  const errMsg = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? '').slice(0, 400);
  console.log(`${ok ? '✓' : '✗'} ${label} — HTTP ${res.status}${ok ? '' : ` :: ${errMsg}`}`);
  return ok;
};

const step = (name: string, q: string) => ({ name, q });
const path = (f: string) => require('node:fs').readFileSync(f, 'utf-8');

const steps = [
  step('bootstrap (documents + bucket app-files)', path('supabase/sql/bootstrap.sql')),
  step('tabelas relacionais (users, casas, chamados, chat…)', path('supabase/sql/relational_tables.sql')),
  step('chat_threads_migration', path('supabase/sql/chat_threads_migration.sql')),
  step('remove_house_tenant_cpf_fields', path('supabase/sql/remove_house_tenant_cpf_fields.sql')),
];

(async () => {
  let okAll = true;
  for (const s of steps) {
    const ok = await runSql(s.name, s.q);
    if (!ok) {
      okAll = false;
      break;
    }
  }
  process.exit(okAll ? 0 : 1);
})();
