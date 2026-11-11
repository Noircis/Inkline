/**
 * @module ui/staff/shared
 * @description
 * **Common base** of the staff block modules: staff-specific state (chord
 * being typed, one-off message) and shared operations (fitting into
 * measures, insertion position, target note, changing the selection).
 *
 * ## Split of the staff block
 *
 * ```
 * staff/index     registers the block type with ui/blocks
 *  ├─ view        block header and staff drawing
 *  │   └─ input   taps on the staff, Write / Edit modes
 *  └─ palette     bottom-of-screen palette
 *      ├─ bars    barline submenu
 *      └─ chord   chord symbol input
 * all ──▶ shared (this module)
 * ```
 *
 * ## Hooks
 *
 * Almost everything must be able to **redraw the staff** and **refresh the
 * palette**, but those two functions live in `view` and `palette`, which
 * themselves import this module. To avoid a circular import, they are
 * registered in {@link module:ui/staff/shared.hooks|hooks} when their module
 * loads, and called through it: dependency inversion, the equivalent of a
 * function pointer set at initialization in C++.
 */

import { state, curNote, blockById, touch } from '../state.js';
import { qlen } from '../../model.js';
import { normalizeStaff, chainStart, chainEnd, singleValue } from '../../measure-fit.js';
import { pushSnapshot } from '../../history.js';

/**
 * Functions provided by other modules of the staff block: `redraw` (by
 * `view`) and `refreshPalette` (by `palette`).
 * @type {{redraw: function(string), refreshPalette: function()}}
 */
export const hooks = {
  redraw: () => {},
  refreshPalette: () => {},
};

/**
 * State specific to the staff block: `chordTarget`, the note whose chord is
 * being typed (highlighted in Write mode); `notice`, one-off message of the
 * help line (an action refused).
 * @type {{chordTarget: ?{b: module:model~StaffBlock, i: number}, notice: string}}
 */
export const staffUi = { chordTarget: null, notice: '' };

let noticeTimer = null;

/**
 * Shows a message in the palette's help line for a few seconds.
 * @param {string} text
 */
export function flash(text) {
  staffUi.notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    staffUi.notice = '';
    hooks.refreshPalette();
  }, 3500);
  hooks.refreshPalette();
}

/**
 * Active staff block and its note (or `null`).
 * @returns {?{n: module:model~Note, b: module:model~StaffBlock}}
 */
export function activeStaff() {
  const n = curNote();
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  return n && b && b.type === 'staff' ? { n, b } : null;
}

/**
 * Keeps the insertion cursor and the selection within bounds (after a
 * deletion or an undo, for example). `null` cursor = end of staff.
 * @param {module:model~StaffBlock} b
 */
export function clampCursor(b) {
  if (state.cursor != null && (state.cursor < 0 || state.cursor >= b.items.length)) state.cursor = null;
  if (state.sel != null && !b.items[state.sel]) state.sel = null;
}

/**
 * Fits the staff back into measures after a change (automatic ties at
 * barlines, see {@link module:measure-fit|measure-fit}) and moves the
 * selection and cursor to the new indices.
 * @param {module:model~StaffBlock} b
 * @returns {{startOf: number[], tupCross: Set.<number>}}
 */
export function refit(b) {
  const res = normalizeStaff(b.items, b.time);
  if (state.sel != null) state.sel = res.startOf[state.sel] ?? null;
  if (state.cursor != null) {
    const c = res.startOf[state.cursor];
    state.cursor = c == null || c >= res.items.length ? null : c;
  }
  b.items = res.items;
  return res;
}

/**
 * Effective insertion position: index of the item before which the next
 * note will land (`items.length` = at the end).
 * @param {module:model~StaffBlock} b
 * @returns {number}
 */
export function insertIndex(b) {
  return state.cursor != null ? state.cursor : b.items.length;
}

/**
 * Logical note that barlines and chord symbols apply to: the selected note
 * in Edit mode, the note just before the cursor in Write mode (failing that,
 * the last or the first). Returns its first piece.
 * @param {module:model~StaffBlock} b
 * @returns {number} -1 if the staff is empty.
 */
export function targetIndex(b) {
  if (!b.items.length) return -1;
  if (state.mode === 'edit') return state.sel != null ? state.sel : b.items.length - 1;
  return chainStart(b.items, Math.max(0, insertIndex(b) - 1));
}

/**
 * Duration (written value) of the logical note containing `i`: the item's
 * own if it is alone, otherwise the single value equal to the sum of its
 * pieces (a whole note split into half⁀half is worth a whole note), failing
 * that the first piece's.
 * @param {module:model~StaffBlock} b
 * @param {number} i
 * @returns {{d: string, dot: boolean, tup: boolean}}
 */
export function logicalValue(b, i) {
  const a = chainStart(b.items, i);
  const z = chainEnd(b.items, i);
  const first = b.items[a];
  if (a === z) return { d: first.d, dot: !!first.dot, tup: !!first.tup };
  let len = 0;
  for (let k = a; k <= z; k++) len += qlen(b.items[k]);
  const one = singleValue(len, true);
  return one ? { ...one, tup: false } : { d: first.d, dot: !!first.dot, tup: false };
}

/**
 * Edit mode: applies `fn` to the selected note, then refits into measures,
 * saves and redraws (with undo available).
 * @param {function(module:model~StaffItem, module:model~StaffBlock)} fn
 * @returns {boolean} `false` outside Edit mode or with no selection (the
 *   button then sets the input).
 */
export function withSel(fn) {
  if (state.mode !== 'edit') return false;
  const a = activeStaff();
  if (!a || state.sel == null || !a.b.items[state.sel]) return false;
  pushSnapshot(a.n);
  fn(a.b.items[state.sel], a.b);
  refit(a.b);
  touch(a.n);
  hooks.redraw(a.b.id);
  return true;
}
