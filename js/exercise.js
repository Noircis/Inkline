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
 * 4. jamais deux fois la même mesure dans un exercice (2.8.1) : le tirage se
 *    fait parmi les mesures pas encore sorties.
 */

import { slotsOf, combinations } from './placements.js';

/**
 * Réglages d'un exercice.
 * @typedef {Object} ExerciseSettings
 * @property {module:placements~Meter} meter
 * @property {number} measures Nombre de mesures (1, 2 ou 4).
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
 * Toutes les mesures différentes que permettent les réglages, rangées par
 * nombre de notes puis par première note. Quand aucune position permise ne
 * laisse la place pour `n` notes, la mesure se réduit (de la première
 * position permise jusqu'à la fin).
 *
 * Au plus quelques milliers de mesures (12/8 : 2^12), énumérées une fois par
 * exercice : c'est instantané.
 *
 * @param {ExerciseSettings} s
 * @returns {Array.<Array.<number>>}
 */
export function candidates(s) {
  const slots = slotsOf(s.meter);
  const lo = Math.max(1, Math.min(slots, s.min));
  const hi = Math.max(lo, Math.min(slots, s.max));
  let allowed = [...new Set(s.starts)].filter((p) => p >= 0 && p < slots).sort((a, b) => a - b);
  if (!allowed.length) allowed = Array.from({ length: slots }, (_, i) => i);
  const out = [];
  const seen = new Set();
  const add = (pos) => {
    const key = pos.join();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(pos);
    }
  };
  for (let n = lo; n <= hi; n++) {
    const fit = allowed.filter((p) => p <= slots - n);
    if (!fit.length) {
      add(Array.from({ length: slots - allowed[0] }, (_, i) => allowed[0] + i));
      continue;
    }
    fit.forEach((p) =>
      combinations(slots - p - 1, n - 1).forEach((rest) => add([p, ...rest.map((x) => x + p + 1)])),
    );
  }
  return out;
}

/**
 * Tire les placements d'un exercice. **Aucune mesure n'apparaît deux fois**
 * dans un même exercice, tant que les réglages le permettent (voir
 * {@link candidates} : avec une seule note et une seule position permise,
 * il n'existe qu'une mesure possible).
 *
 * Plutôt que de tirer au hasard puis de recommencer si la mesure est déjà
 * sortie (ce qui peut tourner longtemps quand il reste peu de choix), on
 * tire directement parmi les mesures **pas encore sorties** : même résultat,
 * mais le nombre d'opérations est garanti.
 *
 * Pour chaque mesure : un nombre de notes au hasard, puis une première note
 * au hasard (chaque départ a la même chance, sinon les départs tôt dans la
 * mesure, qui offrent plus de combinaisons, sortiraient bien plus souvent),
 * puis une mesure au hasard parmi celles qui restent.
 *
 * @param {ExerciseSettings} s
 * @returns {Array.<Array.<number>>} Une liste de positions par mesure.
 */
export function generateExercise(s) {
  const rnd = mulberry32(s.seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const all = candidates(s);
  const used = new Set();
  const out = [];
  for (let m = 0; m < s.measures; m++) {
    let pool = all.filter((pos) => !used.has(pos.join()));
    if (!pool.length) pool = all; // plus rien de neuf : répétition inévitable
    const n = pick([...new Set(pool.map((pos) => pos.length))].sort((a, b) => a - b));
    pool = pool.filter((pos) => pos.length === n);
    const p = pick([...new Set(pool.map((pos) => pos[0]))].sort((a, b) => a - b));
    const pos = pick(pool.filter((x) => x[0] === p));
    used.add(pos.join());
    out.push(pos);
  }
  return out;
}
