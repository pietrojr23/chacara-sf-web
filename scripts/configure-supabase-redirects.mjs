/**
 * Adiciona a origem do web app na lista de Redirect URLs do Supabase Auth.
 *
 * Uso:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx npm run supabase:redirects
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_WEB_ORIGIN=https://meu-dominio.com npm run supabase:redirects
 */
import { request } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MANAGEMENT_API = 'api.supabase.com';
const envVars = (() => {
  const result = { ...process.env };
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const match = /^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && result[match[1]] === undefined) {
        result[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  return result;
})();

const accessToken = envVars.SUPABASE_ACCESS_TOKEN;
const ref = process.argv[2] || (envVars.EXPO_PUBLIC_SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const extraOrigins = (envVars.SUPABASE_WEB_ORIGIN || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (!accessToken || !ref) {
  console.error(
    'Faltam dados. Preencha:\n' +
      '  SUPABASE_ACCESS_TOKEN=<personal access token sbp_...>\n' +
      '  REF (opcional, detectado do .env)',
  );
  process.exit(1);
}

const normalizeOrigin = (value) => value.replace(/\/+$/, '');

const DEFAULT_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:19006',
];

const apiRequest = (method, path, body) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request(
      {
        hostname: MANAGEMENT_API,
        path,
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        });
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });

const getAuthConfig = async () => {
  const { status, body } = await apiRequest('GET', `/v1/projects/${ref}/config/auth`);
  if (status !== 200) {
    throw new Error(`Falha ao buscar config (${status}): ${JSON.stringify(body)}`);
  }
  return body;
};

const updateAuthConfig = async (payload) => {
  const { status, body } = await apiRequest('PATCH', `/v1/projects/${ref}/config/auth`, payload);
  if (status !== 200) {
    throw new Error(`Falha ao salvar config (${status}): ${JSON.stringify(body)}`);
  }
  return body;
};

const run = async () => {
  const current = await getAuthConfig();
  const allowList = String(current.uri_allow_list || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const desired = Array.from(
    new Set([
      ...allowList.map(normalizeOrigin),
      ...DEFAULT_ORIGINS.map(normalizeOrigin),
      ...extraOrigins.map(normalizeOrigin),
    ]),
  )
    .filter(Boolean)
    .sort();

  if (JSON.stringify(desired) === JSON.stringify(allowList)) {
    console.log('Nenhuma mudança necessária. Redirect URLs atuais:');
    desired.forEach((uri) => console.log(`  - ${uri}`));
    return;
  }

  const updated = await updateAuthConfig({ uri_allow_list: desired.join(',') });
  const saved = String(updated.uri_allow_list || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  console.log('Redirect URLs atualizadas no Supabase:');
  saved.forEach((uri) => console.log(`  - ${uri}`));
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});