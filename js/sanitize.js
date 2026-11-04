/**
 * @module sanitize
 * @description
 * **Validation des données venant de l'extérieur** : fichiers `.inkline`
 * reçus, sauvegardes importées, contenu du stockage local.
 *
 * ## Pourquoi
 *
 * Une donnée importée peut avoir été fabriquée par n'importe qui. Si elle
 * était insérée telle quelle dans le HTML, un champ piégé
 * (`id: '"><img src=x onerror=…>'`) exécuterait du code dans l'app : c'est
 * une injection (XSS). L'équivalent en C++ : un parseur de fichier qui ferait
 * confiance aux tailles annoncées dans l'en-tête.
 *
 * ## Principe : liste blanche
 *
 * On ne « nettoie » pas l'objet reçu : on en **reconstruit un neuf** en ne
 * recopiant que les champs connus, après vérification de leur type et de leur
 * valeur (énumérations, bornes, longueurs). Tout le reste est ignoré. Les
 * identifiants invalides sont régénérés.
 *
 * C'est la première ligne de défense. La deuxième est l'échappement
 * systématique au rendu ({@link module:util.esc|esc}), la troisième la
 * Content Security Policy d'`index.html`, qui interdit tout script non issu
 * des fichiers de l'app.
 */

import { uid, clamp } from './util.js';
import { DUR, TIME_SIGNATURES } from './model.js';
import { COLOR_KEYS, cleanFolderName } from './folders.js';

/** Format accepté pour un identifiant : alphanumérique minuscule, 1 à 32 caractères. */
const ID_RE = /^[a-z0-9]{1,32}$/;

/** Tonalité iReal : lettre, altération éventuelle, `-` pour mineur. */
const KEY_RE = /^[A-G][b#]?-?$/;

/** Section de grille : quelques lettres (A, B, Intro, Verse…). */
const SECTION_RE = /^[A-Za-z]{1,6}$/;

/** Limites de taille : protègent contre des fichiers énormes qui gèleraient l'app. */
const LIMITS = {
  folders: 200,
  title: 200,
  text: 20000,
  chord: 16,
  style: 40,
  blocks: 200,
  items: 5000,
  measures: 1000,
  notes: 5000,
};

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => (isStr(v) ? v.slice(0, max) : '');
const id = (v) => (isStr(v) && ID_RE.test(v) ? v : uid());

/**
 * Valide un élément de portée.
 * @param {*} r Valeur brute.
 * @param {boolean} rhythm Ligne rythmique (pas de hauteur).
 * @returns {module:model~StaffItem|null} `null` si l'élément est inutilisable.
 */
function item(r, rhythm) {
  if (!r || !Object.prototype.hasOwnProperty.call(DUR, r.d)) return null;
  /** @type {module:model~StaffItem} */
  const it = { d: r.d };
  if (r.dot === true) it.dot = true;
  if (r.r === true) it.r = true;
  else if (!rhythm) it.s = isNum(r.s) ? clamp(Math.round(r.s), -6, 14) : 4;
  if (!it.r && (r.a === -1 || r.a === 0 || r.a === 1)) it.a = r.a;
  if (isStr(r.c) && r.c.trim()) it.c = str(r.c, LIMITS.chord);
  if (['single', 'double', 'final', 'rep'].includes(r.bar)) it.bar = r.bar;
  if (r.rs === true) it.rs = true;
  if (r.tie === true && !it.r) it.tie = true;
  if (r.tup === 3) it.tup = 3;
  return it;
}

/**
 * Valide une mesure de grille.
 * @param {*} r
 * @returns {module:model~GridMeasure|null}
 */
function measure(r) {
  if (!r || !Array.isArray(r.ch)) return null;
  /** @type {module:model~GridMeasure} */
  const m = {
    ch: r.ch
      .slice(0, 4)
      .filter(isStr)
      .map((c) => c.slice(0, LIMITS.chord)),
  };
  if (isStr(r.sec) && SECTION_RE.test(r.sec)) m.sec = r.sec;
  if (r.rs === true) m.rs = true;
  if (r.re === true) m.re = true;
  if (r.dbl === true) m.dbl = true;
  if (r.fin === true) m.fin = true;
  if (r.ending === 1 || r.ending === 2 || r.ending === 3) m.ending = r.ending;
  return m;
}

/**
 * Valide un bloc.
 * @param {*} r
 * @returns {module:model~Block|null}
 */
export function sanitizeBlock(r) {
  if (!r) return null;
  const time = TIME_SIGNATURES.includes(r.time) ? r.time : '4/4';
  const tempo = isNum(r.tempo) ? clamp(Math.round(r.tempo), 30, 300) : 100;
  if (r.type === 'text') return { id: id(r.id), type: 'text', text: str(r.text, LIMITS.text) };
  if (r.type === 'staff') {
    const clef = ['treble', 'bass', 'rhythm'].includes(r.clef) ? r.clef : 'treble';
    const items = Array.isArray(r.items)
      ? r.items
          .slice(0, LIMITS.items)
          .map((x) => item(x, clef === 'rhythm'))
          .filter(Boolean)
      : [];
    return { id: id(r.id), type: 'staff', clef, time, tempo, swing: r.swing === true, items };
  }
  if (r.type === 'grid') {
    const measures = Array.isArray(r.measures)
      ? r.measures.slice(0, LIMITS.measures).map(measure).filter(Boolean)
      : [];
    return {
      id: id(r.id),
      type: 'grid',
      time,
      tempo,
      key: isStr(r.key) && KEY_RE.test(r.key) ? r.key : 'C',
      style: isStr(r.style) && r.style.trim() ? str(r.style, LIMITS.style) : 'Medium Swing',
      measures: measures.length ? measures : [{ ch: [] }],
    };
  }
  return null;
}

/**
 * Valide une note complète.
 *
 * @param {*} r Valeur brute (issue de `JSON.parse`).
 * @param {{freshIds: boolean}} [opt] `freshIds: true` régénère **tous** les
 *   identifiants : à utiliser pour une note reçue, qui devient une nouvelle
 *   note du carnet au lieu d'écraser une note existante de même id.
 * @returns {module:model~Note|null} `null` si ce n'est pas une note.
 */
export function sanitizeNote(r, opt = {}) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.blocks)) return null;
  const blocks = r.blocks.slice(0, LIMITS.blocks).map(sanitizeBlock).filter(Boolean);
  if (opt.freshIds)
    blocks.forEach((b) => {
      b.id = uid();
    });
  /** @type {module:model~Note} */
  const note = {
    id: opt.freshIds ? uid() : id(r.id),
    title: str(r.title, LIMITS.title).replace(/\n/g, ' '),
    // Notes d'avant la 1.7.0 : pas de date de création, on prend la date de
    // modification (meilleure approximation disponible). main.js enregistre
    // aussitôt le résultat, pour que cette date ne bouge plus ensuite.
    created: isNum(r.created) ? r.created : isNum(r.updated) ? r.updated : Date.now(),
    updated: isNum(r.updated) ? r.updated : Date.now(),
    blocks: blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }],
  };
  // Rangement (2.0). Une note reçue (freshIds) arrive non classée et non
  // épinglée : son rangement appartient à celui qui la reçoit.
  if (!opt.freshIds) {
    if (isStr(r.folder) && ID_RE.test(r.folder)) note.folder = r.folder;
    if (r.pinned === true) note.pinned = true;
  }
  return note;
}

/**
 * Valide un carnet entier (stockage local ou sauvegarde).
 * Les clés du dictionnaire sont réalignées sur l'id de chaque note.
 *
 * @param {*} r
 * @returns {Object.<string, module:model~Note>}
 */
export function sanitizeNotes(r) {
  /** @type {Object.<string, module:model~Note>} */
  const out = {};
  if (!r || typeof r !== 'object') return out;
  Object.values(r)
    .slice(0, LIMITS.notes)
    .forEach((x) => {
      const n = sanitizeNote(x);
      if (n) out[n.id] = n;
    });
  return out;
}

/**
 * Valide un dossier.
 * @param {*} r
 * @returns {module:folders~Folder|null}
 */
export function sanitizeFolder(r) {
  if (!r || typeof r !== 'object') return null;
  const name = cleanFolderName(isStr(r.name) ? r.name : '');
  if (!name) return null;
  return {
    id: id(r.id),
    name,
    color: COLOR_KEYS.includes(r.color) ? r.color : 'blue',
    created: isNum(r.created) ? r.created : Date.now(),
  };
}

/**
 * Valide la liste des dossiers (stockage local ou sauvegarde).
 * @param {*} r
 * @returns {Object.<string, module:folders~Folder>}
 */
export function sanitizeFolders(r) {
  /** @type {Object.<string, module:folders~Folder>} */
  const out = {};
  if (!r || typeof r !== 'object') return out;
  Object.values(r)
    .slice(0, LIMITS.folders)
    .forEach((x) => {
      const f = sanitizeFolder(x);
      if (f) out[f.id] = f;
    });
  return out;
}
