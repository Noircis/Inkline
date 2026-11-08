// Serveur de développement : sert l'appli et la recharge à chaque enregistrement.
//
//   npm run dev        puis ouvrir http://localhost:5500/
//
// Avec --static, il sert l'appli telle qu'en production (service worker
// compris, sans rechargement automatique) : c'est le mode utilisé par les
// tests d'interface (npm run test:e2e). --port=NNNN change le port.
//
// Pourquoi pas l'extension « Live Server » ? Elle injecte un script *dans* la
// page (script « inline »), que la Content Security Policy d'Inkline bloque à
// juste titre (script-src 'self'). Ici, on injecte un script *externe*
// (/__dev/reload.js) servi par ce serveur : même origine, donc autorisé.
//
// Le service worker est neutralisé en développement : /sw.js est remplacé par
// un petit script qui se désinscrit et vide les caches. Sinon il servirait
// l'ancienne version depuis son cache après chaque modification.
//
// Aucune dépendance : modules natifs de Node uniquement.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const STATIC = args.includes('--static');
const portArg = args.find((a) => a.startsWith('--port='));
const PORT = Number(portArg ? portArg.slice(7) : process.env.PORT) || 5500;
const IGNORED = ['node_modules', '.git', 'docs', 'tests', '.vscode'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

// Script injecté dans les pages : écoute le serveur et recharge la page.
const RELOAD_JS = `new EventSource('/__dev/events').onmessage = () => location.reload();`;

// Remplace le service worker en développement : se désinscrit et vide les caches.
const NO_SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
});`;

/** Navigateurs connectés (flux Server-Sent Events). */
const clients = new Set();

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!STATIC && url === '/__dev/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': connecté\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (!STATIC && url === '/__dev/reload.js') return send(res, 200, TYPES['.js'], RELOAD_JS);
  if (!STATIC && url === '/sw.js') return send(res, 200, TYPES['.js'], NO_SW);

  const file = path.join(ROOT, url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(ROOT)) return send(res, 403, 'text/plain', 'Interdit');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain; charset=utf-8', 'Introuvable : ' + url);
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    if (!STATIC && type.startsWith('text/html'))
      data = data.toString().replace('</body>', '<script src="/__dev/reload.js"></script></body>');
    send(res, 200, type, data);
  });
});

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

// Surveille les fichiers ; plusieurs événements rapprochés = un seul rechargement.
let timer = null;
if (!STATIC)
  fs.watch(ROOT, { recursive: true }, (event, name) => {
    if (!name || IGNORED.some((d) => name.split(path.sep)[0] === d)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log('↻ ' + name);
      clients.forEach((c) => c.write('data: reload\n\n'));
    }, 120);
  });

server.listen(PORT, () => {
  if (STATIC) console.log(`Inkline (mode statique) : http://localhost:${PORT}/`);
  else {
    console.log(`Inkline en développement : http://localhost:${PORT}/`);
    console.log('Chaque enregistrement recharge la page. Ctrl+C pour arrêter.');
  }
});
