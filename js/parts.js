/**
 * @module parts
 * @description
 * **Several staves in one block** (2.17): a piano on two staves, a sax over a piano, up to
 * {@link PARTS_MAX} staves joined by a brace. Pure functions.
 *
 * ## Data
 *
 * A staff block is its own first staff (`clef`, `items`, `tr`, `ks`); the others are in `more`
 * (see {@link module:model~StaffPart|StaffPart}). A block written before 2.17 is thus a block
 * with one staff, unchanged. Time signature, tempo, swing and eighth-note grouping belong to the
 * block: every staff shares them.
 *
 * ## Staves seen as blocks
 *
 * Most of the staff code (fitting into measures, pitches, transposition, the palette) works on
 * "a block": its `items`, its `clef`, its `time`. {@link partView} gives each staff that shape: a
 * view that reads and writes the staff's own fields in the staff, and everything else in the block.
 * The first staff needs no view: it is the block itself.
 *
 * Barlines are part of the system: the layout and the playback merge those of every staff
 * ({@link module:score|score}).
 */

import { instrumentOf } from './model.js';
import { fifthsOf } from './transpose.js';

/** Most staves in one block. */
export const PARTS_MAX = 4;

/** Fields that belong to one staff; the others belong to the block. */
const OWN = new Set(['clef', 'items', 'tr', 'ks']);

/**
 * Staves of a block, from the top. The first one is the block itself.
 * @param {module:model~StaffBlock} b
 * @returns {Array.<module:model~StaffPart>}
 */
export function partsOf(b) {
  return Array.isArray(b.more) && b.more.length ? [b, ...b.more] : [b];
}

/**
 * Number of staves of a block.
 * @param {module:model~StaffBlock} b
 * @returns {number}
 */
export function partCount(b) {
  return partsOf(b).length;
}

/**
 * Staff `k` of a block, seen as a block: `clef`, `items`, `tr` and `ks` are read from and written
 * to the staff (deleting them too); everything else (`id`, `time`, `tempo`…) to the block.
 *
 * It is a `Proxy` rather than a copy so that code written for a block (`b.items = …`,
 * `delete b.tr`) changes the right staff.
 *
 * @param {module:model~StaffBlock} b
 * @param {number} k Staff index (0 = the block itself, returned as is).
 * @returns {module:model~StaffBlock}
 */
export function partView(b, k) {
  const parts = partsOf(b);
  const p = parts[Math.max(0, Math.min(parts.length - 1, k))];
  if (p === b) return b;
  const owner = (key) => (OWN.has(/** @type {string} */ (key)) ? p : b);
  return new Proxy(b, {
    get: (_, key) => owner(key)[key],
    set: (_, key, v) => {
      owner(key)[key] = v;
      return true;
    },
    has: (_, key) => key in owner(key),
    deleteProperty: (_, key) => delete owner(key)[key],
  });
}

/**
 * Own fields of a staff, as a {@link module:model~StaffPart|StaffPart} (no shared object).
 * @param {module:model~StaffPart} p
 * @returns {module:model~StaffPart}
 */
function partFields(p) {
  /** @type {module:model~StaffPart} */
  const out = { clef: p.clef, items: p.items };
  if (p.tr) out.tr = p.tr;
  if (p.ks) out.ks = p.ks;
  return out;
}

/**
 * Writes a list of staves back into a block: the first into the block's own fields, the others
 * into `more` (removed when there is only one).
 * @param {module:model~StaffBlock} b
 * @param {Array.<module:model~StaffPart>} list At least one staff.
 */
function setParts(b, list) {
  const [first, ...rest] = list.map(partFields);
  b.clef = first.clef;
  b.items = first.items;
  if (first.tr) b.tr = first.tr;
  else delete b.tr;
  if (first.ks) b.ks = first.ks;
  else delete b.ks;
  if (rest.length) b.more = rest;
  else delete b.more;
}

/**
 * Key signature of staff `to` in the key that staff `from` is written in with `ks`: the same
 * concert key, written for each one's instrument. Wrapped to 7 accidentals at most.
 * @param {module:model~StaffPart} from
 * @param {number} ks
 * @param {module:model~StaffPart} to
 * @returns {number}
 */
function sameKey(from, ks, to) {
  let k = ks - fifthsOf(instrumentOf(from.tr).semis) + fifthsOf(instrumentOf(to.tr).semis);
  if (k > 7) k -= 12;
  if (k < -7) k += 12;
  return k;
}

/**
 * Adds an empty staff under staff `after`. Its clef: bass under a treble staff that has no bass
 * staff yet (the left hand of a piano), otherwise the clef of the staff above. Its key signature
 * is the block's key.
 * @param {module:model~StaffBlock} b
 * @param {number} after
 * @returns {number} Index of the new staff, -1 if the block is full.
 */
export function addPart(b, after) {
  const list = partsOf(b);
  if (list.length >= PARTS_MAX) return -1;
  const above = list[Math.max(0, Math.min(list.length - 1, after))];
  const clef =
    above.clef === 'treble' && !list.some((p) => p.clef === 'bass')
      ? 'bass'
      : above.clef === 'rhythm'
        ? 'treble'
        : above.clef;
  /** @type {module:model~StaffPart} */
  const part = { clef, items: [] };
  const ref = above.clef !== 'rhythm' ? above : list.find((p) => p.clef !== 'rhythm');
  const ks = ref ? sameKey(ref, ref.ks || 0, part) : 0;
  if (ks) part.ks = ks;
  const at = list.indexOf(above) + 1;
  setParts(b, [...list.slice(0, at), part, ...list.slice(at)]);
  return at;
}

/**
 * Removes staff `k` (never the last one).
 * @param {module:model~StaffBlock} b
 * @param {number} k
 * @returns {boolean} Removed.
 */
export function removePart(b, k) {
  const list = partsOf(b);
  if (list.length < 2 || !list[k]) return false;
  setParts(
    b,
    list.filter((_, j) => j !== k),
  );
  return true;
}

/**
 * Moves staff `k` one place up (`-1`) or down (`+1`).
 * @param {module:model~StaffBlock} b
 * @param {number} k
 * @param {number} dir
 * @returns {number} New index of the staff (unchanged if it cannot move).
 */
export function movePart(b, k, dir) {
  const list = partsOf(b);
  const to = k + dir;
  if (!list[k] || to < 0 || to >= list.length) return k;
  const next = list.slice();
  [next[k], next[to]] = [next[to], next[k]];
  setParts(b, next);
  return to;
}

/**
 * Changes the clef of a staff. Between treble and bass, the notes keep their place on the staff
 * (the writing stays, the sound changes, as with the clef menu since 1.0). Toward a rhythm line,
 * the pitches are dropped; from a rhythm line, every note lands on the middle line. A rhythm line
 * has no key signature nor instrument.
 * @param {module:model~StaffPart} p A staff (or the block, for the first one).
 * @param {'treble'|'bass'|'rhythm'} clef
 */
export function setPartClef(p, clef) {
  const was = p.clef;
  if (was === clef) return;
  p.clef = clef;
  if (clef === 'rhythm') {
    p.items.forEach((it) => {
      delete it.s;
      delete it.a;
      delete it.x;
    });
    delete p.tr;
    delete p.ks;
  } else if (was === 'rhythm') {
    p.items.forEach((it) => {
      if (!it.r) it.s = 4;
    });
  }
}

/**
 * Sets the key signature of staff `k`, and of every other staff in the same concert key (a B♭ part
 * gets two more sharps than a part in C).
 * @param {module:model~StaffBlock} b
 * @param {number} k
 * @param {number} ks From -7 to 7.
 */
export function setKey(b, k, ks) {
  const list = partsOf(b);
  const from = list[k] || list[0];
  list.forEach((p) => {
    if (p.clef === 'rhythm') return;
    const v = p === from ? ks : sameKey(from, ks, p);
    if (v) p.ks = v;
    else delete p.ks;
  });
}
