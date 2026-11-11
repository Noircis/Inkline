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
import { resolveMidis, midiOf } from './pitch.js';
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
 * Changes the instrument of a staff (modifies the block).
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
  const target = resolveMidis(b);
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

  // Positions: everything moves up (or down) by the same number of degrees.
  let octaves = 0;
  b.items.forEach((it, i) => {
    if (it.c) it.c = transposeChord(it.c, steps, semis);
    if (it.r) return;
    delete it.a;
    it.s += steps;
    // Too high or too low for the staff: one octave closer (the sound
    // changes by an octave, the user is warned).
    while (it.s > STEP_MAX) {
      it.s -= 7;
      if (target[i] != null) target[i] -= 12;
      octaves++;
    }
    while (it.s < STEP_MIN) {
      it.s += 7;
      if (target[i] != null) target[i] += 12;
      octaves++;
    }
  });

  // Accidentals: in writing order, one is written only if the note
  // would sound wrong without it (key signature and earlier accidentals of the
  // measure included).
  b.items.forEach((it, i) => {
    if (it.r || target[i] == null) return;
    const prev = b.items[i - 1];
    if (prev && prev.tie && !prev.r) {
      it.s = prev.s; // tied note: same pitch, same writing
      return;
    }
    if (resolveMidis(b)[i] === target[i]) return;
    const written = target[i] + dest.semis;
    let alter = written - midiOf(b.clef, it.s, 0);
    if (Math.abs(alter) > 1) {
      // Double accidental: take the neighboring degree (F𝄪 → G).
      it.s += Math.sign(alter);
      alter = written - midiOf(b.clef, it.s, 0);
    }
    it.a = Math.max(-1, Math.min(1, alter));
    // A useless natural (the note sounds right without it) is removed.
    const a = it.a;
    delete it.a;
    if (resolveMidis(b)[i] !== target[i]) it.a = a;
  });
  return { octaves };
}
