/**
 * @module placements
 * @description
 * **Entraînement rythmique : placements** (depuis la 2.3). Fonctions pures.
 *
 * Une mesure de 4/4 contient 8 croches, donc 8 **positions** (0 à 7) :
 *
 * ```
 * position : 0  1  2  3  4  5  6  7
 * compte   : 1  et 2  et 3  et 4  et
 * ```
 *
 * Pour `n` notes, on génère toutes les façons de choisir `n` positions parmi 8
 * ({@link module:placements.combinations|combinations}) : 8 pour une note,
 * 28 pour deux, 56 pour trois, 70 pour quatre… puis on écrit chaque placement
 * selon les règles d'usage ({@link module:placements.placementItems|placementItems}).
 *
 * ## Règles d'écriture (croches)
 *
 * Temps par temps :
 *
 * | sur le temps | contretemps | écriture                 |
 * |--------------|-------------|--------------------------|
 * | note         | rien        | noire                    |
 * | rien         | note        | demi-soupir + croche     |
 * | note         | note        | deux croches (ligaturées)|
 * | rien         | rien        | soupir                   |
 *
 * Une note ne déborde jamais sur le temps suivant (pas de syncope). Puis les
 * silences sont regroupés : deux soupirs sur les temps 1-2 ou 3-4 deviennent
 * une demi-pause. Jamais sur 2-3 : en 4/4, le milieu de la mesure doit rester
 * visible.
 */

/** Positions par mesure (croches en 4/4). */
export const SLOTS = 8;

/** Positions par temps (croches). */
const PER_BEAT = 2;

/** Comptage de chaque position, pour l'affichage. */
export const COUNT_LABELS = ['1', 'et', '2', 'et', '3', 'et', '4', 'et'];

/**
 * Toutes les façons de choisir `k` positions parmi `n`, dans l'ordre
 * lexicographique : `[0,1]`, `[0,2]`… Algorithme récursif classique : pour
 * chaque première position possible, on complète avec les combinaisons des
 * positions suivantes.
 *
 * @param {number} n Nombre de positions.
 * @param {number} k Nombre de positions à choisir.
 * @returns {Array.<Array.<number>>}
 */
export function combinations(n, k) {
  const out = [];
  const pick = (start, chosen) => {
    if (chosen.length === k) {
      out.push(chosen.slice());
      return;
    }
    // Il doit rester assez de positions pour compléter : i <= n - (k - chosen.length).
    for (let i = start; i <= n - (k - chosen.length); i++) {
      chosen.push(i);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  if (k >= 0 && k <= n) pick(0, []);
  return out;
}

/**
 * Écrit un placement en éléments de ligne rythmique (voir les règles en tête
 * de module).
 *
 * @param {Array.<number>} positions Positions jouées (0 à 7).
 * @returns {module:model~StaffItem[]}
 * @example
 * placementItems([4]) // note sur le 3 : demi-pause, noire, soupir
 * // → [{d:'h', r:true}, {d:'q'}, {d:'q', r:true}]
 */
export function placementItems(positions) {
  const on = new Set(positions);
  /** Un tableau d'éléments par temps. */
  const beats = [];
  for (let t = 0; t < SLOTS / PER_BEAT; t++) {
    const down = on.has(t * PER_BEAT);
    const up = on.has(t * PER_BEAT + 1);
    if (down && up) beats.push([{ d: '8' }, { d: '8' }]);
    else if (down) beats.push([{ d: 'q' }]);
    else if (up) beats.push([{ d: '8', r: true }, { d: '8' }]);
    else beats.push(null); // temps vide : soupir, ou demi-pause après regroupement
  }
  const items = [];
  for (let t = 0; t < beats.length; t++) {
    if (beats[t]) {
      items.push(...beats[t]);
    } else if (t % 2 === 0 && !beats[t + 1]) {
      items.push({ d: 'h', r: true }); // temps 1-2 ou 3-4 vides
      t++;
    } else {
      items.push({ d: 'q', r: true });
    }
  }
  return items;
}

/**
 * Bloc ligne rythmique (prêt à dessiner et à jouer) pour un placement.
 * @param {Array.<number>} positions
 * @param {number} tempo
 * @param {string} id
 * @returns {module:model~StaffBlock}
 */
export function placementBlock(positions, tempo, id) {
  return {
    id,
    type: 'staff',
    clef: 'rhythm',
    time: '4/4',
    tempo,
    swing: false,
    justify: true, // la mesure occupe toute la largeur (lecture plus aérée)
    items: placementItems(positions),
  };
}
