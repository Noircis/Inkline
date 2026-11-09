/**
 * @module transpose
 * @description
 * **Instruments transpositeurs** (2.8.3). Fonctions pures.
 *
 * Une portée peut être écrite pour un instrument transpositeur (`b.tr`, voir
 * {@link module:model.INSTRUMENTS|INSTRUMENTS}). Les notes sont alors écrites
 * comme le musicien les lit ; l'écoute joue le son réel
 * ({@link module:pitch.resolveMidis|resolveMidis}).
 *
 * Changer l'instrument d'une portée qui contient déjà des notes peut vouloir
 * dire deux choses, et c'est à l'utilisateur de choisir :
 *
 * - **transposer** ({@link changeInstrument} avec `keep: false`) : le son
 *   reste le même, l'écriture change (notes, armure, accords chiffrés). Par
 *   exemple, un solo relevé en ut devient lisible au sax alto ;
 * - **garder l'écriture** (`keep: true`) : les notes ne bougent pas, c'est le
 *   son qui change. Par exemple, une partie d'alto recopiée sur une portée
 *   restée en ut par erreur.
 *
 * ## Transposer
 *
 * L'écart entre deux instruments se compte en **degrés** et en **demi-tons**
 * (do → la : 5 degrés, 9 demi-tons). Chaque note monte du nombre de degrés,
 * puis on choisit l'altération qui donne la bonne hauteur. L'armure tourne
 * dans le cycle des quintes du même intervalle (sixte majeure : +3 dièses).
 * Une armure de plus de 7 altérations est réécrite à l'enharmonique (ré♯
 * majeur, 9 dièses, devient mi♭ majeur, 3 bémols), et les notes avec elle.
 */

import { instrumentOf, STEP_MIN, STEP_MAX } from './model.js';
import { resolveMidis, midiOf } from './pitch.js';
import { transposeChord } from './chords.js';
import { mod } from './util.js';

/**
 * Déplacement d'armure (en quintes) pour un intervalle de `semis` demi-tons :
 * +2 demi-tons (seconde majeure) = +2 dièses, +9 (sixte majeure) = +3,
 * +5 (quarte) = 1 bémol.
 * @param {number} semis
 * @returns {number} De -5 à +6.
 */
export function fifthsOf(semis) {
  const f = mod(semis * 7, 12);
  return f > 6 ? f - 12 : f;
}

/**
 * Change l'instrument d'une portée (modifie le bloc).
 *
 * @param {module:model~StaffBlock} b
 * @param {string} to Clé de l'instrument visé.
 * @param {{keep: (boolean|undefined)}} [opt] `keep` : garder l'écriture (le son change).
 * @returns {{octaves: number}} Nombre de notes repliées d'une octave parce
 *   qu'elles sortaient de la portée (voir {@link module:model.STEP_MAX|STEP_MAX}).
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

  // Son réel de chaque note, à retrouver après réécriture.
  const target = resolveMidis(b);
  let steps = dest.steps - from.steps;
  const semis = dest.semis - from.semis;

  // Armure ; au-delà de 7 altérations, l'enharmonique (12 quintes plus loin)
  // décale aussi chaque note d'un degré (ré♯ → mi♭).
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

  // Positions : tout monte (ou descend) du même nombre de degrés.
  let octaves = 0;
  b.items.forEach((it, i) => {
    if (it.c) it.c = transposeChord(it.c, steps, semis);
    if (it.r) return;
    delete it.a;
    it.s += steps;
    // Trop haut ou trop bas pour la portée : une octave plus près (le son
    // change d'une octave, l'utilisateur est prévenu).
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

  // Altérations : dans l'ordre d'écriture, on n'en écrit une que si la note
  // ne sonne pas juste sans elle (armure et altérations précédentes de la
  // mesure comprises).
  b.items.forEach((it, i) => {
    if (it.r || target[i] == null) return;
    const prev = b.items[i - 1];
    if (prev && prev.tie && !prev.r) {
      it.s = prev.s; // note liée : même hauteur, même écriture
      return;
    }
    if (resolveMidis(b)[i] === target[i]) return;
    const written = target[i] + dest.semis;
    let alter = written - midiOf(b.clef, it.s, 0);
    if (Math.abs(alter) > 1) {
      // Double altération : on prend le degré voisin (fa𝄪 → sol).
      it.s += Math.sign(alter);
      alter = written - midiOf(b.clef, it.s, 0);
    }
    it.a = Math.max(-1, Math.min(1, alter));
    // Un bécarre inutile (la note sonne juste sans lui) est retiré.
    const a = it.a;
    delete it.a;
    if (resolveMidis(b)[i] !== target[i]) it.a = a;
  });
  return { octaves };
}
