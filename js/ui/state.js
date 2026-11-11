/**
 * @module ui/state
 * @description
 * **Interface state**, shared by every `ui/*` module.
 *
 * The app follows an *immediate mode* model: there is no reactive framework.
 * A module changes `state` (or a note), then explicitly asks for a re-render
 * of what changed (`renderNote`, `redrawStaff`, `redrawGrid`).
 *
 * All state variables are gathered here rather than scattered as globals:
 * that way we know what exists and who changes it.
 */

import { scheduleSave } from '../storage.js';

/**
 * Input settings of the staff palette, used for the **next** note added
 * (when no note is selected).
 *
 * @typedef {Object} InputSettings
 * @property {module:model~DurationCode} d Duration.
 * @property {boolean} dot Dotted.
 * @property {boolean} rest Rest mode (persistent).
 * @property {?number} acc Accidental (consumed by the next note).
 * @property {boolean} rs The next note opens a repeat (consumed).
 * @property {boolean} tie The next note is tied to the previous one (consumed).
 * @property {boolean} tup Triplet mode (persistent).
 */

/**
 * @typedef {Object} UiState
 * @property {Object.<string, module:model~Note>} notes The notebook.
 * @property {Object.<string, module:folders~Folder>} folders The folders.
 * @property {{name: 'list'|'note'|'options', id: string|null}} view Screen shown.
 * @property {string} query Current search on the home screen (not remembered).
 * @property {string|null} activeId Block being edited (a palette is open).
 * @property {number|null} sel Selection in the active block: staff item index
 *   **or** chart measure index, depending on the block type. Only one block
 *   is active at a time, so there is no ambiguity; `setActive` resets `sel`
 *   to `null` on every block change.
 * @property {'write'|'edit'} mode Staff mode (2.5): Write (the palette sets
 *   the next note, inserted at the cursor) or Edit (the palette changes the
 *   selected note).
 * @property {number|null} cursor Write mode: index of the item before which
 *   the next note will be inserted; `null` = at the end of the staff.
 * @property {number|null} playIdx Item or measure being played.
 * @property {InputSettings} input
 */

/** @type {UiState} */
export const state = {
  notes: {},
  folders: {},
  query: '',
  view: { name: 'list', id: null },
  activeId: null,
  sel: null,
  mode: 'write',
  cursor: null,
  playIdx: null,
  input: { d: 'q', dot: false, rest: false, acc: null, rs: false, tie: false, tup: false },
};

/**
 * Note shown, or `undefined` on the list.
 * @returns {module:model~Note|undefined}
 */
export function curNote() {
  return state.view.id ? state.notes[state.view.id] : undefined;
}

/**
 * Block of the note shown, by id.
 * @param {string|null} id
 * @returns {module:model~Block|null}
 */
export function blockById(id) {
  const n = curNote();
  return (n && id && n.blocks.find((b) => b.id === id)) || null;
}

/**
 * Marks a note as changed and schedules the save.
 * @param {module:model~Note} n
 */
export function touch(n) {
  n.updated = Date.now();
  scheduleSave(state.notes, n.id);
}

/**
 * Saves a **filing** change (folder, pin): unlike
 * {@link module:ui/state.touch|touch}, the modification date does not
 * change. Filing a note is not editing it: it must not jump to the top of
 * the "Recently modified" sort.
 * @param {module:model~Note} n
 */
export function saveArrangement(n) {
  scheduleSave(state.notes, n.id);
}

/** Root element where views are rendered. */
export const app = /** @type {HTMLElement} */ (document.getElementById('app'));
