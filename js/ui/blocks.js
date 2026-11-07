/**
 * @module ui/blocks
 * @description
 * **Bloc actif** et registre des types de blocs musicaux.
 *
 * Un seul bloc est « actif » à la fois ({@link module:ui/blocks.setActive|setActive}) :
 * il est encadré, affiche ses outils (monter/descendre/supprimer) et ouvre la
 * palette de son type.
 *
 * ## Registre
 *
 * Les blocs portée et grille s'enregistrent au chargement
 * ({@link module:ui/blocks.registerBlockKind|registerBlockKind}) avec trois
 * fonctions : construire l'élément, le redessiner, montrer/cacher la palette.
 * L'écran note et ce module les appellent par le type du bloc, sans importer
 * `staff-ui` ni `grid-ui` : pas d'import circulaire.
 */

import { state, app, curNote, blockById, touch } from './state.js';
import { popSnapshot } from '../history.js';
import { syncPaletteSpace } from './common.js';
import { renderScreen } from './nav.js';

/**
 * Un type de bloc musical.
 * @typedef {Object} BlockKind
 * @property {function(module:model~Note, module:model~Block, HTMLDivElement)} build Remplit l'élément du bloc.
 * @property {function(string)} redraw Redessine le bloc d'id donné (sans effet si ce n'est pas ce type).
 * @property {function(boolean)} showPalette Montre ou cache la palette du type.
 */

/** @type {Object.<string, BlockKind>} */
const kinds = {};

/**
 * Enregistre un type de bloc.
 * @param {'staff'|'grid'} type
 * @param {BlockKind} kind
 */
export function registerBlockKind(type, kind) {
  kinds[type] = kind;
}

/**
 * Type de bloc enregistré.
 * @param {string} type
 * @returns {BlockKind|undefined}
 */
export function blockKind(type) {
  return kinds[type];
}

/**
 * Redessine un bloc musical (portée ou grille) par son id.
 * @param {string} id
 */
export function redrawBlock(id) {
  Object.values(kinds).forEach((k) => k.redraw(id));
}

/** Cache toutes les palettes. */
export function hideAllPalettes() {
  Object.values(kinds).forEach((k) => k.showPalette(false));
  syncPaletteSpace();
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
  state.cursor = null; // un bloc qu'on ouvre se complète par la fin
  if (prev) redrawBlock(prev);
  if (id) redrawBlock(id);
  updateActive();
}

/**
 * Applique l'état « actif » au DOM : cadre du bloc et palette ouverte.
 */
export function updateActive() {
  app
    .querySelectorAll('.block')
    .forEach((el) => el.classList.toggle('active', el.dataset.block === state.activeId));
  const b = blockById(state.activeId);
  // Cacher d'abord, montrer ensuite : la palette visible fixe l'espace réservé.
  Object.keys(kinds).forEach((t) => {
    if (!b || b.type !== t) kinds[t].showPalette(false);
  });
  if (b && kinds[b.type]) kinds[b.type].showPalette(true);
  syncPaletteSpace();
}

/**
 * Annule la dernière modification de la note affichée.
 */
export function undo() {
  const n = curNote();
  if (!n) return;
  // L'affichage réduit ne fait pas partie de l'historique d'annulation : on
  // le mémorise avant de restaurer l'instantané, puis on le réapplique.
  const folds = new Map(n.blocks.map((b) => [b.id, b.fold]));
  if (!popSnapshot(n)) return;
  n.blocks.forEach((b) => {
    if (!folds.has(b.id)) return; // bloc revenu par l'annulation : il garde son état
    const f = folds.get(b.id);
    if (f) b.fold = f;
    else delete b.fold;
  });
  state.sel = null;
  if (state.activeId && !n.blocks.some((b) => b.id === state.activeId)) state.activeId = null;
  touch(n);
  renderScreen({ keepScroll: true });
}
