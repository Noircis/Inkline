/**
 * @module pitch
 * @description
 * Conversion entre la **position sur la portée** (ce que l'utilisateur touche)
 * et la **hauteur réelle** (numéro MIDI, utilisé par l'audio).
 *
 * ## Repère
 *
 * La position `s` compte les demi-interlignes depuis la première ligne du bas :
 * `s = 0` est la 1re ligne, `s = 1` le 1er interligne, `s = 8` la 5e ligne,
 * les valeurs négatives ou supérieures à 8 sont sur des lignes supplémentaires.
 *
 * Chaque clé est décrite par le degré de la gamme diatonique (0 = do … 6 = si)
 * et l'octave de la note posée sur la 1re ligne :
 * - clé de sol : 1re ligne = mi 4 (degré 2, octave 4)
 * - clé de fa  : 1re ligne = sol 2 (degré 4, octave 2)
 *
 * ## Armure (2.5)
 *
 * Le champ `ks` d'une portée compte les dièses (positif) ou les bémols
 * (négatif) de l'armure, de -7 à 7. Les altérations de l'armure s'ajoutent
 * dans l'ordre du cycle des quintes : fa do sol ré la mi si pour les dièses,
 * si mi la ré sol do fa pour les bémols. Elles valent pour toutes les
 * octaves ({@link module:pitch.keyAcc|keyAcc}).
 *
 * ## Altérations
 *
 * Comme en gravure classique, une altération écrite vaut **jusqu'à la fin de
 * la mesure** pour la même position ; elle remplace celle de l'armure (un
 * bécarre annule le dièse de l'armure). La table `carry` est remise à zéro à
 * chaque barre de mesure. Une note **liée** à la précédente garde la hauteur
 * de celle-ci, même par-dessus une barre (règle d'écriture standard).
 */

import { mod, EPS, snap } from './util.js';
import { qlen, mlen } from './model.js';

/** Noms de notes en solfège français, indexés par degré (0 = do). */
const NOTE_NAMES = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];

/** Demi-tons depuis do pour chaque degré de la gamme majeure. */
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];

/**
 * Note posée sur la 1re ligne pour chaque clé : `L` = degré, `O` = octave.
 * @type {Object.<string, {L:number, O:number}>}
 */
const CLEF_BASE = { treble: { L: 2, O: 4 }, bass: { L: 4, O: 2 } };

/** Degrés recevant un dièse, dans l'ordre de l'armure : fa do sol ré la mi si. */
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];

/** Degrés recevant un bémol, dans l'ordre de l'armure : si mi la ré sol do fa. */
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/**
 * Degré de la gamme (0 = do … 6 = si) d'une position de portée.
 * @param {string} clef
 * @param {number} s
 * @returns {number}
 */
export function degreeOf(clef, s) {
  const b = CLEF_BASE[clef] || CLEF_BASE.treble;
  return mod(b.L + s, 7);
}

/**
 * Altération imposée par l'armure à une position (toutes octaves).
 * @example
 * keyAcc('treble', 8, 1)   // 1 : fa 5 est dièse en sol majeur
 * keyAcc('treble', 4, -2)  // -1 : si est bémol en si♭ majeur
 * @param {string} clef
 * @param {number} s
 * @param {number} [ks=0] Armure : nombre de dièses (> 0) ou de bémols (< 0).
 * @returns {number} -1, 0 ou 1.
 */
export function keyAcc(clef, s, ks = 0) {
  if (!ks) return 0;
  const d = degreeOf(clef, s);
  if (ks > 0) return SHARP_ORDER.slice(0, ks).includes(d) ? 1 : 0;
  return FLAT_ORDER.slice(0, -ks).includes(d) ? -1 : 0;
}

/**
 * Numéro MIDI d'une position de portée.
 *
 * Calcul : on décale la position du degré de la 1re ligne (`t = L + s`),
 * `t mod 7` donne le degré, `floor(t / 7)` le nombre d'octaves à ajouter.
 * MIDI 60 = do 4, d'où le `+1` sur l'octave (convention MIDI : do -1 = 0).
 *
 * @example
 * midiOf('treble', 0, 0)   // 64 (mi 4)
 * midiOf('treble', 4, -1)  // 70 (si♭ 4)
 *
 * @param {string} clef `'treble'` ou `'bass'`.
 * @param {number} s Position sur la portée.
 * @param {number} acc Altération effective en demi-tons (-1, 0, +1).
 * @returns {number} Numéro de note MIDI.
 */
export function midiOf(clef, s, acc) {
  const b = CLEF_BASE[clef] || CLEF_BASE.treble;
  const t = b.L + s;
  return 12 * (b.O + Math.floor(t / 7) + 1) + SEMITONES[mod(t, 7)] + acc;
}

/**
 * Nom lisible d'une position (affiché dans la palette quand une note est sélectionnée).
 * Sans altération écrite, c'est l'armure qui décide.
 *
 * @param {string} clef
 * @param {number} s
 * @param {number} [a] Altération écrite.
 * @param {number} [ks=0] Armure.
 * @returns {string} Par exemple `"Si♭ 4"`.
 */
export function pitchName(clef, s, a, ks = 0) {
  const b = CLEF_BASE[clef] || CLEF_BASE.treble;
  const t = b.L + s;
  const eff = a == null ? keyAcc(clef, s, ks) : a;
  const acc = eff === -1 ? '♭' : eff === 1 ? '♯' : a === 0 ? '♮' : '';
  return NOTE_NAMES[mod(t, 7)] + acc + ' ' + (b.O + Math.floor(t / 7));
}

/**
 * Calcule la hauteur MIDI de chaque élément d'une portée, en appliquant
 * les règles d'altérations et de liaisons.
 *
 * Parcourt les éléments dans l'ordre d'écriture (pas l'ordre de lecture avec
 * reprises : les altérations sont une propriété de la partition écrite).
 *
 * @param {module:model~StaffBlock} b
 * @returns {Array.<?number>} Un numéro MIDI par élément, `null` pour les
 *   silences et pour toute la ligne rythmique.
 */
export function resolveMidis(b) {
  const ML = mlen(b.time);
  let pos = 0;
  // altération en cours par position, pour la mesure courante
  /** @type {Object.<number, number>} */
  let carry = {};
  /** @type {Array.<?number>} */
  const out = [];
  b.items.forEach((it, i) => {
    // Un début de reprise ouvre une nouvelle mesure : on remet tout à zéro.
    if (it.rs && pos > 0) {
      pos = 0;
      carry = {};
    }
    let m = null;
    if (!it.r && b.clef !== 'rhythm') {
      const prev = b.items[i - 1];
      if (prev && prev.tie && !prev.r && out[i - 1] != null) {
        // Note liée : même hauteur que la précédente, quelle que soit la mesure.
        m = out[i - 1];
      } else {
        if (it.a != null) carry[it.s] = it.a;
        m = midiOf(b.clef, it.s, carry[it.s] ?? keyAcc(b.clef, it.s, b.ks));
      }
    }
    out.push(m);
    pos = snap(pos + qlen(it));
    // Fin de mesure (barre explicite ou mesure pleine) : les altérations tombent.
    if (it.bar || pos >= ML - EPS) {
      pos = 0;
      carry = {};
    }
  });
  return out;
}
