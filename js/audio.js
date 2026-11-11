/**
 * @module audio
 * @description
 * Audio playback with the **Web Audio API**: a small synthesizer and a
 * sequencer.
 *
 * ## Sequencing
 *
 * All the notes of a piece are **scheduled in advance** on the audio clock
 * (`AudioContext.currentTime`), which is sample-accurate and immune to
 * main-thread slowdowns. `setTimeout` is only used for the visual highlight
 * (a slight offset is possible, inaudible) and to detect the end.
 *
 * Only one piece plays at a time: starting playback stops the previous one,
 * starting the same block again stops it (toggle button).
 *
 * ## Synthesis
 *
 * - **Melody** ({@link tone}): sawtooth + triangle → low-pass filter whose
 *   cutoff follows a small envelope (bright attack that softens) → gain with
 *   an attack / decay / release envelope.
 * - **Chords** ({@link pad}): triangle + sine an octave up, softer.
 * - **Percussion** ({@link perc}): sine whose frequency drops very fast
 *   ("clave" effect), accented on the first beat.
 *
 * Browsers only allow sound after a user interaction: the context is
 * created (or resumed) on the first call.
 */

import { staffEvents, staffSegment } from './rhythm.js';
import { resolveMidis } from './pitch.js';
import { mlen, groupStarts } from './model.js';
import { gridPlayOrder, slotDurations } from './grid.js';
import { chordTones } from './chords.js';

/** @type {AudioContext|null} */
let ac = null;

/**
 * Playback in progress.
 * @typedef {Object} Playback
 * @property {string} id Block being played.
 * @property {number[]} timers `setTimeout`s to cancel on stop.
 * @property {AudioScheduledSourceNode[]} nodes Oscillators to cut on stop.
 * @property {function()} onEnd End callback (also called on stop).
 */

/** @type {Playback|null} */
let current = null;

/**
 * Audio context, created on demand and resumed if suspended.
 * @returns {AudioContext|null} `null` if the Web Audio API is missing.
 */
function audioContext() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

/** Frequency (Hz) of a MIDI number (A4 = 69 = 440 Hz). */
const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Plays a melody note.
 * @param {number} t Start time (seconds, audio clock).
 * @param {number} dur Duration (s).
 * @param {number|null} midi
 * @param {AudioScheduledSourceNode[]} [nodes] Collector, to be able to cut.
 */
function tone(t, dur, midi, nodes) {
  const c = audioContext();
  if (!c || midi == null) return;
  const f = freq(midi);
  const o1 = c.createOscillator();
  const o2 = c.createOscillator();
  const lp = c.createBiquadFilter();
  const g = c.createGain();
  const g1 = c.createGain();
  o1.type = 'sawtooth';
  o2.type = 'triangle';
  o1.frequency.value = f;
  o2.frequency.value = f;
  g1.gain.value = 0.35; // the sawtooth is dosed so as not to be harsh
  lp.type = 'lowpass';
  lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(f * 1.5, t);
  lp.frequency.linearRampToValueAtTime(f * 4, t + 0.05);
  lp.frequency.setTargetAtTime(f * 2.2, t + 0.06, 0.15);
  const v = 0.16;
  const end = t + Math.max(0.06, dur * 0.94); // slight detached gap between notes
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.025);
  g.gain.setTargetAtTime(v * 0.75, t + 0.04, 0.12);
  g.gain.setTargetAtTime(0, end, 0.025);
  o1.connect(g1);
  g1.connect(lp);
  o2.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  o1.start(t);
  o2.start(t);
  o1.stop(end + 0.2);
  o2.stop(end + 0.2);
  if (nodes) nodes.push(o1, o2);
}

/**
 * Plays a chart **bass** note (2.8.8), like a plucked double bass.
 *
 * The bass sounds between 82 and 155 Hz, where a phone speaker renders
 * almost nothing. Yet the pitch of a low note is heard through its
 * **harmonics** (the ear rebuilds the missing fundamental): the sound is
 * therefore rich (lightly filtered sawtooth) and doubled by a soft octave,
 * so that the bass movement stays audible even on a small speaker.
 *
 * @param {number} t
 * @param {number} dur
 * @param {number} midi
 * @param {AudioScheduledSourceNode[]} nodes
 */
function bass(t, dur, midi, nodes) {
  const c = audioContext();
  if (!c || midi == null) return;
  const f = freq(midi);
  const o1 = c.createOscillator();
  const o2 = c.createOscillator();
  const g2 = c.createGain();
  const lp = c.createBiquadFilter();
  const g = c.createGain();
  o1.type = 'sawtooth';
  o2.type = 'triangle';
  o1.frequency.value = f;
  o2.frequency.value = f * 2; // octave above: carries the pitch on a small speaker
  g2.gain.value = 0.45;
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(f * 10, t); // clear attack (the "pluck")
  lp.frequency.setTargetAtTime(f * 5, t + 0.03, 0.12);
  const v = 0.2;
  const end = t + Math.max(0.08, dur * 0.92);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.012);
  g.gain.setTargetAtTime(v * 0.55, t + 0.03, 0.18);
  g.gain.setTargetAtTime(0, end, 0.04);
  o1.connect(lp);
  o2.connect(g2);
  g2.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  o1.start(t);
  o2.start(t);
  o1.stop(end + 0.3);
  o2.stop(end + 0.3);
  nodes.push(o1, o2);
}

/**
 * Plays a chord note (pad sound).
 * @param {number} t
 * @param {number} dur
 * @param {number} midi
 * @param {AudioScheduledSourceNode[]} nodes
 */
export function pad(t, dur, midi, nodes) {
  const c = audioContext();
  if (!c) return;
  const f = freq(midi);
  const o = c.createOscillator();
  const o2 = c.createOscillator();
  const lp = c.createBiquadFilter();
  const g = c.createGain();
  o.type = 'triangle';
  o2.type = 'sine';
  o.frequency.value = f;
  o2.frequency.value = f * 2;
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(4000, f * 3);
  const end = t + Math.max(0.1, dur * 0.92);
  const v = 0.075;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.02);
  g.gain.setTargetAtTime(v * 0.55, t + 0.05, 0.25);
  g.gain.setTargetAtTime(0, end, 0.05);
  o.connect(lp);
  o2.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  o.start(t);
  o2.start(t);
  o.stop(end + 0.3);
  o2.stop(end + 0.3);
  nodes.push(o, o2);
}

/**
 * Plays a percussion hit.
 * @param {number} t
 * @param {boolean} accent First beat (higher, louder).
 * @param {AudioScheduledSourceNode[]} [nodes]
 */
function perc(t, accent, nodes) {
  const c = audioContext();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(accent ? 1250 : 950, t);
  o.frequency.exponentialRampToValueAtTime(accent ? 700 : 520, t + 0.06);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.35, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + 0.13);
  if (nodes) nodes.push(o);
}

/**
 * Metronome click: short and high (triangle wave), to stand apart from the
 * lower "tick" of rhythm lines ({@link perc}).
 * @param {number} t Audio time (s).
 * @param {boolean} accent Accented click (higher and louder).
 * @param {AudioScheduledSourceNode[]} [nodes]
 */
function click(t, accent, nodes) {
  const c = audioContext();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(accent ? 2600 : 1900, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.55 : 0.3, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + 0.06);
  if (nodes) nodes.push(o);
}

/**
 * Plays a single staff item (audio feedback while typing).
 * @param {module:model~StaffBlock} b
 * @param {number} i
 */
export function previewItem(b, i) {
  const it = b.items[i];
  if (!it || it.r) return;
  const c = audioContext();
  if (!c) return;
  if (b.clef === 'rhythm') perc(c.currentTime + 0.01, false);
  else tone(c.currentTime + 0.01, 0.38, resolveMidis(b)[i]);
}

/**
 * Is block `id` being played?
 * @param {string} id
 * @returns {boolean}
 */
export function isPlaying(id) {
  return !!current && current.id === id;
}

/**
 * Stops current playback (if any) and calls its end callback.
 */
export function stop() {
  if (!current) return;
  const p = current;
  current = null;
  p.timers.forEach(clearTimeout);
  p.nodes.forEach((n) => {
    try {
      n.stop();
    } catch (e) {
      /* already stopped */
    }
  });
  p.onEnd();
}

/**
 * Playback callbacks.
 * @typedef {Object} PlayCallbacks
 * @property {function(number)} onStep Item (or measure) starting.
 * @property {function()} onEnd End or stop.
 */

/**
 * Prepares playback: stops the previous one, or toggles (stops) if it is the same block.
 * @param {string} id
 * @param {PlayCallbacks} cb
 * @returns {{c: AudioContext, p: Playback}|null} `null` if this block was just stopped.
 */
function begin(id, cb) {
  const was = isPlaying(id);
  stop();
  if (was) return null;
  const c = audioContext();
  if (!c) return null;
  current = { id, timers: [], nodes: [], onEnd: cb.onEnd };
  return { c, p: current };
}

/**
 * Schedules a visual callback at a time of the audio clock.
 * @param {Playback} p
 * @param {AudioContext} c
 * @param {number} t Audio time (s).
 * @param {function()} fn
 */
function at(p, c, t, fn) {
  p.timers.push(setTimeout(fn, Math.max(0, (t - c.currentTime) * 1000)));
}

/**
 * Staff playback options (used by practice).
 * @typedef {Object} PlayOptions
 * @property {boolean} [countIn] One count-in measure (all beats) before starting.
 * @property {?Array.<boolean>} [beats] Metronome: beats of the measure that click
 *   (`[true, false, true, false]` = 1 and 3). Missing: no metronome.
 * @property {boolean} [accent] Accent the first-beat click.
 * @property {boolean} [mute] Do not play the rhythm itself (metronome only);
 *   the highlight still follows playback.
 * @property {boolean} [loop] Replay in a loop until stopped (2.8), with no
 *   new count-in. Each pass lasts a whole number of measures.
 * @property {number} [from] Play from this measure (2.8.4, written index).
 *   See {@link module:rhythm.staffSegment|staffSegment}.
 * @property {number} [to] … up to this measure (included). Missing: to the end.
 */

/** Count-in: every beat clicks. */
const EVERY_BEAT = Array(16).fill(true);

/**
 * Schedules the metronome clicks of `measures` measures from `t0`.
 * One click per group of eighth notes ({@link module:model.groupStarts|groupStarts}):
 * each beat in x/4, each dotted quarter note in x/8, and in 7/8 "2+2+3"
 * three uneven clicks.
 * @param {Playback} p
 * @param {number} t0 Audio time of the start (s).
 * @param {number} measures Number of measures.
 * @param {module:model~StaffBlock} b Time signature and grouping.
 * @param {number} spq Seconds per quarter note.
 * @param {Array.<boolean>} beats Beats that click.
 * @param {boolean} accent
 */
function metronome(p, t0, measures, b, spq, beats, accent) {
  const starts = groupStarts(b);
  const ML = mlen(b.time);
  for (let m = 0; m < measures; m++)
    starts.forEach((q, k) => {
      if (beats[k]) click(t0 + (m * ML + q) * spq, accent && k === 0, p.nodes);
    });
}

/**
 * Plays a staff (play/stop toggle).
 *
 * Events come from {@link module:rhythm.staffEvents|staffEvents} (repeats,
 * ties, triplets and swing already resolved); all that is left is converting
 * quarter notes to seconds: `seconds = quarters × 60 / tempo`.
 *
 * With {@link PlayOptions} (practice): count-in measure, metronome on the
 * chosen beats, muted rhythm.
 *
 * @param {module:model~StaffBlock} b
 * @param {PlayCallbacks} cb
 * @param {PlayOptions} [opt={}]
 */
export function playStaff(b, cb, opt = {}) {
  if (!b.items.length) {
    stop();
    return;
  }
  const r = begin(b.id, cb);
  if (!r) return;
  const { c, p } = r;
  const spq = 60 / (b.tempo || 120); // seconds per quarter note
  const start = c.currentTime + 0.12; // small margin so the 1st note is not cut off
  const bar = mlen(b.time) * spq; // duration of a measure (s)
  if (opt.countIn) metronome(p, start, 1, b, spq, EVERY_BEAT, !!opt.accent);
  let events;
  let total;
  let measures;
  if (opt.from != null) {
    const seg = staffSegment(b, opt.from, opt.to ?? Infinity);
    if (!seg) return stop();
    ({ events, total, measures } = seg);
  } else {
    ({ events, total } = staffEvents(b));
    measures = Math.ceil(total / mlen(b.time) - 1e-9);
  }
  let mark = 0; // audio nodes of the previous pass (see below)
  /** Schedules a full pass from `t0`. */
  const pass = (t0) => {
    // In a loop, forget the nodes from two passes ago (already finished).
    const old = mark;
    mark = p.nodes.length;
    if (opt.beats) metronome(p, t0, measures, b, spq, opt.beats, !!opt.accent);
    events.forEach((ev) => {
      const ts = t0 + ev.start * spq;
      if (!ev.rest && !ev.held && !opt.mute) {
        if (b.clef === 'rhythm') perc(ts, ev.downbeat, p.nodes);
        else tone(ts, (ev.end - ev.start) * spq, ev.midi, p.nodes);
      }
      at(p, c, ts, () => cb.onStep(ev.i));
    });
    p.nodes.splice(0, old);
    mark -= old;
    const end = t0 + measures * mlen(b.time) * spq;
    // Loop: the next pass is scheduled a little before the end, so
    // that it starts right on the measure (no count-in).
    if (opt.loop) at(p, c, end - 0.3, () => current === p && pass(end));
    else at(p, c, t0 + total * spq + 0.15, stop);
  };
  pass(opt.countIn ? start + bar : start);
}

/**
 * Plays a chart (play/stop toggle): bass + pad chords, and a hi-hat on
 * beats 2 and 4 for swing styles.
 *
 * Each measure follows {@link module:grid.gridPlayOrder|gridPlayOrder}; inside
 * it, the slots share the measure according to {@link module:grid.slotDurations|slotDurations}.
 * An empty measure continues the last chord, `%` replays the previous measure.
 *
 * Options (2.8.4): `from` / `to` to play only a part (same rule as
 * {@link module:rhythm.staffSegment|staffSegment}: first pass through `from`,
 * up to the following pass through `to`), `loop`, `countIn`. The chord
 * sounding on an empty slot or a `%` does not depend on the starting point:
 * the start of the chart is walked through silently to find it.
 *
 * @param {module:model~GridBlock} b
 * @param {PlayCallbacks} cb
 * @param {PlayOptions} [opt={}] Only `from`, `to`, `loop` and `countIn` matter here.
 */
export function playGrid(b, cb, opt = {}) {
  if (!b.measures.length) {
    stop();
    return;
  }
  const order = gridPlayOrder(b.measures);
  const k1 = opt.from != null ? order.indexOf(opt.from) : 0;
  if (k1 < 0) return stop();
  let k2 = order.length - 1;
  if (opt.to != null) {
    const k = order.findIndex((m, j) => j >= k1 && m === opt.to);
    if (k >= 0) k2 = k;
  }
  const r = begin(b.id, cb);
  if (!r) return;
  const { c, p } = r;
  const spq = 60 / (b.tempo || 120);
  const ML = mlen(b.time);
  const swingy = /swing|waltz|blues|gospel|ballad/i.test(b.style);
  const start = c.currentTime + 0.15;
  if (opt.countIn) metronome(p, start, 1, b, spq, EVERY_BEAT, false);
  let mark = 0;
  /** Schedules a pass (positions k1 to k2 of the playback order) from `t0`. */
  const pass = (t0) => {
    const old = mark;
    mark = p.nodes.length;
    let q = 0;
    let last = null; // last chord played (for empty slots and empty measures)
    let prevCh = [];
    for (let k = 0; k <= k2; k++) {
      const i = order[k];
      const play = k >= k1; // before the segment: follow the chords without playing
      let ch = b.measures[i].ch;
      if (ch.length === 1 && ch[0] === '%') ch = prevCh;
      else if (!ch.length) ch = last ? [last] : [];
      prevCh = ch;
      const durs = slotDurations(Math.max(1, ch.length), b.time);
      let qq = q;
      ch.forEach((x, j) => {
        const d = durs[j];
        if (x === 'n') last = null;
        else {
          const cc = x === '' ? last : x;
          const tn = cc && chordTones(cc);
          if (tn) {
            last = cc;
            if (play) {
              const ts = t0 + qq * spq;
              bass(ts, Math.min(d * spq, spq * 2), tn.bass, p.nodes);
              tn.notes.forEach((nm) => pad(ts, d * spq, nm, p.nodes));
            }
          }
        }
        qq += d;
      });
      if (!play) continue;
      if (swingy && !b.time.endsWith('/8'))
        for (let bt = 1; bt < ML; bt += 2) perc(t0 + (q + bt) * spq, false, p.nodes);
      at(p, c, t0 + q * spq, () => cb.onStep(i));
      q += ML;
    }
    p.nodes.splice(0, old);
    mark -= old;
    const end = t0 + q * spq;
    if (opt.loop) at(p, c, end - 0.3, () => current === p && pass(end));
    else at(p, c, end + 0.2, stop);
  };
  pass(opt.countIn ? start + ML * spq : start);
}
