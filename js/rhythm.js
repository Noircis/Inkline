/**
 * @module rhythm
 * @description
 * Everything about **time** on a staff, independent of drawing:
 *
 * - splitting into measures ({@link module:rhythm.segmentMeasures|segmentMeasures}),
 * - grouping triplets ({@link module:rhythm.tupletGroups|tupletGroups}),
 * - grouping beams ({@link module:rhythm.beamGroups|beamGroups}),
 * - playback order with repeats ({@link module:rhythm.staffPlayOrder|staffPlayOrder}),
 * - swing ({@link module:rhythm.swingWarp|swingWarp}),
 * - computing the list of sound events ({@link module:rhythm.staffEvents|staffEvents}).
 *
 * These functions are **pure** (no DOM, no side effects): the layout engine,
 * the SVG renderer and the audio player all rely on them, which guarantees
 * they agree with each other. They are covered by `tests/rhythm.test.js`.
 */

import { EPS, snap } from './util.js';
import { qlen, writtenLen, mlen, groupStarts } from './model.js';
import { resolveMidis } from './pitch.js';

/**
 * A measure produced by the split.
 * @typedef {Object} Measure
 * @property {number[]} idx Indices of the measure's items, in order.
 * @property {boolean} full `true` if the measure is closed (full, or closed by a barline).
 * @property {module:model~BarType} [type] Barline closing the measure (`'single'` by default).
 * @property {boolean} rs The measure starts with a start repeat.
 */

/**
 * Splits a sequence of items into measures.
 *
 * Rules, in order:
 * 1. an item marked `rs` (start repeat) always opens a new measure; the
 *    current measure is closed by a single barline;
 * 2. an item carrying a barline (`bar`) closes the measure **even if it is
 *    incomplete**: this is what allows ending a pattern anywhere;
 * 3. otherwise the measure closes when the sum of durations reaches its
 *    capacity.
 *
 * The last measure may stay open (`full: false`): that is where the user
 * adds the next notes.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time Time signature.
 * @returns {Measure[]}
 */
export function segmentMeasures(items, time) {
  const ML = mlen(time);
  /** @type {Measure[]} */
  const measures = [];
  let cur = [];
  let pos = 0;
  items.forEach((it, i) => {
    if (it.rs && cur.length) {
      measures.push({ idx: cur, full: true, type: 'single', rs: false });
      cur = [];
      pos = 0;
    }
    cur.push(i);
    pos = snap(pos + qlen(it));
    if (it.bar) {
      measures.push({ idx: cur, full: true, type: it.bar, rs: false });
      cur = [];
      pos = 0;
    } else if (pos >= ML - EPS) {
      measures.push({ idx: cur, full: true, type: 'single', rs: false });
      cur = [];
      pos = 0;
    }
  });
  if (cur.length) measures.push({ idx: cur, full: false, rs: false });
  // The rs flag is carried by the first item of the measure.
  measures.forEach((m) => {
    m.rs = !!items[m.idx[0]].rs;
  });
  return measures;
}

/**
 * Measure index of each item (inverse table of {@link segmentMeasures}).
 * @param {Measure[]} measures
 * @param {number} count Number of items.
 * @returns {number[]}
 */
function measureOfItem(measures, count) {
  const out = new Array(count).fill(0);
  measures.forEach((m, k) =>
    m.idx.forEach((i) => {
      out[i] = k;
    }),
  );
  return out;
}

/**
 * A triplet group.
 * @typedef {Object} TupletGroup
 * @property {number[]} idx Indices of the group's items.
 * @property {boolean} complete `true` if the group exactly fills its "3 in
 *   the time of 2"; an incomplete group is still drawn, so the user sees a
 *   note is missing.
 */

/**
 * Groups consecutive triplet items into triplets.
 *
 * ## Rule for closing a group
 *
 * A triplet is **3 times the smallest value of the group, played in the time
 * of 2**. So the smallest written duration `min` met so far and the written
 * sum `written` are tracked; the group is complete when `written ≥ 3 × min`.
 *
 * This covers the usual cases:
 * - eighth-eighth-eighth: min = ½, 3 × ½ = 1.5 = sum → complete (lasts 1 quarter)
 * - quarter-eighth: min = ½, 1 + ½ = 1.5 → complete (lasts 1 quarter)
 * - quarter-quarter-quarter: min = 1 → complete on 3 (lasts 2 quarters)
 *
 * A group is also cut, even incomplete, by an item without `tup` or by a
 * barline.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @returns {TupletGroup[]}
 */
export function tupletGroups(items, time) {
  const mOf = measureOfItem(segmentMeasures(items, time), items.length);
  /** @type {TupletGroup[]} */
  const groups = [];
  let cur = null;
  const close = (complete) => {
    if (cur) {
      groups.push({ idx: cur.idx, complete });
      cur = null;
    }
  };
  items.forEach((it, i) => {
    if (!it.tup) {
      close(false);
      return;
    }
    if (cur && mOf[i] !== mOf[cur.idx[0]]) close(false);
    if (!cur) cur = { idx: [], written: 0, min: Infinity };
    cur.idx.push(i);
    cur.written = snap(cur.written + writtenLen(it));
    cur.min = Math.min(cur.min, writtenLen(it));
    if (cur.written >= 3 * cur.min - EPS) close(true);
  });
  close(false);
  return groups;
}

/**
 * For each item, the index of its triplet group, or -1.
 * @param {TupletGroup[]} groups
 * @param {number} count
 * @returns {number[]}
 */
function tupletIndex(groups, count) {
  const out = new Array(count).fill(-1);
  groups.forEach((g, k) =>
    g.idx.forEach((i) => {
      out[i] = k;
    }),
  );
  return out;
}

/**
 * Groups the eighth and sixteenth notes to be joined by a beam.
 *
 * Rules:
 * - only notes (not rests) of eighth or sixteenth value are beamed;
 * - a group does not exceed one **beat** (a quarter in x/4, a dotted quarter in x/8);
 * - a group crosses neither a barline nor a triplet boundary (a triplet of
 *   eighths forms its own beam);
 * - a single-item group is not a beam (the note keeps its flag).
 *
 * Splitting by **line** (system) is not done here: it depends on the layout
 * and is applied by the renderer.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @param {Array.<number>} [meter] Eighth-note grouping (2.8, see {@link module:model.meterGroups|meterGroups}).
 * @returns {number[][]} Index groups (length ≥ 2).
 */
export function beamGroups(items, time, meter) {
  const starts = groupStarts({ time, groups: meter });
  /** Group (beat) containing position `q` of the measure. */
  const end = mlen(time);
  const groupAt = (q) => {
    if (q >= end - EPS) return starts.length + Math.floor(q - end + EPS); // overfull measure
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= q + EPS) k++;
    return k;
  };
  const measures = segmentMeasures(items, time);
  const tIdx = tupletIndex(tupletGroups(items, time), items.length);
  /** @type {number[][]} */
  const groups = [];
  measures.forEach((m) => {
    let pos = 0;
    let cur = [];
    let curKey = null;
    const flush = () => {
      if (cur.length >= 2) groups.push(cur);
      cur = [];
      curKey = null;
    };
    m.idx.forEach((i) => {
      const it = items[i];
      const beat = groupAt(snap(pos));
      // Grouping key: same beat AND same triplet (or outside a triplet).
      const key = tIdx[i] >= 0 ? 't' + tIdx[i] : 'b' + beat;
      if (!it.r && (it.d === '8' || it.d === '16')) {
        if (key !== curKey) flush();
        cur.push(i);
        curKey = key;
      } else {
        flush();
      }
      pos = snap(pos + qlen(it));
    });
    flush();
  });
  return groups;
}

/**
 * Playback order of items, repeats unrolled.
 *
 * Items are walked through while remembering the last start repeat `rs`.
 * On reaching an end repeat (`bar: 'rep'`) for the first time, playback goes
 * back to the start repeat; the second time it continues. The `done` set
 * remembers the end repeats already taken.
 *
 * A guard of 4000 items prevents any infinite loop on inconsistent data.
 *
 * @param {module:model~StaffItem[]} items
 * @returns {number[]} Sequence of indices, possibly with repetitions.
 */
export function staffPlayOrder(items) {
  const order = [];
  let rs = 0;
  const done = new Set();
  for (let i = 0; i < items.length && order.length < 4000; i++) {
    const it = items[i];
    if (it.rs) rs = i;
    order.push(i);
    if (it.bar === 'rep') {
      if (!done.has(i)) {
        done.add(i);
        i = rs - 1;
      } // -1 because the loop does i++
      else rs = i + 1;
    }
  }
  return order;
}

/**
 * Swing time warp (triplet-feel eighths).
 *
 * Within each beat (fractional part `r` of the position in quarter notes),
 * the first half is stretched to 2/3 and the second compressed to 1/3: the
 * offbeat eighth falls at 2/3 of the beat, like a triplet eighth.
 *
 * ```
 * r:   0 ──── 0.5 ──── 1
 * w:   0 ──── 0.667 ── 1
 * ```
 *
 * The function is continuous and monotonic: event order is preserved.
 *
 * @param {number} q Position in quarter notes.
 * @returns {number} Warped position in quarter notes.
 */
export function swingWarp(q) {
  const f = Math.floor(q + 1e-9);
  const r = q - f;
  return f + (r < 0.5 ? (r * 4) / 3 : 2 / 3 + ((r - 0.5) * 2) / 3);
}

/**
 * Beats to play **straight** despite swing: those where a note (outside a
 * triplet) starts or ends somewhere other than on the beat or on the
 * offbeat eighth.
 *
 * Why: {@link swingWarp} is meant for eighth notes. Applied to sixteenths,
 * it made them uneven (1/3, 1/3, 1/6, 1/6 of the beat instead of four equal
 * quarters). In jazz, a sixteenth-note passage in a swing tune is played
 * straight (as in "double time"): only beats written in eighths are swung.
 *
 * @param {module:model~StaffItem[]} items
 * @param {number[]} order Playback order ({@link staffPlayOrder}).
 * @returns {Set.<number>} Indices of the beats (in quarter notes from the start of playback).
 */
function straightBeats(items, order) {
  const out = new Set();
  const onGrid = (t) => {
    const r = t - Math.floor(t + 1e-9);
    return Math.abs(r) < 1e-6 || Math.abs(r - 0.5) < 1e-6 || Math.abs(r - 1) < 1e-6;
  };
  let q = 0;
  order.forEach((i) => {
    const it = items[i];
    const start = q;
    q = snap(q + qlen(it));
    if (it.tup) return;
    if (!onGrid(start)) out.add(Math.floor(start + 1e-9));
    if (!onGrid(q)) out.add(Math.floor(q + 1e-9));
  });
  return out;
}

/**
 * A sound event of a staff, ready to be scheduled by audio.
 * Times are in **quarter notes** from the start; audio converts them to
 * seconds with the tempo.
 *
 * @typedef {Object} StaffEvent
 * @property {number} i Item index (for highlighting during playback).
 * @property {number} start Start in quarter notes (swing applied).
 * @property {number} end End in quarter notes (swing applied; extended by ties).
 * @property {number|null} midi Pitch, `null` for a rest or a rhythm line.
 * @property {boolean} rest Rest.
 * @property {boolean} held Note tied to the previous one: it is **not**
 *   replayed (the previous one is extended), but the event is used for highlighting.
 * @property {boolean} downbeat First beat of the measure (accent on the rhythm line).
 */

/**
 * Builds the list of sound events of a staff.
 *
 * Steps:
 * 1. playback order with repeats ({@link staffPlayOrder});
 * 2. positions in quarter notes by summing the actual durations (triplets
 *    included);
 * 3. ties: if the previous item in playback order is the note right before
 *    in the score and it is tied, its end is extended instead of triggering
 *    a new note;
 * 4. swing: {@link swingWarp} is applied beat by beat, **only to beats
 *    written in eighths** ({@link straightBeats}): a beat containing
 *    sixteenths (or a dot falling on a quarter of a beat) is played
 *    straight. Triplet notes are never warped (already ternary). Swing is
 *    not applied in compound time (x/8).
 *
 * @param {module:model~StaffBlock} b
 * @returns {{events: StaffEvent[], total: number}} Events and total duration in quarter notes.
 */
export function staffEvents(b) {
  const items = b.items;
  const midis = resolveMidis(b);
  const order = staffPlayOrder(items);
  const ML = mlen(b.time);
  const swing = b.swing && !b.time.endsWith('/8');
  const straight = swing ? straightBeats(items, order) : new Set();
  const warp = (t, tup) => (swing && !tup && !straight.has(Math.floor(t + 1e-9)) ? swingWarp(t) : t);
  /** @type {StaffEvent[]} */
  const events = [];
  let q = 0;
  let mpos = 0;
  let lastSounding = null; // last event actually played (for ties)
  order.forEach((i, k) => {
    const it = items[i];
    if (it.rs) mpos = 0;
    const start = q;
    q = snap(q + qlen(it));
    const ev = {
      i,
      start: warp(start, it.tup),
      end: warp(q, it.tup),
      midi: midis[i],
      rest: !!it.r,
      held: false,
      downbeat: mpos < EPS,
    };
    const prevIdx = order[k - 1];
    const prev = items[i - 1];
    if (!it.r && prevIdx === i - 1 && prev && prev.tie && !prev.r && lastSounding) {
      ev.held = true;
      lastSounding.end = ev.end; // extends the previous note
    } else if (!it.r) {
      lastSounding = ev;
    }
    events.push(ev);
    mpos = snap(mpos + qlen(it));
    if (it.bar || mpos >= ML - EPS) mpos = 0;
  });
  return { events, total: warp(q, false) };
}

/**
 * A part of a staff's playback (2.8.4): from measure `from` to measure `to`
 * (written index, from 0).
 *
 * Unrolled playback (repeats included) goes through a sequence of measures,
 * some of them several times. The segment starts at the **first pass**
 * through `from` and stops at the first pass through `to` that follows (a
 * repeat contained in the segment is therefore played unrolled). Times are
 * shifted to the start of the segment.
 *
 * A tied note arriving from before the segment is attacked (otherwise the
 * segment would start with silence).
 *
 * @param {module:model~StaffBlock} b
 * @param {number} from
 * @param {number} to
 * @returns {?{events: StaffEvent[], total: number, measures: number}} `null`
 *   if `from` is never played. `measures`: number of measures in the segment.
 */
export function staffSegment(b, from, to) {
  const { events, total } = staffEvents(b);
  /** Written measure of each item. */
  const mOf = [];
  segmentMeasures(b.items, b.time).forEach((m, mi) => m.idx.forEach((i) => (mOf[i] = mi)));
  // Successive passes through the measures: a new pass starts when the
  // measure changes or playback jumps (repeat).
  const occOf = [];
  const occStart = [];
  const occMeasure = [];
  events.forEach((ev, k) => {
    const prev = events[k - 1];
    if (!prev || mOf[ev.i] !== mOf[prev.i] || ev.i !== prev.i + 1) {
      occMeasure.push(mOf[ev.i]);
      occStart.push(ev.start);
    }
    occOf[k] = occMeasure.length - 1;
  });
  const k1 = occMeasure.indexOf(from);
  if (k1 < 0) return null;
  let k2 = occMeasure.findIndex((m, k) => k >= k1 && m === to);
  if (k2 < 0) k2 = occMeasure.length - 1;
  const t0 = occStart[k1];
  const t1 = k2 + 1 < occStart.length ? occStart[k2 + 1] : total;
  /** @type {StaffEvent[]} */
  const out = [];
  let head = null; // sounding note (to extend ties)
  events.forEach((e, k) => {
    if (occOf[k] < k1 || occOf[k] > k2) return;
    const ev = { ...e, start: e.start - t0, end: Math.min(e.end, t1) - t0 };
    if (ev.held) {
      if (head) head.end = Math.max(head.end, ev.end);
      else ev.held = false; // incoming tie: attack the note
    }
    if (!ev.rest && !ev.held) head = ev;
    if (ev.rest) head = null;
    out.push(ev);
  });
  return { events: out, total: t1 - t0, measures: k2 - k1 + 1 };
}
