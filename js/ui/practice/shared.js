/**
 * @module ui/practice/shared
 * @description
 * Pieces shared by the practice notebook screens (2.16): item names, saving
 * programs and sessions, relative dates, a bottom sheet with Android back,
 * starting a session.
 */

import { t, locale } from '../../i18n.js';
import { esc } from '../../util.js';
import { state } from '../state.js';
import { savePrograms, saveSession } from '../../storage.js';
import { putSession, minutesOf } from '../../practice.js';
import { openOverlay, closeOverlay, goChild } from '../nav.js';

/** Item a session asked for by {@link startSession} starts on, until the session screen takes it. */
let startItem = null;

/**
 * Starts a session of a program (2.17.1: on any of its items).
 * @param {string} progId
 * @param {?string} [itemId=null] Item to start on; the first one by default.
 */
export function startSession(progId, itemId = null) {
  startItem = itemId;
  goChild('session', progId);
}

/**
 * Item the next session starts on, read once (the session screen calls it).
 * @returns {?string}
 */
export function takeSessionStart() {
  const id = startItem;
  startItem = null;
  return id;
}

/**
 * The note an item points to, if it still exists.
 * @param {module:practice~PracticeItem} it
 * @returns {?module:model~Note}
 */
export function noteOf(it) {
  return (it.note && state.notes[it.note]) || null;
}

/**
 * The block an item points to, if it still exists.
 * @param {module:practice~PracticeItem} it
 * @returns {?module:model~Block}
 */
export function blockOf(it) {
  const n = noteOf(it);
  return (n && n.blocks.find((b) => b.id === it.block)) || null;
}

/**
 * Title of a note as shown in lists.
 * @param {module:model~Note} n
 * @returns {string}
 */
export function noteTitle(n) {
  return n.title.trim() || t('list.untitled');
}

/**
 * Short name of a block: its kind, and for a text its first words.
 * @param {module:model~Block} b
 * @returns {string}
 */
export function blockName(b) {
  if (b.type === 'text') {
    const first = b.text.trim().split('\n')[0];
    return first.length > 40 ? first.slice(0, 39) + '…' : first || t('note.text');
  }
  if (b.type === 'grid') return t('grid.kind');
  return b.clef === 'rhythm' ? t('staff.rhythm') : t('staff.staff');
}

/**
 * Name of an item in lists and in the history.
 * @param {module:practice~PracticeItem} it
 * @returns {string}
 */
export function itemLabel(it) {
  if (it.kind === 'text') return it.text;
  if (it.kind === 'exercise') return it.title || t('practice.exercise');
  const n = noteOf(it);
  if (!n) return t('practice.missingNote');
  if (it.kind === 'note') return noteTitle(n);
  const b = blockOf(it);
  return b ? `${noteTitle(n)} · ${blockName(b)}` : t('practice.missingBlock');
}

/**
 * Small label of an item's kind (shown under its name).
 * @param {module:practice~PracticeItem} it
 * @returns {string}
 */
export function kindLabel(it) {
  return t('practice.kinds.' + it.kind);
}

/**
 * A program, if it exists.
 * @param {?string} id
 * @returns {?module:practice~Program}
 */
export function programById(id) {
  return (id && state.programs[id]) || null;
}

/**
 * Marks a program changed and saves the programs.
 * @param {module:practice~Program} p
 */
export function saveProgram(p) {
  p.updated = Date.now();
  state.programs[p.id] = p;
  savePrograms(state.programs);
}

/**
 * Deletes a program (its sessions stay in the history).
 * @param {string} id
 */
export function deleteProgram(id) {
  delete state.programs[id];
  savePrograms(state.programs);
}

/**
 * Keeps a session (added or changed) and writes it.
 * @param {module:practice~Session} s
 */
export function storeSession(s) {
  putSession(state.sessions, s);
  saveSession(state.sessions, s.id);
}

/**
 * Removes a session from the history.
 * @param {string} id
 */
export function removeSession(id) {
  delete state.sessions[id];
  saveSession(state.sessions, id);
}

/**
 * Day of a timestamp, said simply: today, yesterday, a weekday within the
 * week, otherwise the date.
 * @param {number} ts
 * @param {number} [now]
 * @returns {string}
 */
export function relDay(ts, now = Date.now()) {
  const day = (x) => {
    const d = new Date(x);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diff = Math.round((day(now) - day(ts)) / 86400000);
  if (diff === 0) return t('practice.today');
  if (diff === 1) return t('practice.yesterday');
  if (diff > 1 && diff < 7) return new Date(ts).toLocaleDateString(locale(), { weekday: 'long' });
  return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/**
 * Full date of a session: "Saturday 14 November".
 * @param {number} ts
 * @returns {string}
 */
export function longDay(ts) {
  return new Date(ts).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Duration said in minutes ("34 min").
 * @param {number} seconds
 * @returns {string}
 */
export function minutesLabel(seconds) {
  return t('practice.minutes', { n: minutesOf(seconds) });
}

/**
 * Opens a bottom sheet over the screen. Android's back button closes it.
 * Clicks inside go to `onClick` (with the clicked element having a
 * `data-a` attribute); a tap outside the panel closes it.
 *
 * @param {string} title
 * @param {string} body HTML of the content.
 * @param {function(HTMLElement, Object): void} onClick `(element, dataset)`.
 * @returns {{el: HTMLElement, close: function()}} `close` goes through history.
 */
export function openSheet(title, body, onClick) {
  const back = document.createElement('div');
  back.className = 'sheet-back psheet-back';
  back.innerHTML = `<div class="sheet psheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="psheet-head"><h2>${esc(title)}</h2><button type="button" class="btn icon-btn" data-a="close" aria-label="${esc(t('common.close'))}">&#x2715;</button></div>
    <div class="psheet-body">${body}</div></div>`;
  document.body.appendChild(back);
  let open = true;
  openOverlay(() => {
    open = false;
    back.remove();
  });
  const close = () => {
    if (open) closeOverlay();
  };
  back.addEventListener('click', (e) => {
    if (e.target === back) return close();
    const el = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-a]'));
    if (!el) return;
    if (el.dataset.a === 'close') return close();
    onClick(el, el.dataset);
  });
  return { el: back, close };
}

/**
 * List of notes to choose from in a sheet: a search field and the notes,
 * most recently changed first (all of them once something is typed).
 * @param {string} q Search text.
 * @param {number} [max=8] Shown without a search.
 * @returns {string} HTML of the rows (`data-a="note"`, `data-id`).
 */
export function noteRows(q, max = 8) {
  const needle = q.trim().toLowerCase();
  const notes = Object.values(state.notes)
    .filter((n) => !needle || noteTitle(n).toLowerCase().includes(needle))
    .sort((a, b) => b.updated - a.updated)
    .slice(0, needle ? 50 : max);
  if (!notes.length) return `<p class="psheet-empty">${esc(t('practice.noNote'))}</p>`;
  return notes
    .map(
      (n) =>
        `<button type="button" class="opt-row" data-a="note" data-id="${esc(n.id)}"><span>${esc(noteTitle(n))}<small>${esc(relDay(n.updated))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>`,
    )
    .join('');
}

/**
 * Shows a short message at the bottom of the screen, with an optional
 * action button; it goes away by itself.
 * @param {string} text
 * @param {string} [action] Button label.
 * @param {function()} [onAction]
 */
export function toast(text, action, onAction) {
  document.querySelectorAll('.ptoast').forEach((x) => x.remove());
  const el = document.createElement('div');
  el.className = 'ptoast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="btn ghost">${esc(action)}</button>` : ''}`;
  document.body.appendChild(el);
  const btn = el.querySelector('button');
  if (btn)
    btn.addEventListener('click', () => {
      el.remove();
      onAction();
    });
  setTimeout(() => el.remove(), 5000);
}
