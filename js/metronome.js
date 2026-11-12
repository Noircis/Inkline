/**
 * @module metronome
 * @description
 * **Metronome** (2.11, free time signatures 2.12, silences and tempo ramp 2.14): settings, validation and
 * the sounds of one cycle. Pure functions, tested under Node. The audio
 * engine is {@link module:metro-engine|metro-engine}, the interface
 * {@link module:ui/metronome|ui/metronome}.
 *
 * ## Time signature, pulses and groups
 *
 * Any time signature `num/den`: 1 to 32 over 2, 4, 8 or 16. The bar has
 * `num` **pulses** (one per unit of the bottom number). In /8 and /16, the
 * pulses are gathered into **groups** (7/8 as 2+2+3, 15/16 as 4+4+4+3): the
 * first pulse of each group is accented by default. In /2 and /4, each pulse
 * is a beat and may be subdivided.
 *
 * ## Levels
 *
 * Every pulse, and every subdivision click, has a **level** from 0 (silent)
 * to 4 (full). A muted cell remembers its level: it is stored negative
 * (`-3` = muted, comes back at 3), so switching it back on restores it.
 *
 * ## Tempo
 *
 * The tempo counts pulses (♪ = 280 in 7/8), or groups when all groups have
 * the same length and that length is a note value (♩. = 80 in 6/8).
 *
 * ## One cycle, or a stream of bars
 *
 * Usually the engine plays one pre-rendered **cycle** in a loop: one bar, or
 * `on + off` bars when whole bars are silenced ({@link cycleEvents}). When
 * every bar may differ (tempo ramp, random or growing silences), it renders
 * the bars a little ahead, chunk after chunk, from {@link planBar}.
 *
 * ## Jazz modes
 *
 * They replace the pulse levels while they are on:
 * - **2 and 4**: only pulses 2 and 4 click (even number of beats, /2 or /4);
 * - **once per bar**: a single pulse clicks (the first by default). For
 *   "every other bar", combine it with the silences (1 bar with, 1 without).
 *
 * ## Silences and tempo ramp (2.14)
 *
 * - **Silences**, to work on the inner tempo: whole bars (2 with click, 2
 *   without…), pulses silenced at random (10 to 90 %), or random silences
 *   that grow over the session. The lights go on during the silence.
 * - **Tempo ramp**: from the tempo of the main page to a target, by steps
 *   (+4 every 4 bars…); at the end, stay, start again or stop.
 *
 * ## Polyrhythm (2.15)
 *
 * A second voice plays `n` evenly spaced hits over `bars` bars, on top of
 * the pulses: 3 over one bar of 4/4 is 3:4, 5 over 2 bars is 5:8. Each hit
 * has its own level. A hit falling on a silenced pulse is silenced too.
 *
 * ## Notes (2.15)
 *
 * A note may keep its own metronome settings (`note.metro`, the preset part),
 * and a staff or chart block gives its tempo, time signature and swing
 * ({@link fromBlock}).
 */

/** Tempo bounds (beats per minute). */
export const TEMPO_MIN = 20;
export const TEMPO_MAX = 400;

/** Top number bounds, and the bottom numbers offered. */
export const NUM_MAX = 32;
export const DENS = Object.freeze([2, 4, 8, 16]);

/** Highest level of a cell. */
export const LEVEL_MAX = 4;

/** Click sounds. Labels: `metro.sounds.*` keys. */
export const SOUNDS = Object.freeze(['click', 'wood', 'cowbell', 'rim', 'hat']);

/**
 * Subdivisions of a pulse (/2 and /4 only): none, in 2, 3, 4, 5, 6 or 7
 * (2.15.1: quintuplets to septuplets; the dotted eighth left, it is swing at
 * 75 %). Labels: `metro.subs.*` keys.
 */
export const SUBDIVS = Object.freeze(['none', '8', '3', '16', '5', '6', '7']);

/** Clicks per pulse of each subdivision, the pulse included. */
const SUB_CLICKS = { none: 1, 8: 2, 3: 3, 16: 4, 5: 5, 6: 6, 7: 7 };

/** Swing that plays a dotted eighth and a sixteenth (3/4 + 1/4). */
export const SWING_DOTTED = 75;

/** Swing bounds (%): position of the offbeat eighth within the beat. */
export const SWING_MIN = 50;
export const SWING_MAX = 75;

/** Jazz modes. */
export const JAZZ = Object.freeze(['off', '24', 'once']);

/** Maximum number of presets, and of characters in a preset name. */
export const PRESETS_MAX = 50;
export const PRESET_NAME_MAX = 40;

/**
 * Time signature shortcuts (the third menu): top, bottom, groups.
 * @type {ReadonlyArray.<{num: number, den: number, groups: Array.<number>}>}
 */
export const SHORTCUTS = Object.freeze([
  { num: 4, den: 4, groups: [1, 1, 1, 1] },
  { num: 3, den: 4, groups: [1, 1, 1] },
  { num: 2, den: 4, groups: [1, 1] },
  { num: 5, den: 4, groups: [1, 1, 1, 1, 1] },
  { num: 6, den: 4, groups: [1, 1, 1, 1, 1, 1] },
  { num: 7, den: 4, groups: [1, 1, 1, 1, 1, 1, 1] },
  { num: 2, den: 2, groups: [1, 1] },
  { num: 6, den: 8, groups: [3, 3] },
  { num: 9, den: 8, groups: [3, 3, 3] },
  { num: 12, den: 8, groups: [3, 3, 3, 3] },
  { num: 5, den: 8, groups: [2, 3] },
  { num: 5, den: 8, groups: [3, 2] },
  { num: 7, den: 8, groups: [2, 2, 3] },
  { num: 7, den: 8, groups: [2, 3, 2] },
  { num: 7, den: 8, groups: [3, 2, 2] },
]);

/**
 * Metronome settings.
 * @typedef {Object} MetroSettings
 * @property {number} tempo Beats per minute ({@link TEMPO_MIN} to {@link TEMPO_MAX}).
 * @property {'pulse'|'group'} unit What the tempo counts.
 * @property {number} num Top number (1 to {@link NUM_MAX}).
 * @property {number} den Bottom number (one of {@link DENS}).
 * @property {Array.<number>} groups Pulses per group (sum = `num`); all 1 in /2 and /4.
 * @property {Array.<number>} levels Level of each pulse, -4 to 4 (≤ 0: silent).
 * @property {string} subdiv One of {@link SUBDIVS} (`none` in /8 and /16).
 * @property {Array.<number>} subLevels Level of each subdivision click,
 *   pulse after pulse ({@link subCount} per pulse).
 * @property {number} swing Offbeat eighth position (%), {@link SWING_MIN} to {@link SWING_MAX}.
 * @property {string} sound One of {@link SOUNDS}.
 * @property {string} jazz One of {@link JAZZ}.
 * @property {number} onceBeat Pulse that clicks in "once per bar" mode (from 0).
 * @property {GapSettings} gap Silences (2.14).
 * @property {RampSettings} ramp Tempo ramp (2.14).
 * @property {PolySettings} poly Polyrhythm (2.15).
 * @property {boolean} vibrate Vibrate on each audible pulse.
 * @property {boolean} flash Full-screen flash on each audible pulse.
 * @property {boolean} wake Keep the screen on while playing.
 */

/**
 * Pulses are grouped (/8 and /16) rather than beats of their own (/2 and /4)?
 * @param {number} den
 * @returns {boolean}
 */
export function grouped(den) {
  return den >= 8;
}

/**
 * Default groups of a time signature: each pulse alone in /2 and /4. In /8,
 * groups of 3 when the top number allows it (6/8, 9/8, 12/8), otherwise 2s
 * ending with a 3 (7/8 = 2+2+3). In /16, groups of 4, the remainder in a
 * last group (15/16 = 4+4+4+3); 3/16 and 6/16 in groups of 3.
 *
 * @example
 * defaultGroups(7, 8)   // [2, 2, 3]
 * defaultGroups(15, 16) // [4, 4, 4, 3]
 * @param {number} num
 * @param {number} den
 * @returns {Array.<number>}
 */
export function defaultGroups(num, den) {
  if (!grouped(den) || num < 4) return grouped(den) ? [num] : Array(num).fill(1);
  const even = (k) => Array(num / k).fill(k);
  if (den === 8) {
    if (num % 3 === 0) return even(3);
    if (num % 2 === 0) return even(2);
    return [...Array((num - 3) / 2).fill(2), 3];
  }
  if (num % 4 === 0) return even(4);
  if (num < 8 && num % 3 === 0) return even(3);
  const g = Array(Math.floor(num / 4)).fill(4);
  const rest = num % 4;
  if (rest === 1) g.splice(g.length - 1, 1, 3, 2);
  else g.push(rest);
  return g;
}

/**
 * Other usual groupings for the groups menu: the default, its rotations, and
 * even groups of 2, 3 or 4. No duplicates.
 * @param {number} num
 * @param {number} den
 * @returns {Array.<Array.<number>>}
 */
export function groupChoices(num, den) {
  if (!grouped(den)) return [Array(num).fill(1)];
  const out = [];
  const add = (g) => {
    if (g.reduce((a, b) => a + b, 0) === num && !out.some((o) => o.join() === g.join())) out.push(g);
  };
  const d = defaultGroups(num, den);
  for (let r = 0; r < d.length; r++) add([...d.slice(r), ...d.slice(0, r)]);
  for (const k of [2, 3, 4]) if (num % k === 0 && num > k) add(Array(num / k).fill(k));
  return out.slice(0, 12);
}

/**
 * Default levels: group heads at 4; in /2 and /4 the other beats at 3, in
 * /8 and /16 the other pulses at 2.
 * @param {Array.<number>} groups
 * @param {number} den
 * @returns {Array.<number>}
 */
export function defaultLevels(groups, den) {
  const rest = grouped(den) ? 2 : 3;
  const out = [];
  groups.forEach((g, gi) => {
    for (let k = 0; k < g; k++) out.push(k === 0 && (gi === 0 || grouped(den)) ? 4 : rest);
  });
  return out;
}

/**
 * Subdivision clicks per pulse (the pulse itself excluded).
 * @param {string} subdiv
 * @returns {number}
 */
export function subCount(subdiv) {
  return (SUB_CLICKS[subdiv] || 1) - 1;
}

/** Default level of a subdivision click. */
const SUB_LEVEL = 2;

/**
 * Index of the group starting each group (pulse index of each head).
 * @param {Array.<number>} groups
 * @returns {Array.<number>}
 */
export function groupHeads(groups) {
  const out = [];
  let i = 0;
  for (const g of groups) {
    out.push(i);
    i += g;
  }
  return out;
}

/**
 * Note value of a duration in whole notes, as a glyph (music font), or
 * `null` if it is not a single value.
 * @param {number} w Duration in whole notes.
 * @returns {?string}
 */
function valueGlyph(w) {
  const table = [
    [1 / 2, '\u{1D15E}'],
    [3 / 4, '\u{1D15E}.'],
    [1 / 4, '♩'],
    [3 / 8, '♩.'],
    [1 / 8, '♪'],
    [3 / 16, '♪.'],
    [1 / 16, '\u{1D161}'],
  ];
  const hit = table.find(([v]) => Math.abs(v - w) < 1e-9);
  return hit ? hit[1] : null;
}

/**
 * Can the tempo count groups? All groups the same length, a note value.
 * @param {MetroSettings} s
 * @returns {boolean}
 */
export function canCountGroups(s) {
  const g = s.groups[0];
  return grouped(s.den) && g > 1 && s.groups.every((x) => x === g) && valueGlyph(g / s.den) !== null;
}

/**
 * What the tempo counts, as a glyph (♩, ♪, ♩.…).
 * @param {MetroSettings} s
 * @returns {string}
 */
export function unitGlyph(s) {
  if (s.unit === 'group' && canCountGroups(s)) return valueGlyph(s.groups[0] / s.den);
  return valueGlyph(1 / s.den);
}

/**
 * Time signature as text ("7/8"), with its groups when they are uneven
 * ("7/8 2+2+3").
 * @param {MetroSettings} s
 * @returns {string}
 */
export function meterLabel(s) {
  const uneven = grouped(s.den) && s.groups.some((g) => g !== s.groups[0]);
  return `${s.num}/${s.den}${uneven ? ' ' + s.groups.join('+') : ''}`;
}

/**
 * Index of the shortcut matching the settings, or -1.
 * @param {MetroSettings} s
 * @returns {number}
 */
export function shortcutIndex(s) {
  return SHORTCUTS.findIndex(
    (x) => x.num === s.num && x.den === s.den && x.groups.join() === s.groups.join(),
  );
}

/**
 * Is the "2 and 4" mode possible? /2 or /4 with an even number of beats.
 * @param {MetroSettings} s
 * @returns {boolean}
 */
export function canTwoFour(s) {
  return !grouped(s.den) && s.num % 2 === 0;
}

/**
 * Subdivisions offered: all of them in /2 and /4, none in /8 and /16.
 * @param {number} den
 * @returns {Array.<string>}
 */
export function subdivsFor(den) {
  return grouped(den) ? ['none'] : SUBDIVS.slice();
}

/**
 * Does swing apply? Eighth subdivisions in /4 (or /2).
 * @param {MetroSettings} s
 * @returns {boolean}
 */
export function swingApplies(s) {
  return s.subdiv === '8' && !grouped(s.den);
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
 * Switches a cell on or off: a muted cell keeps its level (stored negative).
 * A cell muted at 0 comes back at 3.
 * @param {number} v
 * @returns {number}
 */
export function toggleLevel(v) {
  if (v > 0) return -v;
  return v < 0 ? -v : 3;
}

/**
 * Audible level of a cell (0 to 4).
 * @param {number} v
 * @returns {number}
 */
export function audible(v) {
  return Math.max(0, v || 0);
}

/**
 * Effective level of each pulse, jazz modes applied (silences are not).
 * @param {MetroSettings} s
 * @returns {Array.<number>} 0 to 4.
 */
export function pulseLevels(s) {
  if (s.jazz === '24' && canTwoFour(s)) return Array.from({ length: s.num }, (_, i) => (i % 2 ? 4 : 0));
  if (s.jazz === 'once')
    return Array.from({ length: s.num }, (_, i) => (i === Math.min(s.onceBeat, s.num - 1) ? 4 : 0));
  return s.levels.map(audible);
}

/**
 * Duration of a pulse (s) at a tempo.
 * @param {MetroSettings} s
 * @param {number} [tempo=s.tempo]
 * @returns {number}
 */
export function pulseSeconds(s, tempo = s.tempo) {
  const per = s.unit === 'group' && canCountGroups(s) ? s.groups[0] : 1;
  return 60 / tempo / per;
}

/**
 * Offsets (fraction of the pulse) of the subdivision clicks.
 * @param {MetroSettings} s
 * @returns {Array.<number>}
 */
function subOffsets(s) {
  if (s.subdiv === '8') return [s.swing / 100];
  const n = SUB_CLICKS[s.subdiv] || 1;
  return Array.from({ length: n - 1 }, (_, k) => (k + 1) / n);
}

/**
 * A sound.
 * @typedef {Object} MetroEvent
 * @property {number} t Time (s) from the start of the cycle (or chunk).
 * @property {'pulse'|'sub'|'poly'} kind
 * @property {number} level 1 to 4.
 */

/**
 * Start of a pulse, for the lights.
 * @typedef {Object} MetroMark
 * @property {number} t Time (s) from the start of the cycle (or chunk).
 * @property {number} beat Pulse in the bar (from 0).
 * @property {number} bar Bar index (in the cycle, or since the start).
 * @property {number} level Effective level (0 = silent by setting).
 * @property {boolean} silent Silenced by the silence modes (2.14).
 * @property {number} tempo Tempo of the bar (changes during a tempo ramp).
 */

/**
 * A polyrhythm hit, for its lights.
 * @typedef {Object} PolyMark
 * @property {number} t Time (s) from the start of the cycle (or chunk).
 * @property {number} hit Hit index (from 0 to `n - 1`).
 * @property {boolean} silent Falls on a silenced pulse.
 */

/**
 * What one bar plays: its tempo and which pulses are silenced.
 * @typedef {Object} BarPlan
 * @property {number} tempo
 * @property {?Array.<boolean>} mute Silenced pulses (`null`: none).
 */

/**
 * Sounds and pulse starts of one bar.
 * @param {MetroSettings} s
 * @param {BarPlan} plan
 * @param {number} t0 Start time (s) of the bar.
 * @param {number} bar Bar index stored in the marks.
 * @param {Array.<MetroEvent>} events Filled.
 * @param {Array.<MetroMark>} marks Filled.
 * @param {Array.<PolyMark>} polys Filled.
 * @returns {number} Duration of the bar (s).
 */
function barEvents(s, plan, t0, bar, events, marks, polys) {
  const p = pulseSeconds(s, plan.tempo);
  const offs = subOffsets(s);
  const levels = pulseLevels(s);
  for (let i = 0; i < s.num; i++) {
    const at = t0 + i * p;
    const silent = !!(plan.mute && plan.mute[i]);
    marks.push({ t: at, beat: i, bar, level: levels[i], silent, tempo: plan.tempo });
    if (silent) continue; // a silenced pulse takes its subdivisions with it
    if (levels[i]) events.push({ t: at, kind: 'pulse', level: levels[i] });
    offs.forEach((f, k) => {
      const lv = audible(s.subLevels[i * offs.length + k]);
      if (lv) events.push({ t: at + f * p, kind: 'sub', level: lv });
    });
  }
  for (const h of polyHits(s, bar)) {
    const at = t0 + h.f * s.num * p;
    const i = Math.min(s.num - 1, Math.floor(h.f * s.num + 1e-9));
    const silent = !!(plan.mute && plan.mute[i]);
    polys.push({ t: at, hit: h.hit, silent });
    const lv = audible(s.poly.levels[h.hit]);
    if (lv && !silent) events.push({ t: at, kind: 'poly', level: lv });
  }
  return s.num * p;
}

// ---------- Polyrhythm (2.15) ----------

/** Polyrhythm bounds: hits, and bars they spread over. */
export const POLY_N_MIN = 2;
export const POLY_N_MAX = 16;
export const POLY_BARS_MAX = 4;

/**
 * Polyrhythm settings.
 * @typedef {Object} PolySettings
 * @property {boolean} on
 * @property {number} n Hits ({@link POLY_N_MIN} to {@link POLY_N_MAX}).
 * @property {number} bars Bars they spread over (1 to {@link POLY_BARS_MAX}).
 * @property {string} sound One of {@link SOUNDS}.
 * @property {Array.<number>} levels Level of each hit, -4 to 4 (≤ 0: silent).
 */

/**
 * Default levels of the hits: the first one strong.
 * @param {number} n
 * @returns {Array.<number>}
 */
export function defaultPolyLevels(n) {
  return Array.from({ length: n }, (_, k) => (k ? 3 : 4));
}

/**
 * Polyrhythm hits that fall in bar `bar` (from the start of the session):
 * hit `k` sits at `k × bars / n` bars, so bar `bar` holds the hits whose
 * position falls in `[g, g + 1)`, `g = bar mod bars`.
 *
 * @example
 * // 3 over 2 bars: bar 0 → hits 0 (at 0) and 1 (at 2/3); bar 1 → hit 2 (at 1/3)
 * @param {MetroSettings} s
 * @param {number} bar
 * @returns {Array.<{hit: number, f: number}>} `f`: position in the bar (0 to 1).
 */
export function polyHits(s, bar) {
  const p = s.poly;
  if (!p || !p.on) return [];
  const g = bar % p.bars;
  const out = [];
  // k × bars / n in [g, g + 1)  ⇔  k × bars in [g × n, (g + 1) × n): integers only.
  for (let k = Math.ceil((g * p.n) / p.bars); k * p.bars < (g + 1) * p.n; k++)
    out.push({ hit: k, f: (k * p.bars - g * p.n) / p.n });
  return out;
}

/**
 * Ratio shown for a polyrhythm: hits against pulses (3:4, 5:8).
 * @param {MetroSettings} s
 * @returns {string}
 */
export function polyRatio(s) {
  return `${s.poly.n}:${s.num * s.poly.bars}`;
}

// ---------- Silences and tempo ramp (2.14) ----------

/**
 * Silence modes: none; bars with and without click; pulses silenced at
 * random; random silences growing over the session.
 */
export const GAP_MODES = Object.freeze(['off', 'bars', 'random', 'grow']);
/** Ends of a tempo ramp: stay at the target, start again, stop. */
export const RAMP_ENDS = Object.freeze(['stay', 'loop', 'stop']);
/** Durations offered for growing silences (minutes). */
export const GROW_MINUTES = Object.freeze([1, 2, 3, 5, 10, 15, 20, 30]);

/**
 * Silence settings.
 * @typedef {Object} GapSettings
 * @property {string} mode One of {@link GAP_MODES}.
 * @property {number} on Bars with click (1 to 8), `bars` mode.
 * @property {number} off Bars without click (1 to 8), `bars` mode.
 * @property {number} pct Silenced pulses (%), 10 to 90, `random` mode.
 * @property {number} from Silenced pulses at the start (%), 0 to 80, `grow` mode.
 * @property {number} to Silenced pulses at the end (%), 10 to 90, `grow` mode.
 * @property {number} minutes Time to go from `from` to `to`, `grow` mode.
 */

/**
 * Tempo ramp settings. The ramp starts from the tempo of the main page.
 * @typedef {Object} RampSettings
 * @property {boolean} on
 * @property {number} to Target tempo.
 * @property {number} step BPM per step (1 to 20).
 * @property {number} every Bars per step (1 to 16).
 * @property {string} end One of {@link RAMP_ENDS}.
 */

/**
 * Does the engine have to stream bars one by one (ramp, random silences),
 * rather than loop one pre-rendered cycle?
 * @param {MetroSettings} s
 * @returns {boolean}
 */
export function streams(s) {
  return s.ramp.on || s.gap.mode === 'random' || s.gap.mode === 'grow';
}

/**
 * Number of tempo steps of the ramp (0 if it is off or already at the target).
 * @param {MetroSettings} s
 * @returns {number}
 */
export function rampSteps(s) {
  if (!s.ramp.on) return 0;
  return Math.ceil(Math.abs(s.ramp.to - s.tempo) / s.ramp.step);
}

/**
 * Length of the ramp in bars, the last step (at the target) included.
 * @example
 * // 80 → 140, +4 every 4 bars: 15 steps, 64 bars
 * @param {MetroSettings} s
 * @returns {number}
 */
export function rampBars(s) {
  return (rampSteps(s) + 1) * s.ramp.every;
}

/**
 * Tempo of bar `i` (from 0) of a ramp; it goes down if the target is slower.
 * @param {MetroSettings} s
 * @param {number} i
 * @returns {?number} `null` once the ramp has ended with "stop".
 */
export function rampTempo(s, i) {
  if (!s.ramp.on) return s.tempo;
  const total = rampBars(s);
  if (i >= total) {
    if (s.ramp.end === 'stop') return null;
    if (s.ramp.end === 'loop') i %= total;
    else return s.ramp.to;
  }
  const k = Math.min(rampSteps(s), Math.floor(i / s.ramp.every));
  const dir = Math.sign(s.ramp.to - s.tempo);
  const v = s.tempo + dir * k * s.ramp.step;
  return dir > 0 ? Math.min(v, s.ramp.to) : Math.max(v, s.ramp.to);
}

/**
 * Silenced share of the pulses (0 to 1) after `elapsed` seconds.
 * @param {MetroSettings} s
 * @param {number} elapsed
 * @returns {number}
 */
export function gapShare(s, elapsed) {
  const g = s.gap;
  if (g.mode === 'random') return g.pct / 100;
  if (g.mode !== 'grow') return 0;
  const f = Math.min(1, elapsed / (g.minutes * 60));
  return (g.from + (g.to - g.from) * f) / 100;
}

/**
 * Small deterministic generator (mulberry32): the same seed gives the same
 * silences, so a bar can be planned again identically.
 * @param {number} seed
 * @returns {function(): number}
 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plan of bar `i` of a session: tempo (ramp) and silenced pulses.
 *
 * - `bars`: the whole bar is silent when `i mod (on + off) >= on`;
 * - `random` and `grow`: each pulse is silenced with the probability given
 *   by {@link gapShare}, drawn from `seed` and `i` (reproducible).
 *
 * @param {MetroSettings} s
 * @param {number} i Bar index since the start.
 * @param {number} elapsed Seconds since the start, at the start of the bar.
 * @param {number} seed
 * @returns {?BarPlan} `null` when the session is over (ramp ending with "stop").
 */
export function planBar(s, i, elapsed, seed) {
  const tempo = rampTempo(s, i);
  if (tempo === null) return null;
  const g = s.gap;
  if (g.mode === 'bars') {
    const silent = i % (g.on + g.off) >= g.on;
    return { tempo, mute: silent ? Array(s.num).fill(true) : null };
  }
  const share = gapShare(s, elapsed);
  if (!share) return { tempo, mute: null };
  const next = rng(seed ^ Math.imul(i + 1, 0x9e3779b1));
  return { tempo, mute: Array.from({ length: s.num }, () => next() < share) };
}

/**
 * Number of bars in a looping cycle: on + off in `bars` silence mode, 1
 * otherwise; with a polyrhythm, a common multiple with its bars.
 * @param {MetroSettings} s
 * @returns {number}
 */
export function cycleBars(s) {
  const gap = s.gap.mode === 'bars' ? s.gap.on + s.gap.off : 1;
  return s.poly && s.poly.on ? lcm(gap, s.poly.bars) : gap;
}

/**
 * Least common multiple of two positive integers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function lcm(a, b) {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
}

/**
 * Sounds and pulse starts of one looping cycle (no ramp, no random silences).
 *
 * @example
 * cycleEvents(sanitizeMetro({ tempo: 120 }))
 * // 4/4: duration 2 s; pulses at 0 (level 4), 0.5, 1, 1.5 (level 3)
 * @param {MetroSettings} s
 * @returns {{duration: number, events: Array.<MetroEvent>, marks: Array.<MetroMark>, polys: Array.<PolyMark>}}
 */
export function cycleEvents(s) {
  return chunkEvents(
    s,
    Array.from({ length: cycleBars(s) }, (_, i) => planBar(s, i, 0, 0)),
  );
}

/**
 * Sounds and pulse starts of a series of planned bars, one after another.
 * @param {MetroSettings} s
 * @param {Array.<BarPlan>} plans
 * @param {number} [firstBar=0] Index of the first bar (stored in the marks).
 * @returns {{duration: number, events: Array.<MetroEvent>, marks: Array.<MetroMark>, polys: Array.<PolyMark>}}
 */
export function chunkEvents(s, plans, firstBar = 0) {
  const events = [];
  const marks = [];
  const polys = [];
  let t0 = 0;
  plans.forEach((plan, k) => (t0 += barEvents(s, plan, t0, firstBar + k, events, marks, polys)));
  events.sort((a, b) => a.t - b.t);
  return { duration: t0, events, marks, polys };
}

// ---------- Validation ----------

/** Default settings: 4/4 at 120. */
export const METRO_DEFAULTS = Object.freeze({
  tempo: 120,
  unit: 'pulse',
  num: 4,
  den: 4,
  groups: Object.freeze([1, 1, 1, 1]),
  levels: Object.freeze(defaultLevels([1, 1, 1, 1], 4)),
  subdiv: 'none',
  subLevels: Object.freeze([]),
  swing: 50,
  sound: 'click',
  jazz: 'off',
  onceBeat: 0,
  gap: Object.freeze({ mode: 'off', on: 2, off: 2, pct: 30, from: 0, to: 70, minutes: 5 }),
  ramp: Object.freeze({ on: false, to: 140, step: 4, every: 4, end: 'stay' }),
  poly: Object.freeze({ on: false, n: 3, bars: 1, sound: 'wood', levels: Object.freeze([4, 3, 3]) }),
  vibrate: false,
  flash: false,
  wake: true,
});

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isLevel = (v) => Number.isInteger(v) && v >= -LEVEL_MAX && v <= LEVEL_MAX;

/**
 * Converts 2.11 settings (`meter` key, accents 0 to 2, `subVol`) to the 2.12
 * fields. Newer settings are returned as they are.
 * @param {Object} o
 * @returns {Object}
 */
function fromLegacy(o) {
  if (typeof o.meter !== 'string' || o.num !== undefined) return o;
  const [sig, grp] = o.meter.split(':');
  const [n, d] = sig.split('/').map(Number);
  const groups = grp ? grp.split('+').map(Number) : defaultGroups(n, d);
  const lv = { 2: 4, 1: 3, 0: -3 };
  let levels;
  if (Array.isArray(o.accents)) {
    // 2.11 accents are per beat (per group in /8): heads get them.
    const heads = groupHeads(d >= 8 ? groups : Array(n).fill(1));
    levels = defaultLevels(d >= 8 ? groups : Array(n).fill(1), d);
    heads.forEach((h, k) => (levels[h] = lv[o.accents[k]] ?? levels[h]));
  }
  const sub = num(o.subVol) ? Math.round(o.subVol * LEVEL_MAX) : SUB_LEVEL;
  // 2.11 tempo counted dotted quarters in 6/8, 9/8, 12/8 and 3/8.
  const unit = d === 8 && groups.length && groups.every((g) => g === 3) ? 'group' : 'pulse';
  return { ...o, num: n, den: d, groups, levels, unit, subLevels: Array(n * subCount(o.subdiv)).fill(sub) };
}

/**
 * Integer in bounds, or a default.
 * @param {*} v
 * @param {number} lo
 * @param {number} hi
 * @param {number} d
 * @returns {number}
 */
const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/**
 * Validates the silence settings.
 * @param {*} r
 * @param {boolean} twoBars 2.13 "once per bar, every other bar": becomes 1 bar with click, 1 without.
 * @returns {GapSettings}
 */
function sanitizeGap(r, twoBars) {
  const d = METRO_DEFAULTS.gap;
  const o = r && typeof r === 'object' ? r : {};
  if (twoBars && !r) return { ...d, mode: 'bars', on: 1, off: 1 };
  const pct = (v, lo, hi, def) => (Number.isInteger(v) && v >= lo && v <= hi && v % 10 === 0 ? v : def);
  const from = pct(o.from, 0, 80, d.from);
  return {
    mode: GAP_MODES.includes(o.mode) ? o.mode : 'off',
    on: int(o.on, 1, 8, d.on),
    off: int(o.off, 1, 8, d.off),
    pct: pct(o.pct, 10, 90, d.pct),
    from,
    to: Math.max(from + 10, pct(o.to, 10, 90, d.to)),
    minutes: GROW_MINUTES.includes(o.minutes) ? o.minutes : d.minutes,
  };
}

/**
 * Validates the tempo ramp settings.
 * @param {*} r
 * @returns {RampSettings}
 */
function sanitizeRamp(r) {
  const d = METRO_DEFAULTS.ramp;
  const o = r && typeof r === 'object' ? r : {};
  return {
    on: bool(o.on, d.on),
    to: num(o.to) ? clampTempo(o.to) : d.to,
    step: int(o.step, 1, 20, d.step),
    every: int(o.every, 1, 16, d.every),
    end: RAMP_ENDS.includes(o.end) ? o.end : d.end,
  };
}

/**
 * Validates the polyrhythm settings; levels are reset when their number does
 * not match the hits.
 * @param {*} r
 * @returns {PolySettings}
 */
function sanitizePoly(r) {
  const d = METRO_DEFAULTS.poly;
  const o = r && typeof r === 'object' ? r : {};
  const n = int(o.n, POLY_N_MIN, POLY_N_MAX, d.n);
  return {
    on: bool(o.on, d.on),
    n,
    bars: int(o.bars, 1, POLY_BARS_MAX, d.bars),
    sound: SOUNDS.includes(o.sound) ? o.sound : d.sound,
    levels:
      Array.isArray(o.levels) && o.levels.length === n && o.levels.every(isLevel)
        ? o.levels.slice()
        : defaultPolyLevels(n),
  };
}

/**
 * Validates stored or imported settings: unknown values fall back to the
 * defaults; groups, levels and subdivision levels are reset when they do not
 * match the time signature.
 * @param {*} r
 * @returns {MetroSettings}
 */
export function sanitizeMetro(r) {
  const d = METRO_DEFAULTS;
  const raw = r && typeof r === 'object' ? r : {};
  // 2.15.1: the dotted eighth subdivision became eighths with swing at 75 %.
  const o = fromLegacy(raw.subdiv === '8.16' ? { ...raw, subdiv: '8', swing: SWING_DOTTED } : raw);
  const n = Number.isInteger(o.num) && o.num >= 1 && o.num <= NUM_MAX ? o.num : d.num;
  const den = DENS.includes(o.den) ? o.den : d.den;
  const okGroups =
    Array.isArray(o.groups) &&
    o.groups.every((g) => Number.isInteger(g) && g >= 1) &&
    o.groups.reduce((a, b) => a + b, 0) === n &&
    (grouped(den) || o.groups.every((g) => g === 1));
  const groups = okGroups ? o.groups.slice() : defaultGroups(n, den);
  const levels =
    Array.isArray(o.levels) && o.levels.length === n && o.levels.every(isLevel)
      ? o.levels.slice()
      : defaultLevels(groups, den);
  const subdiv = subdivsFor(den).includes(o.subdiv) ? o.subdiv : 'none';
  const sc = n * subCount(subdiv);
  const subLevels =
    Array.isArray(o.subLevels) && o.subLevels.length === sc && o.subLevels.every(isLevel)
      ? o.subLevels.slice()
      : Array(sc).fill(SUB_LEVEL);
  const s = {
    tempo: num(o.tempo) ? clampTempo(o.tempo) : d.tempo,
    unit: o.unit === 'group' ? 'group' : 'pulse',
    num: n,
    den,
    groups,
    levels,
    subdiv,
    subLevels,
    swing: num(o.swing) ? Math.min(SWING_MAX, Math.max(SWING_MIN, Math.round(o.swing))) : d.swing,
    sound: SOUNDS.includes(o.sound) ? o.sound : d.sound,
    jazz: JAZZ.includes(o.jazz) ? o.jazz : 'off',
    onceBeat: Number.isInteger(o.onceBeat) && o.onceBeat >= 0 && o.onceBeat < n ? o.onceBeat : 0,
    gap: sanitizeGap(o.gap, o.jazz === 'once' && o.twoBars === true),
    ramp: sanitizeRamp(o.ramp),
    poly: sanitizePoly(o.poly),
    vibrate: bool(o.vibrate, d.vibrate),
    flash: bool(o.flash, d.flash),
    wake: bool(o.wake, d.wake),
  };
  if (s.unit === 'group' && !canCountGroups(s)) s.unit = 'pulse';
  if (s.jazz === '24' && !canTwoFour(s)) s.jazz = 'off';
  return s;
}

/**
 * Settings after a time signature change: default groups and levels,
 * subdivision kept when possible, the tempo kept (counting pulses).
 * @param {MetroSettings} s
 * @param {number} n Top number.
 * @param {number} den Bottom number.
 * @param {Array.<number>} [groups] Groups (default ones if missing).
 * @returns {MetroSettings}
 */
export function withMeter(s, n, den, groups) {
  const g = groups || defaultGroups(n, den);
  return sanitizeMetro({
    ...s,
    num: n,
    den,
    groups: g,
    levels: null,
    subLevels: null,
    onceBeat: Math.min(s.onceBeat, n - 1),
  });
}

/**
 * Settings after a groups change: default levels for the new groups.
 * @param {MetroSettings} s
 * @param {Array.<number>} groups
 * @returns {MetroSettings}
 */
export function withGroups(s, groups) {
  return sanitizeMetro({ ...s, groups, levels: null });
}

/**
 * Splits a group before pulse `i`, or joins it to the previous group if a
 * group already starts there.
 * @param {Array.<number>} groups
 * @param {number} i Pulse (1 to num − 1).
 * @returns {Array.<number>}
 */
export function cutOrJoin(groups, i) {
  const heads = groupHeads(groups);
  const k = heads.indexOf(i);
  if (k > 0) {
    const out = groups.slice();
    out.splice(k - 1, 2, groups[k - 1] + groups[k]);
    return out;
  }
  const g = heads.filter((h) => h < i).length - 1;
  const out = groups.slice();
  const before = i - heads[g];
  out.splice(g, 1, before, groups[g] - before);
  return out;
}

/**
 * Settings after a subdivision change: the new clicks at the default level.
 * @param {MetroSettings} s
 * @param {string} subdiv
 * @returns {MetroSettings}
 */
export function withSubdiv(s, subdiv) {
  return sanitizeMetro({ ...s, subdiv, subLevels: null });
}

/**
 * Settings after a tempo unit change: the tempo is converted so the speed
 * stays the same.
 * @param {MetroSettings} s
 * @param {'pulse'|'group'} unit
 * @returns {MetroSettings}
 */
export function withUnit(s, unit) {
  const next = sanitizeMetro({ ...s, unit });
  if (next.unit === s.unit) return next;
  const g = s.groups[0];
  return { ...next, tempo: clampTempo(unit === 'group' ? s.tempo / g : s.tempo * g) };
}

/**
 * Settings from a shortcut.
 * @param {MetroSettings} s
 * @param {number} k Index in {@link SHORTCUTS}.
 * @returns {MetroSettings}
 */
export function withShortcut(s, k) {
  const sc = SHORTCUTS[k];
  if (!sc) return s;
  const next = withMeter(s, sc.num, sc.den, sc.groups.slice());
  // Compound time counts dotted quarters, as musicians do.
  return sanitizeMetro({
    ...next,
    unit: sc.den === 8 && sc.groups.every((g) => g === 3) ? 'group' : 'pulse',
  });
}

/**
 * A saved preset.
 * @typedef {Object} MetroPreset
 * @property {string} id
 * @property {string} name 1 to {@link PRESET_NAME_MAX} characters.
 * @property {Object} s Musical settings (vibration, flash and screen options excluded).
 */

/** Settings stored in a preset (the display options stay global). */
const PRESET_FIELDS = [
  'tempo',
  'unit',
  'num',
  'den',
  'groups',
  'levels',
  'subdiv',
  'subLevels',
  'swing',
  'sound',
  'jazz',
  'onceBeat',
  'gap',
  'ramp',
  'poly',
];

/**
 * Part of the settings stored in a preset.
 * @param {MetroSettings} s
 * @returns {Object}
 */
export function presetPart(s) {
  const o = {};
  PRESET_FIELDS.forEach(
    (k) =>
      (o[k] = Array.isArray(s[k]) ? s[k].slice() : s[k] && typeof s[k] === 'object' ? { ...s[k] } : s[k]),
  );
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
 * Settings after a polyrhythm change; the hit levels go back to the default
 * when the number of hits changes.
 * @param {MetroSettings} s
 * @param {Object} patch Polyrhythm fields to change.
 * @returns {MetroSettings}
 */
export function withPoly(s, patch) {
  const poly = { ...s.poly, ...patch };
  if (patch.n !== undefined && patch.n !== s.poly.n) poly.levels = null;
  return sanitizeMetro({ ...s, poly });
}

// ---------- Blocks and notes (2.15) ----------

/** Chart styles played with swing (same rule as {@link module:audio|audio}). */
const SWING_STYLE = /swing|waltz|blues|gospel|ballad/i;

/**
 * Settings from a staff or chart block: its time signature, its tempo
 * (quarter notes per minute, converted to what the metronome counts) and its
 * swing. The rest of the settings is kept.
 *
 * - Compound /8 (6/8, 12/8): the tempo counts dotted quarters (× 2/3).
 * - Otherwise it counts pulses: × 2 in /8, × 1/2 in /2.
 * - Swing: eighth subdivision at 67 % (triplet feel); no swing: straight.
 *
 * @example
 * fromBlock(s, { type: 'staff', time: '6/8', tempo: 90, swing: false })
 * // 6/8, groups 3+3, ♩. = 60
 * @param {MetroSettings} s
 * @param {{type: string, time: string, tempo: number, swing: (boolean|undefined), style: (string|undefined)}} b
 * @returns {MetroSettings}
 */
export function fromBlock(s, b) {
  const [n, den] = String(b.time || '4/4')
    .split('/')
    .map(Number);
  const next = withMeter(s, Number.isInteger(n) ? n : 4, den);
  const compound = next.den === 8 && next.groups.every((g) => g === 3);
  const q = num(b.tempo) ? b.tempo : 120;
  const swing = b.type === 'grid' ? SWING_STYLE.test(b.style || '') && next.den <= 4 : !!b.swing;
  const out = sanitizeMetro({
    ...next,
    unit: compound ? 'group' : 'pulse',
    tempo: Math.round(compound ? (q * 2) / 3 : (q * next.den) / 4),
    swing: swing ? 67 : SWING_MIN,
  });
  return swing && out.subdiv === 'none' ? withSubdiv(out, '8') : out;
}

/**
 * Settings stored in a note are the same as the current ones (no need to
 * load them, the save button shows "saved")?
 * @param {MetroSettings} s
 * @param {*} stored `note.metro`.
 * @returns {boolean}
 */
export function sameAsStored(s, stored) {
  if (!stored) return false;
  return JSON.stringify(presetPart(s)) === JSON.stringify(presetPart(sanitizeMetro(stored)));
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
