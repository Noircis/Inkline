/**
 * @module score
 * @description
 * **Measures of a block with several staves** (2.17), shared by the layout engine and the
 * playback. Pure functions.
 *
 * Each staff is split into measures on its own ({@link module:rhythm.segmentMeasures|segmentMeasures});
 * measure `k` of the block gathers measure `k` of every staff. A staff that stops earlier simply
 * has nothing in the following measures.
 *
 * The system has one barline per measure, whatever the staff it was written on: the strongest
 * one wins (final, then end repeat, then double), and a start repeat on any staff opens the
 * measure for all. That is what the reader sees, and what the playback follows.
 *
 * With a single staff, every result is the one of that staff alone.
 *
 * ## Sound events
 *
 * {@link scoreEvents} turns a block into the list of sounds the audio player schedules: every
 * staff, every note of every chord, repeats unrolled, ties joined, swing applied. Times come from
 * the measures of the block, so the staves stay together even when one of them has an incomplete
 * measure.
 */

import { EPS, snap } from './util.js';
import { qlen } from './model.js';
import { segmentMeasures, swingWarp } from './rhythm.js';
import { resolvePitches } from './pitch.js';
import { partsOf, partView } from './parts.js';

/** Barline strength: the strongest one of a measure is drawn. */
const BAR_RANK = { single: 0, double: 1, rep: 2, final: 3 };

/**
 * One staff's part of a measure.
 * @typedef {Object} PartMeasure
 * @property {number[]} idx Indices of the staff's items in the measure.
 * @property {number[]} on Start of each of those items, in quarter notes from the start of the measure.
 * @property {number} len Duration of the items, in quarter notes.
 * @property {boolean} full The staff closes the measure (full, or closed by a barline).
 */

/**
 * A measure of the block.
 * @typedef {Object} ScoreMeasure
 * @property {Array.<?PartMeasure>} parts One entry per staff, `null` when the staff has nothing there.
 * @property {number} len Duration in quarter notes: the longest of its staves.
 * @property {boolean} full Closed (full, or closed by a barline) on at least one staff.
 * @property {module:model~BarType} [type] Barline closing the measure, when it is closed.
 * @property {boolean} rs Starts with a start repeat.
 */

/**
 * Measures of a block, staves merged (see the module header).
 * @param {module:model~StaffBlock} b
 * @returns {Array.<ScoreMeasure>}
 */
export function scoreMeasures(b) {
  const parts = partsOf(b);
  const split = parts.map((p) => segmentMeasures(p.items, b.time));
  const count = Math.max(...split.map((ms) => ms.length));
  /** @type {Array.<ScoreMeasure>} */
  const out = [];
  for (let k = 0; k < count; k++) {
    /** @type {ScoreMeasure} */
    const sm = { parts: [], len: 0, full: false, rs: false };
    split.forEach((ms, pi) => {
      const m = ms[k];
      if (!m) {
        sm.parts.push(null);
        return;
      }
      const items = parts[pi].items;
      const on = [];
      let q = 0;
      m.idx.forEach((i) => {
        on.push(q);
        q = snap(q + qlen(items[i]));
      });
      sm.parts.push({ idx: m.idx, on, len: q, full: m.full });
      sm.len = Math.max(sm.len, q);
      sm.rs = sm.rs || m.rs;
      if (m.full) {
        sm.full = true;
        const type = m.type || 'single';
        if (!sm.type || BAR_RANK[type] > BAR_RANK[sm.type]) sm.type = type;
      }
    });
    out.push(sm);
  }
  return out;
}

/**
 * Playback order of the measures, repeats unrolled: at an end repeat met for the first time,
 * playback goes back to the last start repeat (or to the start); the second time it goes on.
 * Same rule as {@link module:rhythm.staffPlayOrder|staffPlayOrder}, measure by measure.
 * @param {Array.<ScoreMeasure>} measures
 * @returns {number[]} Measure indices, possibly repeated.
 */
export function scorePlayOrder(measures) {
  const order = [];
  let rs = 0;
  const done = new Set();
  for (let k = 0; k < measures.length && order.length < 4000; k++) {
    const m = measures[k];
    if (m.rs) rs = k;
    order.push(k);
    if (m.type === 'rep') {
      if (!done.has(k)) {
        done.add(k);
        k = rs - 1; // the loop adds 1
      } else rs = k + 1;
    }
  }
  return order;
}

/**
 * Where the next note of staff `k` would start: the measure, and the position in it.
 * @param {Array.<ScoreMeasure>} measures
 * @param {number} k Staff index.
 * @param {number} ML Capacity of a measure.
 * @returns {{m: number, on: number}}
 */
export function partEnd(measures, k, ML) {
  for (let m = measures.length - 1; m >= 0; m--) {
    const pm = measures[m].parts[k];
    if (!pm) continue;
    return pm.full || pm.len >= ML - EPS ? { m: m + 1, on: 0 } : { m, on: pm.len };
  }
  return { m: 0, on: 0 };
}

/**
 * A sound event, ready to be scheduled by audio. Times are in **quarter notes** from the start;
 * audio converts them to seconds with the tempo.
 *
 * @typedef {Object} ScoreEvent
 * @property {number} k Staff index.
 * @property {number} i Item index in its staff (for highlighting during playback).
 * @property {number} pass Index of the measure in the playback order ({@link scorePlayOrder}).
 * @property {number} start Start in quarter notes (swing applied).
 * @property {number} end End in quarter notes (swing applied; extended by ties).
 * @property {?number} midi Pitch of the item's own note, `null` for a rest or a rhythm line.
 * @property {Array.<number>} midis Every pitch of the item (a chord has several), empty for a rest
 *   or a rhythm line.
 * @property {boolean} rest Rest.
 * @property {boolean} held Note tied to the previous one: it is **not** replayed (the previous one
 *   is extended), but the event is used for highlighting.
 * @property {boolean} downbeat First beat of the measure (accent on the rhythm line).
 */

/**
 * A measure as played: its index and when it starts (quarter notes, swing applied).
 * @typedef {Object} ScorePass
 * @property {number} m
 * @property {number} start
 */

/**
 * Beats to play **straight** despite swing: those where a note (outside a triplet), on any staff,
 * starts or ends somewhere other than on the beat or on the offbeat eighth.
 *
 * Why: {@link module:rhythm.swingWarp|swingWarp} is meant for eighth notes. Applied to
 * sixteenths, it made them uneven (1/3, 1/3, 1/6, 1/6 of the beat instead of four equal
 * quarters). In jazz, a sixteenth-note passage in a swing tune is played straight (as in "double
 * time"): only beats written in eighths are swung.
 *
 * @param {Array.<{start: number, end: number, tup: boolean}>} notes
 * @returns {Set.<number>} Indices of the beats (in quarter notes from the start of playback).
 */
function straightBeats(notes) {
  const out = new Set();
  const onGrid = (t) => {
    const r = t - Math.floor(t + 1e-9);
    return Math.abs(r) < 1e-6 || Math.abs(r - 0.5) < 1e-6 || Math.abs(r - 1) < 1e-6;
  };
  notes.forEach((n) => {
    if (n.tup) return;
    if (!onGrid(n.start)) out.add(Math.floor(n.start + 1e-9));
    if (!onGrid(n.end)) out.add(Math.floor(n.end + 1e-9));
  });
  return out;
}

/**
 * Builds the list of sound events of a block.
 *
 * Steps:
 * 1. playback order of the measures, repeats unrolled ({@link scorePlayOrder}), and the start of
 *    each pass: the sum of the durations of the measures before it;
 * 2. every item of every staff, at the start of its pass plus its place in the measure;
 * 3. ties, staff by staff: if the item played just before on the same staff is the one right
 *    before in the score and it is tied, its end is extended instead of triggering a new note;
 * 4. swing: {@link module:rhythm.swingWarp|swingWarp} is applied beat by beat, **only to beats
 *    written in eighths** ({@link straightBeats}). Triplet notes are never warped (already
 *    ternary). Swing is not applied in compound time (x/8).
 *
 * @param {module:model~StaffBlock} b
 * @returns {{events: Array.<ScoreEvent>, total: number, passes: Array.<ScorePass>}} Events sorted by
 *   start, total duration in quarter notes, and the measures as played.
 */
export function scoreEvents(b) {
  const parts = partsOf(b);
  const measures = scoreMeasures(b);
  const order = scorePlayOrder(measures);
  const pitches = parts.map((_, k) => resolvePitches(partView(b, k)));

  // Step 1: start of each pass.
  const passStart = [];
  let total = 0;
  order.forEach((m) => {
    passStart.push(total);
    total = snap(total + measures[m].len);
  });

  // Step 2: every item, staff by staff within each pass (so each staff stays in time order).
  const raw = [];
  order.forEach((m, pass) => {
    measures[m].parts.forEach((pm, k) => {
      if (!pm) return;
      pm.idx.forEach((i, j) => {
        const it = parts[k].items[i];
        const start = snap(passStart[pass] + pm.on[j]);
        raw.push({
          k,
          i,
          pass,
          it,
          start,
          end: snap(start + qlen(it)),
          tup: !!it.tup,
          downbeat: pm.on[j] < EPS,
        });
      });
    });
  });

  // Step 4 prepared: the warp of a time.
  const swing = b.swing && !b.time.endsWith('/8');
  const straight = swing ? straightBeats(raw) : new Set();
  const warp = (t, tup) => (swing && !tup && !straight.has(Math.floor(t + 1e-9)) ? swingWarp(t) : t);

  // Step 3: events and ties.
  const lastIdx = parts.map(() => -2); // item played last on each staff
  const sounding = parts.map(() => null); // note actually played last on each staff
  /** @type {Array.<ScoreEvent>} */
  const events = raw.map((r) => {
    const items = parts[r.k].items;
    const midis = pitches[r.k][r.i];
    /** @type {ScoreEvent} */
    const ev = {
      k: r.k,
      i: r.i,
      pass: r.pass,
      start: warp(r.start, r.tup),
      end: warp(r.end, r.tup),
      midi: midis.length ? midis[0] : null,
      midis,
      rest: !!r.it.r,
      held: false,
      downbeat: r.downbeat,
    };
    const prev = items[r.i - 1];
    if (!ev.rest && lastIdx[r.k] === r.i - 1 && prev && prev.tie && !prev.r && sounding[r.k]) {
      ev.held = true;
      sounding[r.k].end = ev.end; // extends the previous note
    } else if (!ev.rest) {
      sounding[r.k] = ev;
    }
    lastIdx[r.k] = r.i;
    return ev;
  });
  events.sort((p, q) => p.start - q.start || p.k - q.k);
  return {
    events,
    total: warp(total, false),
    passes: order.map((m, pass) => ({ m, start: warp(passStart[pass], false) })),
  };
}

/**
 * A part of a block's playback (2.8.4): from measure `from` to measure `to` (written index, from 0).
 *
 * Unrolled playback (repeats included) goes through a sequence of measures, some of them several
 * times. The segment starts at the **first pass** through `from` and stops at the first pass
 * through `to` that follows (a repeat contained in the segment is therefore played unrolled).
 * Times are shifted to the start of the segment.
 *
 * A tied note arriving from before the segment is attacked (otherwise the segment would start with
 * silence).
 *
 * @param {module:model~StaffBlock} b
 * @param {number} from
 * @param {number} to
 * @returns {?{events: Array.<ScoreEvent>, total: number, measures: number}} `null` if `from` is never
 *   played. `measures`: number of measures in the segment.
 */
export function scoreSegment(b, from, to) {
  const { events, total, passes } = scoreEvents(b);
  const k1 = passes.findIndex((p) => p.m === from);
  if (k1 < 0) return null;
  let k2 = passes.findIndex((p, k) => k >= k1 && p.m === to);
  if (k2 < 0) k2 = passes.length - 1;
  const t0 = passes[k1].start;
  const t1 = k2 + 1 < passes.length ? passes[k2 + 1].start : total;
  /** @type {Array.<ScoreEvent>} */
  const out = [];
  const head = new Map(); // sounding note of each staff (to extend ties)
  events.forEach((e) => {
    if (e.pass < k1 || e.pass > k2) return;
    const ev = { ...e, start: e.start - t0, end: Math.min(e.end, t1) - t0 };
    if (ev.held) {
      const h = head.get(ev.k);
      if (h) h.end = Math.max(h.end, ev.end);
      else ev.held = false; // incoming tie: attack the note
    }
    if (!ev.rest && !ev.held) head.set(ev.k, ev);
    if (ev.rest) head.delete(ev.k);
    out.push(ev);
  });
  return { events: out, total: t1 - t0, measures: k2 - k1 + 1 };
}

/**
 * Gives every staff the barline of one measure (2.17): the barline closing the measure that
 * holds item `i` of staff `k`, and its start repeat, are copied to that measure on every other
 * staff that has notes there. A barline belongs to the system: changing it on one staff changes it
 * on all.
 * @param {module:model~StaffBlock} b
 * @param {number} k Staff where the barline was changed.
 * @param {number} i An item of the measure.
 */
export function shareBarline(b, k, i) {
  const parts = partsOf(b);
  if (parts.length < 2 || !parts[k]) return;
  const own = segmentMeasures(parts[k].items, b.time);
  const mi = own.findIndex((m) => m.idx.includes(i));
  if (mi < 0) return;
  const first = parts[k].items[own[mi].idx[0]];
  const last = parts[k].items[own[mi].idx[own[mi].idx.length - 1]];
  parts.forEach((p, j) => {
    const m = j === k ? null : segmentMeasures(p.items, b.time)[mi];
    if (!m) return;
    const f = p.items[m.idx[0]];
    const l = p.items[m.idx[m.idx.length - 1]];
    if (last.bar) l.bar = last.bar;
    else delete l.bar;
    if (first.rs) f.rs = true;
    else delete f.rs;
  });
}
