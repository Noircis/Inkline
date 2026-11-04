/**
 * @module folders
 * @description
 * **Dossiers** du carnet (depuis la 2.0) : modèle et opérations pures.
 *
 * ## Modèle
 *
 * Un dossier est un objet `{ id, name, color, created }`. Les dossiers sont
 * stockés **à part** des notes (voir {@link module:storage|storage}) ; une note
 * référence son dossier par son id dans le champ optionnel `folder`. Une note
 * sans `folder` (ou dont le dossier n'existe plus) est « non classée ».
 *
 * Un seul niveau : pas de sous-dossiers. C'est un choix de simplicité pour
 * un usage au téléphone (un dossier par cours, par projet…).
 *
 * ## Vues spéciales
 *
 * La barre de dossiers de l'accueil propose deux entrées qui ne sont pas des
 * dossiers : {@link module:folders.ALL|ALL} (toutes les notes) et
 * {@link module:folders.UNFILED|UNFILED} (notes non classées).
 */

import { uid } from './util.js';

/** Sélection « toutes les notes » de la barre de dossiers. */
export const ALL = 'all';

/** Sélection « notes non classées » de la barre de dossiers. */
export const UNFILED = 'none';

/** Longueur maximale d'un nom de dossier. */
export const FOLDER_NAME_MAX = 40;

/**
 * Couleurs proposées pour les dossiers. La couleur réelle vient du thème
 * (variables CSS `--fc-<clé>`, une valeur pour le mode clair et une pour le
 * mode sombre) : on ne stocke que la clé.
 * @type {Array.<{key: string, label: string}>}
 */
export const FOLDER_COLORS = [
  { key: 'red', label: 'Rouge' },
  { key: 'orange', label: 'Orange' },
  { key: 'yellow', label: 'Jaune' },
  { key: 'green', label: 'Vert' },
  { key: 'teal', label: 'Turquoise' },
  { key: 'blue', label: 'Bleu' },
  { key: 'purple', label: 'Violet' },
  { key: 'gray', label: 'Gris' },
];

/** Clés de couleur valides. */
export const COLOR_KEYS = FOLDER_COLORS.map((c) => c.key);

/**
 * Un dossier.
 * @typedef {Object} Folder
 * @property {string} id
 * @property {string} name Nom affiché (1 à {@link FOLDER_NAME_MAX} caractères).
 * @property {string} color Clé de couleur (voir {@link FOLDER_COLORS}).
 * @property {number} created Horodatage de création.
 */

/**
 * Crée un dossier.
 * @param {string} name
 * @param {string} [color='blue']
 * @returns {Folder}
 */
export function newFolder(name, color = 'blue') {
  return {
    id: uid(),
    name: cleanFolderName(name) || 'Dossier',
    color: COLOR_KEYS.includes(color) ? color : 'blue',
    created: Date.now(),
  };
}

/**
 * Nettoie un nom de dossier saisi : espaces superflus retirés, longueur bornée.
 * @param {string} name
 * @returns {string} Chaîne éventuellement vide.
 */
export function cleanFolderName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FOLDER_NAME_MAX);
}

/**
 * Dossiers triés par nom (ordre alphabétique français, sans tenir compte de
 * la casse ni des accents).
 * @param {Object.<string, Folder>} folders
 * @returns {Folder[]}
 */
export function sortedFolders(folders) {
  return Object.values(folders).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/**
 * Dossier d'une note, ou `null` si elle n'est pas classée (ou si son dossier
 * a disparu).
 * @param {module:model~Note} note
 * @param {Object.<string, Folder>} folders
 * @returns {Folder|null}
 */
export function folderOf(note, folders) {
  return (note.folder && folders[note.folder]) || null;
}

/**
 * La note appartient-elle à la sélection de la barre de dossiers ?
 * @param {module:model~Note} note
 * @param {string} selection {@link ALL}, {@link UNFILED} ou un id de dossier.
 * @param {Object.<string, Folder>} folders
 * @returns {boolean}
 */
export function inSelection(note, selection, folders) {
  if (selection === ALL) return true;
  const f = folderOf(note, folders);
  if (selection === UNFILED) return !f;
  return !!f && f.id === selection;
}

/**
 * Nombre de notes par sélection, pour les compteurs de la barre de dossiers.
 * @param {module:model~Note[]} notes
 * @param {Object.<string, Folder>} folders
 * @returns {Object.<string, number>} Clés : {@link ALL}, {@link UNFILED} et chaque id de dossier.
 */
export function countByFolder(notes, folders) {
  const counts = { [ALL]: notes.length, [UNFILED]: 0 };
  Object.keys(folders).forEach((id) => {
    counts[id] = 0;
  });
  notes.forEach((n) => {
    const f = folderOf(n, folders);
    if (f) counts[f.id]++;
    else counts[UNFILED]++;
  });
  return counts;
}

/**
 * Supprime un dossier : ses notes redeviennent non classées (aucune note
 * n'est supprimée). Modifie `notes` et `folders` sur place.
 * @param {string} id
 * @param {Object.<string, module:model~Note>} notes
 * @param {Object.<string, Folder>} folders
 * @returns {number} Nombre de notes déclassées.
 */
export function deleteFolder(id, notes, folders) {
  let moved = 0;
  Object.values(notes).forEach((n) => {
    if (n.folder === id) {
      delete n.folder;
      moved++;
    }
  });
  delete folders[id];
  return moved;
}
