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

import { sanitizeNote, sanitizeNotes, sanitizeFolders } from './sanitize.js';
import { SORT_KEYS } from './search.js';

/** Clé `localStorage` du carnet (historique : ne pas changer). */
const STORAGE_KEY = 'carnet-portees-v1';

/** Identifiant écrit dans les fichiers de sauvegarde. */
const BACKUP_APP = 'carnet-portees';

/** Clé `localStorage` des dossiers (depuis la 2.0). */
const FOLDERS_KEY = 'inkline-folders';

/** Version du format des sauvegardes : 2 depuis l'arrivée des dossiers. Les sauvegardes v1 restent lisibles. */
const BACKUP_VERSION = 2;

/** Clé `localStorage` des métadonnées (date de première utilisation, de dernière sauvegarde). */
const META_KEY = 'inkline-meta';

/** Identifiant écrit dans les fichiers de note partagée (`.inkline`). */
const NOTE_APP = 'inkline';

let timer = null;

/**
 * Charge le carnet. Retourne un objet vide si rien n'est stocké, si le JSON
 * est illisible ou si le stockage est indisponible (navigation privée).
 * @returns {Object.<string, module:model~Note>}
 */
export function loadNotes() {
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch (e) {
    data = {};
  }
  // Même le stockage local est validé : il a pu être écrit par une ancienne
  // version, ou corrompu. Une donnée invalide ne doit jamais atteindre le rendu.
  return sanitizeNotes(data);
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (e) {
    /* stockage indisponible */
  }
}

/**
 * Demande un stockage persistant (sans effet si non supporté).
 */
export function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {
    /* ignoré */
  }
}

/**
 * Charge les dossiers (objet vide si aucun, ou si les données sont illisibles).
 * @returns {Object.<string, module:folders~Folder>}
 */
export function loadFolders() {
  try {
    return sanitizeFolders(JSON.parse(localStorage.getItem(FOLDERS_KEY) || '{}'));
  } catch (e) {
    return {};
  }
}

/**
 * Enregistre les dossiers (immédiatement : ils changent rarement et pèsent peu).
 * @param {Object.<string, module:folders~Folder>} folders
 */
export function saveFolders(folders) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch (e) {
    /* stockage indisponible */
  }
}

/**
 * Contenu d'un fichier de sauvegarde (format v2 : notes et dossiers).
 * @param {Object.<string, module:model~Note>} notes
 * @param {Object.<string, module:folders~Folder>} [folders={}]
 * @returns {string} JSON indenté (lisible et diffable).
 */
export function backupJson(notes, folders = {}) {
  return JSON.stringify(
    { app: BACKUP_APP, version: BACKUP_VERSION, exported: Date.now(), notes, folders },
    null,
    1,
  );
}

/**
 * Contenu d'un fichier `.inkline` : une seule note, pour l'envoyer à quelqu'un.
 * @param {module:model~Note} note
 * @returns {string}
 */
export function noteFileJson(note) {
  // Le rangement (dossier, épingle) reste chez soi : il n'a pas de sens chez le destinataire.
  // eslint-disable-next-line no-unused-vars
  const { folder, pinned, ...shared } = note;
  return JSON.stringify({ app: NOTE_APP, kind: 'note', version: 1, note: shared }, null, 1);
}

/**
 * Résultat d'un import.
 * @typedef {Object} ImportResult
 * @property {'note'|'backup'} kind Type de fichier reconnu.
 * @property {number} count Nombre de notes ajoutées ou mises à jour.
 * @property {string|null} firstId Id de la note importée (pour l'ouvrir directement).
 */

/**
 * Importe un fichier dans le carnet : note partagée (`.inkline`) ou sauvegarde complète.
 *
 * - **Note partagée** : elle est **ajoutée** avec de nouveaux identifiants,
 *   sans jamais écraser une note existante (recevoir deux fois la même note
 *   en crée deux copies, c'est voulu : on ne sait pas laquelle garder).
 * - **Sauvegarde** : fusion par id, la version la plus récente (`updated`)
 *   gagne. Importer deux fois la même sauvegarde est sans effet. Les dossiers
 *   d'une sauvegarde v2 absents du carnet sont ajoutés ; ceux qui existent déjà
 *   (même id) sont conservés tels quels. Une sauvegarde v1 (sans dossiers)
 *   reste lisible.
 *
 * Dans les deux cas, tout passe par {@link module:sanitize|sanitize}.
 *
 * @param {Object.<string, module:model~Note>} notes Carnet (modifié sur place).
 * @param {string} text Contenu du fichier.
 * @param {Object.<string, module:folders~Folder>} [folders={}] Dossiers (modifiés sur place).
 * @returns {ImportResult}
 * @throws {Error} Si le fichier n'est ni du JSON ni un format Inkline.
 */
export function importFile(notes, text, folders = {}) {
  const d = JSON.parse(text);
  if (d && d.kind === 'note' && d.note) {
    const n = sanitizeNote(d.note, { freshIds: true });
    if (!n) throw new Error('note invalide');
    // La note reçue garde sa date de création d'origine ; elle est « modifiée »
    // maintenant (elle remonte en tête de liste).
    n.updated = Date.now();
    notes[n.id] = n;
    return { kind: 'note', count: 1, firstId: n.id };
  }
  const incoming = sanitizeNotes(d && d.notes ? d.notes : d);
  if (d && d.folders) {
    Object.values(sanitizeFolders(d.folders)).forEach((f) => {
      if (!folders[f.id]) folders[f.id] = f;
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
 * Métadonnées du carnet, stockées à part des notes.
 * @typedef {Object} Meta
 * @property {number} [firstUse] Horodatage de la première ouverture de l'app.
 * @property {number} [lastExport] Horodatage du dernier « Exporter le carnet ».
 * @property {'cards'|'mosaic'|'list'} [listView] Affichage de la liste choisi dans les Options.
 * @property {string} [folder] Sélection de la barre de dossiers (`'all'`, `'none'` ou id de dossier).
 * @property {Object.<string, string>} [sorts] Tri choisi pour chaque sélection de la barre de dossiers.
 * @property {number} [dataVersion] Version du format des données locales (2 depuis la 2.0).
 */

/**
 * Garde seulement les tris valides d'un objet `{ sélection: tri }`.
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
 * Lit les métadonnées (objet vide si absentes ou illisibles).
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
      dataVersion: num(m.dataVersion),
    };
  } catch (e) {
    return {};
  }
}

/**
 * Met à jour une partie des métadonnées.
 * @param {Meta} patch
 */
export function setMeta(patch) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ ...getMeta(), ...patch }));
  } catch (e) {
    /* stockage indisponible */
  }
}
