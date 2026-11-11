/**
 * @module ui/options
 * @description
 * **Settings** screen, opened by the gear on the home screen.
 *
 * It gathers what concerns the whole notebook, to keep the home screen
 * dedicated to notes:
 *
 * - **Display**: Cards, Mosaic or List for the home screen; automatic
 *   collapse of long blocks;
 * - **Folders**: list of folders (tap to edit), creation;
 * - **Notebook**: export a full backup (notes and folders), import a file
 *   (backup or received `.inkline` note), date of the last backup;
 * - **iReal Pro**: import a link, a playlist or an `.html` file;
 * - **About**: version, what's new, code documentation.
 *
 * ## Backup reminder
 *
 * Notes live only on the phone. After
 * {@link module:ui/options~BACKUP_REMINDER_DAYS|BACKUP_REMINDER_DAYS} days
 * without an export, a dot appears on the gear
 * ({@link module:ui/options.backupDue|backupDue}): a visible reminder, but
 * never a blocking one.
 */

import { t, lang } from '../i18n.js';
import { state, app } from './state.js';
import { esc, uid } from '../util.js';
import {
  flushSave,
  saveFolders,
  backupJson,
  importFile,
  getMeta,
  setMeta,
  storageBackend,
} from '../storage.js';
import { sanitizeBlock } from '../sanitize.js';
import { parseIRealAll, songToGrid } from '../ireal.js';
import { sortedFolders, countByFolder } from '../folders.js';
import { download } from '../export.js';
import { LIST_VIEWS } from './list-view.js';
import { APP_VERSION, readFile } from './common.js';
import { registerScreen, renderScreen, openNote, backToList } from './nav.js';
import { openFolderSheet } from './folder-sheet.js';
import { FOLD_MIN_LINES, FOLD_PREVIEW_LINES } from './fold.js';

/** Number of days without a backup before showing the reminder. */
const BACKUP_REMINDER_DAYS = 30;

const DAY = 24 * 3600 * 1000;

/** Address of the changelog on GitHub. */
const CHANGELOG_URL = 'https://github.com/Noircis/Inkline/blob/main/CHANGELOG.md';

/**
 * Should a backup be suggested? Yes if there are notes and the last backup
 * (or, failing that, the first use) is more than {@link BACKUP_REMINDER_DAYS}
 * days old.
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function backupDue(now = Date.now()) {
  if (!Object.keys(state.notes).length) return false;
  const meta = getMeta();
  const ref = meta.lastExport || meta.firstUse || now;
  return now - ref > BACKUP_REMINDER_DAYS * DAY;
}

/**
 * Readable wording of the last backup date.
 * @param {number|undefined} ts
 * @returns {string}
 */
function lastExportLabel(ts) {
  if (!ts) return t('opt.noBackup');
  const days = Math.floor((Date.now() - ts) / DAY);
  if (days <= 0) return t('opt.backupToday');
  if (days === 1) return t('opt.backupYesterday');
  return t('opt.backupDaysAgo', { n: days });
}

/**
 * Creates one note per iReal tune found in `text`.
 * @param {string} text `irealb://` link(s) or iReal `.html` file.
 * @returns {number} Number of tunes imported.
 */
function importIRealNotes(text) {
  const songs = parseIRealAll(text);
  songs.forEach((s, k) => {
    // iReal stores the composer as "Last First": put it back in the usual order.
    const composer = s.composer && s.composer !== 'Unknown' ? s.composer.split(' ').reverse().join(' ') : '';
    const n = {
      id: uid(),
      title: s.title.slice(0, 200),
      created: Date.now() + k,
      updated: Date.now() + k,
      blocks: [{ id: uid(), type: 'text', text: composer.slice(0, 200) }, sanitizeBlock(songToGrid(s))],
    };
    state.notes[n.id] = n;
  });
  if (songs.length) flushSave(state.notes);
  return songs.length;
}

/** Pictograms of the three displays (inline SVG, colored with currentColor). */
const VIEW_ICONS = {
  cards:
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="3" y="3" width="16" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="12" width="16" height="7" rx="1.5" fill="currentColor"/></svg>',
  mosaic:
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="12" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="12" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="12" y="12" width="7" height="7" rx="1.5" fill="currentColor"/></svg>',
  list: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="3" y="4" width="16" height="2.4" rx="1.2" fill="currentColor"/><rect x="3" y="9.8" width="16" height="2.4" rx="1.2" fill="currentColor"/><rect x="3" y="15.6" width="16" height="2.4" rx="1.2" fill="currentColor"/></svg>',
};

/** Chevron of tappable rows. */
const CHEVRON = '<span class="opt-chev" aria-hidden="true">&#8250;</span>';

/**
 * HTML of the Folders section.
 * @returns {string}
 */
function foldersHtml() {
  const counts = countByFolder(Object.values(state.notes), state.folders);
  const rows = sortedFolders(state.folders)
    .map(
      (f) =>
        `<button class="opt-row" type="button" data-folder="${esc(f.id)}"><span class="opt-folder"><span class="fdot fc-${f.color}" aria-hidden="true"></span><span>${esc(f.name)}<small>${esc(t('home.noteCount', { n: counts[f.id] }))}</small></span></span>${CHEVRON}</button>`,
    )
    .join('');
  return `${rows}<button class="opt-row" id="optNewFolder" type="button"><span>+ ${esc(t('home.newFolder'))}<small>${esc(rows ? t('opt.folderDeleteHint') : t('opt.folderHint'))}</small></span>${CHEVRON}</button>`;
}

/**
 * HTML of the Language section (2.9): automatic (phone or browser
 * language), English or French. Language names stay in their own language,
 * so everyone can always find theirs.
 * @param {module:storage~Meta} meta
 * @returns {string}
 */
function languageHtml(meta) {
  const cur = meta.lang || 'auto';
  const opts = [
    ['auto', t('opt.langAuto')],
    ['en', 'English'],
    ['fr', 'Français'],
  ];
  return `<section class="opt">
    <h2 class="eyebrow" id="langLbl">${esc(t('opt.language'))}</h2>
    <div class="seg" role="radiogroup" aria-labelledby="langLbl">${opts.map(([k, l]) => `<button type="button" role="radio" data-lang="${k}" aria-checked="${k === cur}" lang="${k === 'auto' ? lang() : k}"><span>${esc(l)}</span></button>`).join('')}</div>
  </section>`;
}

/**
 * Wires the Language section. The whole interface is reloaded in the new
 * language (palettes and keyboards included).
 */
function bindLanguage() {
  app.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = /** @type {HTMLElement} */ (b).dataset.lang;
      if (v === (getMeta().lang || 'auto')) return;
      setMeta({ lang: v });
      location.reload();
    }),
  );
}

/**
 * HTML of the Display section.
 * @param {module:storage~Meta} meta
 * @returns {string}
 */
function displayHtml(meta) {
  const current = meta.listView || 'cards';
  return `<section class="opt">
    <h2 class="eyebrow" id="viewLbl">${esc(t('opt.display'))}</h2>
    <div class="seg" role="radiogroup" aria-labelledby="viewLbl">${LIST_VIEWS.map((v) => `<button type="button" role="radio" data-view="${v.key}" aria-checked="${v.key === current}">${VIEW_ICONS[v.key]}<span>${esc(t('listView.' + v.key))}</span></button>`).join('')}</div>
    <div class="opt-group opt-gap">
      <label class="opt-row" for="optFold"><span>${esc(t('opt.autoFold'))}<small>${esc(t('opt.autoFoldHint', { min: FOLD_MIN_LINES, n: FOLD_PREVIEW_LINES }))}</small></span><input type="checkbox" class="switch" id="optFold"${meta.autoFold ? ' checked' : ''}></label>
    </div>
  </section>`;
}

/**
 * HTML of the Notebook section (backup, import).
 * @param {module:storage~Meta} meta
 * @returns {string}
 */
function notebookHtml(meta) {
  return `<section class="opt">
    <h2 class="eyebrow">${esc(t('opt.notebook'))}</h2>
    <div class="opt-group">
      <button class="opt-row" id="optExport" type="button"><span>${esc(t('opt.export'))}<small>${esc(t('opt.exportHint'))}</small></span>${CHEVRON}</button>
      <label class="opt-row" for="optImport"><span>${esc(t('opt.import'))}<small>${esc(t('opt.importHint'))}</small></span>${CHEVRON}</label>
      <input type="file" id="optImport" hidden>
      <p class="opt-note${backupDue() ? ' due' : ''}" id="optLast">${esc(lastExportLabel(meta.lastExport))}</p>
    </div>
    <div class="status" id="optMsg" role="status"></div>
  </section>`;
}

/**
 * HTML of the iReal Pro section.
 * @returns {string}
 */
function irealHtml() {
  return `<section class="opt">
    <h2 class="eyebrow">iReal Pro</h2>
    <div class="opt-group opt-pad">
      <label class="ir-lbl" for="optIr">${esc(t('opt.irealPaste1'))} <code>irealb://</code> ${esc(t('opt.irealPaste2'))}</label>
      <textarea id="optIr" rows="2" placeholder="irealb://…" spellcheck="false"></textarea>
      <div class="ir-actions"><button class="btn primary" id="optIrGo" type="button">${esc(t('opt.irealImport'))}</button><label class="btn" for="optIrFile">${esc(t('opt.irealFile'))}</label><input type="file" id="optIrFile" accept=".html,.htm,.txt,text/html,text/plain" hidden></div>
    </div>
    <div class="status" id="optIrMsg" role="status"></div>
  </section>`;
}

/**
 * HTML of the About section.
 * @returns {string}
 */
function aboutHtml() {
  return `<section class="opt">
    <h2 class="eyebrow">${esc(t('opt.about'))}</h2>
    <div class="opt-group">
      <div class="opt-row static"><span>Inkline<small>${esc(t('opt.version', { v: APP_VERSION, store: storageBackend() === 'idb' ? 'IndexedDB' : 'localStorage' }))}</small></span></div>
      <a class="opt-row" href="${CHANGELOG_URL}" target="_blank" rel="noopener"><span>${esc(t('opt.whatsNew'))}<small>${esc(t('opt.whatsNewHint'))}</small></span>${CHEVRON}</a>
      <a class="opt-row" href="docs/" target="_blank" rel="noopener"><span>${esc(t('opt.docs'))}<small>${esc(t('opt.docsHint'))}</small></span>${CHEVRON}</a>
    </div>
  </section>`;
}

/** Wires the Display section. */
function bindDisplay() {
  // Display picker: stored in the metadata, applied when returning home.
  app.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => {
      setMeta({ listView: b.dataset.view });
      app.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    };
  });
  const fold = /** @type {HTMLInputElement} */ (app.querySelector('#optFold'));
  fold.onchange = () => setMeta({ autoFold: fold.checked || undefined });
}

/** Wires the Folders section. */
function bindFolders() {
  const reopen = () => renderScreen({ keepScroll: true });
  app.querySelectorAll('[data-folder]').forEach((b) => {
    b.addEventListener('click', () =>
      openFolderSheet(state.folders[/** @type {HTMLElement} */ (b).dataset.folder], reopen),
    );
  });
  app.querySelector('#optNewFolder').addEventListener('click', () => openFolderSheet(null, reopen));
}

/**
 * Imports a file chosen in Settings: a received note is opened directly; a
 * backup is merged, with a report.
 * @param {string} text
 */
function importChosenFile(text) {
  const msg = app.querySelector('#optMsg');
  try {
    const nf = Object.keys(state.folders).length;
    const r = importFile(state.notes, text, state.folders);
    flushSave(state.notes);
    saveFolders(state.folders);
    if (r.kind === 'note') {
      openNote(r.firstId);
      return;
    }
    const added = Object.keys(state.folders).length - nf;
    renderScreen({ keepScroll: true }); // the Folders section may have changed
    app.querySelector('#optMsg').textContent =
      t('opt.imported', { n: r.count }) + (added ? t('opt.foldersAdded', { n: added }) : '.');
  } catch (err) {
    msg.textContent = t('opt.badFile');
  }
}

/** Wires the Notebook section. */
function bindNotebook() {
  app.querySelector('#optExport').onclick = () => {
    download(
      new Blob([backupJson(state.notes, state.folders)], { type: 'application/json' }),
      t('opt.backupFile') + '-' + new Date().toISOString().slice(0, 10) + '.json',
    );
    setMeta({ lastExport: Date.now() });
    const last = app.querySelector('#optLast');
    last.textContent = lastExportLabel(Date.now());
    last.classList.remove('due');
    app.querySelector('#optMsg').textContent = t('note.downloaded');
  };
  // No "accept" filter: Android greys out extensions it does not know
  // (.inkline). The content is checked by importFile.
  app.querySelector('#optImport').onchange = (e) => readFile(e, importChosenFile);
}

/** Wires the iReal Pro section. */
function bindIReal() {
  const field = /** @type {HTMLTextAreaElement} */ (app.querySelector('#optIr'));
  const irGo = (txt) => {
    const k = importIRealNotes(txt);
    app.querySelector('#optIrMsg').textContent = k ? t('opt.irealDone', { n: k }) : t('opt.irealNone');
    if (k) field.value = '';
  };
  app.querySelector('#optIrGo').onclick = () => irGo(field.value);
  app.querySelector('#optIrFile').onchange = (e) => readFile(e, irGo);
}

/**
 * Draws the Settings screen: one function per section for the HTML, one per
 * section for wiring the events.
 */
function renderOptions() {
  const meta = getMeta();
  app.innerHTML = `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; ${esc(t('note.back'))}</button><div class="grow"></div><h1 class="top-title">${esc(t('home.options'))}</h1></header>
  ${languageHtml(meta)}
  ${displayHtml(meta)}
  <section class="opt">
    <h2 class="eyebrow">${esc(t('home.folders'))}</h2>
    <div class="opt-group" id="optFolders">${foldersHtml()}</div>
  </section>
  ${notebookHtml(meta)}
  ${irealHtml()}
  ${aboutHtml()}`;
  app.querySelector('#back').onclick = backToList;
  bindLanguage();
  bindDisplay();
  bindFolders();
  bindNotebook();
  bindIReal();
}

registerScreen('options', renderOptions);
