import { createServer } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('../', import.meta.url)), 'dist');
const port = Number(process.env.PORT || 8080);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/') {
    urlPath = '/index.html';
  }

  const filePath = normalize(join(root, urlPath));

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(join(root, 'index.html')).pipe(res);
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Web app disponível em http://localhost:${port}`);
});