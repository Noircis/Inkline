/**
 * @module transpose
 * @description
 * **Transposing instruments** (2.8.3). Pure functions.
 *
 * A staff can be written for a transposing instrument (`b.tr`, see
 * {@link module:model.INSTRUMENTS|INSTRUMENTS}). The notes are then written
 * as the musician reads them; playback plays the concert pitch
 * ({@link module:pitch.resolveMidis|resolveMidis}).
 *
 * Changing the instrument of a staff that already holds notes can mean two
 * things, and the user chooses:
 *
 * - **transpose** ({@link changeInstrument} with `keep: false`): the sound
 *   stays the same, the writing changes (notes, key signature, chord
 *   symbols). For example, a solo transcribed in C becomes readable on alto
 *   sax;
 * - **keep the writing** (`keep: true`): the notes do not move, the sound
 *   changes. For example, an alto part copied by mistake onto a staff left
 *   in C.
 *
 * ## Transposing
 *
 * The distance between two instruments is counted in **degrees** and in
 * **semitones** (C → A: 5 degrees, 9 semitones). Each note moves up by the
 * number of degrees, then the accidental giving the right pitch is chosen.
 * The key signature moves around the circle of fifths by the same interval
 * (major sixth: +3 sharps). A key signature with more than 7 accidentals is
 * rewritten enharmonically (D♯ major, 9 sharps, becomes E♭ major, 3 flats),
 * and the notes along with it.
 */

import { instrumentOf, STEP_MIN, STEP_MAX } from './model.js';
import { resolvePitches, midiOf } from './pitch.js';
import { isChord, copyHeads } from './noteheads.js';
import { transposeChord } from './chords.js';
import { mod } from './util.js';

/**
 * Key signature shift (in fifths) for an interval of `semis` semitones:
 * +2 semitones (major second) = +2 sharps, +9 (major sixth) = +3,
 * +5 (fourth) = 1 flat.
 * @param {number} semis
 * @returns {number} From -5 to +6.
 */
export function fifthsOf(semis) {
  const f = mod(semis * 7, 12);
  return f > 6 ? f - 12 : f;
}

/**
 * Notes of an item as the objects that hold them: the item itself for its own
 * note, then its stacked notes (2.17). Each has `s` and maybe `a`.
 * @param {module:model~StaffItem} it
 * @returns {Array.<{s: number, a: (number|undefined)}>}
 */
function headRefs(it) {
  return [it, ...(isChord(it) ? it.x : [])];
}

/**
 * Changes the instrument of a staff (modifies the block). Works on one staff
 * of a block with several staves through its view
 * ({@link module:parts.partView|partView}).
 *
 * @param {module:model~StaffBlock} b
 * @param {string} to Key of the target instrument.
 * @param {{keep: (boolean|undefined)}} [opt] `keep`: keep the writing (the sound changes).
 * @returns {{octaves: number}} Number of notes folded by an octave because
 *   they left the staff (see {@link module:model.STEP_MAX|STEP_MAX}).
 */
export function changeInstrument(b, to, opt = {}) {
  const from = instrumentOf(b.tr);
  const dest = instrumentOf(to);
  const setTr = () => {
    if (dest.key === 'C') delete b.tr;
    else b.tr = dest.key;
  };
  if (opt.keep || b.clef === 'rhythm' || from.key === dest.key) {
    setTr();
    return { octaves: 0 };
  }

  // Concert pitch of each note, to recover after rewriting.
  const target = resolvePitches(b);
  let steps = dest.steps - from.steps;
  const semis = dest.semis - from.semis;

  // Key signature; beyond 7 accidentals, the enharmonic (12 fifths away)
  // also shifts each note by one degree (D♯ → E♭).
  let ks = (b.ks || 0) + fifthsOf(semis);
  if (ks > 7) {
    ks -= 12;
    steps += 1;
  } else if (ks < -7) {
    ks += 12;
    steps -= 1;
  }
  if (ks) b.ks = ks;
  else delete b.ks;
  setTr();

  // Positions: every note moves up (or down) by the same number of degrees.
  // A chord moves as a whole.
  let octaves = 0;
  b.items.forEach((it, i) => {
    if (it.c) it.c = transposeChord(it.c, steps, semis);
    if (it.r) return;
    const heads = headRefs(it);
    heads.forEach((h) => {
      delete h.a;
      h.s += steps;
    });
    // Too high or too low for the staff: one octave closer (the sound
    // changes by an octave, the user is warned).
    const fold = (d) => {
      heads.forEach((h) => (h.s += 7 * d));
      target[i] = target[i].map((m) => m + 12 * d);
      octaves++;
    };
    while (Math.max(...heads.map((h) => h.s)) > STEP_MAX) fold(-1);
    while (Math.min(...heads.map((h) => h.s)) < STEP_MIN) fold(1);
  });

  // Accidentals: in writing order, one is written only if the note
  // would sound wrong without it (key signature and earlier accidentals of the
  // measure included).
  b.items.forEach((it, i) => {
    if (it.r || !target[i].length) return;
    const prev = b.items[i - 1];
    if (prev && prev.tie && !prev.r) {
      copyHeads(prev, it); // tied note: same pitches, same writing
      return;
    }
    headRefs(it).forEach((h, k) => {
      if (resolvePitches(b)[i][k] === target[i][k]) return;
      const written = target[i][k] + dest.semis;
      let alter = written - midiOf(b.clef, h.s, 0);
      if (Math.abs(alter) > 1) {
        // Double accidental: take the neighboring degree (F𝄪 → G).
        h.s += Math.sign(alter);
        alter = written - midiOf(b.clef, h.s, 0);
      }
      h.a = Math.max(-1, Math.min(1, alter));
      // A useless natural (the note sounds right without it) is removed.
      const a = h.a;
      delete h.a;
      if (resolvePitches(b)[i][k] !== target[i][k]) h.a = a;
    });
    if (isChord(it)) it.x = it.x.filter((h) => h.s !== it.s).sort((p, q) => p.s - q.s);
    if (it.x && !it.x.length) delete it.x;
  });
  return { octaves };
}
