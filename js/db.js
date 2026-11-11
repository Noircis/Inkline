/**
 * @module db
 * @description
 * **Thin layer over IndexedDB**: open the database, read a whole store,
 * write a batch of changes. The rest of the app never talks to IndexedDB
 * directly: only {@link module:storage|storage} uses this module.
 *
 * ## IndexedDB in two minutes (for a C++ developer)
 *
 * IndexedDB is a key → value database built into the browser, one per site.
 * It stores JavaScript objects (copied, like a deep `memcpy`: changing the
 * object after writing it does not change what is stored).
 *
 * - A **database** (`inkline`) contains **object stores**, the equivalent of
 *   tables: `notes` and `folders`. Each object is stored under its key, here
 *   its `id` field (`keyPath: 'id'`).
 * - Every read or write happens in a **transaction**: either all its
 *   operations succeed, or none do (atomicity, as in SQL). This is what makes
 *   migration safe: the notes are all copied, or none are.
 * - The API is **asynchronous**: an operation does not return its result, it
 *   delivers it later through an event (`onsuccess`, `oncomplete`). Here it
 *   is wrapped in `Promise`s (close to a `std::future`), so we can write
 *   `const notes = await getAll(db, 'notes')`, which reads like sequential
 *   code.
 * - The database has a **version number**. When it is opened with a higher
 *   number than the stored one, the browser calls `onupgradeneeded`: the only
 *   place where stores can be created or changed (the equivalent of a schema
 *   migration).
 */

/** Database name. */
const DB_NAME = 'inkline';

/** Schema (stores) version. Increase it for any structural change. */
const DB_VERSION = 1;

/** Stores of the database. */
export const STORES = { notes: 'notes', folders: 'folders' };

/**
 * Wraps an IndexedDB request in a `Promise`.
 * @param {IDBRequest} req
 * @returns {Promise<*>} The result of the request.
 */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Opens (and creates if needed) the database.
 * @param {string} [name=DB_NAME] Database name (tests use others).
 * @returns {Promise<IDBDatabase>}
 * @throws {Error} If IndexedDB is unavailable or refuses to open.
 */
export function openDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    // First opening (or new schema version): create the stores.
    req.onupgradeneeded = () => {
      const db = req.result;
      Object.values(STORES).forEach((s) => {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => {
      const db = req.result;
      // If a newer version of the app (in another tab) wants to
      // change the schema, release the database instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloquée par un autre onglet'));
  });
}

/**
 * Reads every object of a store.
 * @param {IDBDatabase} db
 * @param {string} store
 * @returns {Promise<Array.<Object>>}
 */
export function getAll(db, store) {
  return done(db.transaction(store, 'readonly').objectStore(store).getAll());
}

/**
 * Batch of writes on a store.
 * @typedef {Object} WriteBatch
 * @property {boolean} [clear] Empty the store first.
 * @property {Array.<Object>} [put] Objects to write (replace those with the same id).
 * @property {Array.<string>} [del] Ids to delete.
 */

/**
 * Writes batches to one or more stores, in **a single transaction**:
 * everything is written, or nothing.
 *
 * @param {IDBDatabase} db
 * @param {Object.<string, WriteBatch>} batches Key: store name.
 * @param {boolean} [strict=false] Ask the browser to wait until the data is
 *   physically on disk before confirming (slower; used when the app goes to
 *   the background and may be killed).
 * @returns {Promise<void>} Resolved when the transaction is committed.
 */
export function write(db, batches, strict = false) {
  return new Promise((resolve, reject) => {
    const names = Object.keys(batches);
    const tx = db.transaction(names, 'readwrite', { durability: strict ? 'strict' : 'default' });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction annulée'));
    names.forEach((name) => {
      const st = tx.objectStore(name);
      const b = batches[name];
      if (b.clear) st.clear();
      (b.del || []).forEach((id) => st.delete(id));
      (b.put || []).forEach((obj) => st.put(obj));
    });
  });
}
