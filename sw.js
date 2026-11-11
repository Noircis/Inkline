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
 *
 * Piège du cache HTTP (corrigé en 1.6.1) : GitHub Pages envoie
 * « Cache-Control: max-age=600 ». Un fetch() ordinaire peut donc renvoyer,
 * pendant 10 minutes, l'ANCIENNE version d'un fichier gardée par le cache
 * HTTP du navigateur, qui est distinct du cache du service worker. Un nouveau
 * worker pouvait ainsi précharger d'anciens fichiers sous le nouveau nom de
 * cache, et l'app restait bloquée sur l'ancienne version. D'où :
 *   - préchargement avec cache: 'reload' (toujours depuis le réseau) ;
 *   - revalidation avec cache: 'no-cache' (le serveur confirme ou renvoie).
 */

const CACHE = 'inkline-2.9.0';

/** Fichiers préchargés à l'installation : tout ce qu'il faut pour démarrer hors ligne. */
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/list.css',
  './css/note.css',
  './css/staff.css',
  './css/grid.css',
  './css/share.css',
  './css/options.css',
  './css/list-views.css',
  './css/folders.css',
  './css/fold.css',
  './css/training.css',
  './css/staff-modes.css',
  './css/chord-keys.css',
  './css/fonts.css',
  './fonts/bricolage-grotesque-latin-600-normal.woff2',
  './fonts/bricolage-grotesque-latin-700-normal.woff2',
  './fonts/instrument-sans-latin-400-normal.woff2',
  './fonts/instrument-sans-latin-500-normal.woff2',
  './fonts/instrument-sans-latin-600-normal.woff2',
  './fonts/instrument-sans-latin-700-italic.woff2',
  './fonts/noto-music-music-400-normal.woff2',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './inkline-icon.svg',
  './js/main.js',
  './js/lang-init.js',
  './js/i18n.js',
  './js/locales/en.js',
  './js/locales/fr.js',
  './js/util.js',
  './js/model.js',
  './js/pitch.js',
  './js/rhythm.js',
  './js/layout.js',
  './js/render-staff.js',
  './js/chords.js',
  './js/grid.js',
  './js/ireal.js',
  './js/audio.js',
  './js/storage.js',
  './js/db.js',
  './js/history.js',
  './js/sanitize.js',
  './js/export.js',
  './js/pdf.js',
  './js/folders.js',
  './js/search.js',
  './js/folding.js',
  './js/placements.js',
  './js/transpose.js',
  './js/chord-keys.js',
  './js/exercise.js',
  './js/measure-fit.js',
  './js/ui/state.js',
  './js/ui/nav.js',
  './js/ui/common.js',
  './js/ui/blocks.js',
  './js/ui/home.js',
  './js/ui/note.js',
  './js/ui/folder-sheet.js',
  './js/ui/icons.js',
  './js/ui/fold.js',
  './js/ui/training.js',
  './js/ui/exercises.js',
  './js/ui/chord-keyboard.js',
  './js/ui/measure-select.js',
  './js/ui/drill-kit.js',
  './js/ui/staff/index.js',
  './js/ui/staff/shared.js',
  './js/ui/staff/view.js',
  './js/ui/staff/input.js',
  './js/ui/staff/palette.js',
  './js/ui/staff/bars.js',
  './js/ui/staff/chord.js',
  './js/ui/grid-ui.js',
  './js/ui/options.js',
  './js/ui/list-view.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // rien d'autre à mettre en cache
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req, { cache: 'no-cache' })
        .then((r) => {
          if (r && r.ok) c.put(req, r.clone());
          return r;
        })
        .catch(() => null);
      if (hit) {
        e.waitUntil(net);
        return hit;
      }
      const r = await net;
      if (r) return r;
      // Navigation hors ligne vers une URL inconnue : on sert l'app.
      if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
      return Response.error();
    }),
  );
});
