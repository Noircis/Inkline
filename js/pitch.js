/**
 * @module pitch
 * @description
 * Conversion between the **position on the staff** (what the user taps) and
 * the **actual pitch** (MIDI number, used by audio).
 *
 * ## Reference
 *
 * Position `s` counts half staff-spaces from the bottom line: `s = 0` is the
 * 1st line, `s = 1` the 1st space, `s = 8` the 5th line; negative values or
 * values above 8 are on ledger lines.
 *
 * Each clef is described by the diatonic scale degree (0 = C … 6 = B) and
 * the octave of the note on the 1st line:
 * - treble clef: 1st line = E4 (degree 2, octave 4)
 * - bass clef:   1st line = G2 (degree 4, octave 2)
 *
 * ## Key signature (2.5)
 *
 * A staff's `ks` field counts the sharps (positive) or flats (negative) of
 * the key signature, from -7 to 7. Key signature accidentals are added in
 * circle-of-fifths order: F C G D A E B for sharps, B E A D G C F for flats.
 * They apply to every octave ({@link module:pitch.keyAcc|keyAcc}).
 *
 * ## Accidentals
 *
 * As in classical engraving, a written accidental holds **until the end of
 * the measure** for the same position; it replaces the key signature's (a
 * natural cancels the key signature's sharp). The `carry` table is reset at
 * every barline. A note **tied** to the previous one keeps its pitch, even
 * across a barline (standard notation rule).
 */

import { lang } from './i18n.js';
import { mod, EPS, snap } from './util.js';
import { qlen, mlen, instrumentOf } from './model.js';

/** Note names in French solfège, indexed by degree (0 = do). */
const NOTE_NAMES = {
  fr: ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'],
  en: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
};

/**
 * Name of a degree in the interface language (2.9): `C`… in English,
 * `Do`… in French.
 * @param {number} degree 0 = C.
 * @returns {string}
 */
export const noteName = (degree) => NOTE_NAMES[lang()][mod(degree, 7)];

/** Semitones from C for each degree of the major scale. */
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/**
 * Note on the 1st line for each clef: `L` = degree, `O` = octave.
 * @type {Object.<string, {L:number, O:number}>}
 */
const CLEF_BASE = { treble: { L: 2, O: 4 }, bass: { L: 4, O: 2 } };

/** Degrees receiving a sharp, in key signature order: F C G D A E B. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];

/** Degrees receiving a flat, in key signature order: B E A D G C F. */
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/**
 * Scale degree (0 = C … 6 = B) of a staff position.
 * @param {string} clef
 * @param {number} s
 * @returns {number}
 */
function degreeOf(clef, s) {
  const b = CLEF_BASE[clef] || CLEF_BASE.treble;
  return mod(b.L + s, 7);
}

/**
 * Accidental imposed by the key signature on a position (every octave).
 * @example
 * keyAcc('treble', 8, 1)   // 1: F5 is sharp in G major
 * keyAcc('treble', 4, -2)  // -1: B is flat in B♭ major
 * @param {string} clef
 * @param {number} s
 * @param {number} [ks=0] Key signature: number of sharps (> 0) or flats (< 0).
 * @returns {number} -1, 0 or 1.
 */
export function keyAcc(clef, s, ks = 0) {
  if (!ks) return 0;
  const d = degreeOf(clef, s);
  if (ks > 0) return SHARP_ORDER.slice(0, ks).includes(d) ? 1 : 0;
  return FLAT_ORDER.slice(0, -ks).includes(d) ? -1 : 0;
}

/**
 * MIDI number of a staff position.
 *
 * Computation: the position is shifted by the degree of the 1st line
 * (`t = L + s`), `t mod 7` gives the degree, `floor(t / 7)` the number of
 * octaves to add. MIDI 60 = C4, hence the `+1` on the octave (MIDI
 * convention: C-1 = 0).
 *
 * @example
 * midiOf('treble', 0, 0)   // 64 (E4)
 * midiOf('treble', 4, -1)  // 70 (B♭4)
 *
 * @param {string} clef `'treble'` or `'bass'`.
 * @param {number} s Position on the staff.
 * @param {number} acc Effective accidental in semitones (-1, 0, +1).
 * @returns {number} MIDI note number.
 */
export function midiOf(clef, s, acc) {
  const b = CLEF_BASE[clef] || CLEF_BASE.treble;
  const deg = b.L + s;
  return 12 * (b.O + Math.floor(deg / 7) + 1) + SEMITONES[mod(deg, 7)] + acc;
}

/**
 * Readable name of a position (shown in the palette when a note is selected).
 * With no written accidental, the key signature decides.
 *
 * @param {string} clef
 * @param {number} s
 * @param {number} [a] Written accidental.
 * @param {number} [ks=0] Key signature.
 * @returns {string} For example `"B♭4"`.
 */
export function pitchName(clef, s, a, ks = 0) {
  const b = CLEF_BASE[clef] || CLEF_BASE.treble;
  const deg = b.L + s;
  const eff = a == null ? keyAcc(clef, s, ks) : a;
  const acc = eff === -1 ? '♭' : eff === 1 ? '♯' : a === 0 ? '♮' : '';
  // "B♭4" in English, "Si♭ 4" in French.
  return noteName(deg) + acc + (lang() === 'fr' ? ' ' : '') + (b.O + Math.floor(deg / 7));
}

/**
 * Computes the MIDI pitch of each item of a staff, applying the rules for
 * accidentals and ties.
 *
 * Walks the items in written order (not playback order with repeats:
 * accidentals are a property of the written score).
 *
 * @param {module:model~StaffBlock} b
 * For a transposing instrument (2.8.3), this is the **concert pitch**: the
 * written note, minus the instrument's interval.
 *
 * @returns {Array.<?number>} One MIDI number per item, `null` for rests and
 *   for the whole rhythm line.
 */
export function resolveMidis(b) {
  const ML = mlen(b.time);
  const shift = instrumentOf(b.tr).semis;
  let pos = 0;
  // current accidental by position, for the current measure
  /** @type {Object.<number, number>} */
  let carry = {};
  /** @type {Array.<?number>} */
  const out = [];
  b.items.forEach((it, i) => {
    // A start repeat opens a new measure: reset everything.
    if (it.rs && pos > 0) {
      pos = 0;
      carry = {};
    }
    let m = null;
    if (!it.r && b.clef !== 'rhythm') {
      const prev = b.items[i - 1];
      if (prev && prev.tie && !prev.r && out[i - 1] != null) {
        // Tied note: same pitch as the previous one, whatever the measure.
        m = out[i - 1];
      } else {
        if (it.a != null) carry[it.s] = it.a;
        m = midiOf(b.clef, it.s, carry[it.s] ?? keyAcc(b.clef, it.s, b.ks)) - shift;
      }
    }
    out.push(m);
    pos = snap(pos + qlen(it));
    // End of measure (explicit barline or full measure): accidentals are dropped.
    if (it.bar || pos >= ML - EPS) {
      pos = 0;
      carry = {};
    }
  });
  return out;
}
