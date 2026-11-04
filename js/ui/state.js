/**
 * @module ui/state
 * @description
 * **État de l'interface**, partagé par tous les modules `ui/*`.
 *
 * L'app suit un modèle *immediate mode* : il n'y a pas de framework réactif.
 * Un module modifie `state` (ou une note), puis demande explicitement le
 * re-rendu de ce qui a changé (`renderNote`, `redrawStaff`, `redrawGrid`).
 *
 * Toutes les variables d'état sont regroupées ici plutôt qu'éparpillées en
 * variables globales : on sait ainsi ce qui existe et qui le modifie.
 */

import { scheduleSave } from '../storage.js';

/**
 * Réglages de saisie de la palette de portée, utilisés pour la **prochaine**
 * note ajoutée (quand aucune note n'est sélectionnée).
 *
 * @typedef {Object} InputSettings
 * @property {module:model~DurationCode} d Valeur.
 * @property {boolean} dot Pointée.
 * @property {boolean} rest Mode silence (persistant).
 * @property {?number} acc Altération (consommée par la prochaine note).
 * @property {boolean} rs La prochaine note ouvre une reprise (consommé).
 * @property {boolean} tie La prochaine note est liée à la précédente (consommé).
 * @property {boolean} tup Mode triolet (persistant).
 */

/**
 * @typedef {Object} UiState
 * @property {Object.<string, module:model~Note>} notes Le carnet.
 * @property {Object.<string, module:folders~Folder>} folders Les dossiers.
 * @property {{name: 'list'|'note'|'options', id: string|null}} view Écran affiché.
 * @property {string} query Recherche en cours sur l'accueil (non mémorisée).
 * @property {string|null} activeId Bloc en cours d'édition (une palette est ouverte).
 * @property {number|null} sel Sélection dans le bloc actif : index d'élément
 *   de portée **ou** index de mesure de grille, selon le type du bloc. Un seul
 *   bloc est actif à la fois, il n'y a donc pas d'ambiguïté ; `setActive`
 *   remet `sel` à `null` à chaque changement de bloc.
 * @property {number|null} playIdx Élément ou mesure en cours de lecture.
 * @property {InputSettings} input
 */

/** @type {UiState} */
export const state = {
  notes: {},
  folders: {},
  query: '',
  view: { name: 'list', id: null },
  activeId: null,
  sel: null,
  playIdx: null,
  input: { d: 'q', dot: false, rest: false, acc: null, rs: false, tie: false, tup: false },
};

/**
 * Note affichée, ou `undefined` sur la liste.
 * @returns {module:model~Note|undefined}
 */
export function curNote() {
  return state.view.id ? state.notes[state.view.id] : undefined;
}

/**
 * Bloc de la note affichée, par id.
 * @param {string|null} id
 * @returns {module:model~Block|null}
 */
export function blockById(id) {
  const n = curNote();
  return (n && id && n.blocks.find((b) => b.id === id)) || null;
}

/**
 * Marque une note comme modifiée et programme la sauvegarde.
 * @param {module:model~Note} n
 */
export function touch(n) {
  n.updated = Date.now();
  scheduleSave(state.notes);
}

/**
 * Enregistre un changement de **rangement** (dossier, épingle) : contrairement
 * à {@link module:ui/state.touch|touch}, la date de modification ne change
 * pas. Ranger une note n'est pas la modifier : elle ne doit pas remonter en
 * tête du tri « Modifiées récemment ».
 */
export function saveArrangement() {
  scheduleSave(state.notes);
}

/** Élément racine où sont rendues les vues. */
export const app = /** @type {HTMLElement} */ (document.getElementById('app'));
