/**
 * @module ui/practice/add-to
 * @description
 * **Add to…** (2.16): a generated rhythm line (random exercise, placements
 * series) goes into a note or a practice program in one tap.
 *
 * The sheet offers, from top to bottom: a new note, the programs, then the
 * notes (most recently changed first, a search field for the others).
 *
 * - Into a **note**: a short caption ("Exercise 482 · 7/8 · ♩ = 90") and a
 *   copy of the line are added at the end of the note.
 * - Into a **program**: a new "exercise" item holding the copy.
 */

import { t } from '../../i18n.js';
import { esc, uid } from '../../util.js';
import { state } from '../state.js';
import { openNote } from '../nav.js';
import { newNote } from '../../model.js';
import { sanitizeBlock } from '../../sanitize.js';
import { scheduleSave } from '../../storage.js';
import { newItem, sortedPrograms, newProgram, ITEMS_MAX } from '../../practice.js';
import { openSheet, noteRows, noteTitle, saveProgram, toast } from './shared.js';

/**
 * What to add.
 * @typedef {Object} AddPayload
 * @property {module:model~StaffBlock} block The rhythm line (copied).
 * @property {string} title Its name ("Exercise 482 · 7/8").
 */

/**
 * Copy of the line, with a fresh id, as stored in a note.
 * @param {module:model~StaffBlock} b
 * @returns {module:model~StaffBlock}
 */
function copyBlock(b) {
  return /** @type {module:model~StaffBlock} */ (sanitizeBlock({ ...b, id: uid() }));
}

/**
 * Caption written above the line in a note.
 * @param {AddPayload} what
 * @returns {module:model~TextBlock}
 */
function caption(what) {
  return { id: uid(), type: 'text', text: `${what.title} · ♩ = ${what.block.tempo}` };
}

/**
 * Adds the line at the end of a note.
 * @param {module:model~Note} n
 * @param {AddPayload} what
 */
function addToNote(n, what) {
  // A note holding only an empty text starts with the caption instead.
  if (n.blocks.length === 1 && n.blocks[0].type === 'text' && !n.blocks[0].text.trim()) n.blocks = [];
  n.blocks.push(caption(what), copyBlock(what.block));
  n.updated = Date.now();
  state.notes[n.id] = n;
  scheduleSave(state.notes, n.id);
}

/**
 * Adds the line to a program, as an exercise item.
 * @param {module:practice~Program} p
 * @param {AddPayload} what
 * @returns {boolean} Done (a program holds at most {@link module:practice.ITEMS_MAX|ITEMS_MAX} items).
 */
function addToProgram(p, what) {
  const it = newItem({ kind: 'exercise', staff: what.block, title: what.title });
  if (!it || p.items.length >= ITEMS_MAX) return false;
  p.items.push(it);
  saveProgram(p);
  return true;
}

/**
 * Content of the sheet.
 * @param {string} q Search text.
 * @returns {string}
 */
function body(q) {
  const programs = sortedPrograms(state.programs, state.sessions);
  const progRows = programs
    .map(
      (p) =>
        `<button type="button" class="opt-row" data-a="program" data-id="${esc(p.id)}"><span>${esc(p.name || t('practice.unnamed'))}<small>${esc(t('practice.itemsN', { n: p.items.length }))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>`,
    )
    .join('');
  return `<div class="opt-group"><button type="button" class="opt-row" data-a="newNote"><span>${esc(t('practice.newNote'))}</span><span class="opt-chev" aria-hidden="true">+</span></button></div>
  <h3 class="eyebrow">${esc(t('practice.toProgram'))}</h3>
  <div class="opt-group">${progRows}<button type="button" class="opt-row" data-a="newProgram"><span>${esc(t('practice.newProgram'))}</span><span class="opt-chev" aria-hidden="true">+</span></button></div>
  <h3 class="eyebrow">${esc(t('practice.toNote'))}</h3>
  <input type="search" class="psheet-search" data-q placeholder="${esc(t('practice.searchNote'))}" value="${esc(q)}" autocomplete="off" aria-label="${esc(t('practice.searchNote'))}">
  <div class="opt-group" data-notes>${noteRows(q, 5)}</div>`;
}

/**
 * Opens the "Add to…" sheet.
 * @param {AddPayload} what
 */
export function openAddTo(what) {
  const sheet = openSheet(t('practice.addTo'), body(''), (el, d) => {
    if (d.a === 'newNote') {
      const n = newNote();
      n.title = what.title;
      addToNote(n, what);
      sheet.close();
      toast(t('practice.addedTo', { name: what.title }), t('practice.open'), () => openNote(n.id));
    } else if (d.a === 'note') {
      const n = state.notes[d.id];
      if (!n) return;
      addToNote(n, what);
      sheet.close();
      toast(t('practice.addedTo', { name: noteTitle(n) }), t('practice.open'), () => openNote(n.id));
    } else if (d.a === 'program' || d.a === 'newProgram') {
      const p = d.a === 'program' ? state.programs[d.id] : newProgram(t('practice.defaultName'));
      if (!p) return;
      const ok = addToProgram(p, what);
      sheet.close();
      toast(ok ? t('practice.addedTo', { name: p.name }) : t('practice.programFull'));
    }
  });
  const search = /** @type {HTMLInputElement} */ (sheet.el.querySelector('[data-q]'));
  search.addEventListener('input', () => {
    sheet.el.querySelector('[data-notes]').innerHTML = noteRows(search.value, 5);
  });
}
