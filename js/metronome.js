/**
 * @module metronome
 * @description
 * **Metronome** (2.11, free time signatures 2.12): settings, validation and
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
 * ## One cycle
 *
 * The engine plays one pre-rendered **cycle** in a loop: one bar, or two in
 * the "every other bar" jazz mode (the second bar is silent).
 * {@link cycleEvents} lists its sounds with their times and levels, and the
 * pulse starts used by the lights.
 *
 * ## Jazz modes
 *
 * They replace the pulse levels while they are on:
 * - **2 and 4**: only pulses 2 and 4 click (even number of beats, /2 or /4);
 * - **once per bar**: a single pulse clicks (the first by default),
 *   optionally every other bar only.
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
 * Subdivisions of a pulse (/2 and /4 only): none, in 2, in 3, in 4, dotted
 * (3/4 + 1/4). Labels: `metro.subs.*` keys.
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
 * @property {boolean} twoBars "Once per bar" mode: every other bar only.
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
  return { none: 0, 8: 1, 3: 2, 16: 3, 8.16: 1 }[subdiv] || 0;
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
 * Effective level of each pulse of bar `bar`, jazz modes applied.
 * @param {MetroSettings} s
 * @param {number} [bar=0] 0, or 1 for the second bar of a two-bar cycle.
 * @returns {Array.<number>} 0 to 4.
 */
export function pulseLevels(s, bar = 0) {
  if (s.jazz === '24' && canTwoFour(s)) return Array.from({ length: s.num }, (_, i) => (i % 2 ? 4 : 0));
  if (s.jazz === 'once') {
    if (s.twoBars && bar === 1) return Array(s.num).fill(0);
    return Array.from({ length: s.num }, (_, i) => (i === Math.min(s.onceBeat, s.num - 1) ? 4 : 0));
  }
  return s.levels.map(audible);
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
 * Duration of a pulse (s).
 * @param {MetroSettings} s
 * @returns {number}
 */
export function pulseSeconds(s) {
  const per = s.unit === 'group' && canCountGroups(s) ? s.groups[0] : 1;
  return 60 / s.tempo / per;
}

/**
 * Offsets (fraction of the pulse) of the subdivision clicks.
 * @param {MetroSettings} s
 * @returns {Array.<number>}
 */
function subOffsets(s) {
  switch (s.subdiv) {
    case '8':
      return [s.swing / 100];
    case '3':
      return [1 / 3, 2 / 3];
    case '16':
      return [1 / 4, 2 / 4, 3 / 4];
    case '8.16':
      return [3 / 4];
    default:
      return [];
  }
}

/**
 * A sound of the cycle.
 * @typedef {Object} MetroEvent
 * @property {number} t Time (s) from the start of the cycle.
 * @property {'pulse'|'sub'} kind
 * @property {number} level 1 to 4.
 */

/**
 * Start of a pulse, for the lights.
 * @typedef {Object} MetroMark
 * @property {number} t Time (s) from the start of the cycle.
 * @property {number} beat Pulse in the bar (from 0).
 * @property {number} bar Bar in the cycle (0 or 1).
 * @property {number} level Effective level (0 = silent).
 */

/**
 * Sounds and pulse starts of one cycle.
 *
 * @example
 * cycleEvents(sanitizeMetro({ tempo: 120 }))
 * // 4/4: duration 2 s; pulses at 0 (level 4), 0.5, 1, 1.5 (level 3)
 * @param {MetroSettings} s
 * @returns {{duration: number, events: Array.<MetroEvent>, marks: Array.<MetroMark>}}
 */
export function cycleEvents(s) {
  const p = pulseSeconds(s);
  const bars = cycleBars(s);
  const offs = subOffsets(s);
  const events = [];
  const marks = [];
  for (let bar = 0; bar < bars; bar++) {
    const levels = pulseLevels(s, bar);
    for (let i = 0; i < s.num; i++) {
      const at = (bar * s.num + i) * p;
      marks.push({ t: at, beat: i, bar, level: levels[i] });
      if (levels[i]) events.push({ t: at, kind: 'pulse', level: levels[i] });
      if (bar === 1) continue; // the silent bar is fully silent
      offs.forEach((f, k) => {
        const lv = audible(s.subLevels[i * offs.length + k]);
        if (lv) events.push({ t: at + f * p, kind: 'sub', level: lv });
      });
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { duration: bars * s.num * p, events, marks };
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
  twoBars: false,
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
 * Validates stored or imported settings: unknown values fall back to the
 * defaults; groups, levels and subdivision levels are reset when they do not
 * match the time signature.
 * @param {*} r
 * @returns {MetroSettings}
 */
export function sanitizeMetro(r) {
  const d = METRO_DEFAULTS;
  const o = fromLegacy(r && typeof r === 'object' ? r : {});
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
    twoBars: bool(o.twoBars, d.twoBars),
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
