/**
 * Service worker d'Inkline : fonctionnement hors ligne.
 *
 * Stratégie « stale-while-revalidate » :
 * - on répond immédiatement depuis le cache (démarrage instantané, hors ligne OK) ;
 * - en parallèle, on retélécharge le fichier et on met le cache à jour pour
 *   la prochaine ouverture.
 *
 * Conséquence : après une mise en ligne, la nouvelle version apparaît à la
 * DEUXIÈME ouverture de l'app.
 *
 * Le nom du cache est versionné. Changer CACHE (à chaque version publiée)
 * fait installer un nouveau worker qui précharge les fichiers et supprime les
 * anciens caches à l'activation. skipWaiting() et clients.claim() le rendent
 * actif sans attendre la fermeture de tous les onglets.
 *
 * Depuis la 1.5.0, les polices sont hébergées dans le dépôt : l'app ne
 * contacte plus aucun autre serveur.
 */

const CACHE = 'inkline-1.5.0';

/** Fichiers préchargés à l'installation : tout ce qu'il faut pour démarrer hors ligne. */
const CORE = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './css/fonts.css',
  './fonts/bricolage-grotesque-latin-600-normal.woff2', './fonts/bricolage-grotesque-latin-700-normal.woff2',
  './fonts/instrument-sans-latin-400-normal.woff2', './fonts/instrument-sans-latin-500-normal.woff2',
  './fonts/instrument-sans-latin-600-normal.woff2', './fonts/instrument-sans-latin-700-italic.woff2',
  './fonts/noto-music-music-400-normal.woff2',
  './icon-192.png', './icon-512.png', './icon-maskable.png',
  './js/main.js', './js/util.js', './js/model.js', './js/pitch.js', './js/rhythm.js',
  './js/layout.js', './js/render-staff.js', './js/chords.js', './js/grid.js', './js/ireal.js',
  './js/audio.js', './js/storage.js', './js/history.js', './js/sanitize.js', './js/export.js', './js/pdf.js',
  './js/ui/state.js', './js/ui/views.js', './js/ui/staff-ui.js', './js/ui/grid-ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // rien d'autre à mettre en cache
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req)
      .then((r) => { if (r && r.ok) c.put(req, r.clone()); return r; })
      .catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net;
    if (r) return r;
    // Navigation hors ligne vers une URL inconnue : on sert l'app.
    if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
