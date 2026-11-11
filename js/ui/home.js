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

import { t } from '../i18n.js';
import { state, app, touch } from './state.js';
import { esc } from '../util.js';
import { newNote as makeNote, exampleNote } from '../model.js';
import {
  ALL,
  UNFILED,
  ALL_CATS,
  NO_CAT,
  sortedFolders,
  inSelection,
  countByFolder,
  inCategory,
  countByCategory,
  groupByCategory,
  fileNote,
} from '../folders.js';
import { SORT_MODES, matchNote, sortNotes } from '../search.js';
import { getMeta, setMeta } from '../storage.js';
import { staffSvg } from '../render-staff.js';
import * as audio from '../audio.js';
import { registerScreen, openNote, go } from './nav.js';
import { hideAllPalettes } from './blocks.js';
import { backupDue } from './options.js';
import { renderNoteList } from './list-view.js';
import { GEAR, LOUPE, METRONOME } from './icons.js';
import { openFolderSheet, openCategoriesSheet } from './folder-sheet.js';

/**
 * Sélection courante de la barre de dossiers. Un dossier supprimé entre-temps
 * ramène sur « Toutes ».
 * @returns {string}
 */
function currentSelection() {
  const f = getMeta().folder;
  if (f === UNFILED || (f && state.folders[f])) return f;
  return ALL;
}

/**
 * Catégorie choisie dans un dossier (2.8.6) : {@link module:folders.ALL_CATS|ALL_CATS},
 * {@link module:folders.NO_CAT|NO_CAT} ou un id de catégorie existante.
 * @param {?module:folders~Folder} folder
 * @returns {string}
 */
function currentCategory(folder) {
  if (!folder || !folder.cats || !folder.cats.length) return ALL_CATS;
  const c = (getMeta().catSel || {})[folder.id];
  if (c === NO_CAT || (c && folder.cats.some((x) => x.id === c))) return c;
  return ALL_CATS;
}

/**
 * HTML de la barre de catégories d'un dossier (2e rangée de puces).
 * @param {module:folders~Folder} folder
 * @param {string} cat Catégorie choisie.
 * @returns {string}
 */
function catChipsHtml(folder, cat) {
  const cats = folder.cats || [];
  const add = `<button type="button" class="chip chip-add" id="addCat" aria-label="${esc(t('home.catsOfFolder'))}">+${cats.length ? '' : ' ' + esc(t('home.category'))}</button>`;
  if (!cats.length) return add;
  const counts = countByCategory(
    Object.values(state.notes).filter((n) => inSelection(n, folder.id, state.folders)),
    folder,
  );
  const chip = (key, label) =>
    `<button type="button" class="chip" data-cat="${esc(key)}" aria-pressed="${key === cat}"><span class="chip-name">${label}</span><span class="chip-n">${counts[key] || 0}</span></button>`;
  let html = chip(ALL_CATS, esc(t('home.allCats')));
  cats.forEach((c) => (html += chip(c.id, esc(c.name))));
  if (counts[NO_CAT]) html += chip(NO_CAT, esc(t('home.noCat')));
  return html + add;
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
  if (sel !== ALL && sel !== UNFILED) {
    const cat = currentCategory(state.folders[sel]);
    fileNote(n, sel, cat !== ALL_CATS && cat !== NO_CAT ? [cat] : []);
  }
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
  let html = chip(ALL, esc(t('home.all')), counts[ALL]);
  folders.forEach((f) => {
    html += chip(
      f.id,
      esc(f.name),
      counts[f.id],
      `<span class="fdot fc-${f.color}" aria-hidden="true"></span>`,
    );
  });
  if (folders.length || sel === UNFILED) html += chip(UNFILED, esc(t('home.unfiled')), counts[UNFILED]);
  html += `<button type="button" class="chip chip-add" id="addFolder" aria-label="${esc(t('home.newFolder'))}">+${folders.length ? '' : ' ' + esc(t('home.folder'))}</button>`;
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
  app.innerHTML = `<header class="top"><div class="grow"><h1 class="brand">Inkline</h1></div><button class="btn icon-btn" id="trainBtn" type="button" aria-label="${esc(t('home.training'))}">${METRONOME}</button><button class="btn icon-btn" id="optBtn" type="button" aria-label="${esc(due ? t('home.optionsBackup') : t('home.options'))}">${GEAR}${due ? '<span class="dot" aria-hidden="true"></span>' : ''}</button><button class="btn primary" id="newNote" type="button">${esc(t('home.newNoteBtn'))}</button></header>
  <div id="homeBody"></div>`;
  app.querySelector('#optBtn').onclick = () => go('options');
  app.querySelector('#trainBtn').onclick = () => go('training');
  app.querySelector('#newNote').onclick = newNote;
  const body = app.querySelector('#homeBody');

  if (!Object.keys(state.notes).length && !Object.keys(state.folders).length) {
    renderOnboarding(body);
    return;
  }

  const sel = currentSelection();
  body.innerHTML = `<div class="search"><span class="search-ico">${LOUPE}</span><input type="search" id="q" placeholder="${esc(t('home.searchPlaceholder'))}" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="${esc(t('home.search'))}"><button type="button" class="search-clear" id="qClear" aria-label="${esc(t('home.clearSearch'))}" hidden>&times;</button></div>
  <nav class="chips" id="chips" aria-label="${esc(t('home.folders'))}">${chipsHtml(sel)}</nav>
  ${state.folders[sel] ? `<nav class="chips cat-chips" id="catChips" aria-label="${esc(t('home.categories'))}">${catChipsHtml(state.folders[sel], currentCategory(state.folders[sel]))}</nav>` : ''}
  <div class="listbar"><span class="listbar-lbl" id="listLbl"></span><button type="button" class="btn ghost small" id="editFolder" hidden>${esc(t('common.edit'))}</button><div class="grow"></div><label class="sort"><span class="sr">${esc(t('home.sort'))}</span><select id="sortSel">${SORT_MODES.map((m) => `<option value="${m.key}">${esc(t('sort.' + m.key))}</option>`).join('')}</select></label></div>
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
  bindCatChips(sel);

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
 * Branche la barre de catégories : toucher une catégorie la choisit ;
 * toucher celle déjà choisie (ou « + ») ouvre le panneau des catégories.
 * @param {string} sel Dossier choisi.
 */
function bindCatChips(sel) {
  const folder = state.folders[sel];
  const bar = app.querySelector('#catChips');
  if (!folder || !bar) return;
  const manage = (focusNew) => openCategoriesSheet(folder, () => renderHome(), { focusNew });
  bar.querySelectorAll('[data-cat]').forEach((c) =>
    c.addEventListener('click', () => {
      const key = /** @type {HTMLElement} */ (c).dataset.cat;
      if (key === currentCategory(folder)) return manage(false);
      setMeta({ catSel: { ...getMeta().catSel, [folder.id]: key } });
      renderHome();
    }),
  );
  bar.querySelector('#addCat').addEventListener('click', () => manage(true));
}

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
  const folder = state.folders[sel];
  const cat = currentCategory(folder);
  const notes = sortNotes(
    all.filter((n) =>
      searching
        ? matchNote(n, query)
        : inSelection(n, sel, state.folders) && inCategory(n, cat, state.folders),
    ),
    sortFor(sel),
  );

  const catName =
    cat === NO_CAT ? t('home.noCat') : cat !== ALL_CATS ? folder.cats.find((c) => c.id === cat).name : '';
  const lbl = app.querySelector('#listLbl');
  lbl.textContent = searching
    ? t('home.results', { n: notes.length })
    : sel === ALL
      ? t('home.noteCount', { n: notes.length })
      : `${folder ? folder.name : t('home.unfiled')}${catName ? ' › ' + catName : ''} · ${t('home.noteCount', { n: notes.length })}`;
  /** @type {HTMLElement} */ (app.querySelector('#editFolder')).hidden = searching || !folder;
  /** @type {HTMLElement} */ (app.querySelector('#qClear')).hidden = !state.query;
  app.querySelector('#chips').classList.toggle('dim', searching);
  app.querySelector('#catChips')?.classList.toggle('dim', searching);

  const body = /** @type {HTMLElement} */ (app.querySelector('#listBody'));
  body.innerHTML = '';
  if (!notes.length) {
    body.innerHTML = emptyHtml(searching, sel, query);
    const b = body.querySelector('#emptyNew');
    if (b) b.addEventListener('click', newNote);
    return;
  }
  const listOpt = { folders: state.folders, showFolder: searching || sel === ALL };
  // Dossier à catégories, sur « Tout » : une section repliable par catégorie (2.8.6).
  if (!searching && folder && folder.cats && folder.cats.length && cat === ALL_CATS) {
    renderSections(body, notes, folder, listOpt);
    return;
  }
  renderNoteList(body, notes, getMeta().listView || 'cards', openNote, listOpt);
}

/**
 * Liste d'un dossier en sections, une par catégorie (puis « Sans
 * catégorie »). Une note de plusieurs catégories apparaît dans chacune.
 * L'état replié de chaque section est mémorisé.
 * @param {HTMLElement} body
 * @param {module:model~Note[]} notes Notes du dossier, triées.
 * @param {module:folders~Folder} folder
 * @param {Object} listOpt Options de {@link module:ui/list-view.renderNoteList|renderNoteList}.
 */
function renderSections(body, notes, folder, listOpt) {
  const mode = getMeta().listView || 'cards';
  groupByCategory(notes, folder).forEach(({ cat, notes: list }) => {
    const key = `${folder.id}:${cat ? cat.id : NO_CAT}`;
    const folded = !!(getMeta().catFold || {})[key];
    const sec = document.createElement('section');
    sec.className = 'cat-sec';
    sec.innerHTML = `<button type="button" class="cat-head" aria-expanded="${!folded}"><span class="drill-chev" aria-hidden="true"></span><span class="cat-title">${esc(cat ? cat.name : t('home.noCat'))}</span><span class="cat-count">${list.length}</span></button><div class="cat-body"${folded ? ' hidden' : ''}></div>`;
    body.appendChild(sec);
    const inner = /** @type {HTMLElement} */ (sec.querySelector('.cat-body'));
    let drawn = false;
    const draw = () => {
      if (drawn) return;
      drawn = true;
      renderNoteList(inner, list, mode, openNote, listOpt);
    };
    if (!folded) draw();
    sec.querySelector('.cat-head').addEventListener('click', (e) => {
      const head = /** @type {HTMLElement} */ (e.currentTarget);
      const open = inner.hidden;
      inner.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
      const fold = { ...getMeta().catFold };
      if (open) delete fold[key];
      else fold[key] = true;
      setMeta({ catFold: fold });
      if (open) draw();
    });
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
    return `<div class="empty-mini"><p>${esc(t('home.noResult', { q: query }))}</p><p class="hint">${esc(t('home.searchHint'))}</p></div>`;
  if (sel === UNFILED) return `<div class="empty-mini"><p>${esc(t('home.allFiled'))}</p></div>`;
  return `<div class="empty-mini"><p>${esc(sel === ALL ? t('home.emptyAll') : t('home.emptyFolder'))}</p><button class="btn primary" id="emptyNew" type="button">${esc(sel === ALL ? t('home.newNote') : t('home.newNoteHere'))}</button></div>`;
}

/**
 * Premier lancement : on montre ce que fait l'app avec une vraie portée d'exemple.
 * @param {Element} body
 */
function renderOnboarding(body) {
  const ex = exampleNote();
  body.innerHTML = `<div class="empty"><div class="eyebrow">${esc(t('onboard.eyebrow'))}</div><h2>${esc(t('onboard.title'))}</h2><p>${esc(t('onboard.text'))}</p><div class="thumb" id="emptyThumb"></div><div class="actions"><button class="btn primary" id="newNote2" type="button">${esc(t('home.newNote'))}</button><button class="btn" id="tryEx" type="button">${esc(t('onboard.example'))}</button></div></div>`;
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
