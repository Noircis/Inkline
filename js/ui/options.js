/**
 * @module ui/options
 * @description
 * Écran **Options**, ouvert par la roue crantée de l'accueil.
 *
 * Il regroupe ce qui concerne le carnet entier, pour garder l'accueil
 * dédié aux notes :
 *
 * - **Carnet** : exporter une sauvegarde complète, importer un fichier
 *   (sauvegarde ou note reçue `.inkline`), date de la dernière sauvegarde ;
 * - **iReal Pro** : importer un lien, une playlist ou un fichier `.html` ;
 * - **À propos** : version, nouveautés, documentation du code.
 *
 * ## Rappel de sauvegarde
 *
 * Les notes ne vivent que sur le téléphone. Au-delà de
 * {@link module:ui/options.BACKUP_REMINDER_DAYS|BACKUP_REMINDER_DAYS} jours
 * sans export, un point apparaît sur la roue crantée
 * ({@link module:ui/options.backupDue|backupDue}) : c'est un rappel visible,
 * mais jamais bloquant.
 */

import { state, app } from './state.js';
import { esc, uid } from '../util.js';
import { flushSave, backupJson, importFile, getMeta, setMeta } from '../storage.js';
import { sanitizeBlock } from '../sanitize.js';
import { parseIRealAll, songToGrid } from '../ireal.js';
import { download } from '../export.js';
import { APP_VERSION, readFile, openNote, backToList, enterSubView } from './views.js';

/** Nombre de jours sans sauvegarde avant d'afficher le rappel. */
export const BACKUP_REMINDER_DAYS = 30;

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
    const n = { id: uid(), title: s.title.slice(0, 200), updated: Date.now() + k, blocks: [{ id: uid(), type: 'text', text: composer.slice(0, 200) }, sanitizeBlock(songToGrid(s))] };
    state.notes[n.id] = n;
  });
  if (songs.length) flushSave(state.notes);
  return songs.length;
}

/** Chevron des lignes cliquables. */
const CHEVRON = '<span class="opt-chev" aria-hidden="true">&#8250;</span>';

/**
 * Ouvre l'écran Options (et l'ajoute à l'historique, pour le bouton retour d'Android).
 */
export function openOptions() {
  enterSubView();
  state.view = { name: 'options', id: null };
  renderOptions();
  window.scrollTo(0, 0);
}

/**
 * Dessine l'écran Options.
 */
export function renderOptions() {
  const meta = getMeta();
  app.innerHTML = `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; Notes</button><div class="grow"></div><h1 class="top-title">Options</h1></header>
  <section class="opt">
    <h2 class="eyebrow">Carnet</h2>
    <div class="opt-group">
      <button class="opt-row" id="optExport" type="button"><span>Exporter le carnet<small>Sauvegarde de toutes les notes (.json)</small></span>${CHEVRON}</button>
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
      <div class="opt-row static"><span>Inkline<small>Version ${esc(APP_VERSION)}</small></span></div>
      <a class="opt-row" href="${CHANGELOG_URL}" target="_blank" rel="noopener"><span>Nouveautés<small>Historique des versions</small></span>${CHEVRON}</a>
      <a class="opt-row" href="docs/" target="_blank" rel="noopener"><span>Documentation du code<small>Générée avec JSDoc</small></span>${CHEVRON}</a>
    </div>
  </section>`;

  app.querySelector('#back').onclick = backToList;
  const msg = app.querySelector('#optMsg');

  app.querySelector('#optExport').onclick = () => {
    download(new Blob([backupJson(state.notes)], { type: 'application/json' }), 'inkline-carnet-' + new Date().toISOString().slice(0, 10) + '.json');
    setMeta({ lastExport: Date.now() });
    const last = app.querySelector('#optLast');
    last.textContent = lastExportLabel(Date.now());
    last.classList.remove('due');
    msg.textContent = 'Fichier enregistré dans tes téléchargements.';
  };

  // Pas de filtre « accept » : Android grise les extensions qu'il ne connaît
  // pas (.inkline). Le contenu est vérifié par importFile.
  app.querySelector('#optImport').onchange = (e) => readFile(e, (text) => {
    try {
      const r = importFile(state.notes, text);
      flushSave(state.notes);
      if (r.kind === 'note') { openNote(r.firstId); return; } // note reçue : on l'ouvre directement
      msg.textContent = r.count + (r.count > 1 ? ' notes importées.' : ' note importée.');
    } catch (err) {
      msg.textContent = "Ce fichier n'est ni une note Inkline ni une sauvegarde.";
    }
  });

  const irMsg = app.querySelector('#optIrMsg');
  const irGo = (txt) => {
    const k = importIRealNotes(txt);
    irMsg.textContent = k
      ? k + (k > 1 ? ' morceaux importés : ils sont dans tes notes.' : ' morceau importé : il est dans tes notes.')
      : 'Aucun morceau iReal trouvé. Le lien doit commencer par irealb://.';
    if (k) /** @type {HTMLTextAreaElement} */ (app.querySelector('#optIr')).value = '';
  };
  app.querySelector('#optIrGo').onclick = () => irGo(/** @type {HTMLTextAreaElement} */ (app.querySelector('#optIr')).value);
  app.querySelector('#optIrFile').onchange = (e) => readFile(e, irGo);
}
