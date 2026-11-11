/**
 * @module measure-fit
 * @description
 * **Automatic fitting into measures** (since 2.6). Pure functions.
 *
 * ## The problem
 *
 * Inkline stores a staff as a **sequence of items**; barlines place
 * themselves ({@link module:rhythm.segmentMeasures|segmentMeasures}). A note
 * can therefore "overflow" its measure: quarter, quarter, whole note in 4/4.
 * Correct engraving splits the whole note at the barline and ties the two
 * pieces:
 *
 * ```
 * quarter quarter whole   →   quarter quarter half⁀ | half
 * ```
 *
 * ## Logical notes and automatic ties
 *
 * The pieces created by this split are marked `auto: true` ("this piece
 * continues into the next item"); for a note, they also carry `tie: true`,
 * which is enough for drawing and audio. A sequence of `auto` pieces forms a
 * **logical note** ({@link module:measure-fit~eventsOf|eventsOf}). Ties placed
 * by the user have no `auto`: they are never touched.
 *
 * After each change, {@link module:measure-fit.normalizeStaff|normalizeStaff}
 * **glues** the logical notes back together then **re-splits** them at the
 * current barlines: inserting a note at the start shifts every barline, and
 * the split follows. A note that crosses no barline stays written as the
 * user wanted (syncopations included): splitting only happens at barlines.
 *
 * ## Compensating with rests (Edit mode)
 *
 * {@link module:measure-fit.resizeEvent|resizeEvent} changes a note's
 * duration while keeping what follows in place, as MuseScore does:
 * - shortening adds a rest for the difference (quarter → eighth + eighth rest);
 * - lengthening first **eats** the rests that follow; if there are not
 *   enough, what follows shifts (and the barlines are re-split).
 *
 * ## Writing durations
 *
 * Any duration is written with the usual values
 * ({@link module:measure-fit.decompose|decompose}): each time, the largest
 * value that fits and lands "right" is taken (a half note starts on an even
 * beat, a quarter note on a beat…). Dots are allowed for notes; for rests,
 * only in compound time (6/8, 12/8).
 *
 * Triplets are never split or glued.
 */

import { EPS, snap } from './util.js';
import { DUR, qlen, mlen, beatUnit } from './model.js';

/** Smallest written value (sixteenth note), in quarter notes. */
const GRID = Math.min(...Object.values(DUR));

/** Simple values, from longest to shortest. */
const PLAIN = Object.entries(DUR)
  .map(([d, v]) => ({ d, v }))
  .sort((a, b) => b.v - a.v);

/**
 * A logical note: a single item, or a sequence of `auto` pieces.
 * @typedef {Object} FitEvent
 * @property {module:model~StaffItem[]} orig Original pieces (copies).
 * @property {number} len Total duration in quarter notes.
 * @property {boolean} rest Rest.
 * @property {boolean} tup Contains a triplet (never split).
 * @property {boolean} [gen] Computed duration: to be rewritten (no original pieces to keep).
 * @property {number} from Index of the first piece in the original sequence (-1 if created).
 */

/**
 * Is `x` a multiple of `a` (up to rounding)?
 * @param {number} x
 * @param {number} a
 * @returns {boolean}
 */
function isMult(x, a) {
  const r = x / a;
  return Math.abs(r - Math.round(r)) < 1e-6;
}

/**
 * Single value (with optional dot) for a duration, if one exists.
 * @example
 * singleValue(3, true)   // { d: 'h', dot: true }
 * singleValue(2.5, true) // null
 * @param {number} len Duration in quarter notes.
 * @param {boolean} allowDot
 * @returns {?{d: string, dot: boolean}}
 */
export function singleValue(len, allowDot) {
  for (const p of PLAIN) {
    if (Math.abs(p.v - len) < EPS) return { d: p.d, dot: false };
    if (allowDot && Math.abs(p.v * 1.5 - len) < EPS) return { d: p.d, dot: true };
  }
  return null;
}

/**
 * Writes a duration with the usual values, from a position in the measure.
 *
 * "Aligned" greedy algorithm: at each step, the largest value that fits in
 * what is left and lands right:
 * - a value of one beat or more starts on a beat (for rests, more strictly,
 *   on a multiple of itself: a half rest in 4/4 on 1 or 3, never on 2, so
 *   that the middle of the measure stays readable);
 * - a value shorter than a beat starts on a multiple of itself (of twice its
 *   simple value if it is dotted: a dotted eighth on the beat, not on the
 *   offbeat) and does not spill into the next beat: the current beat is
 *   completed before moving on.
 *
 * Failing that, the largest simple value that fits.
 *
 * @example
 * decompose(0.5, 1.5, false) // eighth then quarter: [{d:'8'}, {d:'q'}]
 * decompose(1, 3, true)      // dotted half on the 2nd beat
 * @param {number} start Start position in the measure (quarter notes).
 * @param {number} len Duration to write (quarter notes).
 * @param {boolean} allowDot
 * @param {number} [beat=1] Duration of a beat in quarter notes (1.5 in 6/8).
 * @param {boolean} [rest=false] Write rests (strict alignment).
 * @returns {?Array.<{d: string, dot: boolean}>} `null` if the duration cannot
 *   be expressed (remainder smaller than a sixteenth, for example after a triplet).
 */
export function decompose(start, len, allowDot, beat = 1, rest = false) {
  /** @type {Array.<{d: string, dot: boolean, v: number, b: number}>} */
  const cands = [];
  PLAIN.forEach((p) => {
    if (allowDot) cands.push({ d: p.d, dot: true, v: p.v * 1.5, b: p.v });
    cands.push({ d: p.d, dot: false, v: p.v, b: p.v });
  });
  cands.sort((a, b) => b.v - a.v);
  const out = [];
  let s = start;
  let rem = len;
  for (let guard = 0; rem > EPS && guard < 64; guard++) {
    const fits = (c) => c.v <= rem + EPS;
    const aligned = (c) =>
      c.v >= beat - EPS
        ? isMult(s, rest ? c.v : beat)
        : isMult(s, c.dot ? 2 * c.b : c.b) &&
          Math.floor(s / beat + 1e-9) === Math.floor((s + c.v) / beat - 1e-9);
    const pick = cands.find((c) => fits(c) && aligned(c)) || cands.find((c) => fits(c) && !c.dot);
    if (!pick) return null;
    out.push({ d: pick.d, dot: pick.dot });
    s = snap(s + pick.v);
    rem = snap(rem - pick.v);
  }
  return rem > EPS ? null : out;
}

/**
 * Groups items into logical notes.
 * @param {module:model~StaffItem[]} items
 * @returns {FitEvent[]}
 */
function eventsOf(items) {
  const out = [];
  for (let i = 0; i < items.length; ) {
    let j = i;
    while (items[j].auto && j + 1 < items.length && !items[j].tup) j++;
    const orig = items.slice(i, j + 1).map((it) => ({ ...it }));
    out.push({
      orig,
      len: snap(orig.reduce((t, it) => t + qlen(it), 0)),
      rest: !!orig[0].r,
      tup: orig.some((it) => it.tup),
      from: i,
    });
    i = j + 1;
  }
  return out;
}

/**
 * First piece of the logical note containing item `i`.
 * @param {module:model~StaffItem[]} items
 * @param {number} i
 * @returns {number}
 */
export function chainStart(items, i) {
  while (i > 0 && items[i - 1] && items[i - 1].auto) i--;
  return i;
}

/**
 * Last piece of the logical note containing item `i`.
 * @param {module:model~StaffItem[]} items
 * @param {number} i
 * @returns {number}
 */
export function chainEnd(items, i) {
  while (items[i] && items[i].auto && i + 1 < items.length) i++;
  return i;
}

/**
 * Properties of a piece, apart from duration and links.
 * @param {module:model~StaffItem} it
 * @param {boolean} first First piece (keeps accidental, chord, start repeat).
 * @returns {Object}
 */
function baseProps(it, first) {
  // eslint-disable-next-line no-unused-vars
  const { d, dot, tie, auto, bar, a, c, rs, ...rest } = it;
  const out = { ...rest };
  if (first) {
    if (a != null) out.a = a;
    if (c) out.c = c;
    if (rs) out.rs = true;
  }
  return out;
}

/**
 * Splits a duration at barlines.
 * @param {number} pos Start position in the measure.
 * @param {number} len Duration.
 * @param {number} ML Capacity of the measure.
 * @returns {{segs: Array.<{start: number, len: number}>, end: number}} Segments, and
 *   position in the measure after the last one.
 */
function cutAtBars(pos, len, ML) {
  const segs = [];
  let p = pos;
  let rem = len;
  while (rem > EPS) {
    const take = Math.min(rem, ML - p);
    segs.push({ start: p, len: take });
    p = snap(p + take);
    rem = snap(rem - take);
    if (p >= ML - EPS) p = 0;
  }
  return { segs, end: p };
}

/**
 * Written values of a logical note split into segments: a single value if
 * it fits in one segment and is written with one sign, otherwise the usual
 * values of each segment ({@link decompose}).
 * @param {FitEvent} ev
 * @param {Array.<{start: number, len: number}>} segs
 * @param {{beat: number, compound: boolean}} ctx
 * @returns {?Array.<{d: string, dot: boolean}>} `null` if a segment cannot be written.
 */
function valuesFor(ev, segs, ctx) {
  const allowDot = !ev.rest || ctx.compound;
  if (segs.length === 1) {
    const one = singleValue(ev.len, allowDot);
    if (one) return [one];
  }
  const vals = segs.map((sg) => decompose(sg.start, sg.len, allowDot, ctx.beat, ev.rest));
  return vals.some((v) => !v) ? null : vals.flat();
}

/**
 * Pieces of a logical note from its values: tied together (`auto`, and
 * `tie` for a note); accidental, chord and start repeat on the first; the
 * user's tie and barline on the last.
 * @param {FitEvent} ev
 * @param {Array.<{d: string, dot: boolean}>} vals
 * @returns {module:model~StaffItem[]}
 */
function piecesFrom(ev, vals) {
  const first = ev.orig[0];
  const last = ev.orig[ev.orig.length - 1];
  return vals.map((v, k) => {
    const piece = { ...baseProps(first, k === 0), d: v.d };
    if (v.dot) piece.dot = true;
    if (k < vals.length - 1) {
      piece.auto = true;
      if (!ev.rest) piece.tie = true;
    } else {
      if (last.tie && !last.auto && !ev.rest) piece.tie = true;
      if (last.bar) piece.bar = last.bar;
    }
    return piece;
  });
}

/**
 * Rewrites a sequence of logical notes as items, split at barlines.
 *
 * For each logical note:
 * 1. a triplet, or a single note that fits in its measure, is **kept as is**
 *    (the user's writing is respected);
 * 2. otherwise, it is split at barlines ({@link cutAtBars}) and rewritten
 *    with usual values ({@link valuesFor}, {@link piecesFrom});
 * 3. if that is not possible (duration off the sixteenth-note grid), an
 *    original note is kept as is; a computed rest is written in one block,
 *    without a split, rather than losing its duration.
 *
 * The position in the measure follows the rules of
 * {@link module:rhythm.segmentMeasures|segmentMeasures} (a start repeat and
 * a manual barline reset the counter).
 *
 * @param {FitEvent[]} events
 * @param {string} time
 * @returns {{items: module:model~StaffItem[], starts: number[], tupCross: Set.<number>}}
 *   `starts[k]`: index of the first piece of event k; `tupCross`: indices of
 *   triplets crossing a barline.
 */
function materialize(events, time) {
  const ML = mlen(time);
  const ctx = { beat: beatUnit(time), compound: time.endsWith('/8') };
  const items = [];
  const starts = [];
  const tupCross = new Set();
  let pos = 0;

  /** Appends items as they are, tracking the position in the measure. */
  const keep = (list) => {
    list.forEach((it) => {
      const end = snap(pos + qlen(it));
      if (it.tup && end > ML + EPS) tupCross.add(items.length);
      items.push({ ...it });
      pos = it.bar || end >= ML - EPS ? 0 : end;
    });
  };

  events.forEach((ev) => {
    if (ev.orig[0].rs) pos = 0;
    starts.push(items.length);
    if (ev.tup) return keep(ev.orig);
    const { segs, end } = cutAtBars(pos, ev.len, ML);
    if (segs.length === 1 && ev.orig.length === 1 && !ev.gen) return keep(ev.orig);
    const vals = valuesFor(ev, segs, ctx);
    if (vals) {
      items.push(...piecesFrom(ev, vals));
      pos = ev.orig[ev.orig.length - 1].bar ? 0 : end;
      return;
    }
    if (!ev.gen) return keep(ev.orig);
    const whole = decompose(0, ev.len, !ev.rest || ctx.compound, ctx.beat, ev.rest);
    if (whole) keep(piecesFrom(ev, whole));
  });
  return { items, starts, tupCross };
}

/**
 * Fits a staff back into measures: glues the logical notes back together and
 * re-splits them at the current barlines. With no overflow and no automatic
 * piece, the staff is returned unchanged.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @returns {{items: module:model~StaffItem[], startOf: number[], tupCross: Set.<number>}}
 *   `startOf[i]`: new index of the first piece of the logical note that
 *   contained old item `i` (and `startOf[items.length]` = new length).
 */
export function normalizeStaff(items, time) {
  const events = eventsOf(items);
  const res = materialize(events, time);
  const startOf = new Array(items.length + 1);
  events.forEach((ev, k) => {
    for (let i = ev.from; i < ev.from + ev.orig.length; i++) startOf[i] = res.starts[k];
  });
  startOf[items.length] = res.items.length;
  return { items: res.items, startOf, tupCross: res.tupCross };
}

/**
 * Changes the duration of the logical note containing item `i`, keeping
 * what follows in place when possible (see the module header).
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @param {number} i A piece of the note to change.
 * @param {{d: string, dot: (boolean|undefined), tup: (boolean|undefined)}} value New value.
 * @returns {{items: module:model~StaffItem[], index: number, tupCross: Set.<number>}}
 *   `index`: new index of the first piece of the changed note.
 */
export function resizeEvent(items, time, i, value) {
  const events = eventsOf(items);
  const k = events.findIndex((ev) => i >= ev.from && i < ev.from + ev.orig.length);
  const ev = events[k];
  const first = ev.orig[0];
  const last = ev.orig[ev.orig.length - 1];
  const single = { ...baseProps(first, true), d: value.d };
  if (value.dot) single.dot = true;
  if (value.tup) single.tup = 3;
  if (last.tie && !last.auto && !single.r) single.tie = true;
  if (last.bar) single.bar = last.bar;
  const oldLen = ev.len;
  const newLen = qlen(single);
  events[k] = { orig: [single], len: newLen, rest: !!single.r, tup: !!single.tup, from: ev.from };

  // No compensation when the difference cannot be written with simple values
  // (triplet before or after, or less than a sixteenth: sixteenth ⇄
  // dotted sixteenth, 1/8 of a beat). What follows then shifts, and the
  // inverse operation brings it back: nothing accumulates.
  if (!ev.tup && !value.tup) {
    const diff = snap(oldLen - newLen);
    if (diff > EPS && isMult(diff, GRID)) {
      // Shortening: a rest fills the difference. The manual barline and any
      // tie move after it (the tie no longer makes sense).
      const restItem = { d: (singleValue(diff, false) || { d: 'q' }).d, r: true }; // template: rewritten (gen)
      if (single.bar) {
        restItem.bar = single.bar;
        delete single.bar;
      }
      delete single.tie;
      events.splice(k + 1, 0, { orig: [restItem], len: diff, rest: true, tup: false, gen: true, from: -1 });
    } else if (diff < -EPS && isMult(-diff, GRID)) {
      // Lengthening: eat the rests that follow.
      let extra = -diff;
      const j = k + 1;
      while (extra > EPS && events[j] && events[j].rest && !events[j].tup && !events[j].orig[0].rs) {
        const r = events[j];
        const rLast = r.orig[r.orig.length - 1];
        if (r.len <= extra + EPS) {
          extra = snap(extra - r.len);
          events.splice(j, 1);
          if (rLast.bar) {
            single.bar = rLast.bar; // the barline that closed the rest now closes the note
            break;
          }
        } else {
          // A rest is only cut into if its remainder can be written (multiple of a
          // sixteenth); otherwise stop there and what follows shifts.
          if (!isMult(snap(r.len - extra), GRID)) break;
          r.len = snap(r.len - extra);
          r.gen = true;
          extra = 0;
        }
      }
    }
  }
  const res = materialize(events, time);
  return { items: res.items, index: res.starts[k], tupCross: res.tupCross };
}
