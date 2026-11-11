/**
 * @module storage
 * @description
 * Persistance du carnet (notes et dossiers), et sauvegarde/restauration en
 * fichier JSON.
 *
 * ## Où sont les données ? (depuis la 2.1)
 *
 * Dans **IndexedDB** (voir {@link module:db|db}) : un enregistrement par note
 * et par dossier. Jusqu'à la 2.0, tout le carnet était une seule chaîne JSON
 * dans `localStorage`, ce qui posait deux limites :
 *
 * - **taille** : environ 5 Mo par site pour `localStorage`, contre des
 *   centaines de Mo pour IndexedDB ;
 * - **coût** : chaque frappe réécrivait le carnet entier. Désormais, seule la
 *   note modifiée est écrite.
 *
 * Les **métadonnées** (affichage choisi, dossier sélectionné, date de dernière
 * sauvegarde…) restent dans `localStorage` : elles sont minuscules, et les
 * lire de façon synchrone est pratique.
 *
 * ## Migration depuis `localStorage`
 *
 * Au premier lancement de la 2.1, {@link module:storage.loadAll|loadAll}
 * copie les notes et dossiers de `localStorage` vers IndexedDB, **en une
 * seule transaction** (tout ou rien), puis note `storage: 'idb'` dans les
 * métadonnées. La copie n'a lieu que si la base IndexedDB est **vide** : des
 * données déjà présentes ne sont jamais écrasées par l'ancienne copie.
 *
 * L'ancienne copie n'est **pas effacée** : elle reste en filet de sécurité
 * (figée à la date de la migration). Règle d'or : ne jamais déplacer et
 * supprimer des données dans la même opération.
 *
 * Si IndexedDB est indisponible (navigateur très ancien, stockage bloqué),
 * l'app continue avec `localStorage`, comme avant la 2.1.
 *
 * ## Stratégie d'écriture
 *
 * - **Debounce** : chaque modification programme une écriture 150 ms plus
 *   tard ; les frappes rapprochées n'en déclenchent qu'une.
 * - **Notes « sales »** : {@link module:storage.scheduleSave|scheduleSave}
 *   reçoit l'id de la note modifiée ; seules ces notes sont écrites.
 * - **Comparaison** : {@link module:storage.flushSave|flushSave} compare
 *   chaque note à sa dernière version écrite (sa forme JSON) et n'écrit que
 *   les différences, suppressions comprises. C'est un filet de sécurité :
 *   après une opération groupée (import, suppression d'un dossier…), rien ne
 *   peut être oublié, même si l'appelant ne sait pas quelles notes ont changé.
 * - **Flush** sur `visibilitychange` (voir {@link module:main|main}) : Android
 *   peut tuer une app en arrière-plan sans prévenir ; on écrit donc tout de
 *   suite, en mode `strict` (le navigateur attend que ce soit sur le disque).
 * - `navigator.storage.persist()` demande au navigateur de ne pas évincer
 *   les données quand l'espace disque manque.
 *
 * Les écritures sont asynchrones et leurs erreurs (quota dépassé…) ne
 * bloquent pas l'app : une note non écrite reste « différente » et sera
 * retentée à l'écriture suivante.
 */

import { sanitizeNote, sanitizeNotes, sanitizeFolders } from './sanitize.js';
import { SORT_KEYS } from './search.js';
import { openDb, getAll, write, STORES } from './db.js';
import { METERS, meterOf, slotsOf } from './placements.js';

/** Clé `localStorage` du carnet jusqu'à la 2.0 (historique : ne pas changer). */
const STORAGE_KEY = 'carnet-portees-v1';

/** Identifiant écrit dans les fichiers de sauvegarde. */
const BACKUP_APP = 'carnet-portees';

/** Clé `localStorage` des dossiers en 2.0. */
const FOLDERS_KEY = 'inkline-folders';

/** Version du format des sauvegardes : 2 depuis l'arrivée des dossiers. Les sauvegardes v1 restent lisibles. */
const BACKUP_VERSION = 2;

/** Clé `localStorage` des métadonnées (date de première utilisation, de dernière sauvegarde). */
const META_KEY = 'inkline-meta';

/** Identifiant écrit dans les fichiers de note partagée (`.inkline`). */
const NOTE_APP = 'inkline';

/** Délai du debounce d'écriture (ms). */
const SAVE_DELAY = 150;

/**
 * Où le carnet est enregistré.
 * @type {'idb'|'local'}
 */
let backend = 'local';

/** @type {IDBDatabase|null} */
let db = null;

/**
 * Dernière version écrite de chaque note, en JSON (id → chaîne). Sert à
 * savoir ce qui a changé depuis la dernière écriture.
 * @type {Map.<string, string>}
 */
const saved = new Map();

/** JSON du carnet entier lors de la dernière écriture (mode `localStorage`). */
let savedLocal = '';

/** Notes modifiées depuis la dernière écriture (ids). */
const dirty = new Set();

/** Une écriture programmée doit-elle tout comparer (appel sans id) ? */
let fullPending = false;

let timer = null;

/**
 * Contenu chargé au démarrage.
 * @typedef {Object} LoadResult
 * @property {Object.<string, module:model~Note>} notes
 * @property {Object.<string, module:folders~Folder>} folders
 * @property {'idb'|'local'} backend Où le carnet est enregistré.
 * @property {boolean} migrated La migration depuis `localStorage` vient d'avoir lieu.
 */

/**
 * Lit une valeur JSON de `localStorage` (objet vide si absente ou illisible).
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
 * Lit les deux magasins.
 * @param {IDBDatabase} database
 * @returns {Promise<Array.<Array.<Object>>>} `[notes, dossiers]` bruts.
 */
function readDb(database) {
  return Promise.all([getAll(database, STORES.notes), getAll(database, STORES.folders)]);
}

/**
 * Charge le carnet (asynchrone : à attendre avec `await`).
 *
 * Toutes les données lues sont validées
 * ({@link module:sanitize.sanitizeNotes|sanitizeNotes}) : elles ont pu être
 * écrites par une ancienne version, ou corrompues. Une donnée invalide ne
 * doit jamais atteindre le rendu.
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
      // Ne migrer que vers une base VIDE : si elle contient déjà des données
      // (métadonnées perdues, par exemple), elles sont plus récentes que la
      // copie de localStorage et ne doivent surtout pas être écrasées.
      if (!rawNotes.length && !rawFolders.length) {
        await migrateFromLocal(db);
        migrated = true;
        [rawNotes, rawFolders] = await readDb(db);
      }
      setMeta({ storage: 'idb' });
    }
    // On mémorise ce qui est réellement sur le disque (avant validation) : si
    // la validation corrige une note, la première écriture enregistrera la
    // version corrigée.
    rawNotes.forEach((r) => {
      if (r && typeof r.id === 'string') saved.set(r.id, JSON.stringify(r));
    });
    backend = 'idb';
    return { notes: sanitizeNotes(rawNotes), folders: sanitizeFolders(rawFolders), backend, migrated };
  } catch (e) {
    // IndexedDB indisponible : on reste sur localStorage, comme avant la 2.1.
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
 * Copie le carnet de `localStorage` vers IndexedDB, en une transaction : si
 * l'app est tuée au milieu, rien n'est écrit et la migration recommencera au
 * lancement suivant. L'original est conservé.
 * @param {IDBDatabase} database
 * @returns {Promise<void>}
 */
async function migrateFromLocal(database) {
  const notes = Object.values(sanitizeNotes(readLocal(STORAGE_KEY)));
  const folders = Object.values(sanitizeFolders(readLocal(FOLDERS_KEY)));
  await write(database, { [STORES.notes]: { put: notes }, [STORES.folders]: { put: folders } }, true);
}

/**
 * Où le carnet est enregistré (pour l'écran Options et les tests).
 * @returns {'idb'|'local'}
 */
export function storageBackend() {
  return backend;
}

/**
 * Programme une écriture (debounce de {@link SAVE_DELAY} ms).
 * @param {Object.<string, module:model~Note>} notes Le carnet.
 * @param {string} [id] Note modifiée. Sans id, toutes les notes seront comparées.
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
 * Écrit immédiatement tout ce qui a changé (comparaison de toutes les notes).
 * @param {Object.<string, module:model~Note>} notes
 * @param {boolean} [strict=false] Attendre l'écriture physique sur le disque.
 * @returns {Promise<void>} Résolue quand l'écriture est terminée (ou a échoué).
 */
export function flushSave(notes, strict = false) {
  clearTimeout(timer);
  dirty.clear();
  fullPending = false;
  return writeChanges(notes, null, strict);
}

/**
 * Écrit les notes qui diffèrent de leur dernière version écrite.
 *
 * Point subtil : IndexedDB copie chaque objet **au moment** de `put`, et
 * `write` émet les `put` immédiatement (avant le premier `await`). Le JSON
 * comparé et l'objet écrit correspondent donc exactement au même état de la
 * note, même si l'utilisateur continue de taper pendant l'écriture.
 *
 * @param {Object.<string, module:model~Note>} notes
 * @param {?Array.<string>} ids Notes à examiner, ou `null` pour toutes
 *   (et pour détecter les suppressions).
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
      /* stockage indisponible : l'utilisateur peut exporter */
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
  // Suppressions : notes écrites autrefois et absentes du carnet.
  const del = (ids || [...saved.keys()]).filter((id) => !notes[id] && saved.has(id));
  if (!put.length && !del.length) return;
  try {
    await write(db, { [STORES.notes]: { put, del } }, strict);
    changed.forEach((json, id) => saved.set(id, json));
    del.forEach((id) => saved.delete(id));
  } catch (e) {
    /* quota dépassé, base fermée… : ces notes restent « différentes » et seront retentées */
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
 * Enregistre les dossiers (immédiatement : ils changent rarement et pèsent
 * peu, on réécrit donc le magasin entier).
 * @param {Object.<string, module:folders~Folder>} folders
 * @returns {Promise<void>}
 */
export async function saveFolders(folders) {
  if (backend === 'local') {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch (e) {
      /* stockage indisponible */
    }
    return;
  }
  try {
    await write(db, { [STORES.folders]: { clear: true, put: Object.values(folders) } });
  } catch (e) {
    /* retenté au prochain changement de dossier */
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
  // Le rangement (dossier, catégories, épingle, blocs réduits) reste chez soi : il n'a pas
  // de sens chez le destinataire.
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
      // Dossier déjà là : on lui ajoute les catégories qui lui manquent (2.8.6),
      // pour que les notes importées gardent les leurs.
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
 * Métadonnées du carnet, stockées à part des notes.
 * @typedef {Object} Meta
 * @property {number} [firstUse] Horodatage de la première ouverture de l'app.
 * @property {number} [lastExport] Horodatage du dernier « Exporter le carnet ».
 * @property {'cards'|'mosaic'|'list'} [listView] Affichage de la liste choisi dans les Options.
 * @property {string} [folder] Sélection de la barre de dossiers (`'all'`, `'none'` ou id de dossier).
 * @property {Object.<string, string>} [sorts] Tri choisi pour chaque sélection de la barre de dossiers.
 * @property {string} [lang] Langue de l'interface (2.9) : `auto`, `en` ou `fr`.
 * @property {Object.<string, string>} [catSel] Catégorie choisie dans chaque dossier (2.8.6) : `'all'`, `'none'` ou id.
 * @property {Object.<string, boolean>} [catFold] Sections repliées de l'accueil (2.8.6), clés `dossier:catégorie`.
 * @property {number} [dataVersion] Version du format des données locales (2 depuis la 2.0).
 * @property {'idb'} [storage] Présent une fois le carnet migré vers IndexedDB (2.1).
 * @property {boolean} [autoFold] Option « Réduire automatiquement les blocs longs » (2.2).
 * @property {module:storage~DrillSettings} [drill] Derniers réglages de l'entraînement Rythme (2.3).
 * @property {module:storage~GenSettings} [gen] Derniers réglages des exercices aléatoires (2.8).
 */

/**
 * Réglages de l'entraînement Rythme, communs aux Placements et aux exercices
 * aléatoires (sauf `notes` et `meter`, propres aux Placements).
 * @typedef {Object} DrillSettings
 * @property {number} notes Notes par mesure (1 à 12).
 * @property {string} meter Mesure des Placements (clé de {@link module:placements.METERS|METERS}, 2.8).
 * @property {number} tempo Tempo à la noire.
 * @property {boolean} swing
 * @property {Object.<string, Array.<boolean>>} beats Temps où le métronome
 *   clique, par mesure (2.8 ; un tableau de 4 avant). Absent pour une mesure :
 *   tous les temps.
 * @property {boolean} accent Accent sur le 1.
 * @property {boolean} countIn Mesure de décompte.
 * @property {boolean} mute Couper le rythme (métronome seul).
 * @property {boolean} loop Lecture en boucle (exercices aléatoires, 2.8).
 */

/** Réglages par défaut de l'entraînement Rythme. */
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
 * Valide les temps du métronome par mesure. Accepte l'ancien format (2.3 à
 * 2.7 : un tableau de 4, pour le 4/4).
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
 * Valide les réglages de l'entraînement Rythme (valeurs par défaut pour ce qui manque).
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
 * Réglages des exercices aléatoires (2.8).
 * @typedef {Object} GenSettings
 * @property {string} meter Mesure (clé de {@link module:placements.METERS|METERS}).
 * @property {number} measures Longueur de l'exercice : 1, 2 ou 4 mesures (4, 8 ou 12 en 2.8.0).
 * @property {number} min Notes par mesure, au moins.
 * @property {number} max Notes par mesure, au plus.
 * @property {Object.<string, Array.<number>>} starts Positions permises pour
 *   la première note, par mesure. Absent pour une mesure : toutes.
 * @property {number} seed Numéro du dernier exercice.
 */

/** Réglages par défaut des exercices aléatoires. */
export const GEN_DEFAULTS = Object.freeze({
  meter: '4/4',
  measures: 4,
  min: 2,
  max: 3,
  starts: Object.freeze({}),
  seed: 1,
});

/**
 * Valide les réglages des exercices aléatoires.
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
 * Valide un petit dictionnaire de métadonnées : clés et valeurs bornées.
 * @param {*} r
 * @param {RegExp} keyRe
 * @param {function(*): boolean} ok Valeur acceptée.
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
