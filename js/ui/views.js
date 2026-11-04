/**
 * @module ui/views
 * @description
 * Les deux écrans de l'app et la gestion des blocs :
 *
 * - **liste** des notes ({@link module:ui/views.renderList|renderList}), avec la roue
 *   crantée qui ouvre {@link module:ui/options|les options} ;
 * - **note** ({@link module:ui/views.renderNote|renderNote}) : titre, blocs, barre d'ajout.
 *
 * Le rendu est fait par template strings et `innerHTML`, puis les
 * gestionnaires d'événements sont branchés sur les éléments créés. Les blocs
 * portée et grille délèguent leur contenu à {@link module:ui/staff-ui|ui/staff-ui} et
 * {@link module:ui/grid-ui|ui/grid-ui}.
 *
 * ## Bloc actif
 *
 * Un seul bloc est « actif » à la fois ({@link module:ui/views.setActive|setActive}) :
 * il est encadré, affiche ses outils (monter/descendre/supprimer), et ouvre
 * la palette correspondant à son type.
 */

import { state, app, curNote, blockById, touch } from './state.js';
import { esc } from '../util.js';
import { newNote as makeNote, newTextBlock, newStaffBlock, newGridBlock, exampleNote } from '../model.js';
import { flushSave, getMeta } from '../storage.js';
import { noteToInkline, noteToPng, noteToPdf, shareOrDownload, slug } from '../export.js';
import { pushSnapshot, popSnapshot } from '../history.js';
import * as audio from '../audio.js';
import { staffSvg } from '../render-staff.js';
import { staffBlockEl, redrawStaff, showStaffPalette } from './staff-ui.js';
import { gridBlockEl, redrawGrid, showGridPalette } from './grid-ui.js';
import { openOptions, renderOptions, backupDue } from './options.js';
import { renderNoteList } from './list-view.js';

/** Version affichée en bas de l'accueil (à garder alignée sur CHANGELOG.md). */
export const APP_VERSION = '1.7.0';

/**
 * Affiche l'écran courant.
 */
export function render() {
  if (state.view.name === 'note' && curNote()) renderNote();
  else if (state.view.name === 'options') renderOptions();
  else { state.view = { name: 'list', id: null }; renderList(); }
}

// ---------- Navigation et bouton retour d'Android ----------
// La liste est l'écran racine ; note et options sont des « sous-écrans ».
// En entrant dans un sous-écran, on ajoute UNE entrée à l'historique du
// navigateur (history.pushState). Le bouton retour d'Android déclenche alors
// un événement popstate (écouté dans main.js) qui ramène à la liste, au lieu
// de fermer l'app. Passer d'un sous-écran à un autre remplace l'entrée
// (replaceState) : l'historique ne fait jamais plus d'un niveau.

/**
 * À appeler en entrant dans un sous-écran (note, options).
 */
export function enterSubView() {
  if (history.state && history.state.inkline) history.replaceState({ inkline: 1 }, '');
  else history.pushState({ inkline: 1 }, '');
}

/**
 * Affiche la liste (sans toucher à l'historique).
 */
export function showList() {
  state.view = { name: 'list', id: null };
  renderList();
  window.scrollTo(0, 0);
}

/**
 * Retour à la liste depuis un sous-écran : on recule dans l'historique si
 * on y a ajouté une entrée (le popstate affichera la liste), sinon on
 * affiche directement la liste.
 */
export function backToList() {
  if (history.state && history.state.inkline) history.back();
  else showList();
}

/** Icône de roue crantée (SVG : le caractère ⚙ s'afficherait en emoji coloré sur Android). */
const GEAR = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M19.84 10.41 L22.42 10.74 L22.42 13.26 L19.84 13.59 L18.67 16.42 L20.26 18.48 L18.48 20.26 L16.42 18.67 L13.59 19.84 L13.26 22.42 L10.74 22.42 L10.41 19.84 L7.58 18.67 L5.52 20.26 L3.74 18.48 L5.33 16.42 L4.16 13.59 L1.58 13.26 L1.58 10.74 L4.16 10.41 L5.33 7.58 L3.74 5.52 L5.52 3.74 L7.58 5.33 L10.41 4.16 L10.74 1.58 L13.26 1.58 L13.59 4.16 L16.42 5.33 L18.48 3.74 L20.26 5.52 L18.67 7.58 Z M15.4 12 A3.4 3.4 0 1 0 8.6 12 A3.4 3.4 0 1 0 15.4 12 Z"/></svg>';

/**
 * Écran liste : notes triées par date de modification, dans l'affichage
 * choisi dans les Options ({@link module:ui/list-view|ui/list-view}).
 * La roue crantée ouvre {@link module:ui/options|les options}.
 */
export function renderList() {
  audio.stop();
  state.activeId = null;
  state.sel = null;
  showStaffPalette(false);
  showGridPalette(false);
  const list = Object.values(state.notes).sort((a, b) => b.updated - a.updated);
  const due = backupDue();
  app.innerHTML = `<header class="top"><div class="grow"><h1 class="brand">Inkline</h1></div><button class="btn icon-btn" id="optBtn" type="button" aria-label="${due ? 'Options (sauvegarde conseillée)' : 'Options'}">${GEAR}${due ? '<span class="dot" aria-hidden="true"></span>' : ''}</button><button class="btn primary" id="newNote" type="button">+ Note</button></header>
  <div id="listBody"></div>`;
  const body = app.querySelector('#listBody');

  if (!list.length) {
    // État vide : on montre ce que fait l'app avec une vraie portée d'exemple.
    const ex = exampleNote();
    body.innerHTML = `<div class="empty"><div class="eyebrow">Aperçu</div><h2>Notez une idée en trois touchers</h2><p>Écrivez du texte, insérez une portée, une ligne rythmique ou une grille d'accords, puis touchez la portée pour poser les notes. Liaisons, triolets, accords chiffrés et lecture audio inclus.</p><div class="thumb" id="emptyThumb"></div><div class="actions"><button class="btn primary" id="newNote2" type="button">Nouvelle note</button><button class="btn" id="tryEx" type="button">Ouvrir l'exemple</button></div></div>`;
    requestAnimationFrame(() => { const el = body.querySelector('#emptyThumb'); if (el) el.innerHTML = staffSvg(ex.blocks[1], el.clientWidth || 320).svg; });
    body.querySelector('#newNote2').onclick = newNote;
    body.querySelector('#tryEx').onclick = () => { const n = exampleNote(); state.notes[n.id] = n; touch(n); openNote(n.id); };
  } else {
    renderNoteList(body, list, getMeta().listView || 'cards', openNote);
  }
  app.querySelector('#optBtn').onclick = openOptions;
  app.querySelector('#newNote').onclick = newNote;
}

/**
 * Lit le fichier choisi dans un `<input type=file>` et passe son texte à `fn`.
 * @param {Event} e
 * @param {function(string)} fn
 */
export function readFile(e, fn) {
  const f = /** @type {HTMLInputElement} */ (e.target).files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => fn(String(r.result));
  r.readAsText(f);
}

/** Crée une note et l'ouvre, curseur dans le titre. */
export function newNote() {
  const n = makeNote();
  state.notes[n.id] = n;
  touch(n);
  openNote(n.id, true);
}

/**
 * Ouvre une note.
 * @param {string} id
 * @param {boolean} [focusTitle] Placer le curseur dans le titre.
 */
export function openNote(id, focusTitle) {
  enterSubView();
  state.view = { name: 'note', id };
  state.activeId = null;
  state.sel = null;
  renderNote();
  window.scrollTo(0, 0);
  if (focusTitle) { const t = app.querySelector('.title-in'); if (t) t.focus(); }
}

/**
 * Ajuste la hauteur d'un `<textarea>` à son contenu (pas d'ascenseur interne).
 * @param {HTMLTextAreaElement} t
 */
export function autosize(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

/** HTML des outils d'un bloc actif. */
export function toolsHtml() {
  return '<div class="tools"><button type="button" data-tool="up" aria-label="Monter">&#8593;</button><button type="button" data-tool="down" aria-label="Descendre">&#8595;</button><button type="button" data-tool="del">Supprimer</button></div>';
}

/**
 * Écran note : titre, blocs, barre d'ajout, suppression.
 * @param {boolean} [keepScroll] Conserver la position de défilement (re-rendu après une modification).
 */
export function renderNote(keepScroll) {
  const n = curNote();
  if (!n) { showList(); return; }
  const sy = window.scrollY;
  app.innerHTML = `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; Notes</button><div class="grow"></div><button class="btn" id="shareBtn" type="button" aria-expanded="false">Partager</button></header>
  <div class="sharebox" id="shareBox" hidden>
    <button class="btn primary" type="button" data-share="inkline">Fichier Inkline<small>modifiable dans Inkline</small></button>
    <button class="btn" type="button" data-share="png">Image<small>PNG</small></button>
    <button class="btn" type="button" data-share="pdf">PDF<small>A4</small></button>
    <div class="status" id="shareMsg"></div>
  </div>
  <textarea class="title-in" id="titleIn" rows="1" placeholder="Titre de la note"></textarea>
  <div class="blocks" id="blocks"></div>
  <div class="addbar"><button class="btn" data-add="text" type="button">+ Texte</button><button class="btn" data-add="staff" type="button">+ Portée</button><button class="btn" data-add="rhythm" type="button">+ Rythme</button><button class="btn" data-add="grid" type="button">+ Grille</button></div>
  <div class="notefoot"><button class="btn ghost danger" id="delNote" type="button">Supprimer la note</button></div>`;

  const ti = /** @type {HTMLTextAreaElement} */ (app.querySelector('#titleIn'));
  ti.value = n.title;
  autosize(ti);
  ti.addEventListener('focus', () => { pushSnapshot(n); setActive(null); });
  ti.addEventListener('input', () => { n.title = ti.value.replace(/\n/g, ' '); autosize(ti); touch(n); });
  ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ti.blur(); } });
  app.querySelector('#back').onclick = backToList;
  bindShare(n);

  // Suppression en deux temps (les boîtes confirm() natives sont peu pratiques sur mobile).
  const dn = /** @type {HTMLButtonElement} */ (app.querySelector('#delNote'));
  dn.onclick = () => {
    if (dn.dataset.armed) { delete state.notes[n.id]; flushSave(state.notes); backToList(); return; }
    dn.dataset.armed = '1';
    dn.textContent = 'Toucher encore pour supprimer';
    dn.classList.add('confirm');
    setTimeout(() => { if (dn.isConnected) { delete dn.dataset.armed; dn.textContent = 'Supprimer la note'; dn.classList.remove('confirm'); } }, 3500);
  };
  app.querySelectorAll('[data-add]').forEach((btn) => { btn.onclick = () => addBlock(n, btn.dataset.add); });

  const bl = app.querySelector('#blocks');
  n.blocks.forEach((b, bi) => bl.appendChild(blockEl(n, b, bi)));
  // Les SVG ont besoin de la largeur réelle : on les dessine après le layout.
  requestAnimationFrame(() => {
    n.blocks.forEach((b) => { redrawStaff(b.id); redrawGrid(b.id); });
    app.querySelectorAll('.block textarea').forEach(autosize);
  });
  updateActive();
  if (keepScroll) window.scrollTo(0, sy);
}

/**
 * Branche le panneau « Partager » d'une note.
 *
 * Le fichier est généré au clic, puis {@link module:export.shareOrDownload|shareOrDownload}
 * ouvre le menu de partage d'Android ou télécharge le fichier. L'appel à
 * `navigator.share` doit suivre de près le geste de l'utilisateur (quelques
 * secondes) : la génération d'image est assez rapide pour ça.
 *
 * @param {module:model~Note} n
 */
function bindShare(n) {
  const btn = app.querySelector('#shareBtn');
  const box = /** @type {HTMLElement} */ (app.querySelector('#shareBox'));
  const msg = app.querySelector('#shareMsg');
  btn.onclick = () => {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    msg.textContent = '';
    if (!box.hidden) setActive(null);
  };
  box.querySelectorAll('[data-share]').forEach((b) => {
    b.onclick = async () => {
      const kind = b.dataset.share;
      const name = slug(n.title);
      const title = n.title || 'Note Inkline';
      msg.textContent = kind === 'inkline' ? '' : 'Préparation…';
      box.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      try {
        let res;
        if (kind === 'inkline') {
          // .inkline d'abord ; si Android refuse ce type, variante .txt (même contenu).
          res = await shareOrDownload(noteToInkline(n), [
            { name: name + '.inkline', type: 'application/json' },
            { name: name + '.inkline.txt', type: 'text/plain' },
          ], title);
        } else if (kind === 'png') {
          res = await shareOrDownload(await noteToPng(n), [{ name: name + '.png', type: 'image/png' }], title);
        } else {
          res = await shareOrDownload(await noteToPdf(n), [{ name: name + '.pdf', type: 'application/pdf' }], title);
        }
        msg.textContent = res === 'downloaded' ? 'Fichier enregistré dans tes téléchargements.' : res === 'shared' ? 'Envoyé.' : '';
      } catch (e) {
        msg.textContent = "L'export a échoué. Réessaie ; si ça persiste, exporte le fichier Inkline.";
      } finally {
        box.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      }
    };
  });
}

/**
 * Ajoute un bloc en fin de note et l'active.
 * @param {module:model~Note} n
 * @param {'text'|'staff'|'rhythm'|'grid'} kind
 */
export function addBlock(n, kind) {
  pushSnapshot(n);
  const b = kind === 'grid' ? newGridBlock() : kind === 'text' ? newTextBlock() : newStaffBlock(kind === 'rhythm');
  n.blocks.push(b);
  touch(n);
  state.activeId = b.id;
  state.sel = kind === 'grid' ? 0 : null; // une grille s'ouvre sur sa 1re mesure
  renderNote(true);
  const el = app.querySelector(`[data-block="${CSS.escape(b.id)}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (kind === 'text') { const t = el.querySelector('textarea'); if (t) t.focus(); }
  }
}

/**
 * Crée l'élément DOM d'un bloc et branche ses outils.
 * @param {module:model~Note} n
 * @param {module:model~Block} b
 * @param {number} bi Position du bloc dans la note.
 * @returns {HTMLDivElement}
 */
function blockEl(n, b, bi) {
  const el = document.createElement('div');
  el.className = 'block ' + (b.type === 'text' ? 'text' : b.type === 'grid' ? 'gridblk' : 'staff');
  el.dataset.block = b.id;
  if (b.type === 'text') {
    el.innerHTML = `<textarea rows="1" placeholder="${bi === 0 ? 'Écrivez ici…' : 'Texte'}" id="t_${esc(b.id)}"></textarea>` + toolsHtml();
    const t = el.querySelector('textarea');
    t.value = b.text;
    t.addEventListener('focus', () => { pushSnapshot(n); setActive(b.id); });
    t.addEventListener('input', () => { b.text = t.value; autosize(t); touch(n); });
  } else if (b.type === 'grid') {
    gridBlockEl(n, b, el);
  } else {
    staffBlockEl(n, b, el);
  }

  el.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.onclick = () => {
      const i = n.blocks.indexOf(b);
      const tool = btn.dataset.tool;
      if (tool === 'del') {
        if (!btn.dataset.armed) {
          btn.dataset.armed = '1'; btn.textContent = 'Confirmer'; btn.classList.add('confirm');
          setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Supprimer'; btn.classList.remove('confirm'); } }, 3000);
          return;
        }
        pushSnapshot(n);
        if (audio.isPlaying(b.id)) audio.stop();
        n.blocks.splice(i, 1);
        state.activeId = null; state.sel = null;
        touch(n);
        renderNote(true);
        return;
      }
      const j = tool === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= n.blocks.length) return;
      pushSnapshot(n);
      n.blocks.splice(i, 1);
      n.blocks.splice(j, 0, b);
      touch(n);
      renderNote(true);
      const nel = app.querySelector(`[data-block="${CSS.escape(b.id)}"]`);
      if (nel) nel.scrollIntoView({ block: 'nearest' });
    };
  });
  return el;
}

/**
 * Change le bloc actif (ou aucun avec `null`). Remet la sélection à zéro et
 * redessine l'ancien et le nouveau bloc (curseur, surlignage).
 * @param {string|null} id
 */
export function setActive(id) {
  if (state.activeId === id) return;
  const prev = state.activeId;
  state.activeId = id;
  state.sel = null;
  if (prev) { redrawStaff(prev); redrawGrid(prev); }
  if (id) { redrawStaff(id); redrawGrid(id); }
  updateActive();
}

/**
 * Applique l'état « actif » au DOM : cadre du bloc et palette ouverte.
 */
export function updateActive() {
  app.querySelectorAll('.block').forEach((el) => el.classList.toggle('active', el.dataset.block === state.activeId));
  const b = blockById(state.activeId);
  // Cacher d'abord, montrer ensuite : la palette visible fixe l'espace réservé.
  showStaffPalette(!!b && b.type === 'staff');
  showGridPalette(!!b && b.type === 'grid');
  syncPaletteSpace();
}

/**
 * Réserve en bas de page la hauteur de la palette ouverte (variable CSS
 * `--pal-h`), pour que le contenu ne passe pas dessous.
 */
export function syncPaletteSpace() {
  const pal = document.getElementById('palette');
  const gpal = document.getElementById('gpal');
  const h = !pal.hidden ? pal.offsetHeight : !gpal.hidden ? gpal.offsetHeight : 0;
  document.documentElement.style.setProperty('--pal-h', h + 'px');
}

/**
 * Annule la dernière modification de la note affichée.
 */
export function undo() {
  const n = curNote();
  if (!n || !popSnapshot(n)) return;
  state.sel = null;
  if (state.activeId && !n.blocks.some((b) => b.id === state.activeId)) state.activeId = null;
  touch(n);
  renderNote(true);
}

/**
 * Met à jour le bouton Écouter/Stop d'un bloc.
 * @param {string} id
 */
export function updatePlayBtn(id) {
  const btn = document.querySelector(`[data-play="${CSS.escape(id)}"]`);
  if (!btn) return;
  const on = audio.isPlaying(id);
  btn.classList.toggle('on', on);
  btn.innerHTML = on ? '&#9632; Stop' : '&#9654; Écouter';
}

/**
 * Rappels de lecture communs aux portées et aux grilles : surlignage de
 * l'élément joué, puis remise à zéro à la fin.
 * @param {string} id Bloc joué.
 * @param {function(string)} redraw Fonction de redessin du bloc.
 * @returns {module:audio~PlayCallbacks}
 */
export function playCallbacks(id, redraw) {
  return {
    onStep: (i) => { state.playIdx = i; redraw(id); },
    onEnd: () => { state.playIdx = null; redraw(id); updatePlayBtn(id); },
  };
}
