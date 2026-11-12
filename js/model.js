/**
 * @module model
 * @description
 * Inkline's data model: types (as JSDoc `@typedef`s), duration constants and
 * object factories.
 *
 * ## Overview
 *
 * ```
 * notes : { [id]: Note }
 * Note  = { id, title, created, updated, blocks: Block[] }
 * Block = TextBlock | StaffBlock | GridBlock     (union discriminated by `type`)
 * ```
 *
 * Every structure is a plain JSON object: they are serialized as is in
 * storage and in backup files. Optional fields are **absent** rather than
 * `false`/`null`, which keeps the JSON compact (a piece of several hundred
 * notes stays light).
 *
 * ## Time units
 *
 * Every duration is expressed in **quarter notes**: whole = 4, half = 2,
 * quarter = 1, eighth = 0.5, sixteenth = 0.25. A dotted note is worth ×1.5,
 * a triplet note ×2/3.
 *
 * ## Pitch
 *
 * A note's pitch is stored as a **position on the staff** (`s`, in half
 * staff-spaces, 0 = bottom line) and not as a MIDI number: that is what the
 * user taps on screen. The actual pitch is computed on demand by
 * {@link module:pitch|pitch}.
 */

import { t } from './i18n.js';
import { uid } from './util.js';

/**
 * Written duration code of a note or rest.
 * - `'w'` whole, `'h'` half, `'q'` quarter, `'8'` eighth, `'16'` sixteenth.
 * @typedef {'w'|'h'|'q'|'8'|'16'} DurationCode
 */

/**
 * Type of barline placed **after** a staff item.
 * - `'single'` single barline (forces the end of the measure, even incomplete)
 * - `'double'` double barline
 * - `'final'` final barline (ends the pattern: nothing more can be added)
 * - `'rep'` end repeat `:‖`
 * @typedef {'single'|'double'|'final'|'rep'} BarType
 */

/**
 * A staff item: note or rest.
 *
 * @typedef {Object} StaffItem
 * @property {DurationCode} d Written duration.
 * @property {boolean} [dot] Dotted note (duration ×1.5).
 * @property {boolean} [r] Rest (no pitch).
 * @property {number} [s] Position on the staff in half staff-spaces (0 = 1st line).
 *   Absent for a rest and on a rhythm line.
 * @property {number} [a] Written accidental: flat, natural, sharp.
 * @property {string} [c] Chord symbol shown above (e.g. `"Bb7"`).
 * @property {BarType} [bar] Barline placed after the item.
 * @property {boolean} [rs] Start repeat `‖:` placed **before** the item.
 * @property {boolean} [tie] Tie to the next item (same pitch; on playback,
 *   the two durations become one).
 * @property {3} [tup] Belongs to a triplet (3 notes in the time of 2:
 *   actual duration = written duration × 2/3).
 * @property {boolean} [auto] Piece created by fitting into measures (2.6): continues into the next item (note split at the barline). See the `measure-fit` module.
 */

/**
 * Free text block.
 * @typedef {Object} TextBlock
 * @property {string} id
 * @property {'text'} type
 * @property {string} text
 */

/**
 * Staff block (treble or bass clef) or rhythm line (a single line, no pitch).
 *
 * @typedef {Object} StaffBlock
 * @property {string} id
 * @property {'staff'} type
 * @property {'treble'|'bass'|'rhythm'} clef `'rhythm'` = rhythm line.
 * @property {string} time Time signature, e.g. `'4/4'`, `'6/8'`.
 * @property {number} tempo Tempo in quarter notes per minute.
 * @property {boolean} swing Swing eighths on playback.
 * @property {StaffItem[]} items Items in order.
 * @property {string} [tr] Transposing instrument (2.8.3, key of {@link module:model.INSTRUMENTS|INSTRUMENTS}): notes are written as the musician reads them, playback plays the concert pitch. Absent: in C.
 * @property {number} [ks] Key signature (2.5): number of sharps (> 0) or flats (< 0), from -7 to 7. Absent: no key signature.
 * @property {Array.<number>} [groups] Grouping of eighth notes in the measure (2.8), e.g. `[2, 2, 3]` for a "2+2+3" 7/8. Decides beams and metronome clicks. Absent: {@link module:model.defaultGroups|defaultGroups}. For now only on generated practice blocks.
 * @property {boolean} [justify] Stretch the last line to the edge (generated practice blocks; never saved).
 * @property {'open'|'closed'} [fold] Manual display choice for a long block (2.2): expanded or collapsed. Absent: the "Collapse automatically" option decides.
 */

/**
 * A chord chart measure.
 *
 * `ch` holds 0 to 4 slots that share the measure:
 * - a chord name (`'Cm7'`, `'Bb7alt'`, `'F/A'`…)
 * - `''`: continues the previous chord over this slot
 * - `'n'`: *no chord* (N.C.)
 * - `['%']` (alone): repeats the previous measure
 *
 * @typedef {Object} GridMeasure
 * @property {string[]} ch Chord slots.
 * @property {string} [sec] Section mark (`'A'`, `'B'`, `'Intro'`…) at the start of the measure.
 * @property {boolean} [rs] Start repeat before the measure.
 * @property {boolean} [re] End repeat after the measure.
 * @property {boolean} [dbl] Double barline after the measure.
 * @property {boolean} [fin] Final barline after the measure.
 * @property {1|2|3} [ending] Start of a 1st/2nd/3rd ending (volta).
 */

/**
 * iReal Pro style chord chart.
 *
 * @typedef {Object} GridBlock
 * @property {string} id
 * @property {'grid'} type
 * @property {string} time Time signature.
 * @property {string} key Key in iReal format: `'Bb'` (major), `'C-'` (minor).
 * @property {string} style iReal style (`'Medium Swing'`, `'Bossa Nova'`…).
 * @property {number} tempo Tempo in quarter notes per minute.
 * @property {GridMeasure[]} measures
 * @property {'open'|'closed'} [fold] Manual display choice for a long block (2.2): expanded or collapsed. Absent: the "Collapse automatically" option decides.
 */

/**
 * @typedef {TextBlock|StaffBlock|GridBlock} Block
 */

/**
 * A note of the notebook (a "page").
 *
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title
 * @property {number} created Creation timestamp (ms), filled in automatically
 *   and never changed afterwards. For notes from before 1.7.0 (which did not
 *   have this field), it was initialized with the last modification date.
 * @property {number} updated Last modification timestamp (ms), used to sort
 *   the list and to resolve conflicts on import (the most recent wins).
 * @property {Block[]} blocks
 * @property {string} [folder] Folder (2.0), see {@link module:folders|folders}.
 * @property {Array.<string>} [cats] Categories of its folder (2.8.6), one or more.
 * @property {boolean} [pinned] Pinned at the top of the list (2.0).
 * @property {Object} [metro] Metronome settings of the note (2.15): the preset
 *   part of {@link module:metronome~MetroSettings|MetroSettings}, loaded when the
 *   metronome is opened from the note.
 */

/**
 * Duration in quarter notes of each {@link DurationCode}.
 * @type {Object.<DurationCode, number>}
 */
export const DUR = Object.freeze({ w: 4, h: 2, q: 1, 8: 0.5, 16: 0.25 });

/** Time signatures offered in the interface. */
export const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '5/4', '6/8', '12/8'];

/**
 * **Actual** duration of a staff item, in quarter notes.
 *
 * Combines the written duration, the dot (×1.5) and the triplet (×2/3).
 * This is the value used to fill measures, group beams and sequence audio.
 *
 * @example
 * qlen({ d: 'q', dot: true })   // 1.5
 * qlen({ d: '8', tup: 3 })      // 0.333…
 *
 * @param {StaffItem} it
 * @returns {number}
 */
export function qlen(it) {
  return DUR[it.d] * (it.dot ? 1.5 : 1) * (it.tup ? 2 / 3 : 1);
}

/**
 * **Written** duration of an item (without the triplet factor). Used to
 * group triplets, which works on written values.
 *
 * @param {StaffItem} it
 * @returns {number}
 */
export function writtenLen(it) {
  return DUR[it.d] * (it.dot ? 1.5 : 1);
}

/**
 * Capacity of a measure in quarter notes.
 *
 * @example
 * mlen('4/4')  // 4
 * mlen('6/8')  // 3
 *
 * @param {string} time Time signature `'n/d'`.
 * @returns {number}
 */
export function mlen(time) {
  const [n, d] = time.split('/').map(Number);
  return (n * 4) / d;
}

/**
 * Beat unit (pulse) in quarter notes: 1 for simple time (x/4), 1.5 (dotted
 * quarter) for compound time (x/8). Used to group beams by beat.
 *
 * @param {string} time
 * @returns {number}
 */
export function beatUnit(time) {
  return time.endsWith('/8') ? 1.5 : 1;
}

/**
 * A transposing instrument (2.8.3): how far above the concert pitch its part
 * is written.
 * @typedef {Object} Instrument
 * @property {string} key Id stored in the staff (`b.tr`); label: key
 *   `instr.<key>` in the dictionaries ({@link module:i18n|i18n}).
 * @property {string} tag Label shown on the staff (empty in C).
 * @property {number} steps Written − concert interval, in degrees (lines and spaces).
 * @property {number} semis Written − concert interval, in semitones.
 */

/**
 * Instruments offered. An alto sax (E♭) reads a major sixth above concert
 * pitch: its written C sounds E♭. A tenor sax (B♭) reads a major ninth above
 * (a second, plus an octave).
 * @type {ReadonlyArray.<Instrument>}
 */
export const INSTRUMENTS = Object.freeze([
  { key: 'C', tag: '', steps: 0, semis: 0 },
  { key: 'Bb', tag: 'B♭', steps: 1, semis: 2 },
  { key: 'Bb8', tag: 'B♭', steps: 8, semis: 14 },
  { key: 'Eb', tag: 'E♭', steps: 5, semis: 9 },
  { key: 'Eb8', tag: 'E♭', steps: 12, semis: 21 },
  { key: 'F', tag: 'F', steps: 4, semis: 7 },
  { key: 'G', tag: 'G', steps: 3, semis: 5 },
]);

/**
 * Instrument of a staff (in C if absent or unknown).
 * @param {string} [key]
 * @returns {Instrument}
 */
export function instrumentOf(key) {
  return INSTRUMENTS.find((x) => x.key === key) || INSTRUMENTS[0];
}

/**
 * Range of note positions on the staff (`s`, in half staff-spaces, 0 = 1st
 * line). In treble clef: from F3 (-6, three ledger lines below) to D7 (20,
 * six ledger lines above; up to 2.8.1, E6, 14). The staff grows upward when
 * a note goes above 14 (see {@link module:layout.layout|layout}).
 */
export const STEP_MIN = -6;
/** See {@link STEP_MIN}. */
export const STEP_MAX = 20;
/** Highest position that fits in the normal line height. */
export const STEP_FIT = 14;

/**
 * Default grouping of the eighth notes of a measure (2.8): pairs in x/4 (one
 * beat = two eighths), groups of 3 in compound time (6/8, 9/8, 12/8, 3/8),
 * and for odd meters pairs ending with a group of 3 (5/8 = 2+3,
 * 7/8 = 2+2+3).
 *
 * @example
 * defaultGroups('4/4') // [2, 2, 2, 2]
 * defaultGroups('6/8') // [3, 3]
 * defaultGroups('7/8') // [2, 2, 3]
 *
 * @param {string} time
 * @returns {Array.<number>} Group sizes, in eighth notes.
 */
export function defaultGroups(time) {
  const [n, d] = time.split('/').map(Number);
  const eighths = (n * 8) / d;
  if (d !== 8) return Array(Math.max(1, Math.round(eighths / 2))).fill(2);
  if (n % 3 === 0) return Array(n / 3).fill(3);
  const g = Array(Math.floor((n - 3) / 2)).fill(2);
  g.push(3);
  return g;
}

/**
 * Effective grouping of a block: `b.groups` if it covers the measure exactly
 * (groups of 2 or 3 eighths), otherwise {@link defaultGroups}.
 * @param {{time: string, groups: (Array.<number>|undefined)}} b
 * @returns {Array.<number>}
 */
export function meterGroups(b) {
  const g = b.groups;
  const eighths = mlen(b.time) * 2;
  if (
    Array.isArray(g) &&
    g.length &&
    g.every((x) => x === 2 || x === 3) &&
    g.reduce((s, x) => s + x, 0) === eighths
  )
    return g;
  return defaultGroups(b.time);
}

/**
 * Start of each group in the measure, in quarter notes.
 * @example
 * groupStarts({ time: '7/8', groups: [2, 3, 2] }) // [0, 1, 2.5]
 * @param {{time: string, groups: (Array.<number>|undefined)}} b
 * @returns {Array.<number>}
 */
export function groupStarts(b) {
  const out = [];
  let q = 0;
  meterGroups(b).forEach((g) => {
    out.push(q);
    q += g / 2;
  });
  return out;
}

/**
 * Creates an empty note holding a text block (to start writing right away).
 * @returns {Note}
 */
export function newNote() {
  const now = Date.now();
  return { id: uid(), title: '', created: now, updated: now, blocks: [newTextBlock()] };
}

/** @returns {TextBlock} */
export function newTextBlock() {
  return { id: uid(), type: 'text', text: '' };
}

/**
 * @param {boolean} rhythm `true` for a rhythm line, `false` for a treble clef staff.
 * @returns {StaffBlock}
 */
export function newStaffBlock(rhythm) {
  return {
    id: uid(),
    type: 'staff',
    clef: rhythm ? 'rhythm' : 'treble',
    time: '4/4',
    tempo: 100,
    swing: false,
    items: [],
  };
}

/**
 * Chart of 4 empty measures in C major, Medium Swing at 120.
 * @returns {GridBlock}
 */
export function newGridBlock() {
  return {
    id: uid(),
    type: 'grid',
    time: '4/4',
    key: 'C',
    style: 'Medium Swing',
    tempo: 120,
    measures: [{ ch: [] }, { ch: [] }, { ch: [] }, { ch: [] }],
  };
}

/**
 * Example note shown on the empty home screen. Shows the different block
 * types, including a tie and a triplet.
 * @returns {Note}
 */
export function exampleNote() {
  return {
    id: uid(),
    title: t('example.title'),
    created: Date.now(),
    updated: Date.now(),
    blocks: [
      {
        id: uid(),
        type: 'text',
        text: t('example.text'),
      },
      {
        id: uid(),
        type: 'staff',
        clef: 'treble',
        time: '4/4',
        tempo: 132,
        swing: true,
        items: [
          { d: '8', s: 4, a: -1, c: 'Bb7' },
          { d: '8', s: 6 },
          { d: '8', s: 8 },
          { d: '8', s: 10, a: -1 },
          { d: '8', s: 9, tup: 3 },
          { d: '8', s: 8, tup: 3 },
          { d: '8', s: 6, tup: 3 },
          { d: 'q', s: 6, a: -1, tie: true },
          { d: '8', s: 6, c: 'Eb7' },
          { d: '8', s: 5 },
          { d: 'q', s: 4, a: -1 },
          { d: 'q', r: true },
          { d: 'q', s: 1 },
          { d: 'h', s: 1, c: 'Bb7' },
          { d: 'h', r: true, bar: 'final' },
        ],
      },
      { id: uid(), type: 'text', text: t('example.rhythm') },
      {
        id: uid(),
        type: 'staff',
        clef: 'rhythm',
        time: '4/4',
        tempo: 132,
        swing: true,
        items: [
          { d: '8' },
          { d: '8', tie: true },
          { d: 'q' },
          { d: '8', dot: true },
          { d: '16' },
          { d: '8', r: true },
          { d: '8', bar: 'final' },
        ],
      },
    ],
  };
}
