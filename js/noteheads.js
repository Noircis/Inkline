/**
 * @module noteheads
 * @description
 * **Chords on a staff** (2.17): several notes stacked on the same item, sharing its duration, stem,
 * tie and chord symbol. Pure functions.
 *
 * ## Data
 *
 * An item keeps its own note (`s`, `a`) and may carry the others in `x`, sorted by position
 * (see {@link module:model~StaffItem|StaffItem}). A plain note has no `x`: every staff written
 * before 2.17 is already valid.
 *
 * ## Engraving
 *
 * {@link placeHeads} applies the two usual rules:
 *
 * - **seconds**: two heads one step apart cannot sit on the same side of the stem. Walking from
 *   the stem's root (the bottom with a stem up, the top with a stem down), a head a second away
 *   from an unshifted neighbour goes to the other side of the stem.
 * - **accidentals**: they are stacked in columns, from the top head down. Each accidental takes
 *   the column nearest to the head where no other accidental lies within a sixth (they would
 *   overlap vertically).
 *
 * {@link headRoom} turns that into horizontal room, used by the layout engine so that the
 * renderer and the hit testing agree.
 */

import { STEP_MIN, STEP_MAX } from './model.js';
import { clamp } from './util.js';

/** Most notes in one chord. */
export const HEADS_MAX = 6;

/** Horizontal shift (px) of a head moved to the other side of the stem. */
export const HEAD_SHIFT = 11.5;

/** Width (px) of the first column of accidentals, then of each further column. */
const ACC_FIRST = 12;
const ACC_NEXT = 10;

/** Two accidentals closer than this (in steps) cannot share a column. */
const ACC_CLEAR = 6;

/**
 * A note of an item, its own or a stacked one.
 * @typedef {Object} Head
 * @property {number} s Position on the staff.
 * @property {number} [a] Written accidental.
 */

/**
 * A head placed for drawing.
 * @typedef {Object} PlacedHead
 * @property {number} s
 * @property {number} [a]
 * @property {number} dx Horizontal offset from the item's x (0, or ±{@link HEAD_SHIFT}).
 * @property {number} col Accidental column, 0 next to the head; -1 without an accidental.
 */

/**
 * Does the item stack several notes?
 * @param {module:model~StaffItem} it
 * @returns {boolean}
 */
export function isChord(it) {
  return !it.r && Array.isArray(it.x) && it.x.length > 0;
}

/**
 * Notes of an item, from the lowest to the highest. Empty for a rest.
 * @param {module:model~StaffItem} it
 * @returns {Array.<Head>}
 */
export function headsOf(it) {
  if (it.r || it.s == null) return [];
  const own = it.a != null ? { s: it.s, a: it.a } : { s: it.s };
  if (!isChord(it)) return [own];
  return [own, ...it.x.map((h) => (h.a != null ? { s: h.s, a: h.a } : { s: h.s }))].sort((p, q) => p.s - q.s);
}

/**
 * Stem direction of a note or chord: up when the heads sit mostly below the middle line.
 * For a single note, that is `s < 4`.
 * @param {Array.<Head>} heads
 * @returns {boolean}
 */
export function stemUpFor(heads) {
  if (!heads.length) return true;
  return (heads[0].s + heads[heads.length - 1].s) / 2 < 4;
}

/**
 * Places the heads of a chord: side of the stem and accidental columns (see the module header).
 * @param {Array.<Head>} heads Sorted from the lowest.
 * @param {boolean} up Stem up.
 * @returns {Array.<PlacedHead>} Same order as `heads`.
 */
export function placeHeads(heads, up) {
  const out = heads.map((h) => ({ ...h, dx: 0, col: -1 }));
  // Seconds: walk away from the stem's root.
  const order = up ? out.map((_, i) => i) : out.map((_, i) => out.length - 1 - i);
  for (let k = 1; k < order.length; k++) {
    const h = out[order[k]];
    const prev = out[order[k - 1]];
    if (Math.abs(h.s - prev.s) === 1 && prev.dx === 0) h.dx = up ? HEAD_SHIFT : -HEAD_SHIFT;
  }
  // Accidentals: from the top head down, nearest free column.
  const placed = [];
  for (let i = out.length - 1; i >= 0; i--) {
    const h = out[i];
    if (h.a == null) continue;
    let col = 0;
    while (placed.some((p) => p.col === col && Math.abs(p.s - h.s) < ACC_CLEAR)) col++;
    h.col = col;
    placed.push(h);
  }
  return out;
}

/**
 * X offset (from the item's x) of an accidental in column `col`.
 * @param {number} col
 * @param {boolean} leftShift A head of the chord sits left of the stem.
 * @returns {number}
 */
export function accidentalDx(col, leftShift) {
  return -15 - col * ACC_NEXT - (leftShift ? HEAD_SHIFT : 0);
}

/**
 * Extra horizontal room an item needs around its head: on the left for its accidentals and for a
 * head shifted left of the stem, on the right for a head shifted right.
 * @param {module:model~StaffItem} it
 * @param {boolean} rh Rhythm line (no pitch, nothing extra).
 * @returns {{left: number, right: number}}
 */
export function headRoom(it, rh) {
  if (rh || it.r) return { left: 0, right: 0 };
  const heads = headsOf(it);
  const placed = placeHeads(heads, stemUpFor(heads));
  const cols = Math.max(-1, ...placed.map((h) => h.col));
  const leftShift = placed.some((h) => h.dx < 0);
  return {
    left: (cols >= 0 ? ACC_FIRST + cols * ACC_NEXT : 0) + (leftShift ? HEAD_SHIFT : 0),
    right: placed.some((h) => h.dx > 0) ? HEAD_SHIFT : 0,
  };
}

/**
 * Adds a note to an item, or removes it if the item already has one at that position. Removing
 * the item's own note hands its place to the lowest stacked one. The last note of an item is never
 * removed.
 * @param {module:model~StaffItem} it
 * @param {number} s
 * @param {?number} [a] Accidental of an added note.
 * @returns {'added'|'removed'|'full'|null} What happened; `null`: nothing (a rest, or the only note).
 */
export function toggleHead(it, s, a = null) {
  if (it.r || it.s == null) return null;
  const x = Array.isArray(it.x) ? it.x : [];
  if (s === it.s) {
    if (!x.length) return null;
    const [next, ...rest] = x;
    it.s = next.s;
    if (next.a != null) it.a = next.a;
    else delete it.a;
    setExtras(it, rest);
    return 'removed';
  }
  const k = x.findIndex((h) => h.s === s);
  if (k >= 0) {
    setExtras(
      it,
      x.filter((_, j) => j !== k),
    );
    return 'removed';
  }
  if (x.length + 1 >= HEADS_MAX) return 'full';
  const head = a != null ? { s, a } : { s };
  setExtras(it, [...x, head]);
  return 'added';
}

/**
 * Writes the stacked notes of an item, sorted; removes `x` when empty.
 * @param {module:model~StaffItem} it
 * @param {Array.<Head>} list
 */
function setExtras(it, list) {
  if (list.length) it.x = list.slice().sort((p, q) => p.s - q.s);
  else delete it.x;
}

/**
 * Moves every note of an item so that its own note lands on `s`. The whole chord keeps its shape;
 * the move is shortened if a note would leave the staff.
 * @param {module:model~StaffItem} it
 * @param {number} s
 */
export function moveHeads(it, s) {
  const heads = headsOf(it);
  if (!heads.length) return;
  let delta = s - it.s;
  delta = clamp(delta, STEP_MIN - heads[0].s, STEP_MAX - heads[heads.length - 1].s);
  it.s += delta;
  if (isChord(it)) it.x = it.x.map((h) => ({ ...h, s: h.s + delta }));
}

/**
 * Gives an item the same notes as another one (a tied note, written the same).
 * Accidentals are not copied: the tie carries the pitch.
 * @param {module:model~StaffItem} from
 * @param {module:model~StaffItem} to
 */
export function copyHeads(from, to) {
  to.s = from.s;
  delete to.a;
  if (isChord(from)) to.x = from.x.map((h) => ({ s: h.s }));
  else delete to.x;
}
