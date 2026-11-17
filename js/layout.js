/**
 * @module layout
 * @description
 * **Layout** engine of a staff block: decides where each item goes (line and x),
 * where barlines fall, and where the add zone is. A block may hold several
 * staves (2.17): they are laid out together, one above the other, and the
 * notes that start at the same time are aligned.
 *
 * It is a pure function: same input, same output, no DOM. The SVG renderer
 * ({@link module:render-staff|render-staff}) **and** hit testing (the user's
 * tap, in {@link module:ui/staff/input|ui/staff/input}) both call
 * {@link module:layout.layout|layout} with the same parameters: they are
 * therefore consistent by construction.
 *
 * ## Algorithm
 *
 * 1. **Intrinsic widths**: each item gets a base width from its duration
 *    (proportional engraving: a whole note takes more room than an eighth),
 *    plus room for its accidentals, a note shifted beside the stem (chords),
 *    a dot or a long chord symbol.
 * 2. **Measures and columns**: the measures of every staff, merged
 *    ({@link module:score.scoreMeasures|scoreMeasures}). Inside a measure,
 *    every start time on any staff is a **column**, as wide as its widest
 *    item; the items of a column share their x. With one staff, a column is
 *    an item.
 * 3. **Line breaking**, greedy (*first-fit*) algorithm: a measure goes on the
 *    current line if it fits, otherwise it opens a new line. A measure is
 *    never split in two.
 * 4. **Justification**: each line is stretched by a factor
 *    `sc = availableWidth / usedWidth`, capped at 2.4 to avoid an absurd
 *    stretch. The last line is not stretched, unless the pattern ends with a
 *    final barline **and** the line is already more than 50% full. An
 *    overfull line (measure wider than the screen) is compressed (`sc < 1`).
 * 5. **Final positions** of items, barlines and start repeats.
 *
 * ## Vertical reference
 *
 * Each line (system) takes a band of fixed height `SH`, split into one band
 * per staff; the y coordinates inside it are given by
 * {@link module:layout.geom|geom}.
 */

import { EPS, snap } from './util.js';
import { mlen, qlen, STEP_MIN, STEP_MAX, STEP_FIT } from './model.js';
import { headRoom, headsOf } from './noteheads.js';
import { partsOf } from './parts.js';
import { scoreMeasures, partEnd } from './score.js';

/** Half a staff space, in pixels: the vertical gap between two consecutive positions `s`. */
export const HALF_SPACE = 5;

/** Base width (px) per note value, before justification. */
const BASE_WIDTH = { w: 46, h: 34, q: 27, 8: 23, 16: 21 };

/** Extra width (px) reserved after the measure depending on the barline type. */
const BAR_EXTRA = { double: 4, final: 6, rep: 14 };

/** Inner measure margins (px) before the first and after the last note. */
const PAD_L = 10;
const PAD_R = 8;

/** Width (px) reserved for the start repeat sign `‖:`. */
const REPEAT_START_W = 16;

/** Width (px) of a key signature accidental. */
export const KEY_ACC_W = 9;

/** Width (px) of the gap opened before the note where the insertion cursor is. */
export const INSERT_GAP = 34;

/** Maximum stretch factor of a justified line. */
const MAX_STRETCH = 2.4;

/** Room (px) on the left of every line for the brace joining several staves. */
export const BRACE_W = 14;

/** Height (px) of the band of a staff, and of a rhythm line, before room for high notes. */
const STAFF_H = 124;
const RHYTHM_H = 92;

/**
 * Computed position of an item.
 * @typedef {Object} ItemPos
 * @property {number} sys Line index.
 * @property {number} x X of the notehead (center).
 * @property {number} x0 Start of the item's horizontal zone (for taps).
 * @property {number} x1 End of that zone.
 */

/**
 * A line (system) of the block.
 * @typedef {Object} System
 * @property {number} start X where the music starts (after brace, clef and time signature).
 * @property {number} end X after the last measure.
 * @property {number} used Natural width taken (before justification).
 * @property {number} firstMeasure Number (from 1) of the first measure, shown at the start of the line.
 * @property {Array.<{m: ScoreColumns, w: number}>} ms Measures placed on the line.
 */

/**
 * Layout of one staff of the block.
 * @typedef {Object} PartLayout
 * @property {boolean} rh Rhythm line (a single staff line, no pitches).
 * @property {ItemPos[]} pos One position per item, same index as the staff's `items`.
 * @property {number} padTop Room added at the top of the staff's band for very high notes (2.8.2).
 * @property {number} off Top of the staff's band, from the top of the line (system).
 * @property {number} H Height of the staff's band.
 */

/**
 * Result of the layout.
 * @typedef {Object} Layout
 * @property {Array.<PartLayout>} parts One per staff, from the top.
 * @property {number} part Staff being edited (the one the cursor, the add zone and `pos` refer to).
 * @property {boolean} rh `parts[part].rh`.
 * @property {ItemPos[]} pos `parts[part].pos`.
 * @property {number} padTop `parts[part].padTop`.
 * @property {System[]} systems
 * @property {Array.<{sys:number, x:number, type:string}>} bars End-of-measure barlines.
 * @property {Array.<{sys:number, x0:number, x1:number}>} mrects Place of each measure (2.8.4), in written order.
 * @property {Array.<{sys:number, x:number}>} starts Start repeats.
 * @property {number} ksw Key signature width (0 without a key signature); the widest of the staves.
 * @property {number} left Room on the left of every line (the brace, with several staves).
 * @property {?number} insertSys Line of the insertion cursor (if it is placed before a note).
 * @property {?number} insertX X of the insertion cursor, `null` if it is at the end of the staff.
 * @property {number} appendSys Line of the add zone.
 * @property {number|null} appendX X of the add zone, `null` if the pattern
 *   ends with a final barline.
 * @property {boolean} appendGap The add zone is a narrow gap among the notes of the other staves
 *   (the staff being edited is shorter than they are), not the end of the line.
 * @property {boolean} ended The last measure ends with a final barline.
 * @property {number} SH Height of a line in px (every staff).
 * @property {number} height Total height in px.
 * @property {number} ML Capacity of a measure in quarter notes.
 */

/**
 * A measure ready to be placed: its columns.
 * @typedef {Object} ScoreColumns
 * @property {module:score~ScoreMeasure} sm The merged measure.
 * @property {Array.<Column>} cols Columns, by start time.
 */

/**
 * A column: what starts at the same time on every staff.
 * @typedef {Object} Column
 * @property {number} on Start, in quarter notes from the start of the measure.
 * @property {number} w Natural width (px), gap included.
 * @property {number} left Room left of the heads (accidentals), the widest of the column.
 * @property {number} gap Gap opened before the column (insertion cursor or add zone), 0 if none.
 * @property {Array.<{k: number, i: number, end: number}>} items Items of the column: staff, index,
 *   and when the item ends (quarter notes from the start of the measure).
 */

/**
 * Natural width (px) of an item.
 * @param {module:model~StaffItem} it
 * @param {boolean} rh Rhythm line (no accidentals).
 * @returns {number}
 */
function itemWidth(it, rh) {
  const room = headRoom(it, rh);
  let w = BASE_WIDTH[it.d] + room.left + room.right;
  if (it.dot) w += 7;
  if (it.c) w = Math.max(w, it.c.length * 8 + 10); // the chord symbol must not run into the next one
  return w;
}

/**
 * X where the music starts: the 1st line carries the clef, key signature AND
 * time signature, the following ones the clef and key signature.
 * @param {boolean} rh Only rhythm lines (narrower clef).
 * @param {boolean} isFirst
 * @param {number} ksw Key signature width.
 * @param {number} left Room for the brace.
 * @returns {number}
 */
function systemStart(rh, isFirst, ksw, left) {
  if (isFirst) return left + (rh ? 46 : 64) + ksw;
  return left + (rh ? 30 : 44) + ksw;
}

/**
 * Key signature width (px) of a staff.
 * @param {module:model~StaffPart} p
 * @returns {number}
 */
function keySigWidth(p) {
  const n = p.clef === 'rhythm' ? 0 : Math.abs(p.ks || 0);
  return n ? n * KEY_ACC_W + 4 : 0;
}

/**
 * Natural width of a measure: margins, optional repeat sign, columns, and
 * room for the closing barline.
 * @param {ScoreColumns} mc
 * @returns {number}
 */
function measureWidth(mc) {
  const content = mc.cols.reduce((sum, c) => sum + c.w, 0);
  return PAD_L + (mc.sm.rs ? REPEAT_START_W : 0) + content + PAD_R + (BAR_EXTRA[mc.sm.type] || 0);
}

/**
 * Step 2: the columns of each measure.
 *
 * Two gaps may be opened, both on the staff being edited: before the item
 * where the insertion cursor is (`gapAt`), and where its next note will go
 * when another staff already has notes there (`tail`, see {@link appendTarget}).
 *
 * @param {Array.<module:score~ScoreMeasure>} measures
 * @param {Array.<module:model~StaffPart>} parts
 * @param {number} ka Staff being edited.
 * @param {?number} gapAt Insertion cursor before this item of staff `ka`.
 * @param {?{m: number, on: number}} tail Narrow add zone.
 * @returns {Array.<ScoreColumns>}
 */
function buildColumns(measures, parts, ka, gapAt, tail) {
  return measures.map((sm, mi) => {
    /** @type {Map.<number, Column>} */
    const byOn = new Map();
    const colAt = (on) => {
      const key = Math.round(on * 96);
      if (!byOn.has(key)) byOn.set(key, { on, w: 0, left: 0, gap: 0, items: [] });
      return byOn.get(key);
    };
    sm.parts.forEach((pm, k) => {
      if (!pm) return;
      const rh = parts[k].clef === 'rhythm';
      pm.idx.forEach((i, j) => {
        const it = parts[k].items[i];
        const col = colAt(pm.on[j]);
        col.items.push({ k, i, end: snap(pm.on[j] + qlen(it)) });
        col.w = Math.max(col.w, itemWidth(it, rh));
        col.left = Math.max(col.left, headRoom(it, rh).left);
        if (k === ka && i === gapAt) col.gap = INSERT_GAP;
      });
    });
    if (tail && tail.m === mi) colAt(tail.on).gap = INSERT_GAP;
    const cols = [...byOn.values()].sort((p, q) => p.on - q.on);
    cols.forEach((c) => (c.w += c.gap));
    return { sm, cols };
  });
}

/**
 * Where the add zone of the staff being edited goes: at the end of the block
 * (`null`), or as a narrow gap at the place of its next note, when the other
 * staves already have notes from there on.
 * @param {Array.<module:score~ScoreMeasure>} measures
 * @param {number} ka
 * @param {number} ML
 * @returns {?{m: number, on: number}}
 */
function appendTarget(measures, ka, ML) {
  if (measures.length === 0 || measures[0].parts.length < 2) return null;
  const end = partEnd(measures, ka, ML);
  if (end.m >= measures.length) return null;
  const busyHere = measures[end.m].parts.some(
    (pm, k) => pm && k !== ka && pm.on.some((on) => on >= end.on - EPS),
  );
  const busyAfter = measures.slice(end.m + 1).some((m) => m.parts.some(Boolean));
  return busyHere || busyAfter ? end : null;
}

/**
 * Step 3: line breaking, greedy (*first-fit*) algorithm. A measure goes on
 * the current line if it fits, otherwise it opens a new line.
 * @param {Array.<ScoreColumns>} measures
 * @param {number} W
 * @param {function(boolean): number} startOf Start of a line (`true` for the first).
 * @returns {System[]}
 */
function breakIntoSystems(measures, W, startOf) {
  const systems = [];
  const open = () => {
    const sys = { start: startOf(systems.length === 0), ms: [], used: 0, end: 0, firstMeasure: 1 };
    systems.push(sys);
    return sys;
  };
  let sys = open();
  measures.forEach((m) => {
    const w = measureWidth(m);
    const avail = W - sys.start - 4;
    if (sys.ms.length && sys.used + w > avail) sys = open();
    sys.ms.push({ m, w });
    sys.used += w;
  });
  return systems;
}

/**
 * Stretch factor of a line (step 4, justification).
 * - overfull line: compress (`< 1`);
 * - full non-final line: stretch to the edge, at most ×{@link MAX_STRETCH};
 * - last line: natural width, except at the end of a pattern more than 50%
 *   full, or a `justify` block (practice): the last line is then stretched
 *   like the others (at most ×{@link MAX_STRETCH}).
 * @param {System} sys
 * @param {number} W
 * @param {boolean} isLast
 * @param {boolean} ended The pattern ends with a final barline.
 * @param {boolean} [justify=false] Stretch the last line too, like the others.
 * @returns {number}
 */
function stretchFactor(sys, W, isLast, ended, justify = false) {
  const avail = W - sys.start - 4;
  if (sys.used > avail) return avail / sys.used;
  if (!isLast && sys.used > 0) return Math.min(avail / sys.used, MAX_STRETCH);
  if (isLast && justify && sys.used > 0) return Math.min(avail / sys.used, MAX_STRETCH);
  if (isLast && ended && sys.used > avail * 0.5) return avail / sys.used;
  return 1;
}

/**
 * Steps 4 and 5: justification of each line and computation of the
 * positions of items, barlines and start repeats. Also fills in each line's
 * `end` and `firstMeasure`.
 *
 * An item's zone (for taps) runs from its column to the column where it ends
 * (or to the end of the measure's columns).
 *
 * @param {System[]} systems
 * @param {Array.<module:model~StaffPart>} parts
 * @param {number} W
 * @param {boolean} ended
 * @param {boolean} justify
 * @param {?{m: number, on: number}} tail Narrow add zone.
 * @returns {{pos: Array.<ItemPos[]>, bars: Array.<{sys: number, x: number, type: string}>, starts: Array.<{sys: number, x: number}>, measureCount: number, mrects: Array.<{sys: number, x0: number, x1: number}>, insert: ?{sys: number, x: number}, tailAt: ?{sys: number, x: number}}}
 */
function placeSystems(systems, parts, W, ended, justify, tail) {
  const pos = parts.map(() => []);
  let insert = null;
  let tailAt = null;
  const bars = [];
  const starts = [];
  const mrects = [];
  let measureCount = 0;
  systems.forEach((sys, si) => {
    const sc = stretchFactor(sys, W, si === systems.length - 1, ended, justify);
    sys.firstMeasure = measureCount + 1;
    let x = sys.start;
    sys.ms.forEach(({ m: mc }) => {
      const mi = measureCount;
      measureCount++;
      const measureX = x;
      x += PAD_L * sc;
      if (mc.sm.rs) {
        starts.push({ sys: si, x: measureX + 2 });
        x += REPEAT_START_W * sc;
      }
      /** Last item placed on each staff, waiting for the end of its zone. */
      const open = parts.map(() => null);
      mc.cols.forEach((col) => {
        const colStart = x;
        open.forEach((o, k) => {
          if (o && col.on >= o.end - EPS) {
            o.p.x1 = colStart;
            open[k] = null;
          }
        });
        let w = col.w * sc;
        if (col.gap) {
          // Insertion cursor or add zone before this column: open a gap.
          const gap = col.gap * Math.min(1, sc);
          const at = { sys: si, x: x + gap / 2 };
          const isTail = !!tail && tail.m === mi && Math.abs(col.on - tail.on) < EPS;
          if (isTail) tailAt = at;
          else insert = at;
          x += gap;
          w -= gap;
        }
        const headOffset = (col.left + 8) * Math.min(1, sc);
        col.items.forEach(({ k, i, end }) => {
          const p = { sys: si, x: x + headOffset, x0: x, x1: x + w };
          pos[k][i] = p;
          open[k] = { p, end };
        });
        x += w;
      });
      open.forEach((o) => o && (o.p.x1 = x));
      x += (PAD_R + (BAR_EXTRA[mc.sm.type] || 0)) * sc;
      if (mc.sm.full) bars.push({ sys: si, x, type: mc.sm.type || 'single' });
      mrects.push({ sys: si, x0: measureX, x1: x });
    });
    sys.end = x;
  });
  return { pos, bars, starts, measureCount, insert, tailAt, mrects };
}

/**
 * Vertical bands of the staves: each staff's band grows upward for very high
 * notes (above E6 in treble clef).
 * @param {Array.<module:model~StaffPart>} parts
 * @returns {Array.<{rh: boolean, padTop: number, off: number, H: number}>}
 */
function bands(parts) {
  let off = 0;
  return parts.map((p) => {
    const rh = p.clef === 'rhythm';
    let hi = STEP_FIT;
    if (!rh)
      p.items.forEach((it) =>
        headsOf(it).forEach((h) => {
          if (h.s > hi) hi = h.s;
        }),
      );
    const padTop = (hi - STEP_FIT) * HALF_SPACE;
    const H = (rh ? RHYTHM_H : STAFF_H) + padTop;
    const band = { rh, padTop, off, H };
    off += H;
    return band;
  });
}

/**
 * Lays out a staff block (every staff).
 *
 * @param {module:model~StaffBlock} b Staff block.
 * @param {number} W Available width in px.
 * @param {boolean} [active=false] Block being edited: an add zone wide enough
 *   is then guaranteed, even if it means opening a new empty line.
 * @param {?number} [insertAt=null] Insertion cursor placed before this item of
 *   the staff being edited: a gap of {@link INSERT_GAP} px is opened there
 *   (Write mode).
 * @param {number} [part=0] Staff being edited (2.17).
 * @returns {Layout}
 */
export function layout(b, W, active = false, insertAt = null, part = 0) {
  const parts = partsOf(b);
  const ka = Math.max(0, Math.min(parts.length - 1, part));
  const items = parts[ka].items;
  const gapAt = insertAt != null && insertAt >= 0 && insertAt < items.length ? insertAt : null;
  const ML = mlen(b.time);
  const measures = scoreMeasures(b);
  const ended = measures.length > 0 && measures[measures.length - 1].type === 'final';
  const tail = active ? appendTarget(measures, ka, ML) : null;
  const columns = buildColumns(measures, parts, ka, gapAt, tail);

  const ksw = Math.max(...parts.map(keySigWidth));
  const left = parts.length > 1 ? BRACE_W : 0;
  const allRh = parts.every((p) => p.clef === 'rhythm');
  const startOf = (first) => systemStart(allRh, first, ksw, left);
  const systems = breakIntoSystems(columns, W, startOf);
  const { pos, bars, starts, measureCount, insert, tailAt, mrects } = placeSystems(
    systems,
    parts,
    W,
    ended,
    !!b.justify,
    tail,
  );

  // Add zone: after the last measure, or on a new empty line
  // if there is not enough room left (only while editing).
  let appendX;
  let appendSys;
  if (tailAt) {
    appendX = tailAt.x;
    appendSys = tailAt.sys;
  } else {
    let last = systems[systems.length - 1];
    if (active && !ended && W - last.end < 48) {
      last = { start: startOf(false), ms: [], used: 0, end: 0, firstMeasure: measureCount + 1 };
      last.end = last.start;
      systems.push(last);
    }
    appendX = ended ? null : last.ms.length ? last.end + 8 : last.start + 6;
    appendSys = systems.length - 1;
  }

  const bandList = bands(parts);
  const SH = bandList.reduce((sum, p) => sum + p.H, 0);
  /** @type {Array.<PartLayout>} */
  const partLayouts = bandList.map((band, k) => ({ ...band, pos: pos[k] }));
  return {
    parts: partLayouts,
    part: ka,
    rh: partLayouts[ka].rh,
    pos: partLayouts[ka].pos,
    padTop: partLayouts[ka].padTop,
    systems,
    bars,
    mrects,
    starts,
    ksw,
    left,
    insertSys: insert ? insert.sys : null,
    insertX: insert ? insert.x : null,
    appendSys,
    appendX,
    appendGap: !!tailAt,
    ended,
    SH,
    height: systems.length * SH,
    ML,
  };
}

/**
 * Vertical references of a staff on a line.
 * @typedef {Object} SystemGeom
 * @property {number} top Top of the staff's band.
 * @property {number} chordY Baseline of chord symbols.
 * @property {number} staffTop Y of the 5th line (top).
 * @property {number} staffBottom Y of the 1st line (bottom); `s = 0` here.
 * @property {number} mid Middle line (3rd line), pivot for stem direction.
 * @property {number} [line] Single line of a rhythm line.
 */

/**
 * Reference y coordinates of staff `k` on line `si`.
 * @param {Layout} L
 * @param {number} si Line index.
 * @param {number} [k=L.part] Staff index (the one being edited by default).
 * @returns {SystemGeom}
 */
export function geom(L, si, k = L.part) {
  const band = L.parts[k] || L.parts[0];
  const top = si * L.SH + band.off;
  if (band.rh) {
    const ly = top + 56;
    return { top, chordY: top + 20, staffTop: ly, staffBottom: ly, mid: ly, line: ly };
  }
  const st = top + 46 + band.padTop;
  return { top, chordY: top + 20, staffTop: st, staffBottom: st + 40, mid: st + 20 };
}

/**
 * Which line and which staff a y falls on.
 * @param {Layout} L
 * @param {number} y From the top of the drawing.
 * @returns {{sys: number, k: number}}
 */
export function bandAt(L, y) {
  const sys = Math.max(0, Math.min(L.systems.length - 1, Math.floor(y / L.SH)));
  const inner = y - sys * L.SH;
  let k = L.parts.findIndex((p) => inner >= p.off && inner < p.off + p.H);
  if (k < 0) k = inner < 0 ? 0 : L.parts.length - 1;
  return { sys, k };
}

/**
 * Y of a position `s` (notehead) on the staff with geometry `g`.
 * On a rhythm line, every note is on the line.
 * @param {Layout} L
 * @param {SystemGeom} g
 * @param {number} s
 * @returns {number}
 */
export function yOfStep(L, g, s) {
  return g.line != null ? g.line : g.staffBottom - s * HALF_SPACE;
}

/**
 * Vertical hit testing: position `s` closest to a tapped y.
 * Bounded to [{@link module:model.STEP_MIN|STEP_MIN}, {@link module:model.STEP_MAX|STEP_MAX}].
 * @param {SystemGeom} g
 * @param {number} y
 * @returns {number}
 */
export function stepFromY(g, y) {
  return Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round((g.staffBottom - y) / HALF_SPACE)));
}
