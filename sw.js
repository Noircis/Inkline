/**
 * Inkline's service worker: offline use.
 *
 * "Stale-while-revalidate" strategy:
 * - answer immediately from the cache (instant startup, works offline);
 * - in parallel, download the file again and update the cache for the next
 *   opening.
 *
 * Consequence: after a deployment, the new version shows up on the SECOND
 * opening of the app.
 *
 * The cache name is versioned. Changing CACHE (on every published version)
 * installs a new worker that preloads the files and deletes the old caches
 * on activation. skipWaiting() and clients.claim() make it active without
 * waiting for every tab to close.
 *
 * Since 1.5.0, fonts are hosted in the repository: the app no longer
 * contacts any other server.
 *
 * HTTP cache trap (fixed in 1.6.1): GitHub Pages sends
 * "Cache-Control: max-age=600". A plain fetch() can therefore return, for
 * 10 minutes, the OLD version of a file kept by the browser's HTTP cache,
 * which is separate from the service worker cache. A new worker could thus
 * preload old files under the new cache name, and the app stayed stuck on
 * the old version. Hence:
 *   - preloading with cache: 'reload' (always from the network);
 *   - revalidation with cache: 'no-cache' (the server confirms or resends).
 */

const CACHE = 'inkline-2.10.0-spike.2';

/** Files preloaded on install: everything needed to start offline. */
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
  './css/metro-spike.css',
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
  './js/metro-clock.js',
  './js/metro-engine.js',
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
  './js/ui/metro-spike.js',
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
  if (url.origin !== location.origin) return; // nothing else to cache
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
      // Offline navigation to an unknown URL: serve the app.
      if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
      return Response.error();
    }),
  );
});
