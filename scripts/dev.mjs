// Development server: serves the app and reloads it on every save.
//
//   npm run dev        then open http://localhost:5500/
//
// With --static, it serves the app as in production (service worker
// included, no automatic reload): this is the mode used by the
// interface tests (npm run test:e2e). --port=NNNN changes the port.
//
// Why not the "Live Server" extension? It injects a script *into* the
// page (an "inline" script), which Inkline's Content Security Policy rightly
// blocks (script-src 'self'). Here, an *external* script is injected
// (/__dev/reload.js) served by this server: same origin, so allowed.
//
// The service worker is disabled in development: /sw.js is replaced by
// a small script that unregisters itself and clears the caches. Otherwise it
// would serve the old version from its cache after each change.
//
// No dependencies: Node built-in modules only.

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

// Script injected into pages: listens to the server and reloads the page.
const RELOAD_JS = `new EventSource('/__dev/events').onmessage = () => location.reload();`;

// Replaces the service worker in development: unregisters and clears the caches.
const NO_SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
});`;

/** Connected browsers (Server-Sent Events streams). */
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

// Watches the files; several close events = a single reload.
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
