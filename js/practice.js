/**
 * @module practice
 * @description
 * **Practice notebook** (2.16): programs, sessions, tempo history. Pure: no
 * DOM, tested under Node.
 *
 * - A **program** is a list of things to practise, in the order the user
 *   chose: a free text ("Scales in 12 keys"), a note, one block of a note, or
 *   an exercise (a copy of a generated rhythm line). An item may have a
 *   duration (a countdown during the session; none by default) and its own
 *   metronome settings.
 * - A **session** is a program played once: for each item visited, the time
 *   spent on it and, when the metronome played, its tempo. Sessions make the
 *   history, and the tempo curve of each item.
 *
 * Nothing here judges: no goal, no streak, no "skipped". An item never
 * visited is simply absent from the session.
 */

import { uid } from './util.js';
import { sanitizeBlock } from './sanitize.js';
import { sanitizeMetro, presetPart, TEMPO_MIN, TEMPO_MAX } from './metronome.js';

/** Longest program name. */
export const PROGRAM_NAME_MAX = 60;
/** Most items in a program. */
export const ITEMS_MAX = 60;
/** Longest free text of an item. */
export const ITEM_TEXT_MAX = 300;
/** Durations offered for an item, in minutes (none by default). */
export const DURATIONS = Object.freeze([1, 2, 3, 5, 10, 15, 20, 30, 45, 60]);
/** Longest item duration accepted (minutes). */
const MINUTES_MAX = 180;
/** A session shorter than this (seconds) is not kept: opened by mistake. */
export const KEEP_SECONDS = 30;
/** Most sessions kept (the oldest go first). */
export const SESSIONS_MAX = 5000;
/** Item kinds. */
export const ITEM_KINDS = Object.freeze(['text', 'note', 'block', 'exercise']);

/**
 * Something to practise.
 * @typedef {Object} PracticeItem
 * @property {string} id
 * @property {'text'|'note'|'block'|'exercise'} kind
 * @property {string} [text] Free text (`text` kind).
 * @property {string} [note] Note id (`note` and `block` kinds).
 * @property {string} [block] Block id in that note (`block` kind).
 * @property {module:model~StaffBlock} [staff] Copy of a generated rhythm line (`exercise` kind).
 * @property {module:model~GridBlock} [grid] Copy of a random chord chart (`exercise` kind, 2.18),
 *   instead of `staff`.
 * @property {string} [title] Title of an exercise ("Exercise 482 · 7/8", "Chart 4821 · 8 bars").
 * @property {number} [minutes] Duration: a countdown during the session. Absent: none.
 * @property {Object} [metro] Metronome settings of the item (preset part of
 *   {@link module:metronome~MetroSettings|MetroSettings}).
 */

/**
 * A practice program.
 * @typedef {Object} Program
 * @property {string} id
 * @property {string} name
 * @property {number} created Timestamp.
 * @property {number} updated Timestamp.
 * @property {Array.<PracticeItem>} items In practice order.
 */

/**
 * One item of a session.
 * @typedef {Object} SessionEntry
 * @property {string} item Item id in the program.
 * @property {string} label Item name at the time (history stays readable if
 *   the item or its note goes away).
 * @property {number} seconds Time spent on it.
 * @property {number} [tempo] Metronome tempo when leaving it, if the metronome played.
 */

/**
 * A program played once.
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} program Program id.
 * @property {string} name Program name at the time.
 * @property {number} start Timestamp.
 * @property {number} end Timestamp of the last change.
 * @property {Array.<SessionEntry>} items In visiting order.
 */

// ---------- Validation ----------

const isStr = (v) => typeof v === 'string';
const isId = (v) => isStr(v) && /^[a-z0-9]{1,32}$/.test(v);
const isTime = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Cleans a typed name: one line, trimmed, bounded.
 * @param {*} v
 * @param {number} max
 * @returns {string}
 */
function line(v, max) {
  return isStr(v) ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/**
 * Validates an item; `null` if unusable.
 * @param {*} r
 * @returns {?PracticeItem}
 */
function sanitizeItem(r) {
  if (!r || typeof r !== 'object' || !ITEM_KINDS.includes(r.kind)) return null;
  /** @type {PracticeItem} */
  const it = { id: isId(r.id) ? r.id : uid(), kind: r.kind };
  if (r.kind === 'text') {
    it.text = isStr(r.text) ? r.text.trim().slice(0, ITEM_TEXT_MAX) : '';
    if (!it.text) return null;
  }
  if (r.kind === 'note' || r.kind === 'block') {
    if (!isId(r.note)) return null;
    it.note = r.note;
  }
  if (r.kind === 'block') {
    if (!isId(r.block)) return null;
    it.block = r.block;
  }
  if (r.kind === 'exercise') {
    // A rhythm line, or a chord chart (2.18).
    const b = sanitizeBlock(r.staff || r.grid);
    if (!b || (b.type !== 'staff' && b.type !== 'grid')) return null;
    if (b.type === 'staff') it.staff = /** @type {module:model~StaffBlock} */ (b);
    else it.grid = /** @type {module:model~GridBlock} */ (b);
    it.title = line(r.title, PROGRAM_NAME_MAX);
  }
  if (Number.isInteger(r.minutes) && r.minutes >= 1 && r.minutes <= MINUTES_MAX) it.minutes = r.minutes;
  if (r.metro && typeof r.metro === 'object') it.metro = presetPart(sanitizeMetro(r.metro));
  return it;
}

/**
 * Validates a program; `null` if unusable.
 * @param {*} r
 * @returns {?Program}
 */
export function sanitizeProgram(r) {
  if (!r || typeof r !== 'object' || !isId(r.id)) return null;
  const now = Date.now();
  const created = isTime(r.created) ? r.created : now;
  const items = Array.isArray(r.items) ? r.items.slice(0, ITEMS_MAX).map(sanitizeItem).filter(Boolean) : [];
  // Ids stay unique (the session history refers to them).
  const seen = new Set();
  items.forEach((it) => {
    if (seen.has(it.id)) it.id = uid();
    seen.add(it.id);
  });
  return {
    id: r.id,
    name: line(r.name, PROGRAM_NAME_MAX),
    created,
    updated: isTime(r.updated) ? Math.max(r.updated, created) : created,
    items,
  };
}

/**
 * Validates every program (an object keyed by id, or an array).
 * @param {*} r
 * @returns {Object.<string, Program>}
 */
export function sanitizePrograms(r) {
  const out = {};
  const list = Array.isArray(r) ? r : r && typeof r === 'object' ? Object.values(r) : [];
  list.forEach((x) => {
    const p = sanitizeProgram(x);
    if (p) out[p.id] = p;
  });
  return out;
}

/**
 * Validates a session; `null` if unusable.
 * @param {*} r
 * @returns {?Session}
 */
export function sanitizeSession(r) {
  if (!r || typeof r !== 'object' || !isId(r.id) || !isId(r.program) || !isTime(r.start)) return null;
  const items = Array.isArray(r.items)
    ? r.items
        .slice(0, ITEMS_MAX * 2)
        .filter((e) => e && isId(e.item))
        .map((e) => {
          /** @type {SessionEntry} */
          const out = {
            item: e.item,
            label: line(e.label, ITEM_TEXT_MAX),
            seconds: Number.isFinite(e.seconds) ? Math.max(0, Math.min(86400, Math.round(e.seconds))) : 0,
          };
          if (Number.isFinite(e.tempo) && e.tempo >= TEMPO_MIN && e.tempo <= TEMPO_MAX)
            out.tempo = Math.round(e.tempo);
          return out;
        })
    : [];
  return {
    id: r.id,
    program: r.program,
    name: line(r.name, PROGRAM_NAME_MAX),
    start: r.start,
    end: isTime(r.end) ? Math.max(r.end, r.start) : r.start,
    items,
  };
}

/**
 * Validates every session (object keyed by id, or array); only the most
 * recent {@link SESSIONS_MAX} are kept.
 * @param {*} r
 * @returns {Object.<string, Session>}
 */
export function sanitizeSessions(r) {
  const list = (Array.isArray(r) ? r : r && typeof r === 'object' ? Object.values(r) : [])
    .map(sanitizeSession)
    .filter(Boolean)
    .sort((a, b) => b.start - a.start)
    .slice(0, SESSIONS_MAX);
  const out = {};
  list.forEach((s) => (out[s.id] = s));
  return out;
}

// ---------- Creating and editing ----------

/**
 * A new, empty program.
 * @param {string} name
 * @returns {Program}
 */
export function newProgram(name) {
  const now = Date.now();
  return { id: uid(), name: line(name, PROGRAM_NAME_MAX), created: now, updated: now, items: [] };
}

/**
 * A new item, validated (`null` if the fields do not make one).
 * @param {Object} fields `kind` and the fields of that kind.
 * @returns {?PracticeItem}
 */
export function newItem(fields) {
  return sanitizeItem({ ...fields, id: uid() });
}

/**
 * Copy of a program with fresh ids (the copy has no history).
 * @param {Program} p
 * @param {string} name
 * @returns {Program}
 */
export function duplicateProgram(p, name) {
  const copy = sanitizeProgram({ ...p, id: uid(), name, created: Date.now(), updated: Date.now() });
  copy.items = copy.items.map((it) => ({ ...it, id: uid() }));
  return copy;
}

/**
 * Moves an item (drag and drop).
 * @param {Array.<PracticeItem>} items
 * @param {number} from
 * @param {number} to Index in the result.
 * @returns {Array.<PracticeItem>} A new array.
 */
export function moveItem(items, from, to) {
  const out = items.slice();
  if (from < 0 || from >= out.length) return out;
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

/**
 * Sessions are kept by id; adding one beyond the limit drops the oldest.
 * @param {Object.<string, Session>} sessions Modified in place.
 * @param {Session} s
 */
export function putSession(sessions, s) {
  sessions[s.id] = s;
  const ids = Object.keys(sessions);
  if (ids.length <= SESSIONS_MAX) return;
  const oldest = ids.reduce((a, b) => (sessions[a].start <= sessions[b].start ? a : b));
  delete sessions[oldest];
}

// ---------- Sessions ----------

/**
 * A new session of a program (nothing visited yet).
 * @param {Program} p
 * @param {number} [now]
 * @returns {Session}
 */
export function newSession(p, now = Date.now()) {
  return { id: uid(), program: p.id, name: p.name, start: now, end: now, items: [] };
}

/**
 * Records a visit of an item: time added, tempo replaced when given (the
 * last one counts). Returns a new session.
 * @param {Session} s
 * @param {{item: string, label: string, seconds: number, tempo: (number|undefined)}} visit
 * @param {number} [now]
 * @returns {Session}
 */
export function recordVisit(s, visit, now = Date.now()) {
  const items = s.items.slice();
  const i = items.findIndex((e) => e.item === visit.item);
  const prev = i >= 0 ? items[i] : { item: visit.item, label: visit.label, seconds: 0 };
  const entry = {
    ...prev,
    label: visit.label || prev.label,
    seconds: prev.seconds + Math.round(visit.seconds),
  };
  if (visit.tempo !== undefined) entry.tempo = Math.round(visit.tempo);
  if (i >= 0) items[i] = entry;
  else items.push(entry);
  return { ...s, end: now, items };
}

/**
 * Total time of a session (seconds).
 * @param {Session} s
 * @returns {number}
 */
export function sessionSeconds(s) {
  return s.items.reduce((sum, e) => sum + e.seconds, 0);
}

/**
 * Is a session worth keeping? (Not opened by mistake.)
 * @param {Session} s
 * @returns {boolean}
 */
export function worthKeeping(s) {
  return sessionSeconds(s) >= KEEP_SECONDS;
}

/**
 * Sessions, most recent first.
 * @param {Object.<string, Session>} sessions
 * @param {string} [program] Only those of this program.
 * @returns {Array.<Session>}
 */
export function sortedSessions(sessions, program) {
  return Object.values(sessions)
    .filter((s) => !program || s.program === program)
    .sort((a, b) => b.start - a.start);
}

/**
 * Programs, the one played last first, then the newest.
 * @param {Object.<string, Program>} programs
 * @param {Object.<string, Session>} sessions
 * @returns {Array.<Program>}
 */
export function sortedPrograms(programs, sessions) {
  const last = lastPlayed(sessions);
  return Object.values(programs).sort(
    (a, b) => (last[b.id] || 0) - (last[a.id] || 0) || b.created - a.created,
  );
}

/**
 * Start of the last session of each program.
 * @param {Object.<string, Session>} sessions
 * @returns {Object.<string, number>}
 */
export function lastPlayed(sessions) {
  const out = {};
  Object.values(sessions).forEach((s) => {
    if (!out[s.program] || s.start > out[s.program]) out[s.program] = s.start;
  });
  return out;
}

/**
 * Tempo of an item, session after session (oldest first): the curve of its
 * progress.
 * @param {Object.<string, Session>} sessions
 * @param {string} item Item id.
 * @returns {Array.<{t: number, tempo: number, session: string}>}
 */
export function tempoHistory(sessions, item) {
  const out = [];
  Object.values(sessions).forEach((s) => {
    const e = s.items.find((x) => x.item === item);
    if (e && e.tempo) out.push({ t: s.start, tempo: e.tempo, session: s.id });
  });
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Sets (or removes, with `null`) the tempo of an item in a session: a
 * correction from the history.
 * @param {Session} s
 * @param {string} item
 * @param {?number} tempo
 * @returns {Session}
 */
export function setEntryTempo(s, item, tempo) {
  return {
    ...s,
    items: s.items.map((e) => {
      if (e.item !== item) return e;
      const out = { ...e };
      if (tempo === null) delete out.tempo;
      else out.tempo = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(tempo)));
      return out;
    }),
  };
}

// ---------- Display ----------

/**
 * Clock display of a duration: `7:05`, `1:02:03`.
 * @param {number} seconds
 * @returns {string}
 */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Whole minutes of a duration, at least 1 when something was done.
 * @param {number} seconds
 * @returns {number}
 */
export function minutesOf(seconds) {
  return seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
}

/**
 * Points of a tempo curve in a `w × h` box (y down), with a margin of `pad`
 * px; the tempo scale is rounded to tens around the values.
 *
 * @example
 * curvePoints([{tempo: 100}, {tempo: 120}], 200, 100, 10)
 * // { points: [{x: 10, y: 90}, {x: 190, y: 10}], lo: 100, hi: 120 }
 * @param {Array.<{tempo: number}>} data Oldest first.
 * @param {number} w
 * @param {number} h
 * @param {number} pad
 * @returns {{points: Array.<{x: number, y: number}>, lo: number, hi: number}}
 */
export function curvePoints(data, w, h, pad) {
  if (!data.length) return { points: [], lo: 0, hi: 0 };
  const tempos = data.map((d) => d.tempo);
  let lo = Math.floor(Math.min(...tempos) / 10) * 10;
  let hi = Math.ceil(Math.max(...tempos) / 10) * 10;
  if (hi === lo) {
    lo -= 10;
    hi += 10;
  }
  const n = data.length;
  const points = data.map((d, i) => ({
    x: n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1),
    y: pad + ((hi - d.tempo) * (h - 2 * pad)) / (hi - lo),
  }));
  return { points, lo, hi };
}
