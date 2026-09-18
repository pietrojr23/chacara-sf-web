/**
 * Torna o build web exportável em subpasta (GitHub Pages).
 *
 * O `expo export` gera URLs absolutas ("/assets/...", "/_expo/..."), que só
 * funcionam na raiz do domínio. Este script reescreve index.html e o bundle
 * para caminhos relativos ("./assets/..."), permitindo hospedar em
 * https://<user>.github.io/<repo>/.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

const rewrite = (filePath) => {
  const original = readFileSync(filePath, 'utf-8');
  let content = original.replace(/="\/(_expo|assets|favicon|static)\//g, '="./$1/');
  content = content.replace(/="\/(favicon\.\w+)"/g, '="./$1"');
  return { filePath, changed: content !== original, content };
};

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name === 'index.html')) {
      files.push(full);
    }
  }
};

if (!existsSync(dist)) {
  console.error('Dist não encontrado. Rode antes: npm run build:web');
  process.exit(1);
}

walk(dist);

let totalReplacements = 0;

for (const file of files) {
  const original = readFileSync(file, 'utf-8');
  let content;

  if (file.endsWith('.js')) {
    // URLs de assets dentro do bundle aparecem como literais "string": "/assets/...".
    content = original.replaceAll('"/assets/', '"./assets/');
  } else {
    // index.html: atributos src/href apontando para a raiz do domínio.
    content = original
      .replace(/="\/(_expo|assets|favicon|static)\//g, '="./$1/')
      .replace(/="\/(favicon\.\w+)"/g, '="./$1"');
  }

  if (content !== original) {
    totalReplacements += 1;
    writeFileSync(file, content);
    console.log(`✓ caminhos relativos: ${file.replace(process.cwd() + '/', '')}`);
  }
}

const bundle = files.find((file) => /index-.*\.js$/.test(file));
if (bundle) {
  const original = readFileSync(bundle, 'utf-8');
  const remainingAbs = (original.match(/["'`]\/_(expo|static|assets)\//g) || []).length;
  if (remainingAbs > 0) {
    console.warn(`Atenção: restaram ${remainingAbs} referências absolutas não tocadas no bundle.`);
  }
}

console.log(`Concluído: ${totalReplacements} arquivo(s) ajustado(s).`);
console.log('Agora o build pode ser servido em subpasta (GitHub Pages).');

// GitHub Pages (Jekyll) ignora arquivos/pastas iniciando com "_".
// O ".nojekyll" desativa o Jekyll e preserva o _expo/ do Expo.
writeFileSync(join(dist, '.nojekyll'), '');
console.log('✓ .nojekyll criado (desativa Jekyll no GitHub Pages).');