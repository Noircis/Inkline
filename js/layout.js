/**
 * @module layout
 * @description
 * **Layout** engine of a staff: decides where each item goes (line and x),
 * where barlines fall, and where the add zone is.
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
 *    plus room for an accidental, a dot or a long chord symbol.
 * 2. **Measures**: split by {@link module:rhythm.segmentMeasures|segmentMeasures}.
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
 * Each line (system) takes a band of fixed height `SH`; the y coordinates
 * inside it are given by {@link module:layout.geom|geom}.
 */

import { segmentMeasures } from './rhythm.js';
import { mlen, STEP_MIN, STEP_MAX, STEP_FIT } from './model.js';

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

/**
 * Computed position of an item.
 * @typedef {Object} ItemPos
 * @property {number} sys Line index.
 * @property {number} x X of the notehead (center).
 * @property {number} x0 Start of the item's horizontal zone (for taps).
 * @property {number} x1 End of that zone.
 */

/**
 * A line (system) of the staff.
 * @typedef {Object} System
 * @property {number} start X where the music starts (after clef and time signature).
 * @property {number} end X after the last measure.
 * @property {number} used Natural width taken (before justification).
 * @property {number} firstMeasure Number (from 1) of the first measure, shown at the start of the line.
 * @property {Array.<{m: module:rhythm~Measure, w: number}>} ms Measures placed on the line.
 */

/**
 * Result of the layout.
 * @typedef {Object} Layout
 * @property {boolean} rh Rhythm line (a single staff line, no pitches).
 * @property {System[]} systems
 * @property {ItemPos[]} pos One position per item, same index as `items`.
 * @property {Array.<{sys:number, x:number, type:string}>} bars End-of-measure barlines.
 * @property {Array.<{sys:number, x0:number, x1:number}>} mrects Place of each measure (2.8.4), in written order.
 * @property {Array.<{sys:number, x:number}>} starts Start repeats.
 * @property {number} ksw Key signature width (0 without a key signature).
 * @property {?number} insertSys Line of the insertion cursor (if it is placed before a note).
 * @property {?number} insertX X of the insertion cursor, `null` if it is at the end of the staff.
 * @property {number} appendSys Line of the add zone.
 * @property {number|null} appendX X of the add zone, `null` if the pattern
 *   ends with a final barline.
 * @property {boolean} ended The last item carries a final barline.
 * @property {number} SH Height of a line in px.
 * @property {number} padTop Room added at the top of each line for very high notes (2.8.2).
 * @property {number} height Total height in px.
 * @property {number} ML Capacity of a measure in quarter notes.
 */

/**
 * Natural width (px) of an item.
 * @param {module:model~StaffItem} it
 * @param {boolean} rh Rhythm line (no accidentals).
 * @returns {number}
 */
function itemWidth(it, rh) {
  let w = BASE_WIDTH[it.d];
  if (it.dot) w += 7;
  if (it.a != null && !it.r && !rh) w += 12;
  if (it.c) w = Math.max(w, it.c.length * 8 + 10); // the chord symbol must not run into the next one
  return w;
}

/**
 * X where the music starts: the 1st line carries the clef, key signature AND
 * time signature, the following ones the clef and key signature.
 * @param {boolean} rh
 * @param {boolean} isFirst
 * @param {number} [ksw=0] Key signature width.
 * @returns {number}
 */
function systemStart(rh, isFirst, ksw = 0) {
  if (isFirst) return (rh ? 46 : 64) + ksw;
  return (rh ? 30 : 44) + ksw;
}

/**
 * Key signature width (px).
 * @param {module:model~StaffBlock} b
 * @returns {number}
 */
function keySigWidth(b) {
  const n = b.clef === 'rhythm' ? 0 : Math.abs(b.ks || 0);
  return n ? n * KEY_ACC_W + 4 : 0;
}

/**
 * Adds an empty line to the list.
 * @param {System[]} systems
 * @param {boolean} rh
 * @returns {System}
 */
function newSystem(systems, rh, ksw = 0) {
  const sys = { start: systemStart(rh, systems.length === 0, ksw), ms: [], used: 0, end: 0, firstMeasure: 1 };
  systems.push(sys);
  return sys;
}

/**
 * Natural width of a measure: margins, optional repeat sign, items, and room
 * for the closing barline.
 * @param {module:rhythm~Measure} m
 * @param {number[]} widths Natural width of each item.
 * @returns {number}
 */
function measureWidth(m, widths) {
  const content = m.idx.reduce((sum, i) => sum + widths[i], 0);
  return PAD_L + (m.rs ? REPEAT_START_W : 0) + content + PAD_R + (BAR_EXTRA[m.type] || 0);
}

/**
 * Step 3: line breaking, greedy (*first-fit*) algorithm. A measure goes on
 * the current line if it fits, otherwise it opens a new line.
 * @param {module:rhythm~Measure[]} measures
 * @param {number[]} widths
 * @param {number} W
 * @param {boolean} rh
 * @returns {System[]}
 */
function breakIntoSystems(measures, widths, W, rh, ksw = 0) {
  const systems = [];
  let sys = newSystem(systems, rh, ksw);
  measures.forEach((m) => {
    const w = measureWidth(m, widths);
    const avail = W - sys.start - 4;
    if (sys.ms.length && sys.used + w > avail) sys = newSystem(systems, rh, ksw);
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
 * @param {System[]} systems
 * @param {module:model~StaffItem[]} items
 * @param {number[]} widths
 * @param {number} W
 * @param {boolean} rh
 * @param {boolean} ended
 * @param {boolean} [justify=false]
 * @returns {{pos: ItemPos[], bars: Array.<{sys: number, x: number, type: string}>, starts: Array.<{sys: number, x: number}>, measureCount: number, mrects: Array.<{sys: number, x0: number, x1: number}>}}
 */
function placeSystems(systems, items, widths, W, rh, ended, justify = false, gapAt = null) {
  const pos = [];
  let insert = null;
  const bars = [];
  const starts = [];
  const mrects = [];
  let measureCount = 0;
  systems.forEach((sys, si) => {
    const sc = stretchFactor(sys, W, si === systems.length - 1, ended, justify);
    sys.firstMeasure = measureCount + 1;
    let x = sys.start;
    sys.ms.forEach(({ m }) => {
      measureCount++;
      const measureX = x;
      x += PAD_L * sc;
      if (m.rs) {
        starts.push({ sys: si, x: measureX + 2 });
        x += REPEAT_START_W * sc;
      }
      m.idx.forEach((i) => {
        const it = items[i];
        let w = widths[i] * sc;
        if (i === gapAt) {
          // Insertion cursor before this item: open a gap.
          const gap = INSERT_GAP * Math.min(1, sc);
          insert = { sys: si, x: x + gap / 2 };
          x += gap;
          w -= gap;
        }
        // The head is shifted right within its zone to leave room for the accidental.
        const headOffset = (it.a != null && !it.r && !rh ? 12 : 0) + 8;
        pos[i] = { sys: si, x: x + headOffset * Math.min(1, sc), x0: x, x1: x + w };
        x += w;
      });
      x += (PAD_R + (BAR_EXTRA[m.type] || 0)) * sc;
      if (m.full) bars.push({ sys: si, x, type: m.type || 'single' });
      mrects.push({ sys: si, x0: measureX, x1: x });
    });
    sys.end = x;
  });
  return { pos, bars, starts, measureCount, insert, mrects };
}

/**
 * Lays out a staff.
 *
 * @param {module:model~StaffBlock} b Staff block.
 * @param {number} W Available width in px.
 * @param {boolean} [active=false] Block being edited: an add zone wide enough
 *   is then guaranteed, even if it means opening a new empty line.
 * @param {?number} [insertAt=null] Insertion cursor placed before this item:
 *   a gap of {@link INSERT_GAP} px is opened there (Write mode).
 * @returns {Layout}
 */
export function layout(b, W, active = false, insertAt = null) {
  const rh = b.clef === 'rhythm';
  const items = b.items;
  const gapAt = insertAt != null && insertAt >= 0 && insertAt < items.length ? insertAt : null;
  const widths = items.map((it, i) => itemWidth(it, rh) + (i === gapAt ? INSERT_GAP : 0));
  const ended = items.length > 0 && items[items.length - 1].bar === 'final';
  const ksw = keySigWidth(b);

  const systems = breakIntoSystems(segmentMeasures(items, b.time), widths, W, rh, ksw);
  const { pos, bars, starts, measureCount, insert, mrects } = placeSystems(
    systems,
    items,
    widths,
    W,
    rh,
    ended,
    !!b.justify,
    gapAt,
  );

  // Add zone: after the last measure, or on a new empty line
  // if there is not enough room left (only while editing).
  let last = systems[systems.length - 1];
  if (active && !ended && W - last.end < 48) {
    last = newSystem(systems, rh, ksw);
    last.end = last.start;
    last.firstMeasure = measureCount + 1;
  }
  const appendX = ended ? null : last.ms.length ? last.end + 8 : last.start + 6;

  // Very high notes (above E6 in treble clef): every line grows upward by
  // the same amount. Nothing changes otherwise.
  let hi = STEP_FIT;
  if (!rh) items.forEach((it) => !it.r && it.s > hi && (hi = it.s));
  const padTop = (hi - STEP_FIT) * HALF_SPACE;
  const SH = (rh ? 92 : 124) + padTop;
  return {
    rh,
    systems,
    pos,
    bars,
    mrects,
    starts,
    ksw,
    insertSys: insert ? insert.sys : null,
    insertX: insert ? insert.x : null,
    appendSys: systems.length - 1,
    appendX,
    ended,
    SH,
    padTop,
    height: systems.length * SH,
    ML: mlen(b.time),
  };
}

/**
 * Vertical references of a line.
 * @typedef {Object} SystemGeom
 * @property {number} top Top of the band.
 * @property {number} chordY Baseline of chord symbols.
 * @property {number} staffTop Y of the 5th line (top).
 * @property {number} staffBottom Y of the 1st line (bottom); `s = 0` here.
 * @property {number} mid Middle line (3rd line), pivot for stem direction.
 * @property {number} [line] Single line of a rhythm line.
 */

/**
 * Reference y coordinates of line `si`.
 * @param {Layout} L
 * @param {number} si Line index.
 * @returns {SystemGeom}
 */
export function geom(L, si) {
  const top = si * L.SH;
  if (L.rh) {
    const ly = top + 56;
    return { top, chordY: top + 20, staffTop: ly, staffBottom: ly, mid: ly, line: ly };
  }
  const st = top + 46 + (L.padTop || 0);
  return { top, chordY: top + 20, staffTop: st, staffBottom: st + 40, mid: st + 20 };
}

/**
 * Y of a position `s` (notehead) on the line with geometry `g`.
 * On a rhythm line, every note is on the line.
 * @param {Layout} L
 * @param {SystemGeom} g
 * @param {number} s
 * @returns {number}
 */
export function yOfStep(L, g, s) {
  return L.rh ? g.line : g.staffBottom - s * HALF_SPACE;
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
