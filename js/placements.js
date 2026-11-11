/**
 * @module placements
 * @description
 * **Entraînement rythmique : placements** (depuis la 2.3, toutes les mesures
 * depuis la 2.8). Fonctions pures, partagées avec le générateur d'exercices
 * ({@link module:exercise|exercise}).
 *
 * Une mesure est découpée en **positions** de croche. En 4/4 :
 *
 * ```
 * position : 0  1  2  3  4  5  6  7
 * compte   : 1  et 2  et 3  et 4  et
 * ```
 *
 * Les croches sont rangées en **groupes** de 2 ou 3 (un temps) : des paires
 * en x/4, des groupes de 3 en 6/8, 9/8, 12/8, et un mélange en 5/8 ou 7/8
 * (voir {@link METERS}). Pour `n` notes, on génère toutes les façons de
 * choisir `n` positions ({@link combinations}), on écrit chaque placement
 * groupe par groupe ({@link placementItems}), puis on regroupe en séries
 * selon la position de la première note ({@link placementSeries}).
 *
 * ## Règles d'écriture (croches)
 *
 * Groupe de 2 (un temps en x/4) :
 *
 * | croches | écriture                  |
 * |---------|---------------------------|
 * | x.      | noire                     |
 * | .x      | demi-soupir + croche      |
 * | xx      | deux croches (ligaturées) |
 * | ..      | soupir                    |
 *
 * Groupe de 3 (un temps de mesure composée) :
 *
 * | croches | écriture                         |
 * |---------|----------------------------------|
 * | x..     | noire pointée                    |
 * | .x.     | demi-soupir, croche, demi-soupir |
 * | ..x     | soupir, croche                   |
 * | xx.     | croche, noire                    |
 * | x.x     | noire, croche                    |
 * | .xx     | demi-soupir, deux croches        |
 * | xxx     | trois croches                    |
 * | ...     | soupir pointé                    |
 *
 * Une note ne déborde jamais sur le groupe suivant (pas de syncope). Puis les
 * silences de deux temps vides voisins sont réunis (demi-pause, ou demi-pause
 * pointée en mesure composée) :
 * - à 3 temps (3/4, 9/8) : n'importe quelle paire ;
 * - sinon, seulement une paire qui commence sur un temps impair (1-2, 3-4) :
 *   en 4/4, le milieu de la mesure doit rester visible, jamais 2-3 ;
 * - jamais en mesure asymétrique (5/8, 7/8) : chaque groupe reste lisible.
 */

import { t } from './i18n.js';

/**
 * Une mesure proposée à l'entraînement.
 * @typedef {Object} Meter
 * @property {string} key Identifiant (`'4/4'`, `'7/8:2+3+2'`).
 * @property {string} time Chiffrage.
 * @property {Array.<number>} groups Groupes de croches.
 * @property {string} label Libellé court.
 * @property {'simple'|'compound'|'odd'} kind Simple (x/4), composée, asymétrique.
 */

/**
 * Fabrique une {@link Meter}.
 * @param {string} time
 * @param {Array.<number>} groups
 * @returns {Meter}
 */
function meter(time, groups) {
  const odd = groups.some((g) => g !== groups[0]);
  return {
    key: odd ? `${time}:${groups.join('+')}` : time,
    time,
    groups,
    label: odd ? `${time} (${groups.join('+')})` : time,
    kind: odd ? 'odd' : groups[0] === 3 ? 'compound' : 'simple',
  };
}

/** Mesures proposées, dans l'ordre d'affichage. */
export const METERS = Object.freeze([
  meter('4/4', [2, 2, 2, 2]),
  meter('3/4', [2, 2, 2]),
  meter('2/4', [2, 2]),
  meter('5/4', [2, 2, 2, 2, 2]),
  meter('6/8', [3, 3]),
  meter('9/8', [3, 3, 3]),
  meter('12/8', [3, 3, 3, 3]),
  meter('3/8', [3]),
  meter('5/8', [2, 3]),
  meter('5/8', [3, 2]),
  meter('7/8', [2, 2, 3]),
  meter('7/8', [2, 3, 2]),
  meter('7/8', [3, 2, 2]),
]);

/**
 * Mesure d'après son identifiant (4/4 si inconnu).
 * @param {string} key
 * @returns {Meter}
 */
export function meterOf(key) {
  return METERS.find((m) => m.key === key) || METERS[0];
}

/**
 * Nombre de positions (croches) d'une mesure.
 * @param {Meter} m
 * @returns {number}
 */
export const slotsOf = (m) => m.groups.reduce((s, g) => s + g, 0);

/** Positions par mesure en 4/4 (compatibilité 2.3). */
export const SLOTS = 8;

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

/** Écriture d'un groupe de 2 croches selon les positions jouées. */
const PAIR = {
  'x.': [{ d: 'q' }],
  '.x': [{ d: '8', r: true }, { d: '8' }],
  xx: [{ d: '8' }, { d: '8' }],
};

/** Écriture d'un groupe de 3 croches (voir le tableau en tête de module). */
const TRIPLE = {
  'x..': [{ d: 'q', dot: true }],
  '.x.': [{ d: '8', r: true }, { d: '8' }, { d: '8', r: true }],
  '..x': [{ d: 'q', r: true }, { d: '8' }],
  'xx.': [{ d: '8' }, { d: 'q' }],
  'x.x': [{ d: 'q' }, { d: '8' }],
  '.xx': [{ d: '8', r: true }, { d: '8' }, { d: '8' }],
  xxx: [{ d: '8' }, { d: '8' }, { d: '8' }],
};

/**
 * Écrit un placement en éléments de ligne rythmique (voir les règles en tête
 * de module).
 *
 * @param {Array.<number>} positions Positions jouées (0 à nombre de croches − 1).
 * @param {Meter} [m] Mesure (4/4 par défaut).
 * @returns {module:model~StaffItem[]}
 * @example
 * placementItems([4]) // note sur le 3 : demi-pause, noire, soupir
 * // → [{d:'h', r:true}, {d:'q'}, {d:'q', r:true}]
 * placementItems([1], meterOf('6/8')) // → demi-soupir, croche, demi-soupir, soupir pointé
 */
export function placementItems(positions, m = METERS[0]) {
  const on = new Set(positions);
  /** Un tableau d'éléments par groupe, `null` pour un groupe vide. */
  const cells = [];
  let off = 0;
  m.groups.forEach((g) => {
    let key = '';
    for (let k = 0; k < g; k++) key += on.has(off + k) ? 'x' : '.';
    const table = g === 3 ? TRIPLE : PAIR;
    cells.push(table[key] ? table[key].map((it) => ({ ...it })) : null);
    off += g;
  });
  const dot = m.kind === 'compound';
  const rest = (g) => (g === 3 ? { d: 'q', dot: true, r: true } : { d: 'q', r: true });
  const merged = dot ? { d: 'h', dot: true, r: true } : { d: 'h', r: true };
  const anyPair = cells.length === 3; // 3/4, 9/8
  const items = [];
  for (let ci = 0; ci < cells.length; ci++) {
    if (cells[ci]) {
      items.push(...cells[ci]);
    } else if (m.kind !== 'odd' && ci + 1 < cells.length && !cells[ci + 1] && (anyPair || ci % 2 === 0)) {
      items.push({ ...merged }); // deux temps vides réunis
      ci++;
    } else {
      items.push(rest(m.groups[ci]));
    }
  }
  return items;
}

/**
 * Regroupe des placements en **séries** : une série réunit les placements
 * dont la première note est à la même position (ils sont déjà consécutifs
 * dans l'ordre de {@link combinations}). Cas particulier : avec une seule
 * note, chaque placement serait seul dans sa série ; on les réunit tous en
 * une seule.
 *
 * @param {Array.<Array.<number>>} placements
 * @returns {Array.<Array.<Array.<number>>>} Liste de séries, chacune une liste de placements.
 */
function groupSeries(placements) {
  if (placements.length && placements[0].length === 1) return [placements];
  const series = [];
  placements.forEach((pos) => {
    const last = series[series.length - 1];
    if (last && last[0][0] === pos[0]) last.push(pos);
    else series.push([pos]);
  });
  return series;
}

/**
 * Séries d'exercices pour `notes` notes par mesure.
 * @param {number} notes
 * @param {Meter} [m] Mesure (4/4 par défaut).
 * @returns {Array.<Array.<Array.<number>>>}
 */
export function placementSeries(notes, m = METERS[0]) {
  return groupSeries(combinations(slotsOf(m), notes));
}

/**
 * Bloc ligne rythmique (prêt à dessiner et à jouer) : des placements à la
 * suite, une mesure chacun. Sert aux séries et aux exercices aléatoires.
 * Le swing n'est gardé qu'en mesure simple.
 * @param {Array.<Array.<number>>} placements
 * @param {{tempo: number, swing: boolean}} play Réglages de lecture.
 * @param {string} id
 * @param {Meter} [m] Mesure (4/4 par défaut).
 * @returns {module:model~StaffBlock}
 */
export function seriesBlock(placements, play, id, m = METERS[0]) {
  return {
    id,
    type: 'staff',
    clef: 'rhythm',
    time: m.time,
    groups: m.groups.slice(),
    tempo: play.tempo,
    swing: play.swing && m.kind === 'simple',
    justify: true, // dernière ligne étirée comme les autres (lecture régulière)
    items: placements.flatMap((pos) => placementItems(pos, m)),
  };
}

/** Glyphes (Unicode, police musicale) des silences, par durée. */
const REST_GLYPH = { h: '\u{1D13C}', q: '\u{1D13D}', 8: '\u{1D13E}' };

/** Glyphe de la croche. */
export const EIGHTH_GLYPH = '\u{1D160}';

/**
 * Départ d'une note en notation : les silences qui la précèdent, puis une
 * croche. Sert de titre aux séries et aux choix de position du générateur.
 *
 * @example
 * startGlyphs(3) // 2 et, en 4/4 : soupir, demi-soupir, croche
 * @param {number} pos
 * @param {Meter} [m]
 * @returns {string}
 */
export function startGlyphs(pos, m = METERS[0]) {
  const items = placementItems([pos], m);
  let out = '';
  for (const it of items) {
    if (!it.r) break;
    out += REST_GLYPH[it.d] + (it.dot ? '.' : '');
  }
  return out + EIGHTH_GLYPH;
}

/**
 * Position dite en mots (lecteurs d'écran) : « 2 et » en mesure simple,
 * « temps 2, 3e croche » sinon.
 * @param {number} pos
 * @param {Meter} [m]
 * @returns {string}
 */
export function startLabel(pos, m = METERS[0]) {
  let off = 0;
  for (let g = 0; g < m.groups.length; g++) {
    const k = pos - off;
    if (k < m.groups[g]) {
      if (m.kind === 'simple') return k ? t('count.and', { n: g + 1 }) : `${g + 1}`;
      return k ? t('count.beatEighth', { n: g + 1, k: k + 1 }) : t('count.beat', { n: g + 1 });
    }
    off += m.groups[g];
  }
  return String(pos + 1);
}
