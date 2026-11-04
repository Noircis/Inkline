/**
 * @module ui/home
 * @description
 * **Accueil** : recherche, barre de dossiers, tri et liste des notes.
 *
 * ```
 * ┌ Inkline ─────────────── ⚙  + Note ┐
 * │ 🔍 Rechercher…                     │
 * │ [Toutes 12] [● Jazz 5] [● Cours 4] [Non classées 3] [+] │  ← défile horizontalement
 * │ Jazz · 5 notes   Modifier   [Tri ▾]│
 * │ ┌ carte ┐ ┌ carte ┐ …              │
 * ```
 *
 * ## Règles
 *
 * - La **sélection** de la barre (`Toutes`, un dossier, `Non classées`) est
 *   mémorisée ({@link module:storage~Meta|meta.folder}), comme le **tri**,
 *   mémorisé pour chaque sélection (`meta.sorts`).
 * - Toucher de nouveau le dossier sélectionné ouvre son éditeur.
 * - Une **recherche** non vide porte sur **toutes** les notes, quel que soit
 *   le dossier sélectionné : on cherche une note dont on a oublié le
 *   rangement. Les résultats indiquent alors le dossier de chaque note.
 * - Une note créée depuis un dossier est rangée dans ce dossier.
 * - Taper dans la recherche ne redessine que la liste (le champ garde le
 *   focus et le clavier reste ouvert).
 */

import { state, app, touch } from './state.js';
import { esc } from '../util.js';
import { newNote as makeNote, exampleNote } from '../model.js';
import { ALL, UNFILED, sortedFolders, inSelection, countByFolder } from '../folders.js';
import { SORT_MODES, matchNote, sortNotes } from '../search.js';
import { getMeta, setMeta } from '../storage.js';
import { staffSvg } from '../render-staff.js';
import * as audio from '../audio.js';
import { registerScreen, openNote, go } from './nav.js';
import { hideAllPalettes } from './blocks.js';
import { backupDue } from './options.js';
import { renderNoteList } from './list-view.js';
import { GEAR, LOUPE } from './icons.js';
import { openFolderSheet } from './folder-sheet.js';

/** « 1 note », « 3 notes ». */
const plural = (k, word) => `${k} ${word}${k > 1 ? 's' : ''}`;

/**
 * Sélection courante de la barre de dossiers. Un dossier supprimé entre-temps
 * ramène sur « Toutes ».
 * @returns {string}
 */
export function currentSelection() {
  const f = getMeta().folder;
  if (f === UNFILED || (f && state.folders[f])) return f;
  return ALL;
}

/**
 * Tri mémorisé pour une sélection.
 * @param {string} selection
 * @returns {string}
 */
function sortFor(selection) {
  const s = getMeta().sorts;
  return (s && s[selection]) || 'updated';
}

/** Change la sélection de la barre et redessine l'accueil. */
function select(selection) {
  setMeta({ folder: selection });
  renderHome();
}

/**
 * Crée une note (dans le dossier sélectionné, s'il y en a un) et l'ouvre.
 */
function newNote() {
  const n = makeNote();
  const sel = currentSelection();
  if (sel !== ALL && sel !== UNFILED) n.folder = sel;
  state.notes[n.id] = n;
  touch(n);
  openNote(n.id, true);
}

/**
 * HTML de la barre de dossiers.
 * @param {string} sel Sélection courante.
 * @returns {string}
 */
function chipsHtml(sel) {
  const notes = Object.values(state.notes);
  const counts = countByFolder(notes, state.folders);
  const folders = sortedFolders(state.folders);
  const chip = (key, label, count, dot = '') =>
    `<button type="button" class="chip" data-sel="${esc(key)}" aria-pressed="${key === sel}">${dot}<span class="chip-name">${label}</span><span class="chip-n">${count}</span></button>`;
  let html = chip(ALL, 'Toutes', counts[ALL]);
  folders.forEach((f) => {
    html += chip(
      f.id,
      esc(f.name),
      counts[f.id],
      `<span class="fdot fc-${f.color}" aria-hidden="true"></span>`,
    );
  });
  if (folders.length || sel === UNFILED) html += chip(UNFILED, 'Non classées', counts[UNFILED]);
  html += `<button type="button" class="chip chip-add" id="addFolder" aria-label="Nouveau dossier">+${folders.length ? '' : ' Dossier'}</button>`;
  return html;
}

/**
 * Écran d'accueil.
 * @returns {void}
 */
function renderHome() {
  audio.stop();
  state.activeId = null;
  state.sel = null;
  hideAllPalettes();
  const due = backupDue();
  app.innerHTML = `<header class="top"><div class="grow"><h1 class="brand">Inkline</h1></div><button class="btn icon-btn" id="optBtn" type="button" aria-label="${due ? 'Options (sauvegarde conseillée)' : 'Options'}">${GEAR}${due ? '<span class="dot" aria-hidden="true"></span>' : ''}</button><button class="btn primary" id="newNote" type="button">+ Note</button></header>
  <div id="homeBody"></div>`;
  app.querySelector('#optBtn').onclick = () => go('options');
  app.querySelector('#newNote').onclick = newNote;
  const body = app.querySelector('#homeBody');

  if (!Object.keys(state.notes).length && !Object.keys(state.folders).length) {
    renderOnboarding(body);
    return;
  }

  const sel = currentSelection();
  body.innerHTML = `<div class="search"><span class="search-ico">${LOUPE}</span><input type="search" id="q" placeholder="Rechercher titres, textes, accords" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Rechercher"><button type="button" class="search-clear" id="qClear" aria-label="Effacer la recherche" hidden>&times;</button></div>
  <nav class="chips" id="chips" aria-label="Dossiers">${chipsHtml(sel)}</nav>
  <div class="listbar"><span class="listbar-lbl" id="listLbl"></span><button type="button" class="btn ghost small" id="editFolder" hidden>Modifier</button><div class="grow"></div><label class="sort"><span class="sr">Trier</span><select id="sortSel">${SORT_MODES.map((m) => `<option value="${m.key}">${esc(m.label)}</option>`).join('')}</select></label></div>
  <div id="listBody"></div>`;

  const q = /** @type {HTMLInputElement} */ (body.querySelector('#q'));
  const clear = /** @type {HTMLButtonElement} */ (body.querySelector('#qClear'));
  q.value = state.query;
  q.addEventListener('input', () => {
    state.query = q.value;
    refreshResults();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') q.blur(); // ferme le clavier, les résultats sont déjà là
  });
  clear.onclick = () => {
    state.query = '';
    q.value = '';
    refreshResults();
    q.focus();
  };

  body.querySelectorAll('[data-sel]').forEach((c) => {
    c.addEventListener('click', () => {
      const key = /** @type {HTMLElement} */ (c).dataset.sel;
      if (key === sel && state.folders[key]) editFolder(key);
      else select(key);
    });
  });
  body
    .querySelector('#addFolder')
    .addEventListener('click', () => openFolderSheet(null, (f) => (f ? select(f.id) : renderHome())));
  body.querySelector('#editFolder').addEventListener('click', () => editFolder(sel));

  const sortSel = /** @type {HTMLSelectElement} */ (body.querySelector('#sortSel'));
  sortSel.value = sortFor(sel);
  sortSel.onchange = () => {
    setMeta({ sorts: { ...getMeta().sorts, [sel]: sortSel.value } });
    refreshResults();
  };

  // Barre de dossiers : amener le dossier sélectionné à l'écran.
  const bar = /** @type {HTMLElement} */ (body.querySelector('#chips'));
  const on = /** @type {HTMLElement} */ (bar.querySelector('[aria-pressed="true"]'));
  if (on && on.offsetLeft + on.offsetWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - 16;

  refreshResults();
}

registerScreen('list', renderHome);

/**
 * Ouvre l'éditeur d'un dossier depuis l'accueil.
 * @param {string} id
 */
function editFolder(id) {
  openFolderSheet(state.folders[id], () => renderHome());
}

/**
 * Recalcule et redessine la liste (recherche, sélection, tri), sans toucher
 * au reste de l'accueil.
 */
function refreshResults() {
  const sel = currentSelection();
  const query = state.query.trim();
  const searching = !!query;
  const all = Object.values(state.notes);
  const notes = sortNotes(
    all.filter((n) => (searching ? matchNote(n, query) : inSelection(n, sel, state.folders))),
    sortFor(sel),
  );

  const folder = state.folders[sel];
  const lbl = app.querySelector('#listLbl');
  lbl.textContent = searching
    ? `${plural(notes.length, 'résultat')} dans toutes les notes`
    : sel === ALL
      ? plural(notes.length, 'note')
      : `${folder ? folder.name : 'Non classées'} · ${plural(notes.length, 'note')}`;
  /** @type {HTMLElement} */ (app.querySelector('#editFolder')).hidden = searching || !folder;
  /** @type {HTMLElement} */ (app.querySelector('#qClear')).hidden = !state.query;
  app.querySelector('#chips').classList.toggle('dim', searching);

  const body = /** @type {HTMLElement} */ (app.querySelector('#listBody'));
  body.innerHTML = '';
  if (!notes.length) {
    body.innerHTML = emptyHtml(searching, sel, query);
    const b = body.querySelector('#emptyNew');
    if (b) b.addEventListener('click', newNote);
    return;
  }
  renderNoteList(body, notes, getMeta().listView || 'cards', openNote, {
    folders: state.folders,
    showFolder: searching || sel === ALL,
  });
}

/**
 * Message affiché quand la liste est vide.
 * @param {boolean} searching
 * @param {string} sel
 * @param {string} query
 * @returns {string}
 */
function emptyHtml(searching, sel, query) {
  if (searching)
    return `<div class="empty-mini"><p>Aucune note ne contient « ${esc(query)} ».</p><p class="hint">La recherche porte sur les titres, les textes et les accords.</p></div>`;
  if (sel === UNFILED)
    return '<div class="empty-mini"><p>Toutes tes notes sont rangées dans des dossiers.</p></div>';
  return `<div class="empty-mini"><p>${sel === ALL ? 'Aucune note pour l’instant.' : 'Ce dossier est vide.'}</p><button class="btn primary" id="emptyNew" type="button">${sel === ALL ? 'Nouvelle note' : 'Nouvelle note ici'}</button></div>`;
}

/**
 * Premier lancement : on montre ce que fait l'app avec une vraie portée d'exemple.
 * @param {Element} body
 */
function renderOnboarding(body) {
  const ex = exampleNote();
  body.innerHTML = `<div class="empty"><div class="eyebrow">Aperçu</div><h2>Notez une idée en trois touchers</h2><p>Écrivez du texte, insérez une portée, une ligne rythmique ou une grille d'accords, puis touchez la portée pour poser les notes. Liaisons, triolets, accords chiffrés et lecture audio inclus.</p><div class="thumb" id="emptyThumb"></div><div class="actions"><button class="btn primary" id="newNote2" type="button">Nouvelle note</button><button class="btn" id="tryEx" type="button">Ouvrir l'exemple</button></div></div>`;
  requestAnimationFrame(() => {
    const el = body.querySelector('#emptyThumb');
    if (el) el.innerHTML = staffSvg(ex.blocks[1], el.clientWidth || 320).svg;
  });
  body.querySelector('#newNote2').addEventListener('click', newNote);
  body.querySelector('#tryEx').addEventListener('click', () => {
    const n = exampleNote();
    state.notes[n.id] = n;
    touch(n);
    openNote(n.id);
  });
}
