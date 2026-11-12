/**
 * @module sanitize
 * @description
 * **Validation of data coming from outside**: received `.inkline` files,
 * imported backups, contents of local storage.
 *
 * ## Why
 *
 * Imported data may have been crafted by anyone. If it were inserted as is
 * into the HTML, a booby-trapped field (`id: '"><img src=x onerror=…>'`)
 * would run code in the app: an injection (XSS). The C++ equivalent: a file
 * parser that trusts the sizes announced in the header.
 *
 * ## Principle: allowlist
 *
 * The received object is not "cleaned": a **new one is rebuilt** by copying
 * only the known fields, after checking their type and value (enumerations,
 * bounds, lengths). Everything else is ignored. Invalid ids are regenerated.
 *
 * This is the first line of defense. The second is systematic escaping at
 * render time ({@link module:util.esc|esc}), the third the Content Security
 * Policy of `index.html`, which forbids any script not coming from the app's
 * files.
 */

import { uid, clamp } from './util.js';
import { DUR, TIME_SIGNATURES, STEP_MIN, STEP_MAX, INSTRUMENTS } from './model.js';
import { COLOR_KEYS, cleanFolderName, CAT_NAME_MAX, MAX_CATS } from './folders.js';
import { sanitizeMetro, presetPart } from './metronome.js';

/** Accepted format for an id: lowercase alphanumeric, 1 to 32 characters. */
const ID_RE = /^[a-z0-9]{1,32}$/;

/** iReal key: letter, optional accidental, `-` for minor. */
const KEY_RE = /^[A-G][b#]?-?$/;

/** Chart section: a few letters (A, B, Intro, Verse…). */
const SECTION_RE = /^[A-Za-z]{1,6}$/;

/** Size limits: protect against huge files that would freeze the app. */
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

/** Possible values of a block's `fold` field. */
const FOLDS = ['open', 'closed'];

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => (isStr(v) ? v.slice(0, max) : '');
const id = (v) => (isStr(v) && ID_RE.test(v) ? v : uid());

/**
 * Validates a staff item.
 * @param {*} r Raw value.
 * @param {boolean} rhythm Rhythm line (no pitch).
 * @returns {module:model~StaffItem|null} `null` if the item is unusable.
 */
function item(r, rhythm) {
  if (!r || !Object.prototype.hasOwnProperty.call(DUR, r.d)) return null;
  /** @type {module:model~StaffItem} */
  const it = { d: r.d };
  if (r.dot === true) it.dot = true;
  if (r.r === true) it.r = true;
  else if (!rhythm) it.s = isNum(r.s) ? clamp(Math.round(r.s), STEP_MIN, STEP_MAX) : 4;
  if (!it.r && (r.a === -1 || r.a === 0 || r.a === 1)) it.a = r.a;
  if (isStr(r.c) && r.c.trim()) it.c = str(r.c, LIMITS.chord);
  if (['single', 'double', 'final', 'rep'].includes(r.bar)) it.bar = r.bar;
  if (r.rs === true) it.rs = true;
  if (r.tie === true && !it.r) it.tie = true;
  if (r.tup === 3) it.tup = 3;
  if (r.auto === true && !it.tup) it.auto = true; // piece of a note split at the barline (2.6)
  return it;
}

/**
 * Validates a chart measure.
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
 * Validates a block.
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
    const st = { id: id(r.id), type: 'staff', clef, time, tempo, swing: r.swing === true, items };
    if (clef !== 'rhythm' && Number.isInteger(r.ks) && r.ks !== 0 && Math.abs(r.ks) <= 7) st.ks = r.ks;
    if (clef !== 'rhythm' && r.tr !== 'C' && INSTRUMENTS.some((x) => x.key === r.tr)) st.tr = r.tr;
    if (FOLDS.includes(r.fold)) st.fold = r.fold;
    return st;
  }
  if (r.type === 'grid') {
    const measures = Array.isArray(r.measures)
      ? r.measures.slice(0, LIMITS.measures).map(measure).filter(Boolean)
      : [];
    const grid = {
      id: id(r.id),
      type: 'grid',
      time,
      tempo,
      key: isStr(r.key) && KEY_RE.test(r.key) ? r.key : 'C',
      style: isStr(r.style) && r.style.trim() ? str(r.style, LIMITS.style) : 'Medium Swing',
      measures: measures.length ? measures : [{ ch: [] }],
    };
    if (FOLDS.includes(r.fold)) grid.fold = r.fold;
    return grid;
  }
  return null;
}

/**
 * Validates a full note.
 *
 * @param {*} r Raw value (from `JSON.parse`).
 * @param {{freshIds: boolean}} [opt] `freshIds: true` regenerates **every**
 *   id: use it for a received note, which becomes a new note in the notebook
 *   instead of overwriting an existing note with the same id.
 * @returns {module:model~Note|null} `null` if it is not a note.
 */
export function sanitizeNote(r, opt = {}) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.blocks)) return null;
  const blocks = r.blocks.slice(0, LIMITS.blocks).map(sanitizeBlock).filter(Boolean);
  if (opt.freshIds)
    blocks.forEach((b) => {
      b.id = uid();
      delete b.fold; // the collapsed display belongs to whoever receives the note
    });
  /** @type {module:model~Note} */
  const note = {
    id: opt.freshIds ? uid() : id(r.id),
    title: str(r.title, LIMITS.title).replace(/\n/g, ' '),
    // Notes from before 1.7.0: no creation date, so the modification date is
    // used (best approximation available). main.js saves the result right
    // away, so that this date no longer moves afterwards.
    created: isNum(r.created) ? r.created : isNum(r.updated) ? r.updated : Date.now(),
    updated: isNum(r.updated) ? r.updated : Date.now(),
    blocks: blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }],
  };
  // Metronome of the note (2.15): musical settings, shared with the note.
  if (r.metro && typeof r.metro === 'object') note.metro = presetPart(sanitizeMetro(r.metro));
  // Filing (2.0). A received note (freshIds) arrives unfiled and not
  // pinned: its filing belongs to whoever receives it.
  if (!opt.freshIds) {
    if (isStr(r.folder) && ID_RE.test(r.folder)) {
      note.folder = r.folder;
      // Categories (2.8.6): ids, no duplicates, bounded.
      if (Array.isArray(r.cats)) {
        const cats = [...new Set(r.cats.filter((c) => isStr(c) && ID_RE.test(c)))].slice(0, MAX_CATS);
        if (cats.length) note.cats = cats;
      }
    }
    if (r.pinned === true) note.pinned = true;
  }
  return note;
}

/**
 * Validates a whole notebook (local storage or backup).
 * The dictionary keys are realigned on each note's id.
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
 * Validates a folder.
 * @param {*} r
 * @returns {module:folders~Folder|null}
 */
function sanitizeFolder(r) {
  if (!r || typeof r !== 'object') return null;
  const name = cleanFolderName(isStr(r.name) ? r.name : '');
  if (!name) return null;
  const f = {
    id: id(r.id),
    name,
    color: COLOR_KEYS.includes(r.color) ? r.color : 'blue',
    created: isNum(r.created) ? r.created : Date.now(),
  };
  // Categories (2.8.6): non-empty names, unique ids.
  if (Array.isArray(r.cats)) {
    const seen = new Set();
    const cats = [];
    r.cats.slice(0, MAX_CATS).forEach((c) => {
      const cn = c && isStr(c.name) ? cleanFolderName(c.name, CAT_NAME_MAX) : '';
      if (!cn || !c || !isStr(c.id) || !ID_RE.test(c.id) || seen.has(c.id)) return;
      seen.add(c.id);
      cats.push({ id: c.id, name: cn });
    });
    if (cats.length) f.cats = cats;
  }
  return f;
}

/**
 * Validates the folder list (local storage or backup).
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
