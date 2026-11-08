/**
 * @module db
 * @description
 * **Petite couche au-dessus d'IndexedDB** : ouvrir la base, lire tout un
 * magasin, écrire un lot de modifications. Le reste de l'app ne parle jamais
 * directement à IndexedDB : seul {@link module:storage|storage} utilise ce module.
 *
 * ## IndexedDB en deux minutes (pour un développeur C++)
 *
 * IndexedDB est une base de données clé → valeur intégrée au navigateur, une
 * par site. On y range des objets JavaScript (copiés, comme un `memcpy`
 * profond : modifier l'objet après l'écriture ne change pas ce qui est stocké).
 *
 * - Une **base** (`inkline`) contient des **magasins** (*object stores*),
 *   l'équivalent de tables : `notes` et `folders`. Chaque objet est rangé
 *   sous sa clé, ici son champ `id` (`keyPath: 'id'`).
 * - Toute lecture ou écriture se fait dans une **transaction** : soit toutes
 *   ses opérations réussissent, soit aucune (atomicité, comme en SQL). C'est
 *   ce qui rend la migration sûre : les notes sont toutes copiées, ou pas du tout.
 * - L'API est **asynchrone** : une opération ne renvoie pas son résultat,
 *   elle le livre plus tard via un événement (`onsuccess`, `oncomplete`). On
 *   l'enveloppe ici dans des `Promise` (proches d'un `std::future`), pour
 *   écrire `const notes = await getAll(db, 'notes')`, qui se lit comme du
 *   code séquentiel.
 * - La base a un **numéro de version**. Quand on l'ouvre avec un numéro plus
 *   grand que celui stocké, le navigateur appelle `onupgradeneeded` : c'est le
 *   seul endroit où l'on peut créer ou modifier des magasins (l'équivalent
 *   d'une migration de schéma).
 */

/** Nom de la base. */
const DB_NAME = 'inkline';

/** Version du schéma (magasins). À augmenter pour toute modification de structure. */
const DB_VERSION = 1;

/** Magasins de la base. */
export const STORES = { notes: 'notes', folders: 'folders' };

/**
 * Enveloppe une requête IndexedDB dans une `Promise`.
 * @param {IDBRequest} req
 * @returns {Promise<*>} Le résultat de la requête.
 */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Ouvre (et crée au besoin) la base.
 * @param {string} [name=DB_NAME] Nom de la base (les tests en utilisent d'autres).
 * @returns {Promise<IDBDatabase>}
 * @throws {Error} Si IndexedDB est indisponible ou refuse l'ouverture.
 */
export function openDb(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    // Première ouverture (ou nouvelle version du schéma) : on crée les magasins.
    req.onupgradeneeded = () => {
      const db = req.result;
      Object.values(STORES).forEach((s) => {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si une version plus récente de l'app (dans un autre onglet) veut
      // modifier le schéma, on libère la base au lieu de la bloquer.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloquée par un autre onglet'));
  });
}

/**
 * Lit tous les objets d'un magasin.
 * @param {IDBDatabase} db
 * @param {string} store
 * @returns {Promise<Array.<Object>>}
 */
export function getAll(db, store) {
  return done(db.transaction(store, 'readonly').objectStore(store).getAll());
}

/**
 * Lot d'écritures sur un magasin.
 * @typedef {Object} WriteBatch
 * @property {boolean} [clear] Vider le magasin d'abord.
 * @property {Array.<Object>} [put] Objets à écrire (remplacent ceux de même id).
 * @property {Array.<string>} [del] Ids à supprimer.
 */

/**
 * Écrit des lots sur un ou plusieurs magasins, dans **une seule transaction**
 * : tout est écrit, ou rien.
 *
 * @param {IDBDatabase} db
 * @param {Object.<string, WriteBatch>} batches Clé : nom du magasin.
 * @param {boolean} [strict=false] Demander au navigateur d'attendre que les
 *   données soient physiquement sur le disque avant de confirmer (plus lent ;
 *   utilisé quand l'app passe en arrière-plan et risque d'être tuée).
 * @returns {Promise<void>} Résolue quand la transaction est validée.
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
