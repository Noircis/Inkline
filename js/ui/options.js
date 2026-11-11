/**
 * @module ui/options
 * @description
 * Écran **Options**, ouvert par la roue crantée de l'accueil.
 *
 * Il regroupe ce qui concerne le carnet entier, pour garder l'accueil
 * dédié aux notes :
 *
 * - **Affichage** : Cartes, Mosaïque ou Liste pour l'accueil ; réduction
 *   automatique des blocs longs ;
 * - **Dossiers** : liste des dossiers (toucher pour modifier), création ;
 * - **Carnet** : exporter une sauvegarde complète (notes et dossiers), importer un fichier
 *   (sauvegarde ou note reçue `.inkline`), date de la dernière sauvegarde ;
 * - **iReal Pro** : importer un lien, une playlist ou un fichier `.html` ;
 * - **À propos** : version, nouveautés, documentation du code.
 *
 * ## Rappel de sauvegarde
 *
 * Les notes ne vivent que sur le téléphone. Au-delà de
 * {@link module:ui/options~BACKUP_REMINDER_DAYS|BACKUP_REMINDER_DAYS} jours
 * sans export, un point apparaît sur la roue crantée
 * ({@link module:ui/options.backupDue|backupDue}) : c'est un rappel visible,
 * mais jamais bloquant.
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

/** Nombre de jours sans sauvegarde avant d'afficher le rappel. */
const BACKUP_REMINDER_DAYS = 30;

const DAY = 24 * 3600 * 1000;

/** Adresse du journal des modifications sur GitHub. */
const CHANGELOG_URL = 'https://github.com/Noircis/Inkline/blob/main/CHANGELOG.md';

/**
 * Faut-il rappeler de sauvegarder ? Oui s'il y a des notes et que la
 * dernière sauvegarde (ou, à défaut, la première utilisation) date de plus de
 * {@link BACKUP_REMINDER_DAYS} jours.
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
 * Formule lisible de la date de dernière sauvegarde.
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
 * Crée une note par morceau iReal trouvé dans `text`.
 * @param {string} text Lien(s) `irealb://` ou fichier `.html` iReal.
 * @returns {number} Nombre de morceaux importés.
 */
function importIRealNotes(text) {
  const songs = parseIRealAll(text);
  songs.forEach((s, k) => {
    // Le compositeur iReal est au format « Nom Prénom » : on le remet dans l'ordre usuel.
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

/** Pictogrammes des trois affichages (SVG en ligne, colorés par currentColor). */
const VIEW_ICONS = {
  cards:
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="3" y="3" width="16" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="12" width="16" height="7" rx="1.5" fill="currentColor"/></svg>',
  mosaic:
    '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="12" y="3" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="3" y="12" width="7" height="7" rx="1.5" fill="currentColor"/><rect x="12" y="12" width="7" height="7" rx="1.5" fill="currentColor"/></svg>',
  list: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="3" y="4" width="16" height="2.4" rx="1.2" fill="currentColor"/><rect x="3" y="9.8" width="16" height="2.4" rx="1.2" fill="currentColor"/><rect x="3" y="15.6" width="16" height="2.4" rx="1.2" fill="currentColor"/></svg>',
};

/** Chevron des lignes cliquables. */
const CHEVRON = '<span class="opt-chev" aria-hidden="true">&#8250;</span>';

/**
 * HTML de la section Dossiers.
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
 * HTML de la section Langue (2.9) : automatique (langue du téléphone ou du
 * navigateur), anglais ou français. Les libellés des langues restent dans
 * leur propre langue, pour qu'on retrouve toujours la sienne.
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
 * Branche la section Langue. Toute l'interface est rechargée dans la
 * nouvelle langue (palettes et claviers compris).
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
 * HTML de la section Affichage.
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
 * HTML de la section Carnet (sauvegarde, import).
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
 * HTML de la section iReal Pro.
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
 * HTML de la section À propos.
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

/** Branche la section Affichage. */
function bindDisplay() {
  // Sélecteur d'affichage : mémorisé dans les métadonnées, appliqué au retour sur l'accueil.
  app.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => {
      setMeta({ listView: b.dataset.view });
      app.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    };
  });
  const fold = /** @type {HTMLInputElement} */ (app.querySelector('#optFold'));
  fold.onchange = () => setMeta({ autoFold: fold.checked || undefined });
}

/** Branche la section Dossiers. */
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
 * Importe un fichier choisi dans les Options : une note reçue est ouverte
 * directement ; une sauvegarde est fusionnée, avec un compte rendu.
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
    renderScreen({ keepScroll: true }); // la section Dossiers a pu changer
    app.querySelector('#optMsg').textContent =
      t('opt.imported', { n: r.count }) + (added ? t('opt.foldersAdded', { n: added }) : '.');
  } catch (err) {
    msg.textContent = t('opt.badFile');
  }
}

/** Branche la section Carnet. */
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
  // Pas de filtre « accept » : Android grise les extensions qu'il ne connaît
  // pas (.inkline). Le contenu est vérifié par importFile.
  app.querySelector('#optImport').onchange = (e) => readFile(e, importChosenFile);
}

/** Branche la section iReal Pro. */
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
 * Dessine l'écran Options : une fonction par section pour le HTML, une par
 * section pour le branchement des événements.
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
