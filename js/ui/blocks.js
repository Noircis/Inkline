/**
 * @module ui/blocks
 * @description
 * **Active block** and registry of musical block types.
 *
 * Only one block is "active" at a time ({@link module:ui/blocks.setActive|setActive}):
 * it is framed, shows its tools (up/down/delete) and opens the palette of
 * its type.
 *
 * ## Registry
 *
 * Staff and chart blocks register at load time
 * ({@link module:ui/blocks.registerBlockKind|registerBlockKind}) with three
 * functions: build the element, redraw it, show/hide the palette. The note
 * screen and this module call them by block type, without importing
 * `ui/staff` or `grid-ui`: no circular import.
 */

import { state, app, curNote, blockById, touch } from './state.js';
import { popSnapshot } from '../history.js';
import { syncPaletteSpace } from './common.js';
import { renderScreen } from './nav.js';

/**
 * A musical block type.
 * @typedef {Object} BlockKind
 * @property {function(module:model~Note, module:model~Block, HTMLDivElement)} build Fills the block's element.
 * @property {function(string)} redraw Redraws the block with the given id (no effect if it is not this type).
 * @property {function(boolean)} showPalette Shows or hides the type's palette.
 */

/** @type {Object.<string, BlockKind>} */
const kinds = {};

/**
 * Registers a block type.
 * @param {'staff'|'grid'} type
 * @param {BlockKind} kind
 */
export function registerBlockKind(type, kind) {
  kinds[type] = kind;
}

/**
 * Registered block type.
 * @param {string} type
 * @returns {BlockKind|undefined}
 */
export function blockKind(type) {
  return kinds[type];
}

/**
 * Redraws a musical block (staff or chart) by its id.
 * @param {string} id
 */
export function redrawBlock(id) {
  Object.values(kinds).forEach((k) => k.redraw(id));
}

/** Hides every palette. */
export function hideAllPalettes() {
  Object.values(kinds).forEach((k) => k.showPalette(false));
  syncPaletteSpace();
}

/**
 * Changes the active block (or none with `null`). Resets the selection and
 * redraws the old and new blocks (cursor, highlight).
 * @param {string|null} id
 */
export function setActive(id) {
  if (state.activeId === id) return;
  const prev = state.activeId;
  state.activeId = id;
  state.sel = null;
  state.cursor = null; // a block being opened is continued at the end
  if (prev) redrawBlock(prev);
  if (id) redrawBlock(id);
  updateActive();
}

/**
 * Applies the "active" state to the DOM: block frame and open palette.
 */
export function updateActive() {
  app
    .querySelectorAll('.block')
    .forEach((el) => el.classList.toggle('active', el.dataset.block === state.activeId));
  const b = blockById(state.activeId);
  // Hide first, then show: the visible palette sets the reserved space.
  Object.keys(kinds).forEach((t) => {
    if (!b || b.type !== t) kinds[t].showPalette(false);
  });
  if (b && kinds[b.type]) kinds[b.type].showPalette(true);
  syncPaletteSpace();
}

/**
 * Undoes the last change to the note shown.
 */
export function undo() {
  const n = curNote();
  if (!n) return;
  // The collapsed display is not part of the undo history: it is
  // stored before restoring the snapshot, then applied again.
  const folds = new Map(n.blocks.map((b) => [b.id, b.fold]));
  if (!popSnapshot(n)) return;
  n.blocks.forEach((b) => {
    if (!folds.has(b.id)) return; // block brought back by undo: it keeps its state
    const f = folds.get(b.id);
    if (f) b.fold = f;
    else delete b.fold;
  });
  state.sel = null;
  if (state.activeId && !n.blocks.some((b) => b.id === state.activeId)) state.activeId = null;
  touch(n);
  renderScreen({ keepScroll: true });
}
