/**
 * @module exercise
 * @description
 * **Exercices rythmiques aléatoires** (2.8). Fonctions pures.
 *
 * Un exercice est une suite de mesures tirées au hasard selon des réglages
 * ({@link ExerciseSettings}) : nombre de mesures, nombre de notes par mesure
 * (une fourchette), positions permises pour la première note. Chaque mesure
 * est ensuite écrite avec les mêmes règles que les Placements
 * ({@link module:placements.placementItems|placementItems}).
 *
 * Le hasard est **reproductible** : un exercice est entièrement décidé par ses
 * réglages et un numéro (la graine, *seed*). Le même numéro redonne le même
 * exercice, ce qui permet de le retrouver ou de le partager (« fais le n° 4821 »).
 *
 * ## Tirage d'une mesure
 *
 * 1. nombre de notes `n` au hasard entre min et max ;
 * 2. première note `p` parmi les positions permises, en gardant assez de place
 *    derrière elle pour les `n − 1` autres (`p ≤ positions − n`). Si aucune
 *    position permise ne laisse assez de place, on réduit `n` ;
 * 3. les `n − 1` autres notes au hasard après `p` ;
 * 4. si la mesure est identique à la précédente, on retire (quelques essais).
 */

import { slotsOf } from './placements.js';

/**
 * Réglages d'un exercice.
 * @typedef {Object} ExerciseSettings
 * @property {module:placements~Meter} meter
 * @property {number} measures Nombre de mesures (4, 8 ou 12).
 * @property {number} min Notes par mesure, au moins.
 * @property {number} max Notes par mesure, au plus.
 * @property {Array.<number>} starts Positions permises pour la première note
 *   de chaque mesure (vide : toutes).
 * @property {number} seed Numéro de l'exercice.
 */

/**
 * Générateur pseudo-aléatoire *mulberry32* : rapide, 32 bits, et surtout
 * déterministe (même graine, même suite). `Math.random` ne permet pas de
 * choisir sa graine, d'où ce petit algorithme classique.
 *
 * @param {number} seed
 * @returns {function(): number} Tirage dans [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nouveau numéro d'exercice (1 à 9999).
 * @param {function(): number} [rnd=Math.random]
 * @returns {number}
 */
export function newSeed(rnd = Math.random) {
  return 1 + Math.floor(rnd() * 9999);
}

/**
 * Tire les placements d'un exercice.
 * @param {ExerciseSettings} s
 * @returns {Array.<Array.<number>>} Une liste de positions par mesure.
 */
export function generateExercise(s) {
  const slots = slotsOf(s.meter);
  const rnd = mulberry32(s.seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)); // entier dans [lo, hi]
  const lo = Math.max(1, Math.min(slots, s.min));
  const hi = Math.max(lo, Math.min(slots, s.max));
  let allowed = [...new Set(s.starts)].filter((p) => p >= 0 && p < slots).sort((a, b) => a - b);
  if (!allowed.length) allowed = Array.from({ length: slots }, (_, i) => i);

  const out = [];
  let prev = '';
  for (let m = 0; m < s.measures; m++) {
    const n = int(lo, hi);
    let pos = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      let cand = allowed.filter((p) => p <= slots - n);
      let k = n;
      if (!cand.length) {
        // Aucune position permise ne laisse la place : on place moins de notes.
        cand = [allowed[0]];
        k = slots - allowed[0];
      }
      const p = cand[int(0, cand.length - 1)];
      // k − 1 positions parmi p+1 … slots−1 : mélange partiel de Fisher-Yates.
      const after = [];
      for (let i = p + 1; i < slots; i++) after.push(i);
      for (let i = 0; i < k - 1; i++) {
        const j = int(i, after.length - 1);
        [after[i], after[j]] = [after[j], after[i]];
      }
      pos = [p, ...after.slice(0, k - 1)].sort((a, b) => a - b);
      if (pos.join() !== prev) break;
    }
    prev = pos.join();
    out.push(pos);
  }
  return out;
}
