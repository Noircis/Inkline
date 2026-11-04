/**
 * @module model
 * @description
 * Modèle de données d'Inkline : types (sous forme de `@typedef` JSDoc),
 * constantes de durée et fabriques d'objets.
 *
 * ## Vue d'ensemble
 *
 * ```
 * notes : { [id]: Note }
 * Note  = { id, title, created, updated, blocks: Block[] }
 * Block = TextBlock | StaffBlock | GridBlock     (union discriminée par `type`)
 * ```
 *
 * Toutes les structures sont des objets JSON simples : elles sont sérialisées
 * telles quelles dans `localStorage` et dans les fichiers de sauvegarde. Les
 * champs optionnels sont **absents** plutôt que `false`/`null`, ce qui garde
 * le JSON compact (un morceau de plusieurs centaines de notes reste léger).
 *
 * ## Unités de temps
 *
 * Toutes les durées sont exprimées en **noires** (quarter notes) :
 * ronde = 4, blanche = 2, noire = 1, croche = 0.5, double croche = 0.25.
 * Une note pointée vaut ×1.5, une note de triolet ×2/3.
 *
 * ## Hauteur
 *
 * La hauteur d'une note est stockée comme **position sur la portée**
 * (`s`, en demi-interlignes, 0 = première ligne du bas) et non comme numéro
 * MIDI : c'est ce que l'utilisateur touche à l'écran. La hauteur réelle est
 * calculée à la demande par {@link module:pitch|pitch}.
 */

import { uid } from './util.js';

/**
 * Code de durée écrite d'une note ou d'un silence.
 * - `'w'` ronde, `'h'` blanche, `'q'` noire, `'8'` croche, `'16'` double croche.
 * @typedef {'w'|'h'|'q'|'8'|'16'} DurationCode
 */

/**
 * Type de barre de mesure placée **après** un élément de portée.
 * - `'single'` barre simple (force la fin de mesure, même incomplète)
 * - `'double'` double barre
 * - `'final'` barre de fin (termine le motif : plus d'ajout possible)
 * - `'rep'` fin de reprise `:‖`
 * @typedef {'single'|'double'|'final'|'rep'} BarType
 */

/**
 * Un élément de portée : note ou silence.
 *
 * @typedef {Object} StaffItem
 * @property {DurationCode} d Durée écrite.
 * @property {boolean} [dot] Note pointée (durée ×1.5).
 * @property {boolean} [r] Silence (aucune hauteur).
 * @property {number} [s] Position sur la portée en demi-interlignes (0 = 1re ligne).
 *   Absent pour un silence et sur une ligne rythmique.
 * @property {number} [a] Altération écrite : bémol, bécarre, dièse.
 * @property {string} [c] Accord chiffré affiché au-dessus (ex. `"Bb7"`).
 * @property {BarType} [bar] Barre de mesure placée après l'élément.
 * @property {boolean} [rs] Début de reprise `‖:` placé **avant** l'élément.
 * @property {boolean} [tie] Liaison de prolongation vers l'élément suivant
 *   (même hauteur ; à la lecture, les deux durées n'en font qu'une).
 * @property {3} [tup] Appartient à un triolet (3 notes dans le temps de 2 :
 *   durée réelle = durée écrite × 2/3).
 */

/**
 * Bloc de texte libre.
 * @typedef {Object} TextBlock
 * @property {string} id
 * @property {'text'} type
 * @property {string} text
 */

/**
 * Bloc portée (clé de sol ou de fa) ou ligne rythmique (une seule ligne, sans hauteur).
 *
 * @typedef {Object} StaffBlock
 * @property {string} id
 * @property {'staff'} type
 * @property {'treble'|'bass'|'rhythm'} clef `'rhythm'` = ligne rythmique.
 * @property {string} time Chiffrage de mesure, ex. `'4/4'`, `'6/8'`.
 * @property {number} tempo Tempo en noires par minute.
 * @property {boolean} swing Croches swing à la lecture.
 * @property {StaffItem[]} items Éléments dans l'ordre.
 */

/**
 * Une mesure de grille d'accords.
 *
 * `ch` contient de 0 à 4 « cases » (slots) qui se partagent la mesure :
 * - un nom d'accord (`'Cm7'`, `'Bb7alt'`, `'F/A'`…)
 * - `''` : prolonge l'accord précédent sur cette case
 * - `'n'` : *no chord* (N.C.)
 * - `['%']` (seul) : répète la mesure précédente
 *
 * @typedef {Object} GridMeasure
 * @property {string[]} ch Cases d'accords.
 * @property {string} [sec] Repère de section (`'A'`, `'B'`, `'Intro'`…) en début de mesure.
 * @property {boolean} [rs] Début de reprise avant la mesure.
 * @property {boolean} [re] Fin de reprise après la mesure.
 * @property {boolean} [dbl] Double barre après la mesure.
 * @property {boolean} [fin] Barre de fin après la mesure.
 * @property {1|2|3} [ending] Début d'une 1re/2e/3e fin (volta).
 */

/**
 * Grille d'accords façon iReal Pro.
 *
 * @typedef {Object} GridBlock
 * @property {string} id
 * @property {'grid'} type
 * @property {string} time Chiffrage de mesure.
 * @property {string} key Tonalité au format iReal : `'Bb'` (majeur), `'C-'` (mineur).
 * @property {string} style Style iReal (`'Medium Swing'`, `'Bossa Nova'`…).
 * @property {number} tempo Tempo en noires par minute.
 * @property {GridMeasure[]} measures
 */

/**
 * @typedef {TextBlock|StaffBlock|GridBlock} Block
 */

/**
 * Une note du carnet (une « page »).
 *
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title
 * @property {number} created Horodatage (ms) de création, rempli automatiquement et
 *   jamais modifié ensuite. Pour les notes antérieures à la 1.7.0 (qui n'avaient
 *   pas ce champ), il a été initialisé avec la date de dernière modification.
 * @property {number} updated Horodatage (ms) de dernière modification, utilisé pour
 *   trier la liste et pour résoudre les conflits à l'import (le plus récent gagne).
 * @property {Block[]} blocks
 */

/**
 * Durée en noires de chaque {@link DurationCode}.
 * @type {Object.<DurationCode, number>}
 */
export const DUR = Object.freeze({ w: 4, h: 2, q: 1, 8: 0.5, 16: 0.25 });

/** Chiffrages de mesure proposés dans l'interface. */
export const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '5/4', '6/8', '12/8'];

/**
 * Durée **réelle** d'un élément de portée, en noires.
 *
 * Combine la durée écrite, le point (×1.5) et le triolet (×2/3).
 * C'est cette valeur qui sert à remplir les mesures, grouper les ligatures
 * et séquencer l'audio.
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
 * Durée **écrite** d'un élément (sans le facteur de triolet). Sert au
 * regroupement des triolets, qui raisonne sur les valeurs écrites.
 *
 * @param {StaffItem} it
 * @returns {number}
 */
export function writtenLen(it) {
  return DUR[it.d] * (it.dot ? 1.5 : 1);
}

/**
 * Capacité d'une mesure en noires.
 *
 * @example
 * mlen('4/4')  // 4
 * mlen('6/8')  // 3
 *
 * @param {string} time Chiffrage `'n/d'`.
 * @returns {number}
 */
export function mlen(time) {
  const [n, d] = time.split('/').map(Number);
  return (n * 4) / d;
}

/**
 * Unité de temps (pulsation) en noires : 1 pour les mesures simples (x/4),
 * 1.5 (noire pointée) pour les mesures composées (x/8). Sert au groupement
 * des ligatures par temps.
 *
 * @param {string} time
 * @returns {number}
 */
export function beatUnit(time) {
  return time.endsWith('/8') ? 1.5 : 1;
}

/**
 * Crée une note vide contenant un bloc texte (pour écrire tout de suite).
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
 * @param {boolean} rhythm `true` pour une ligne rythmique, `false` pour une portée en clé de sol.
 * @returns {StaffBlock}
 */
export function newStaffBlock(rhythm) {
  return { id: uid(), type: 'staff', clef: rhythm ? 'rhythm' : 'treble', time: '4/4', tempo: 100, swing: false, items: [] };
}

/**
 * Grille de 4 mesures vides en do majeur, Medium Swing à 120.
 * @returns {GridBlock}
 */
export function newGridBlock() {
  return {
    id: uid(), type: 'grid', time: '4/4', key: 'C', style: 'Medium Swing', tempo: 120,
    measures: [{ ch: [] }, { ch: [] }, { ch: [] }, { ch: [] }],
  };
}

/**
 * Note d'exemple affichée sur l'écran d'accueil vide. Montre les différents
 * types de blocs, dont une liaison et un triolet.
 * @returns {Note}
 */
export function exampleNote() {
  return {
    id: uid(), title: 'Exemple · motif sur Bb blues', created: Date.now(), updated: Date.now(),
    blocks: [
      { id: uid(), type: 'text', text: 'Motif de deux mesures, à développer en question / réponse. Essayer plus lent.' },
      {
        id: uid(), type: 'staff', clef: 'treble', time: '4/4', tempo: 132, swing: true,
        items: [
          { d: '8', s: 4, a: -1, c: 'Bb7' }, { d: '8', s: 6 }, { d: '8', s: 8 }, { d: '8', s: 10, a: -1 },
          { d: '8', s: 9, tup: 3 }, { d: '8', s: 8, tup: 3 }, { d: '8', s: 6, tup: 3 }, { d: 'q', s: 6, a: -1, tie: true },
          { d: '8', s: 6, c: 'Eb7' }, { d: '8', s: 5 }, { d: 'q', s: 4, a: -1 }, { d: 'q', r: true }, { d: 'q', s: 1 },
          { d: 'h', s: 1, c: 'Bb7' }, { d: 'h', r: true, bar: 'final' },
        ],
      },
      { id: uid(), type: 'text', text: 'Cellule rythmique pour la relance :' },
      {
        id: uid(), type: 'staff', clef: 'rhythm', time: '4/4', tempo: 132, swing: true,
        items: [{ d: '8' }, { d: '8', tie: true }, { d: 'q' }, { d: '8', dot: true }, { d: '16' }, { d: '8', r: true }, { d: '8', bar: 'final' }],
      },
    ],
  };
}
