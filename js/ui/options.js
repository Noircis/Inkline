/**
 * @module ui/options
 * @description
 * Écran **Options**, ouvert par la roue crantée de l'accueil.
 *
 * Il regroupe ce qui concerne le carnet entier, pour garder l'accueil
 * dédié aux notes :
 *
 * - **Affichage** : Cartes, Mosaïque ou Liste pour l'accueil ;
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
  if (!ts) return 'Aucune sauvegarde pour l’instant';
  const days = Math.floor((Date.now() - ts) / DAY);
  if (days <= 0) return 'Dernière sauvegarde : aujourd’hui';
  if (days === 1) return 'Dernière sauvegarde : hier';
  return `Dernière sauvegarde : il y a ${days} jours`;
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
        `<button class="opt-row" type="button" data-folder="${esc(f.id)}"><span class="opt-folder"><span class="fdot fc-${f.color}" aria-hidden="true"></span><span>${esc(f.name)}<small>${counts[f.id]} note${counts[f.id] > 1 ? 's' : ''}</small></span></span>${CHEVRON}</button>`,
    )
    .join('');
  return `${rows}<button class="opt-row" id="optNewFolder" type="button"><span>+ Nouveau dossier<small>${rows ? 'Supprimer un dossier ne supprime pas ses notes' : 'Range tes notes par cours, projet, répertoire…'}</small></span>${CHEVRON}</button>`;
}

/**
 * Dessine l'écran Options.
 */
function renderOptions() {
  const meta = getMeta();
  const current = meta.listView || 'cards';
  app.innerHTML = `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; Notes</button><div class="grow"></div><h1 class="top-title">Options</h1></header>
  <section class="opt">
    <h2 class="eyebrow" id="viewLbl">Affichage des notes</h2>
    <div class="seg" role="radiogroup" aria-labelledby="viewLbl">${LIST_VIEWS.map((v) => `<button type="button" role="radio" data-view="${v.key}" aria-checked="${v.key === current}">${VIEW_ICONS[v.key]}<span>${v.label}</span></button>`).join('')}</div>
  </section>
  <section class="opt">
    <h2 class="eyebrow">Dossiers</h2>
    <div class="opt-group" id="optFolders">${foldersHtml()}</div>
  </section>
  <section class="opt">
    <h2 class="eyebrow">Carnet</h2>
    <div class="opt-group">
      <button class="opt-row" id="optExport" type="button"><span>Exporter le carnet<small>Sauvegarde des notes et des dossiers (.json)</small></span>${CHEVRON}</button>
      <label class="opt-row" for="optImport"><span>Importer un fichier<small>Sauvegarde ou note reçue (.inkline)</small></span>${CHEVRON}</label>
      <input type="file" id="optImport" hidden>
      <p class="opt-note${backupDue() ? ' due' : ''}" id="optLast">${esc(lastExportLabel(meta.lastExport))}</p>
    </div>
    <div class="status" id="optMsg" role="status"></div>
  </section>
  <section class="opt">
    <h2 class="eyebrow">iReal Pro</h2>
    <div class="opt-group opt-pad">
      <label class="ir-lbl" for="optIr">Colle un lien <code>irealb://</code> (morceau ou playlist) : une note est créée par morceau.</label>
      <textarea id="optIr" rows="2" placeholder="irealb://…" spellcheck="false"></textarea>
      <div class="ir-actions"><button class="btn primary" id="optIrGo" type="button">Importer</button><label class="btn" for="optIrFile">Ouvrir un fichier iReal</label><input type="file" id="optIrFile" accept=".html,.htm,.txt,text/html,text/plain" hidden></div>
    </div>
    <div class="status" id="optIrMsg" role="status"></div>
  </section>
  <section class="opt">
    <h2 class="eyebrow">À propos</h2>
    <div class="opt-group">
      <div class="opt-row static"><span>Inkline<small>Version ${esc(APP_VERSION)} · stockage ${storageBackend() === 'idb' ? 'IndexedDB' : 'localStorage'}</small></span></div>
      <a class="opt-row" href="${CHANGELOG_URL}" target="_blank" rel="noopener"><span>Nouveautés<small>Historique des versions</small></span>${CHEVRON}</a>
      <a class="opt-row" href="docs/" target="_blank" rel="noopener"><span>Documentation du code<small>Générée avec JSDoc</small></span>${CHEVRON}</a>
    </div>
  </section>`;

  app.querySelector('#back').onclick = backToList;
  // Sélecteur d'affichage : mémorisé dans les métadonnées, appliqué au retour sur l'accueil.
  app.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => {
      setMeta({ listView: b.dataset.view });
      app.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    };
  });
  app.querySelectorAll('[data-folder]').forEach((b) => {
    b.addEventListener('click', () =>
      openFolderSheet(state.folders[/** @type {HTMLElement} */ (b).dataset.folder], () =>
        renderScreen({ keepScroll: true }),
      ),
    );
  });
  app
    .querySelector('#optNewFolder')
    .addEventListener('click', () => openFolderSheet(null, () => renderScreen({ keepScroll: true })));
  const msg = app.querySelector('#optMsg');

  app.querySelector('#optExport').onclick = () => {
    download(
      new Blob([backupJson(state.notes, state.folders)], { type: 'application/json' }),
      'inkline-carnet-' + new Date().toISOString().slice(0, 10) + '.json',
    );
    setMeta({ lastExport: Date.now() });
    const last = app.querySelector('#optLast');
    last.textContent = lastExportLabel(Date.now());
    last.classList.remove('due');
    msg.textContent = 'Fichier enregistré dans tes téléchargements.';
  };

  // Pas de filtre « accept » : Android grise les extensions qu'il ne connaît
  // pas (.inkline). Le contenu est vérifié par importFile.
  app.querySelector('#optImport').onchange = (e) =>
    readFile(e, (text) => {
      try {
        const nf = Object.keys(state.folders).length;
        const r = importFile(state.notes, text, state.folders);
        flushSave(state.notes);
        saveFolders(state.folders);
        if (r.kind === 'note') {
          openNote(r.firstId);
          return;
        } // note reçue : on l'ouvre directement
        const added = Object.keys(state.folders).length - nf;
        renderScreen({ keepScroll: true }); // la section Dossiers a pu changer
        app.querySelector('#optMsg').textContent =
          r.count +
          (r.count > 1 ? ' notes importées' : ' note importée') +
          (added ? `, ${added} dossier${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}.` : '.');
      } catch (err) {
        msg.textContent = "Ce fichier n'est ni une note Inkline ni une sauvegarde.";
      }
    });

  const irMsg = app.querySelector('#optIrMsg');
  const irGo = (txt) => {
    const k = importIRealNotes(txt);
    irMsg.textContent = k
      ? k +
        (k > 1
          ? ' morceaux importés : ils sont dans tes notes.'
          : ' morceau importé : il est dans tes notes.')
      : 'Aucun morceau iReal trouvé. Le lien doit commencer par irealb://.';
    if (k) /** @type {HTMLTextAreaElement} */ (app.querySelector('#optIr')).value = '';
  };
  app.querySelector('#optIrGo').onclick = () =>
    irGo(/** @type {HTMLTextAreaElement} */ (app.querySelector('#optIr')).value);
  app.querySelector('#optIrFile').onchange = (e) => readFile(e, irGo);
}

registerScreen('options', renderOptions);
