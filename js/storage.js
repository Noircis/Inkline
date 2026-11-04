/**
 * @module storage
 * @description
 * Persistance des notes dans `localStorage`, et sauvegarde/restauration en
 * fichier JSON.
 *
 * ## Stratégie d'écriture
 *
 * - **Debounce** : chaque modification programme une écriture 150 ms plus
 *   tard ; les frappes rapprochées n'en déclenchent qu'une. Sérialiser tout le
 *   carnet à chaque caractère serait inutilement coûteux.
 * - **Flush** sur `visibilitychange` (voir {@link module:main|main}) : Android peut
 *   tuer une app en arrière-plan sans prévenir ; on écrit donc immédiatement
 *   quand la page passe en arrière-plan.
 * - `navigator.storage.persist()` demande au navigateur de ne pas évincer
 *   les données quand l'espace disque manque.
 *
 * La clé de stockage date de la première version (« Carnet de portées ») et
 * n'a pas été renommée, pour ne pas perdre les notes existantes.
 *
 * ## Limites
 *
 * `localStorage` est synchrone et plafonné à environ 5 Mo par origine, ce qui
 * représente déjà plusieurs milliers de notes. Au-delà, il faudrait migrer
 * vers IndexedDB.
 */

/** Clé `localStorage` du carnet (historique : ne pas changer). */
export const STORAGE_KEY = 'carnet-portees-v1';

/** Identifiant écrit dans les fichiers de sauvegarde. */
const BACKUP_APP = 'carnet-portees';

let timer = null;

/**
 * Vérifie grossièrement qu'un objet ressemble à une note (garde-fou contre
 * des données corrompues ou un fichier étranger).
 * @param {*} n
 * @returns {boolean}
 */
function isNote(n) {
  return !!n && typeof n.id === 'string' && Array.isArray(n.blocks);
}

/**
 * Charge le carnet. Retourne un objet vide si rien n'est stocké, si le JSON
 * est illisible ou si le stockage est indisponible (navigation privée).
 * @returns {Object.<string, module:model~Note>}
 */
export function loadNotes() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { data = {}; }
  Object.keys(data).forEach((k) => { if (!isNote(data[k])) delete data[k]; });
  return data;
}

/**
 * Programme une écriture (debounce 150 ms).
 * @param {Object.<string, module:model~Note>} notes
 */
export function scheduleSave(notes) {
  clearTimeout(timer);
  timer = setTimeout(() => flushSave(notes), 150);
}

/**
 * Écrit immédiatement. Les erreurs (quota dépassé, stockage bloqué) sont
 * ignorées : l'app reste utilisable, l'utilisateur peut exporter.
 * @param {Object.<string, module:model~Note>} notes
 */
export function flushSave(notes) {
  clearTimeout(timer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); } catch (e) { /* stockage indisponible */ }
}

/**
 * Demande un stockage persistant (sans effet si non supporté).
 */
export function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignoré */ }
}

/**
 * Contenu d'un fichier de sauvegarde.
 * @param {Object.<string, module:model~Note>} notes
 * @returns {string} JSON indenté (lisible et diffable).
 */
export function backupJson(notes) {
  return JSON.stringify({ app: BACKUP_APP, version: 1, exported: Date.now(), notes }, null, 1);
}

/**
 * Fusionne une sauvegarde dans le carnet. Pour chaque note, la version la
 * plus récente (`updated`) gagne : importer deux fois le même fichier est
 * sans effet, et une note modifiée depuis la sauvegarde n'est pas écrasée.
 *
 * @param {Object.<string, module:model~Note>} notes Carnet (modifié sur place).
 * @param {string} text Contenu du fichier.
 * @returns {number} Nombre de notes ajoutées ou mises à jour.
 * @throws {SyntaxError} Si le fichier n'est pas du JSON.
 */
export function mergeBackup(notes, text) {
  const d = JSON.parse(text);
  const incoming = d.notes || d;
  let count = 0;
  Object.values(incoming).forEach((n) => {
    if (!isNote(n)) return;
    const cur = notes[n.id];
    if (!cur || n.updated >= cur.updated) { notes[n.id] = n; count++; }
  });
  return count;
}
