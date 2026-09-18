/**
 * Cria o repositório e publica o web app (dist/) no GitHub Pages.
 *
 * Uso:
 *   GH_TOKEN=github_pat_... npm run deploy:pages
 *   GH_TOKEN=... REPO_NAME=chacara-sf-web npm run deploy:pages
 */
import { request } from 'node:https';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';

const token = process.env.GH_TOKEN;
const repoName = process.env.REPO_NAME || 'chacara-sf-web';
const distDir = join(process.cwd(), 'dist');

if (!token) {
  console.error(
    'Exporte GH_TOKEN com o seu token do GitHub (escopos repo + workflow):\n  export GH_TOKEN=github_pat_...  ou  GH_TOKEN=... npm run deploy:pages',
  );
  process.exit(1);
}

if (!existsSync(distDir)) {
  console.error('dist/ não encontrado. Rode: npm run build:web:pages');
  process.exit(1);
}

const ghApi = (method, path, body) =>
  new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request(
      {
        hostname: 'api.github.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'chacara-sf-web-deploy',
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
          let parsed = null;
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

const run = async () => {
  const me = await ghApi('GET', '/user');
  if (me.status !== 200) {
    throw new Error(`Token inválido ou sem escopo de repo (${me.status}): ${JSON.stringify(me.body).slice(0, 200)}`);
  }
  const login = me.body.login;
  console.log(`Autenticado como @${login}`);

  const created = await ghApi('POST', '/user/repos', {
    name: repoName,
    description: 'Web app Chácara São Francisco',
    homepage: '',
    private: false,
    has_issues: false,
    has_wiki: false,
    has_projects: false,
    auto_init: false,
  });
  if (created.status !== 201 && created.status !== 422) {
    throw new Error(`Falha ao criar repositório (${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`);
  }
  if (created.status === 201) {
    console.log(`Repositório criado: https://github.com/${login}/${repoName}`);
  } else {
    console.log(`Repositório já existe: https://github.com/${login}/${repoName}`);
  }

  const workdir = mkdtempSync(join(tmpdir(), 'chacara-pages-'));
  const copy = (src, dest) => {
    const stat = statSync(src);
    if (stat.isDirectory()) {
      cpSync(src, dest, { recursive: true });
    } else {
      copyFileSync(src, dest);
    }
  };
  for (const entry of readdirSync(distDir)) {
    copy(join(distDir, entry), join(workdir, entry));
  }

  const runGit = (args) => execFileSync('git', args, { cwd: workdir, stdio: 'pipe' }).toString().trim();

  runGit(['init', '-b', 'gh-pages']);
  runGit(['config', 'user.name', login]);
  runGit(['config', 'user.email', `${login}@users.noreply.github.com`]);
  runGit(['add', '-A']);
  runGit(['commit', '-m', 'deploy: web app Chácara São Francisco']);
  const remoteUrl = `https://x-access-token:${token}@github.com/${login}/${repoName}.git`;
  runGit(['remote', 'add', 'origin', remoteUrl]);
  execFileSync('git', ['push', '-f', 'origin', 'gh-pages'], { cwd: workdir, stdio: 'pipe' });
  console.log('Branch gh-pages publicada.');

  const pages = await ghApi('PUT', `/repos/${login}/${repoName}/pages`, {
    source: { branch: 'gh-pages', path: '/' },
  });
  if (pages.status >= 300) {
    console.warn(`Aviso: não consegui ativar o Pages (${pages.status}): ${JSON.stringify(pages.body).slice(0, 300)}`);
  }

  const info = await ghApi('GET', `/repos/${login}/${repoName}/pages`);
  const url = info.body?.html_url || `https://${login}.github.io/${repoName}/`;
  console.log(`\nWeb app publicado em: ${url}`);
  console.log('Para liberar esse endereço no Supabase, rode:');
  console.log(`  SUPABASE_WEB_ORIGIN="${url.replace(/\/$/, '')}" npm run supabase:redirects`);
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});