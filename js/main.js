/**
 * @module main
 * @description
 * **Entry point** of Inkline, loaded by `index.html` through
 * `<script type="module" src="js/main.js">`.
 *
 * Responsibilities:
 * 1. load the notebook (IndexedDB, asynchronously);
 * 2. show the first screen;
 * 3. wire the global listeners (going to the background, resizing, virtual
 *    keyboard);
 * 4. handle Android's back button (history);
 * 5. register the service worker (offline use).
 *
 * ## Module graph
 *
 * ```
 * main
 *  ├─ lang-init ───── i18n ── locales/en, locales/fr   (imported first)
 *  ├─ ui/home ─────┬─ ui/list-view       (list displays)
 *  │               ├─ ui/folder-sheet    (folder editor)
 *  │               └─ ui/options         (backup reminder)
 *  ├─ ui/note ─────── export ── pdf
 *  ├─ ui/options ──── ireal
 *  ├─ ui/training, ui/exercises ── ui/drill-kit, exercise ── placements
 *  ├─ ui/staff/* ──── render-staff ── layout ── rhythm ── pitch ── model ── util
 *  ├─ ui/grid-ui ──── grid ── chords
 *  │
 *  │  base shared by every screen (imports no screen):
 *  ├─ ui/nav         screen registry, navigation, back button
 *  ├─ ui/blocks      musical block registry, active block, undo
 *  ├─ ui/common      version, small interface helpers
 *  ├─ ui/state       interface state
 *  ├─ storage ─────── sanitize ── folders
 *  ├─ search, folders
 *  ├─ audio (rhythm, grid, chords)
 *  └─ history
 * ```
 *
 * Screens (`home`, `note`, `options`) and blocks (`ui/staff`, `grid-ui`)
 * **register** with `ui/nav` and `ui/blocks` at load time: navigation calls
 * them by name, without importing them. The import graph thus has no cycle.
 * That is why `main` imports every screen and every block: those imports
 * register them.
 *
 * Modules outside `ui/` (except `audio`, `storage`, `export` and `main`) are
 * pure, DOM-free, and tested under Node (`npm test`).
 */

// First: the language must be set before screens build their labels.
import './lang-init.js';
import { state, app } from './ui/state.js';
import { loadAll, flushSave, requestPersistence, getMeta, setMeta } from './storage.js';
import { renderScreen, onHistoryBack } from './ui/nav.js';
import { redrawStaff } from './ui/staff/index.js';
// Imports for their side effect: each module registers with ui/nav or ui/blocks.
import './ui/grid-ui.js';
import './ui/home.js';
import './ui/note.js';
import './ui/options.js';
import './ui/training.js';
import './ui/exercises.js';

// Asynchronous loading (IndexedDB): top-level `await`. The rest of this
// file, including the first render, only runs once the notebook is
// loaded. The modules imported above are already evaluated: they only
// registered themselves, without showing anything.
const loaded = await loadAll();
state.notes = loaded.notes;
state.folders = loaded.folders;
// A note referencing a folder that no longer exists becomes unfiled again.
Object.values(state.notes).forEach((n) => {
  if (n.folder && !state.folders[n.folder]) delete n.folder;
});
// loadAll validates the notes and fills in missing fields (creation
// date of notes from before 1.7.0). The result is written back right away
// to freeze these values: otherwise they would be recomputed at each launch.
flushSave(state.notes);
if (!getMeta().firstUse) setMeta({ firstUse: Date.now() }); // starting point of the backup reminder
if (getMeta().dataVersion !== 2) setMeta({ dataVersion: 2 }); // 2.0 format (folders) in place
// At startup we are always on the list: a history entry left by a previous
// session (page reload) is neutralized.
if (history.state && history.state.inkline) history.replaceState(null, '');
renderScreen();

// Android's (or the browser's) back button: to the previous screen.
window.addEventListener('popstate', (e) => onHistoryBack(e.state));
requestPersistence();

// Web fonts loaded after the first render: SVG text widths change, so
// redraw once.
if (document.fonts && document.fonts.ready)
  document.fonts.ready.then(() => renderScreen({ keepScroll: true }));

// Android may kill the app in the background: write right away.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave(state.notes, true);
});

// Resize / rotation: staves depend on the width.
// Opening the virtual keyboard only changes the height: redraw only if
// the width changed (otherwise the search field would lose the focus and
// the keyboard would close at once).
let resizeTimer = null;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.view.name !== 'note') {
      if (window.innerWidth === lastWidth || document.getElementById('folderSheet')) return;
      lastWidth = window.innerWidth;
      renderScreen({ keepScroll: true });
      return;
    }
    app.querySelectorAll('[data-staff]').forEach((w) => {
      const el = /** @type {HTMLElement} */ (w);
      if (el.clientWidth !== el._W) redrawStaff(el.dataset.staff);
    });
  }, 150);
});

// Virtual keyboard: by default Chrome Android only resizes the "visual
// viewport", and a `position: fixed; bottom: 0` element goes under the
// keyboard. The palettes are raised by the keyboard height. (In the
// installed app, `interactive-widget=resizes-content` already solves this
// and this offset is 0.)
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fix = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    ['palette', 'gpal'].forEach((id) => {
      document.getElementById(id).style.bottom = kb + 'px';
    });
  };
  vv.addEventListener('resize', fix);
  vv.addEventListener('scroll', fix);
}

// Offline: only served over http(s) (not file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* offline unavailable, the app still works */
  });
}
