/**
 * @module metronome
 * @description
 * **Metronome** (2.11): settings, validation and the sounds of one cycle.
 * Pure functions, tested under Node. The audio engine is
 * {@link module:metro-engine|metro-engine}, the interface
 * {@link module:ui/metronome|ui/metronome}.
 *
 * ## Beats and tempo
 *
 * A bar is split into **beats** following the eighth-note groups of its time
 * signature ({@link METRO_METERS}): 4 beats in 4/4, 2 in
 * 6/8, 3 uneven beats in 7/8 "2+2+3". The tempo counts the usual beat unit:
 *
 * | Time signatures       | Tempo counts         |
 * |-----------------------|----------------------|
 * | x/4 (simple)          | quarter notes        |
 * | 6/8, 9/8, 12/8, 3/8   | dotted quarter notes |
 * | 5/8, 7/8 (odd)        | eighth notes         |
 *
 * ## One cycle
 *
 * The engine plays one pre-rendered **cycle** in a loop: one bar, or two in
 * the "every other bar" jazz mode (the second bar is silent).
 * {@link cycleEvents} lists its sounds (beats and subdivisions) with their
 * times, and the beat starts used by the lights.
 *
 * ## Accents and jazz modes
 *
 * Each beat has a level: 2 strong, 1 normal, 0 muted. The jazz modes replace
 * these levels while they are on:
 * - **2 and 4**: only beats 2 and 4 click (even x/4 time signatures only);
 * - **once per bar**: a single beat clicks (beat 1 by default), optionally
 *   every other bar only.
 *
 * Subdivisions keep playing on muted beats (they give the grid); a silent bar
 * of the "every other bar" mode is fully silent.
 */

import { METERS, meter } from './placements.js';

/**
 * Time signatures of the metronome: those of the practice screens, plus 6/4
 * and 7/4 (2.11.1).
 * @type {ReadonlyArray.<module:placements~Meter>}
 */
export const METRO_METERS = Object.freeze([
  ...METERS.slice(0, 4),
  meter('6/4', [2, 2, 2, 2, 2, 2]),
  meter('7/4', [2, 2, 2, 2, 2, 2, 2]),
  ...METERS.slice(4),
]);

/**
 * Metronome time signature from its key (4/4 if unknown).
 * @param {string} key
 * @returns {module:placements~Meter}
 */
export function meterOf(key) {
  return METRO_METERS.find((m) => m.key === key) || METRO_METERS[0];
}

/** Tempo bounds (beats per minute). */
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 400;

/** Click sounds. Labels: `metro.sound.*` keys. */
export const SOUNDS = Object.freeze(['click', 'wood', 'cowbell', 'rim', 'hat']);

/**
 * Subdivisions: `none`, eighths, triplets, sixteenths, dotted eighth +
 * sixteenth. Labels: `metro.sub.*` keys.
 */
export const SUBDIVS = Object.freeze(['none', '8', '3', '16', '8.16']);

/** Swing bounds (%): position of the offbeat eighth within the beat. */
export const SWING_MIN = 50;
export const SWING_MAX = 75;

/** Jazz modes. */
export const JAZZ = Object.freeze(['off', '24', 'once']);

/** Maximum number of presets, and of characters in a preset name. */
export const PRESETS_MAX = 50;
export const PRESET_NAME_MAX = 40;

/**
 * Metronome settings.
 * @typedef {Object} MetroSettings
 * @property {number} tempo Beats per minute ({@link TEMPO_MIN} to {@link TEMPO_MAX}).
 * @property {string} meter Key of {@link METRO_METERS}.
 * @property {Array.<number>} accents Level of each beat: 2 strong, 1 normal, 0 muted.
 * @property {string} subdiv One of {@link SUBDIVS}.
 * @property {number} subVol Subdivision volume, 0 to 1.
 * @property {number} swing Offbeat eighth position (%), {@link SWING_MIN} to {@link SWING_MAX}.
 * @property {string} sound One of {@link SOUNDS}.
 * @property {string} jazz One of {@link JAZZ}.
 * @property {number} onceBeat Beat that clicks in "once per bar" mode (from 0).
 * @property {boolean} twoBars "Once per bar" mode: every other bar only.
 * @property {boolean} vibrate Vibrate on each audible beat.
 * @property {boolean} flash Full-screen flash on each audible beat.
 * @property {boolean} wake Keep the screen on while playing.
 */

/**
 * Default accents: beat 1 strong, the others normal.
 * @param {number} n Number of beats.
 * @returns {Array.<number>}
 */
export function defaultAccents(n) {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 2 : 1));
}

/** Default settings. */
export const METRO_DEFAULTS = Object.freeze({
  tempo: 120,
  meter: '4/4',
  accents: Object.freeze(defaultAccents(4)),
  subdiv: 'none',
  subVol: 0.6,
  swing: 50,
  sound: 'click',
  jazz: 'off',
  onceBeat: 0,
  twoBars: false,
  vibrate: false,
  flash: false,
  wake: true,
});

/**
 * Number of beats of a time signature.
 * @param {string} key
 * @returns {number}
 */
export function beatsOf(key) {
  return meterOf(key).groups.length;
}

/**
 * Beat unit counted by the tempo (see the module header).
 * @param {string} key Time signature key.
 * @returns {'q'|'q.'|'8'}
 */
export function beatUnit(key) {
  const m = meterOf(key);
  return m.kind === 'simple' ? 'q' : m.kind === 'compound' ? 'q.' : '8';
}

/** Glyph of each beat unit (music font). */
export const UNIT_GLYPHS = Object.freeze({ q: '♩', 'q.': '♩.', 8: '♪' });

/**
 * Subdivisions offered for a time signature: all of them in simple time,
 * eighths and sixteenths otherwise (beats of 2 or 3 eighths).
 * @param {string} key
 * @returns {Array.<string>}
 */
export function subdivsFor(key) {
  return meterOf(key).kind === 'simple' ? SUBDIVS.slice() : ['none', '8', '16'];
}

/**
 * Is the "2 and 4" mode possible? Simple time with an even number of beats.
 * @param {string} key
 * @returns {boolean}
 */
export function canTwoFour(key) {
  const m = meterOf(key);
  return m.kind === 'simple' && m.groups.length % 2 === 0;
}

/**
 * Does swing apply? Eighth subdivisions in simple time.
 * @param {MetroSettings} s
 * @returns {boolean}
 */
export function swingApplies(s) {
  return s.subdiv === '8' && meterOf(s.meter).kind === 'simple';
}

/**
 * Clamps and rounds a tempo.
 * @param {number} bpm
 * @returns {number}
 */
export function clampTempo(bpm) {
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(bpm)));
}

/** Italian tempo markings, with their lower bound (BPM). */
const MARKINGS = [
  [200, 'Prestissimo'],
  [168, 'Presto'],
  [120, 'Allegro'],
  [108, 'Moderato'],
  [76, 'Andante'],
  [66, 'Adagio'],
  [40, 'Largo'],
  [0, 'Grave'],
];

/**
 * Italian tempo marking of a tempo (the same in every language).
 * @param {number} bpm
 * @returns {string}
 */
export function tempoMarking(bpm) {
  return MARKINGS.find(([min]) => bpm >= min)[1];
}

/**
 * Tap tempo: adds a tap and computes the tempo from the last 4 taps (3
 * intervals). A pause of more than 2 s starts a new series.
 *
 * @example
 * let r = tapTempo([], 0);      // { taps: [0], bpm: null }
 * r = tapTempo(r.taps, 500);    // { taps: [0, 500], bpm: 120 }
 * @param {Array.<number>} taps Previous tap times (ms).
 * @param {number} now Time of this tap (ms).
 * @returns {{taps: Array.<number>, bpm: ?number}} `bpm` is `null` after a single tap.
 */
export function tapTempo(taps, now) {
  const last = taps[taps.length - 1];
  const next = last !== undefined && now - last <= 2000 && now > last ? [...taps, now].slice(-4) : [now];
  if (next.length < 2) return { taps: next, bpm: null };
  const avg = (next[next.length - 1] - next[0]) / (next.length - 1);
  return { taps: next, bpm: clampTempo(60000 / avg) };
}

/**
 * Effective level of each beat of bar `bar`, jazz modes applied.
 * @param {MetroSettings} s
 * @param {number} bar 0, or 1 for the second bar of a two-bar cycle.
 * @returns {Array.<number>}
 */
export function beatLevels(s, bar = 0) {
  const n = beatsOf(s.meter);
  if (s.jazz === '24' && canTwoFour(s.meter)) return Array.from({ length: n }, (_, i) => (i % 2 ? 2 : 0));
  if (s.jazz === 'once') {
    if (s.twoBars && bar === 1) return Array(n).fill(0);
    return Array.from({ length: n }, (_, i) => (i === Math.min(s.onceBeat, n - 1) ? 2 : 0));
  }
  return s.accents.slice(0, n);
}

/**
 * Number of bars in a cycle: 2 in "once per bar, every other bar" mode.
 * @param {MetroSettings} s
 * @returns {number}
 */
export function cycleBars(s) {
  return s.jazz === 'once' && s.twoBars ? 2 : 1;
}

/**
 * Duration of an eighth note (s).
 * @param {MetroSettings} s
 * @returns {number}
 */
export function eighthSeconds(s) {
  const per = { q: 2, 'q.': 3, 8: 1 }[beatUnit(s.meter)];
  return 60 / s.tempo / per;
}

/**
 * A sound of the cycle.
 * @typedef {Object} MetroEvent
 * @property {number} t Time (s) from the start of the cycle.
 * @property {'strong'|'normal'|'sub'} kind
 */

/**
 * Start of a beat, for the lights.
 * @typedef {Object} MetroMark
 * @property {number} t Time (s) from the start of the cycle.
 * @property {number} beat Beat in the bar (from 0).
 * @property {number} bar Bar in the cycle (0 or 1).
 * @property {number} level Effective level (0 = silent).
 */

/**
 * Offsets (fraction of the beat) of the subdivision clicks inside a beat of
 * `n` eighths.
 * @param {MetroSettings} s
 * @param {number} n 2 or 3.
 * @returns {Array.<number>}
 */
function subOffsets(s, n) {
  const simple = meterOf(s.meter).kind === 'simple';
  switch (s.subdiv) {
    case '8':
      if (simple) return [s.swing / 100];
      return Array.from({ length: n - 1 }, (_, k) => (k + 1) / n);
    case '3':
      return simple ? [1 / 3, 2 / 3] : [];
    case '16':
      return Array.from({ length: 2 * n - 1 }, (_, k) => (k + 1) / (2 * n));
    case '8.16':
      return simple ? [3 / 4] : [];
    default:
      return [];
  }
}

/**
 * Sounds and beat starts of one cycle.
 *
 * @example
 * cycleEvents({ ...METRO_DEFAULTS, tempo: 120 })
 * // duration 2 s; events: strong at 0, normal at 0.5, 1, 1.5
 * @param {MetroSettings} s
 * @returns {{duration: number, events: Array.<MetroEvent>, marks: Array.<MetroMark>}}
 */
export function cycleEvents(s) {
  const groups = meterOf(s.meter).groups;
  const e8 = eighthSeconds(s);
  const barLen = groups.reduce((a, g) => a + g, 0) * e8;
  const bars = cycleBars(s);
  const events = [];
  const marks = [];
  for (let bar = 0; bar < bars; bar++) {
    const levels = beatLevels(s, bar);
    const silentBar = bar === 1;
    let t = bar * barLen;
    groups.forEach((n, beat) => {
      const level = levels[beat] || 0;
      marks.push({ t, beat, bar, level });
      if (level) events.push({ t, kind: level === 2 ? 'strong' : 'normal' });
      if (!silentBar && s.subVol > 0) {
        for (const f of subOffsets(s, n)) events.push({ t: t + f * n * e8, kind: 'sub' });
      }
      t += n * e8;
    });
  }
  events.sort((a, b) => a.t - b.t);
  return { duration: bars * barLen, events, marks };
}

// ---------- Validation ----------

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validates stored or imported settings: unknown values fall back to the
 * defaults, accents are reset if they do not match the time signature.
 * @param {*} r
 * @returns {MetroSettings}
 */
export function sanitizeMetro(r) {
  const d = METRO_DEFAULTS;
  const o = r && typeof r === 'object' ? r : {};
  const key = METRO_METERS.some((m) => m.key === o.meter) ? o.meter : d.meter;
  const n = beatsOf(key);
  const accents =
    Array.isArray(o.accents) && o.accents.length === n && o.accents.every((a) => [0, 1, 2].includes(a))
      ? o.accents.slice()
      : defaultAccents(n);
  const subdiv = subdivsFor(key).includes(o.subdiv) ? o.subdiv : 'none';
  let jazz = JAZZ.includes(o.jazz) ? o.jazz : 'off';
  if (jazz === '24' && !canTwoFour(key)) jazz = 'off';
  return {
    tempo: num(o.tempo) ? clampTempo(o.tempo) : d.tempo,
    meter: key,
    accents,
    subdiv,
    subVol: num(o.subVol) ? Math.min(1, Math.max(0, o.subVol)) : d.subVol,
    swing: num(o.swing) ? Math.min(SWING_MAX, Math.max(SWING_MIN, Math.round(o.swing))) : d.swing,
    sound: SOUNDS.includes(o.sound) ? o.sound : d.sound,
    jazz,
    onceBeat: Number.isInteger(o.onceBeat) && o.onceBeat >= 0 && o.onceBeat < n ? o.onceBeat : 0,
    twoBars: bool(o.twoBars, d.twoBars),
    vibrate: bool(o.vibrate, d.vibrate),
    flash: bool(o.flash, d.flash),
    wake: bool(o.wake, d.wake),
  };
}

/**
 * Settings after a time signature change: accents reset, subdivision and
 * jazz mode kept when the new time signature allows them.
 * @param {MetroSettings} s
 * @param {string} key Time signature key.
 * @returns {MetroSettings}
 */
export function withMeter(s, key) {
  return sanitizeMetro({ ...s, meter: key, accents: null, onceBeat: Math.min(s.onceBeat, beatsOf(key) - 1) });
}

/**
 * A saved preset.
 * @typedef {Object} MetroPreset
 * @property {string} id
 * @property {string} name 1 to {@link PRESET_NAME_MAX} characters.
 * @property {MetroSettings} s Settings (vibration, flash and screen options excluded).
 */

/** Settings stored in a preset (the display options stay global). */
const PRESET_FIELDS = [
  'tempo',
  'meter',
  'accents',
  'subdiv',
  'subVol',
  'swing',
  'sound',
  'jazz',
  'onceBeat',
  'twoBars',
];

/**
 * Part of the settings stored in a preset.
 * @param {MetroSettings} s
 * @returns {Object}
 */
export function presetPart(s) {
  const o = {};
  PRESET_FIELDS.forEach((k) => (o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k]));
  return o;
}

/**
 * Settings after loading a preset: its musical settings, the current display
 * options.
 * @param {MetroSettings} current
 * @param {MetroPreset} p
 * @returns {MetroSettings}
 */
export function applyPreset(current, p) {
  return sanitizeMetro({ ...current, ...presetPart(sanitizeMetro(p.s)) });
}

/**
 * Cleans a typed preset name: spaces reduced, length bounded.
 * @param {string} name
 * @returns {string}
 */
export function cleanPresetName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PRESET_NAME_MAX);
}

/**
 * Validates the preset list (local storage).
 * @param {*} r
 * @returns {Array.<MetroPreset>|undefined}
 */
export function sanitizePresets(r) {
  if (!Array.isArray(r)) return undefined;
  const seen = new Set();
  const out = [];
  for (const p of r) {
    if (!p || typeof p !== 'object') continue;
    const id = typeof p.id === 'string' && /^[a-z0-9]{1,32}$/.test(p.id) ? p.id : null;
    const name = cleanPresetName(p.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, s: presetPart(sanitizeMetro(p.s)) });
    if (out.length >= PRESETS_MAX) break;
  }
  return out;
}
