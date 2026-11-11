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
 * Pas de sous-dossiers, mais des **catégories** (2.8.6) : chaque dossier a
 * sa propre liste ordonnée de catégories (`cats`, par exemple Technique, Son,
 * Impro dans « Saxophone »). Une note peut en avoir **plusieurs** (champ
 * `cats` de la note, ids des catégories de son dossier) ; elle apparaît alors
 * dans chacune des sections ({@link groupByCategory}). Changer une note de
 * dossier efface ses catégories : elles n'ont de sens que dans leur dossier.
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
 * Noms des couleurs : clés `color.*` des dictionnaires ({@link module:i18n|i18n}).
 * @type {Array.<{key: string}>}
 */
export const FOLDER_COLORS = [
  { key: 'red' },
  { key: 'orange' },
  { key: 'yellow' },
  { key: 'green' },
  { key: 'teal' },
  { key: 'blue' },
  { key: 'purple' },
  { key: 'gray' },
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
 * @property {Category[]} [cats] Catégories du dossier, dans l'ordre d'affichage (2.8.6).
 */

/**
 * Une catégorie de dossier (2.8.6).
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name Nom affiché (1 à {@link CAT_NAME_MAX} caractères).
 */

/** Longueur maximale d'un nom de catégorie. */
export const CAT_NAME_MAX = 30;
/** Nombre maximal de catégories par dossier. */
export const MAX_CATS = 30;
/** Sélection « tout le dossier » de la barre de catégories. */
export const ALL_CATS = 'all';
/** Sélection « sans catégorie » de la barre de catégories. */
export const NO_CAT = 'none';

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
 * @param {number} [max] Longueur maximale ({@link FOLDER_NAME_MAX} par défaut).
 * @returns {string} Chaîne éventuellement vide.
 */
export function cleanFolderName(name, max = FOLDER_NAME_MAX) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
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
      delete n.cats;
      moved++;
    }
  });
  delete folders[id];
  return moved;
}

// ---------- Catégories (2.8.6) ----------

/**
 * Ajoute une catégorie à un dossier (modifie le dossier). Un nom déjà pris
 * (sans tenir compte de la casse ni des accents) renvoie la catégorie
 * existante.
 * @param {Folder} folder
 * @param {string} name
 * @returns {?Category} `null` si le nom est vide ou si le dossier est plein.
 */
export function addCategory(folder, name) {
  const clean = cleanFolderName(name, CAT_NAME_MAX);
  if (!clean) return null;
  const cats = folder.cats || (folder.cats = []);
  const same = cats.find((c) => c.name.localeCompare(clean, 'fr', { sensitivity: 'base' }) === 0);
  if (same) return same;
  if (cats.length >= MAX_CATS) return null;
  const c = { id: uid(), name: clean };
  cats.push(c);
  return c;
}

/**
 * Catégories d'une note, dans l'ordre du dossier (celles qui n'existent plus
 * sont ignorées).
 * @param {module:model~Note} note
 * @param {Object.<string, Folder>} folders
 * @returns {Category[]}
 */
export function catsOf(note, folders) {
  const f = folderOf(note, folders);
  if (!f || !f.cats || !note.cats || !note.cats.length) return [];
  return f.cats.filter((c) => note.cats.includes(c.id));
}

/**
 * La note appartient-elle à la sélection de la barre de catégories ?
 * @param {module:model~Note} note
 * @param {string} sel {@link ALL_CATS}, {@link NO_CAT} ou un id de catégorie.
 * @param {Object.<string, Folder>} folders
 * @returns {boolean}
 */
export function inCategory(note, sel, folders) {
  if (sel === ALL_CATS) return true;
  const cats = catsOf(note, folders);
  if (sel === NO_CAT) return !cats.length;
  return cats.some((c) => c.id === sel);
}

/**
 * Nombre de notes par catégorie d'un dossier.
 * @param {module:model~Note[]} notes Notes du dossier.
 * @param {Folder} folder
 * @returns {Object.<string, number>} Clés : {@link ALL_CATS}, {@link NO_CAT} et chaque id.
 */
export function countByCategory(notes, folder) {
  const counts = { [ALL_CATS]: notes.length, [NO_CAT]: 0 };
  (folder.cats || []).forEach((c) => (counts[c.id] = 0));
  notes.forEach((n) => {
    const own = (n.cats || []).filter((id) => id in counts && id !== ALL_CATS && id !== NO_CAT);
    if (!own.length) counts[NO_CAT]++;
    own.forEach((id) => counts[id]++);
  });
  return counts;
}

/**
 * Range les notes d'un dossier en **sections**, une par catégorie dans
 * l'ordre du dossier, puis « Sans catégorie ». Une note de plusieurs
 * catégories apparaît dans chacune. Les sections vides sont omises. L'ordre
 * des notes est conservé (elles arrivent déjà triées).
 * @param {module:model~Note[]} notes
 * @param {Folder} folder
 * @returns {Array.<{cat: ?Category, notes: module:model~Note[]}>} `cat` vaut
 *   `null` pour « Sans catégorie ».
 */
export function groupByCategory(notes, folder) {
  const cats = folder.cats || [];
  const out = cats.map((cat) => ({ cat, notes: notes.filter((n) => (n.cats || []).includes(cat.id)) }));
  const ids = new Set(cats.map((c) => c.id));
  out.push({ cat: null, notes: notes.filter((n) => !(n.cats || []).some((id) => ids.has(id))) });
  return out.filter((g) => g.notes.length);
}

/**
 * Supprime une catégorie : elle est retirée du dossier et des notes (aucune
 * note n'est supprimée). Modifie sur place.
 * @param {Folder} folder
 * @param {string} catId
 * @param {Object.<string, module:model~Note>} notes
 * @returns {number} Nombre de notes concernées.
 */
export function deleteCategory(folder, catId, notes) {
  folder.cats = (folder.cats || []).filter((c) => c.id !== catId);
  let n = 0;
  Object.values(notes).forEach((note) => {
    if (note.folder === folder.id && note.cats && note.cats.includes(catId)) {
      note.cats = note.cats.filter((id) => id !== catId);
      if (!note.cats.length) delete note.cats;
      n++;
    }
  });
  return n;
}

/**
 * Déplace une catégorie d'un cran (vers le haut `-1`, vers le bas `+1`).
 * @param {Folder} folder
 * @param {string} catId
 * @param {number} dir
 */
export function moveCategory(folder, catId, dir) {
  const cats = folder.cats || [];
  const i = cats.findIndex((c) => c.id === catId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cats.length) return;
  [cats[i], cats[j]] = [cats[j], cats[i]];
}

/**
 * Range une note : dossier, et catégories de ce dossier. Changer de dossier
 * efface les catégories.
 * @param {module:model~Note} note
 * @param {?string} folderId `null` : non classée.
 * @param {Array.<string>} [cats=[]]
 */
export function fileNote(note, folderId, cats = []) {
  if (folderId) note.folder = folderId;
  else delete note.folder;
  if (folderId && cats.length) note.cats = [...new Set(cats)];
  else delete note.cats;
}
