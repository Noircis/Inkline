/**
 * @module random-grid
 * @description
 * **Random chord charts** (2.18): a chart of `n` measures where every chord is
 * drawn at random, with no harmonic rule. Any root, any quality from
 * {@link QUALITIES}; no inversions. Pure functions.
 *
 * The draw is deterministic: the same settings and the same number (seed)
 * give the same chart, so a chart can be found again by its number.
 */

import { mulberry32 } from './exercise.js';

/**
 * Qualities drawn, in iReal notation (as typed and stored in a chart):
 * triads, sixths, sevenths of every family, extensions and altered
 * dominants, suspended chords. Each one is understood by
 * {@link module:chords.chordTones|chordTones} (playback) and
 * {@link module:chords.chordParts|chordParts} (display).
 */
export const QUALITIES = Object.freeze([
  // Major
  '',
  '6',
  '69',
  'add9',
  '^7',
  '^9',
  '^13',
  '^7#11',
  '^7#5',
  // Minor
  '-',
  '-6',
  '-69',
  '-7',
  '-9',
  '-11',
  '-^7',
  '-^9',
  // Half-diminished, diminished, augmented
  'h7',
  'o',
  'o7',
  '+',
  // Dominant
  '7',
  '9',
  '13',
  '7b9',
  '7#9',
  '7#11',
  '7b13',
  '7#5',
  '9#11',
  '13b9',
  '7b9b13',
  '7alt',
  // Suspended
  'sus2',
  'sus4',
  '7sus4',
  '9sus4',
]);

/** Roots spelled with flats, by pitch class from C. */
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Roots spelled with sharps, by pitch class from C. */
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Time signatures offered. */
export const RGRID_TIMES = Object.freeze(['4/4', '3/4']);
/** Chords per measure: one, two, or one or two at random (`0`). */
export const RGRID_PER_BAR = Object.freeze([1, 2, 0]);
/** Spelling of the black keys: flats, sharps, or either at random. */
export const RGRID_ACCS = Object.freeze(['b', '#', 'both']);
/** Most measures in a chart. */
export const RGRID_MAX = 64;

/**
 * Settings of a random chart.
 * @typedef {Object} RandomGridSettings
 * @property {string} time `'4/4'` or `'3/4'`.
 * @property {number} measures From 1 to {@link RGRID_MAX}.
 * @property {number} perBar Chords per measure: 1, 2, or 0 for one or two at random.
 * @property {'b'|'#'|'both'} acc Spelling of the black keys.
 * @property {number} seed Number of the chart (1 to 9999).
 */

/** Default settings. */
export const RGRID_DEFAULTS = Object.freeze({ time: '4/4', measures: 8, perBar: 1, acc: 'b', seed: 1 });

/**
 * Validates settings (stored with the app's metadata).
 * @param {*} r
 * @returns {RandomGridSettings|undefined} `undefined` when nothing usable.
 */
export function sanitizeRandomGrid(r) {
  if (!r || typeof r !== 'object') return undefined;
  const d = RGRID_DEFAULTS;
  const int = (v, lo, hi, def) => (Number.isInteger(v) && v >= lo && v <= hi ? v : def);
  return {
    time: RGRID_TIMES.includes(r.time) ? r.time : d.time,
    measures: int(r.measures, 1, RGRID_MAX, d.measures),
    perBar: RGRID_PER_BAR.includes(r.perBar) ? r.perBar : d.perBar,
    acc: RGRID_ACCS.includes(r.acc) ? r.acc : d.acc,
    seed: int(r.seed, 1, 9999, d.seed),
  };
}

/**
 * Draws one chord.
 * @param {function(): number} rnd
 * @param {'b'|'#'|'both'} acc
 * @returns {string} Chord in iReal notation (`'Eb-^7'`).
 */
function drawChord(rnd, acc) {
  const pc = Math.floor(rnd() * 12);
  const sharp = acc === '#' || (acc === 'both' && rnd() < 0.5);
  const root = (sharp ? SHARPS : FLATS)[pc];
  return root + QUALITIES[Math.floor(rnd() * QUALITIES.length)];
}

/**
 * Draws the chords of a chart.
 * @param {RandomGridSettings} s
 * @returns {Array.<Array.<string>>} One list of chords per measure.
 */
export function generateChords(s) {
  const rnd = mulberry32(s.seed * 7919 + s.measures);
  return Array.from({ length: s.measures }, () => {
    const n = s.perBar || (rnd() < 0.5 ? 1 : 2);
    return Array.from({ length: n }, () => drawChord(rnd, s.acc));
  });
}

/**
 * The chart as a chord chart block, ready to show, play or copy into a note.
 * Ends with a final barline.
 * @param {RandomGridSettings} s
 * @param {Object} play
 * @param {string} play.id Block id.
 * @param {number} play.tempo
 * @param {boolean} play.swing Swing (otherwise straight eighths).
 * @returns {module:model~GridBlock}
 */
export function randomGridBlock(s, { id, tempo, swing }) {
  const measures = generateChords(s).map((ch) => ({ ch }));
  measures[measures.length - 1].fin = true;
  return {
    id,
    type: 'grid',
    time: s.time,
    key: 'C',
    style: swing ? 'Medium Swing' : 'Even 8ths',
    tempo,
    measures,
  };
}
