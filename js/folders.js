/**
 * @module folders
 * @description
 * Notebook **folders** (since 2.0): model and pure operations.
 *
 * ## Model
 *
 * A folder is an object `{ id, name, color, created }`. Folders are stored
 * **separately** from notes (see {@link module:storage|storage}); a note
 * references its folder by id in the optional `folder` field. A note without
 * `folder` (or whose folder no longer exists) is "unfiled".
 *
 * No subfolders, but **categories** (2.8.6): each folder has its own ordered
 * list of categories (`cats`, for example Technique, Sound, Improv in
 * "Saxophone"). A note can have **several** (the note's `cats` field, ids of
 * its folder's categories); it then appears in each section
 * ({@link groupByCategory}). Moving a note to another folder clears its
 * categories: they only make sense in their folder.
 *
 * ## Special views
 *
 * The home folder bar offers two entries that are not folders:
 * {@link module:folders.ALL|ALL} (all notes) and
 * {@link module:folders.UNFILED|UNFILED} (unfiled notes).
 */

import { uid } from './util.js';

/** "All notes" selection of the folder bar. */
export const ALL = 'all';

/** "Unfiled notes" selection of the folder bar. */
export const UNFILED = 'none';

/** Maximum length of a folder name. */
export const FOLDER_NAME_MAX = 40;

/**
 * Colors offered for folders. The actual color comes from the theme (CSS
 * variables `--fc-<key>`, one value for light mode and one for dark mode):
 * only the key is stored.
 * Color names: `color.*` keys in the dictionaries ({@link module:i18n|i18n}).
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

/** Valid color keys. */
export const COLOR_KEYS = FOLDER_COLORS.map((c) => c.key);

/**
 * A folder.
 * @typedef {Object} Folder
 * @property {string} id
 * @property {string} name Displayed name (1 to {@link FOLDER_NAME_MAX} characters).
 * @property {string} color Color key (see {@link FOLDER_COLORS}).
 * @property {number} created Creation timestamp.
 * @property {Category[]} [cats] Categories of the folder, in display order (2.8.6).
 */

/**
 * A folder category (2.8.6).
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name Displayed name (1 to {@link CAT_NAME_MAX} characters).
 */

/** Maximum length of a category name. */
export const CAT_NAME_MAX = 30;
/** Maximum number of categories per folder. */
export const MAX_CATS = 30;
/** "Whole folder" selection of the category bar. */
export const ALL_CATS = 'all';
/** "No category" selection of the category bar. */
export const NO_CAT = 'none';

/**
 * Creates a folder.
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
 * Cleans a typed folder name: extra spaces removed, length bounded.
 * @param {string} name
 * @param {number} [max] Maximum length ({@link FOLDER_NAME_MAX} by default).
 * @returns {string} Possibly empty string.
 */
export function cleanFolderName(name, max = FOLDER_NAME_MAX) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Folders sorted by name (French alphabetical order, ignoring case and
 * accents).
 * @param {Object.<string, Folder>} folders
 * @returns {Folder[]}
 */
export function sortedFolders(folders) {
  return Object.values(folders).sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/**
 * Folder of a note, or `null` if it is unfiled (or its folder disappeared).
 * @param {module:model~Note} note
 * @param {Object.<string, Folder>} folders
 * @returns {Folder|null}
 */
export function folderOf(note, folders) {
  return (note.folder && folders[note.folder]) || null;
}

/**
 * Does the note belong to the folder bar's selection?
 * @param {module:model~Note} note
 * @param {string} selection {@link ALL}, {@link UNFILED} or a folder id.
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
 * Number of notes per selection, for the folder bar counters.
 * @param {module:model~Note[]} notes
 * @param {Object.<string, Folder>} folders
 * @returns {Object.<string, number>} Keys: {@link ALL}, {@link UNFILED} and each folder id.
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
 * Deletes a folder: its notes become unfiled again (no note is deleted).
 * Changes `notes` and `folders` in place.
 * @param {string} id
 * @param {Object.<string, module:model~Note>} notes
 * @param {Object.<string, Folder>} folders
 * @returns {number} Number of notes unfiled.
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

// ---------- Categories (2.8.6) ----------

/**
 * Adds a category to a folder (modifies the folder). A name already taken
 * (ignoring case and accents) returns the existing category.
 * @param {Folder} folder
 * @param {string} name
 * @returns {?Category} `null` if the name is empty or the folder is full.
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
 * Categories of a note, in folder order (those that no longer exist are
 * ignored).
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
 * Does the note belong to the category bar's selection?
 * @param {module:model~Note} note
 * @param {string} sel {@link ALL_CATS}, {@link NO_CAT} or a category id.
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
 * Number of notes per category of a folder.
 * @param {module:model~Note[]} notes Notes of the folder.
 * @param {Folder} folder
 * @returns {Object.<string, number>} Keys: {@link ALL_CATS}, {@link NO_CAT} and each id.
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
 * Groups a folder's notes into **sections**, one per category in folder
 * order, then "No category". A note with several categories appears in
 * each. Empty sections are left out. Note order is kept (they arrive already
 * sorted).
 * @param {module:model~Note[]} notes
 * @param {Folder} folder
 * @returns {Array.<{cat: ?Category, notes: module:model~Note[]}>} `cat` is
 *   `null` for "No category".
 */
export function groupByCategory(notes, folder) {
  const cats = folder.cats || [];
  const out = cats.map((cat) => ({ cat, notes: notes.filter((n) => (n.cats || []).includes(cat.id)) }));
  const ids = new Set(cats.map((c) => c.id));
  out.push({ cat: null, notes: notes.filter((n) => !(n.cats || []).some((id) => ids.has(id))) });
  return out.filter((g) => g.notes.length);
}

/**
 * Deletes a category: it is removed from the folder and from the notes (no
 * note is deleted). Modifies in place.
 * @param {Folder} folder
 * @param {string} catId
 * @param {Object.<string, module:model~Note>} notes
 * @returns {number} Number of notes affected.
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
 * Moves a category by one step (up `-1`, down `+1`).
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
 * Files a note: folder, and categories of that folder. Changing the folder
 * clears the categories.
 * @param {module:model~Note} note
 * @param {?string} folderId `null`: unfiled.
 * @param {Array.<string>} [cats=[]]
 */
export function fileNote(note, folderId, cats = []) {
  if (folderId) note.folder = folderId;
  else delete note.folder;
  if (folderId && cats.length) note.cats = [...new Set(cats)];
  else delete note.cats;
}
