/**
 * @module storage
 * @description
 * Persistence of the notebook (notes and folders), and backup/restore as a
 * JSON file.
 *
 * ## Where is the data? (since 2.1)
 *
 * In **IndexedDB** (see {@link module:db|db}): one record per note and per
 * folder. Up to 2.0, the whole notebook was a single JSON string in
 * `localStorage`, which had two limits:
 *
 * - **size**: about 5 MB per site for `localStorage`, versus hundreds of MB
 *   for IndexedDB;
 * - **cost**: every keystroke rewrote the whole notebook. Now only the
 *   changed note is written.
 *
 * The **metadata** (chosen display, selected folder, last backup date…) stay
 * in `localStorage`: they are tiny, and reading them synchronously is handy.
 *
 * ## Migration from `localStorage`
 *
 * On the first launch of 2.1, {@link module:storage.loadAll|loadAll} copies
 * the notes and folders from `localStorage` to IndexedDB, **in a single
 * transaction** (all or nothing), then records `storage: 'idb'` in the
 * metadata. The copy only happens if the IndexedDB database is **empty**:
 * data already there is never overwritten by the old copy.
 *
 * The old copy is **not erased**: it stays as a safety net (frozen at the
 * migration date). Golden rule: never move and delete data in the same
 * operation.
 *
 * If IndexedDB is unavailable (very old browser, storage blocked), the app
 * keeps going with `localStorage`, as before 2.1.
 *
 * ## Write strategy
 *
 * - **Debounce**: each change schedules a write 150 ms later; close
 *   keystrokes trigger only one.
 * - **"Dirty" notes**: {@link module:storage.scheduleSave|scheduleSave}
 *   receives the id of the changed note; only those notes are written.
 * - **Comparison**: {@link module:storage.flushSave|flushSave} compares each
 *   note to its last written version (its JSON form) and writes only the
 *   differences, deletions included. It is a safety net: after a bulk
 *   operation (import, folder deletion…), nothing can be forgotten, even if
 *   the caller does not know which notes changed.
 * - **Flush** on `visibilitychange` (see {@link module:main|main}): Android
 *   may kill an app in the background without warning; so everything is
 *   written right away, in `strict` mode (the browser waits until it is on
 *   disk).
 * - `navigator.storage.persist()` asks the browser not to evict the data
 *   when disk space runs low.
 *
 * Writes are asynchronous and their errors (quota exceeded…) do not block
 * the app: a note that was not written stays "different" and will be retried
 * on the next write.
 */

import { sanitizeNote, sanitizeNotes, sanitizeFolders } from './sanitize.js';
import { SORT_KEYS } from './search.js';
import { openDb, getAll, write, STORES } from './db.js';
import { METERS, meterOf, slotsOf } from './placements.js';

/** `localStorage` key of the notebook up to 2.0 (historical: do not change). */
const STORAGE_KEY = 'carnet-portees-v1';

/** Id written in backup files. */
const BACKUP_APP = 'carnet-portees';

/** `localStorage` key of the folders in 2.0. */
const FOLDERS_KEY = 'inkline-folders';

/** Backup format version: 2 since folders arrived. v1 backups stay readable. */
const BACKUP_VERSION = 2;

/** `localStorage` key of the metadata (first use date, last backup date). */
const META_KEY = 'inkline-meta';

/** Id written in shared note files (`.inkline`). */
const NOTE_APP = 'inkline';

/** Write debounce delay (ms). */
const SAVE_DELAY = 150;

/**
 * Where the notebook is stored.
 * @type {'idb'|'local'}
 */
let backend = 'local';

/** @type {IDBDatabase|null} */
let db = null;

/**
 * Last written version of each note, as JSON (id → string). Used to know
 * what changed since the last write.
 * @type {Map.<string, string>}
 */
const saved = new Map();

/** JSON of the whole notebook at the last write (`localStorage` mode). */
let savedLocal = '';

/** Notes changed since the last write (ids). */
const dirty = new Set();

/** Must a scheduled write compare everything (call without an id)? */
let fullPending = false;

let timer = null;

/**
 * Content loaded at startup.
 * @typedef {Object} LoadResult
 * @property {Object.<string, module:model~Note>} notes
 * @property {Object.<string, module:folders~Folder>} folders
 * @property {'idb'|'local'} backend Where the notebook is stored.
 * @property {boolean} migrated The migration from `localStorage` just happened.
 */

/**
 * Reads a JSON value from `localStorage` (empty object if missing or unreadable).
 * @param {string} key
 * @returns {*}
 */
function readLocal(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch (e) {
    return {};
  }
}

/**
 * Reads both stores.
 * @param {IDBDatabase} database
 * @returns {Promise<Array.<Array.<Object>>>} Raw `[notes, folders]`.
 */
function readDb(database) {
  return Promise.all([getAll(database, STORES.notes), getAll(database, STORES.folders)]);
}

/**
 * Loads the notebook (asynchronous: to be awaited).
 *
 * All data read is validated
 * ({@link module:sanitize.sanitizeNotes|sanitizeNotes}): it may have been
 * written by an old version, or corrupted. Invalid data must never reach the
 * renderer.
 *
 * @returns {Promise<LoadResult>}
 */
export async function loadAll() {
  saved.clear();
  dirty.clear();
  try {
    db = await openDb();
    let [rawNotes, rawFolders] = await readDb(db);
    let migrated = false;
    if (getMeta().storage !== 'idb') {
      // Only migrate to an EMPTY database: if it already holds data
      // (lost metadata, for example), that data is newer than the
      // localStorage copy and must certainly not be overwritten.
      if (!rawNotes.length && !rawFolders.length) {
        await migrateFromLocal(db);
        migrated = true;
        [rawNotes, rawFolders] = await readDb(db);
      }
      setMeta({ storage: 'idb' });
    }
    // Remember what is really on disk (before validation): if
    // validation fixes a note, the first write will save the fixed
    // version.
    rawNotes.forEach((r) => {
      if (r && typeof r.id === 'string') saved.set(r.id, JSON.stringify(r));
    });
    backend = 'idb';
    return { notes: sanitizeNotes(rawNotes), folders: sanitizeFolders(rawFolders), backend, migrated };
  } catch (e) {
    // IndexedDB unavailable: stay on localStorage, as before 2.1.
    db = null;
    backend = 'local';
    try {
      savedLocal = localStorage.getItem(STORAGE_KEY) || '';
    } catch (e2) {
      savedLocal = '';
    }
    return {
      notes: sanitizeNotes(readLocal(STORAGE_KEY)),
      folders: sanitizeFolders(readLocal(FOLDERS_KEY)),
      backend,
      migrated: false,
    };
  }
}

/**
 * Copies the notebook from `localStorage` to IndexedDB, in one transaction:
 * if the app is killed halfway, nothing is written and the migration starts
 * over on the next launch. The original is kept.
 * @param {IDBDatabase} database
 * @returns {Promise<void>}
 */
async function migrateFromLocal(database) {
  const notes = Object.values(sanitizeNotes(readLocal(STORAGE_KEY)));
  const folders = Object.values(sanitizeFolders(readLocal(FOLDERS_KEY)));
  await write(database, { [STORES.notes]: { put: notes }, [STORES.folders]: { put: folders } }, true);
}

/**
 * Where the notebook is stored (for the Settings screen and tests).
 * @returns {'idb'|'local'}
 */
export function storageBackend() {
  return backend;
}

/**
 * Schedules a write (debounce of {@link SAVE_DELAY} ms).
 * @param {Object.<string, module:model~Note>} notes The notebook.
 * @param {string} [id] Changed note. Without an id, every note is compared.
 */
export function scheduleSave(notes, id) {
  if (id) dirty.add(id);
  else fullPending = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const ids = fullPending ? null : [...dirty];
    dirty.clear();
    fullPending = false;
    writeChanges(notes, ids, false);
  }, SAVE_DELAY);
}

/**
 * Writes everything that changed right away (comparing every note).
 * @param {Object.<string, module:model~Note>} notes
 * @param {boolean} [strict=false] Wait for the physical write to disk.
 * @returns {Promise<void>} Resolved when the write is done (or failed).
 */
export function flushSave(notes, strict = false) {
  clearTimeout(timer);
  dirty.clear();
  fullPending = false;
  return writeChanges(notes, null, strict);
}

/**
 * Writes the notes that differ from their last written version.
 *
 * Subtle point: IndexedDB copies each object **at the time** of `put`, and
 * `write` issues the `put`s immediately (before the first `await`). The
 * compared JSON and the written object therefore match exactly the same
 * state of the note, even if the user keeps typing during the write.
 *
 * @param {Object.<string, module:model~Note>} notes
 * @param {?Array.<string>} ids Notes to examine, or `null` for all (and to
 *   detect deletions).
 * @param {boolean} strict
 * @returns {Promise<void>}
 */
async function writeChanges(notes, ids, strict) {
  if (backend === 'local') {
    try {
      const json = JSON.stringify(notes);
      if (json !== savedLocal) localStorage.setItem(STORAGE_KEY, json);
      savedLocal = json;
    } catch (e) {
      /* storage unavailable: the user can export */
    }
    return;
  }
  /** @type {Map.<string, string>} */
  const changed = new Map();
  const put = [];
  (ids || Object.keys(notes)).forEach((id) => {
    const n = notes[id];
    if (!n) return;
    const json = JSON.stringify(n);
    if (saved.get(id) === json) return;
    changed.set(id, json);
    put.push(n);
  });
  // Deletions: notes written before and missing from the notebook.
  const del = (ids || [...saved.keys()]).filter((id) => !notes[id] && saved.has(id));
  if (!put.length && !del.length) return;
  try {
    await write(db, { [STORES.notes]: { put, del } }, strict);
    changed.forEach((json, id) => saved.set(id, json));
    del.forEach((id) => saved.delete(id));
  } catch (e) {
    /* quota exceeded, database closed…: these notes stay "different" and will be retried */
  }
}

/**
 * Requests persistent storage (no effect if unsupported).
 */
export function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {
    /* ignored */
  }
}

/**
 * Saves the folders (right away: they change rarely and weigh little, so the
 * whole store is rewritten).
 * @param {Object.<string, module:folders~Folder>} folders
 * @returns {Promise<void>}
 */
export async function saveFolders(folders) {
  if (backend === 'local') {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch (e) {
      /* storage unavailable */
    }
    return;
  }
  try {
    await write(db, { [STORES.folders]: { clear: true, put: Object.values(folders) } });
  } catch (e) {
    /* retried on the next folder change */
  }
}

/**
 * Content of a backup file (v2 format: notes and folders).
 * @param {Object.<string, module:model~Note>} notes
 * @param {Object.<string, module:folders~Folder>} [folders={}]
 * @returns {string} Indented JSON (readable and diffable).
 */
export function backupJson(notes, folders = {}) {
  return JSON.stringify(
    { app: BACKUP_APP, version: BACKUP_VERSION, exported: Date.now(), notes, folders },
    null,
    1,
  );
}

/**
 * Content of an `.inkline` file: a single note, to send to someone.
 * @param {module:model~Note} note
 * @returns {string}
 */
export function noteFileJson(note) {
  // Filing (folder, categories, pin, collapsed blocks) stays at home: it makes
  // no sense for the recipient.
  // eslint-disable-next-line no-unused-vars
  const { folder, cats, pinned, ...shared } = note;
  shared.blocks = note.blocks.map((b) => {
    // eslint-disable-next-line no-unused-vars
    const { fold, ...rest } = b;
    return rest;
  });
  return JSON.stringify({ app: NOTE_APP, kind: 'note', version: 1, note: shared }, null, 1);
}

/**
 * Result of an import.
 * @typedef {Object} ImportResult
 * @property {'note'|'backup'} kind Type of file recognized.
 * @property {number} count Number of notes added or updated.
 * @property {string|null} firstId Id of the imported note (to open it directly).
 */

/**
 * Imports a file into the notebook: shared note (`.inkline`) or full backup.
 *
 * - **Shared note**: it is **added** with new ids, never overwriting an
 *   existing note (receiving the same note twice creates two copies, on
 *   purpose: we cannot know which one to keep).
 * - **Backup**: merged by id, the most recent version (`updated`) wins.
 *   Importing the same backup twice has no effect. Folders of a v2 backup
 *   missing from the notebook are added; those already there (same id) are
 *   kept as they are. A v1 backup (no folders) stays readable.
 *
 * In both cases, everything goes through {@link module:sanitize|sanitize}.
 *
 * @param {Object.<string, module:model~Note>} notes Notebook (modified in place).
 * @param {string} text File content.
 * @param {Object.<string, module:folders~Folder>} [folders={}] Folders (modified in place).
 * @returns {ImportResult}
 * @throws {Error} If the file is neither JSON nor an Inkline format.
 */
export function importFile(notes, text, folders = {}) {
  const d = JSON.parse(text);
  if (d && d.kind === 'note' && d.note) {
    const n = sanitizeNote(d.note, { freshIds: true });
    if (!n) throw new Error('note invalide');
    // The received note keeps its original creation date; it is "modified"
    // now (it moves to the top of the list).
    n.updated = Date.now();
    notes[n.id] = n;
    return { kind: 'note', count: 1, firstId: n.id };
  }
  const incoming = sanitizeNotes(d && d.notes ? d.notes : d);
  if (d && d.folders) {
    Object.values(sanitizeFolders(d.folders)).forEach((f) => {
      // Folder already there: add the categories it is missing (2.8.6),
      // so that imported notes keep theirs.
      const here = folders[f.id];
      if (here && f.cats) {
        const ids = new Set((here.cats || []).map((c) => c.id));
        const extra = f.cats.filter((c) => !ids.has(c.id));
        if (extra.length) here.cats = [...(here.cats || []), ...extra];
      }
      if (!here) folders[f.id] = f;
    });
  }
  let count = 0;
  let firstId = null;
  Object.values(incoming).forEach((n) => {
    const cur = notes[n.id];
    if (!cur || n.updated >= cur.updated) {
      notes[n.id] = n;
      count++;
      firstId = firstId || n.id;
    }
  });
  if (!count && !Object.keys(incoming).length) throw new Error('aucune note');
  return { kind: 'backup', count, firstId };
}

/**
 * Notebook metadata, stored apart from the notes.
 * @typedef {Object} Meta
 * @property {number} [firstUse] Timestamp of the app's first opening.
 * @property {number} [lastExport] Timestamp of the last "Export notebook".
 * @property {'cards'|'mosaic'|'list'} [listView] List display chosen in Settings.
 * @property {string} [folder] Folder bar selection (`'all'`, `'none'` or folder id).
 * @property {Object.<string, string>} [sorts] Sort chosen for each folder bar selection.
 * @property {string} [lang] Interface language (2.9): `auto`, `en` or `fr`.
 * @property {Object.<string, string>} [catSel] Category chosen in each folder (2.8.6): `'all'`, `'none'` or id.
 * @property {Object.<string, boolean>} [catFold] Collapsed sections of home (2.8.6), keys `folder:category`.
 * @property {number} [dataVersion] Version of the local data format (2 since 2.0).
 * @property {'idb'} [storage] Present once the notebook has been migrated to IndexedDB (2.1).
 * @property {boolean} [autoFold] "Collapse long blocks automatically" option (2.2).
 * @property {module:storage~DrillSettings} [drill] Last settings of Rhythm practice (2.3).
 * @property {module:storage~GenSettings} [gen] Last settings of random exercises (2.8).
 */

/**
 * Rhythm practice settings, shared by Placements and random exercises
 * (except `notes` and `meter`, specific to Placements).
 * @typedef {Object} DrillSettings
 * @property {number} notes Notes per measure (1 to 12).
 * @property {string} meter Placements time signature (key of {@link module:placements.METERS|METERS}, 2.8).
 * @property {number} tempo Tempo (quarter note).
 * @property {boolean} swing
 * @property {Object.<string, Array.<boolean>>} beats Beats where the metronome
 *   clicks, per time signature (2.8; an array of 4 before). Missing for a
 *   time signature: every beat.
 * @property {boolean} accent Accent on 1.
 * @property {boolean} countIn Count-in measure.
 * @property {boolean} mute Mute the rhythm (metronome only).
 * @property {boolean} loop Loop playback (random exercises, 2.8).
 */

/** Default Rhythm practice settings. */
export const DRILL_DEFAULTS = Object.freeze({
  notes: 1,
  meter: '4/4',
  tempo: 80,
  swing: false,
  beats: Object.freeze({}),
  accent: false,
  countIn: true,
  mute: false,
  loop: false,
});

const int = (v, lo, hi, def) => (Number.isInteger(v) && v >= lo && v <= hi ? v : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const meterKey = (v) => (METERS.some((m) => m.key === v) ? v : '4/4');

/**
 * Validates the metronome beats per time signature. Accepts the old format
 * (2.3 to 2.7: an array of 4, for 4/4).
 * @param {*} r
 * @returns {Object.<string, Array.<boolean>>}
 */
function beatsOf(r) {
  if (Array.isArray(r)) r = { '4/4': r };
  const out = {};
  if (!r || typeof r !== 'object') return out;
  METERS.forEach((m) => {
    const v = r[m.key];
    if (Array.isArray(v) && v.length === m.groups.length && v.every((x) => typeof x === 'boolean'))
      out[m.key] = v.slice();
  });
  return out;
}

/**
 * Validates Rhythm practice settings (defaults for whatever is missing).
 * @param {*} r
 * @returns {DrillSettings|undefined}
 */
function drillOf(r) {
  if (!r || typeof r !== 'object') return undefined;
  const d = DRILL_DEFAULTS;
  const meter = meterKey(r.meter);
  return {
    notes: int(r.notes, 1, slotsOf(meterOf(meter)), d.notes),
    meter,
    tempo: int(r.tempo, 30, 300, d.tempo),
    swing: bool(r.swing, d.swing),
    beats: beatsOf(r.beats),
    accent: bool(r.accent, d.accent),
    countIn: bool(r.countIn, d.countIn),
    mute: bool(r.mute, d.mute),
    loop: bool(r.loop, d.loop),
  };
}

/**
 * Random exercise settings (2.8).
 * @typedef {Object} GenSettings
 * @property {string} meter Time signature (key of {@link module:placements.METERS|METERS}).
 * @property {number} measures Exercise length: 1, 2 or 4 measures (4, 8 or 12 in 2.8.0).
 * @property {number} min Notes per measure, at least.
 * @property {number} max Notes per measure, at most.
 * @property {Object.<string, Array.<number>>} starts Allowed positions for the
 *   first note, per time signature. Missing for a time signature: all.
 * @property {number} seed Number of the last exercise.
 */

/** Default random exercise settings. */
export const GEN_DEFAULTS = Object.freeze({
  meter: '4/4',
  measures: 4,
  min: 2,
  max: 3,
  starts: Object.freeze({}),
  seed: 1,
});

/**
 * Validates random exercise settings.
 * @param {*} r
 * @returns {GenSettings|undefined}
 */
function genOf(r) {
  if (!r || typeof r !== 'object') return undefined;
  const d = GEN_DEFAULTS;
  const meter = meterKey(r.meter);
  const slots = slotsOf(meterOf(meter));
  const min = int(r.min, 1, slots, Math.min(d.min, slots));
  const starts = {};
  if (r.starts && typeof r.starts === 'object')
    METERS.forEach((m) => {
      const v = r.starts[m.key];
      const n = slotsOf(m);
      if (Array.isArray(v) && v.length && v.every((x) => Number.isInteger(x) && x >= 0 && x < n))
        starts[m.key] = [...new Set(v)].sort((a, b) => a - b);
    });
  return {
    meter,
    measures: [1, 2, 4].includes(r.measures) ? r.measures : d.measures,
    min,
    max: int(r.max, min, slots, Math.max(min, Math.min(d.max, slots))),
    starts,
    seed: int(r.seed, 1, 9999, d.seed),
  };
}

/**
 * Keeps only the valid sorts of a `{ selection: sort }` object.
 * @param {*} r
 * @returns {Object.<string, string>|undefined}
 */
function sortsOf(r) {
  if (!r || typeof r !== 'object') return undefined;
  const out = {};
  Object.keys(r)
    .slice(0, 300)
    .forEach((k) => {
      if (/^[a-z0-9]{1,32}$/.test(k) && SORT_KEYS.includes(r[k])) out[k] = r[k];
    });
  return out;
}

/**
 * Validates a small metadata dictionary: bounded keys and values.
 * @param {*} r
 * @param {RegExp} keyRe
 * @param {function(*): boolean} ok Accepted value.
 * @returns {Object|undefined}
 */
function dictOf(r, keyRe, ok) {
  if (!r || typeof r !== 'object') return undefined;
  const out = {};
  Object.keys(r)
    .slice(0, 500)
    .forEach((k) => {
      if (keyRe.test(k) && ok(r[k])) out[k] = r[k];
    });
  return out;
}

/**
 * Reads the metadata (empty object if missing or unreadable).
 * @returns {Meta}
 */
export function getMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || '{}') || {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const views = ['cards', 'mosaic', 'list'];
    return {
      firstUse: num(m.firstUse),
      lastExport: num(m.lastExport),
      listView: views.includes(m.listView) ? m.listView : undefined,
      folder: typeof m.folder === 'string' && /^[a-z0-9]{1,32}$/.test(m.folder) ? m.folder : undefined,
      sorts: sortsOf(m.sorts),
      lang: ['auto', 'en', 'fr'].includes(m.lang) ? m.lang : undefined,
      catSel: dictOf(
        m.catSel,
        /^[a-z0-9]{1,32}$/,
        (v) => typeof v === 'string' && /^[a-z0-9]{1,32}$/.test(v),
      ),
      catFold: dictOf(m.catFold, /^[a-z0-9]{1,32}:[a-z0-9]{1,32}$/, (v) => v === true),
      dataVersion: num(m.dataVersion),
      storage: m.storage === 'idb' ? 'idb' : undefined,
      autoFold: m.autoFold === true ? true : undefined,
      drill: drillOf(m.drill),
      gen: genOf(m.gen),
    };
  } catch (e) {
    return {};
  }
}

/**
 * Updates part of the metadata.
 * @param {Meta} patch
 */
export function setMeta(patch) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ ...getMeta(), ...patch }));
  } catch (e) {
    /* storage unavailable */
  }
}
