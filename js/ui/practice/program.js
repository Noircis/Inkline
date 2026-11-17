/**
 * @module ui/practice/program
 * @description
 * **Program editor** (`program` screen, 2.16): its name, its items in
 * practice order, and ▶ to start a session.
 *
 * - **+ Add**: a free text, a note, or one block of a note (exercises come
 *   from the exercise screens, with "Add to…").
 * - **≡**: drag an item to move it (Move up / down in its sheet, too).
 * - Tap an item: its sheet (text, duration, metronome, move, delete).
 *
 * A duration is optional: without one, the session shows a quiet stopwatch.
 * The metronome of an item is saved from the metronome itself, during a
 * session ("Save for this item"); here it can only be removed.
 */

import { t } from '../../i18n.js';
import { esc } from '../../util.js';
import { state, app } from '../state.js';
import * as audio from '../../audio.js';
import { registerScreen, backToList } from '../nav.js';
import { hideAllPalettes } from '../blocks.js';
import { confirmTap } from '../common.js';
import { header } from '../drill-kit.js';
import { meterLabel, sanitizeMetro, unitGlyph } from '../../metronome.js';
import {
  newItem,
  moveItem,
  duplicateProgram,
  DURATIONS,
  ITEMS_MAX,
  ITEM_TEXT_MAX,
  PROGRAM_NAME_MAX,
} from '../../practice.js';
import {
  programById,
  saveProgram,
  deleteProgram,
  itemLabel,
  kindLabel,
  openSheet,
  noteRows,
  noteTitle,
  blockName,
  toast,
  startSession,
} from './shared.js';

/** Program shown. */
let prog = null;
/** Pending name save. */
let nameTimer = 0;

/**
 * Short metronome summary of an item: "♩ 132 · 4/4".
 * @param {Object} part Preset part.
 * @returns {string}
 */
export function metroSummary(part) {
  const m = sanitizeMetro(part);
  return `${unitGlyph(m)} ${m.tempo} · ${meterLabel(m)}`;
}

/**
 * Second line of an item: kind, duration, metronome.
 * @param {module:practice~PracticeItem} it
 * @returns {string}
 */
function itemInfo(it) {
  const parts = [kindLabel(it)];
  if (it.minutes) parts.push(t('practice.minutes', { n: it.minutes }));
  if (it.metro) parts.push(metroSummary(it.metro));
  return parts.join(' · ');
}

/**
 * The list of items.
 * @returns {string}
 */
function itemsHtml() {
  if (!prog.items.length) return `<p class="pitems-empty">${esc(t('practice.noItem'))}</p>`;
  return `<ol class="pitems" id="pItems">${prog.items
    .map(
      (it) =>
        `<li class="pitem" data-id="${esc(it.id)}"><span class="pdrag" data-drag aria-hidden="true">&#8801;</span><button type="button" class="pitem-main" data-item="${esc(it.id)}"><span class="pitem-name">${esc(itemLabel(it))}</span><small>${esc(itemInfo(it))}</small></button><button type="button" class="pitem-play" data-play-item="${esc(it.id)}" aria-label="${esc(t('practice.startAt', { name: itemLabel(it) }))}">&#9654;</button></li>`,
    )
    .join('')}</ol>`;
}

/**
 * Program screen.
 * @returns {boolean|void} `false` if the program no longer exists.
 */
function renderProgram() {
  prog = programById(state.view.id);
  if (!prog) return false;
  audio.stop();
  hideAllPalettes();
  const start = `<button type="button" class="btn icon-btn" id="pMenu" aria-label="${esc(t('practice.menu'))}">&#8943;</button>`;
  app.innerHTML = `${header(t('home.training'), '', start)}
  <input class="title-in prog-name" id="pName" maxlength="${PROGRAM_NAME_MAX}" placeholder="${esc(t('practice.namePlaceholder'))}" aria-label="${esc(t('practice.name'))}" autocomplete="off">
  ${itemsHtml()}
  <div class="pactions">
    <button type="button" class="btn" id="pAdd"${prog.items.length >= ITEMS_MAX ? ' disabled' : ''}>+ ${esc(t('practice.add'))}</button>
    <button type="button" class="btn primary" id="pStart"${prog.items.length ? '' : ' disabled'}>&#9654; ${esc(t('practice.start'))}</button>
  </div>`;
  const name = /** @type {HTMLInputElement} */ (app.querySelector('#pName'));
  name.value = prog.name;
  name.addEventListener('input', () => {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(saveName, 400);
  });
  name.addEventListener('change', saveName);
  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#pMenu').addEventListener('click', openMenu);
  app.querySelector('#pAdd').addEventListener('click', openAdd);
  app.querySelector('#pStart').addEventListener('click', () => startSession(prog.id));
  app
    .querySelectorAll('[data-item]')
    .forEach((b) => b.addEventListener('click', () => openItem(/** @type {HTMLElement} */ (b).dataset.item)));
  // ▶ on an item: the session starts right there (2.17.1).
  app
    .querySelectorAll('[data-play-item]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        startSession(prog.id, /** @type {HTMLElement} */ (b).dataset.playItem),
      ),
    );
  app
    .querySelectorAll('[data-drag]')
    .forEach((h) => h.addEventListener('pointerdown', (e) => dragItem(/** @type {PointerEvent} */ (e))));
  // A program just created: its name is ready to be typed over.
  if (!prog.items.length && prog.name === t('practice.defaultName')) {
    name.focus();
    name.select();
  }
}

/** Saves the typed name. */
function saveName() {
  clearTimeout(nameTimer);
  const el = /** @type {HTMLInputElement} */ (app.querySelector('#pName'));
  if (!el || !prog) return;
  const v = el.value.replace(/\s+/g, ' ').trim().slice(0, PROGRAM_NAME_MAX);
  if (v === prog.name) return;
  prog.name = v;
  saveProgram(prog);
}

/** Redraws, keeping the scroll position. */
function refresh() {
  const y = window.scrollY;
  renderProgram();
  window.scrollTo(0, y);
}

// ---------- Menu ----------

/** Program menu: duplicate, delete. */
function openMenu() {
  saveName();
  const body = `<div class="opt-group">
    <button type="button" class="opt-row" data-a="dup"><span>${esc(t('practice.duplicate'))}</span></button>
    <button type="button" class="opt-row danger" data-a="del"><span>${esc(t('practice.deleteProgram'))}<small>${esc(t('practice.deleteHint'))}</small></span></button>
  </div>`;
  const sheet = openSheet(prog.name || t('practice.unnamed'), body, (el, d) => {
    if (d.a === 'dup') {
      const copy = duplicateProgram(prog, t('practice.copyOf', { name: prog.name }));
      saveProgram(copy);
      sheet.close();
      toast(t('practice.duplicated', { name: copy.name }));
    }
    if (d.a === 'del')
      confirmTap(/** @type {HTMLButtonElement} */ (el), t('common.confirm'), () => {
        deleteProgram(prog.id);
        sheet.close();
        setTimeout(backToList, 50);
      });
  });
}

// ---------- Adding ----------

/** "+ Add" sheet: free text, a note, a block of a note. */
function openAdd() {
  saveName();
  const choose = `<div class="opt-group">
    <button type="button" class="opt-row" data-a="text"><span>${esc(t('practice.addText'))}<small>${esc(t('practice.addTextHint'))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    <button type="button" class="opt-row" data-a="pickNote"><span>${esc(t('practice.addNote'))}<small>${esc(t('practice.addNoteHint'))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    <button type="button" class="opt-row" data-a="pickBlock"><span>${esc(t('practice.addBlock'))}<small>${esc(t('practice.addBlockHint'))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
  </div>
  <p class="psheet-hint">${esc(t('practice.addExerciseHint'))}</p>`;
  /** What the note list is for. */
  let mode = 'note';
  const sheet = openSheet(t('practice.add'), choose, (el, d) => {
    const body = sheet.el.querySelector('.psheet-body');
    if (d.a === 'text') {
      body.innerHTML = `<form class="ptext" data-text-form><textarea data-text rows="3" maxlength="${ITEM_TEXT_MAX}" placeholder="${esc(t('practice.textPlaceholder'))}" aria-label="${esc(t('practice.addText'))}"></textarea><button type="submit" class="btn primary">${esc(t('common.add'))}</button></form>`;
      const ta = /** @type {HTMLTextAreaElement} */ (body.querySelector('[data-text]'));
      body.querySelector('[data-text-form]').addEventListener('submit', (e) => {
        e.preventDefault();
        if (add({ kind: 'text', text: ta.value })) sheet.close();
      });
      ta.focus();
    } else if (d.a === 'pickNote' || d.a === 'pickBlock') {
      mode = d.a === 'pickNote' ? 'note' : 'block';
      body.innerHTML = `<input type="search" class="psheet-search" data-q placeholder="${esc(t('practice.searchNote'))}" autocomplete="off" aria-label="${esc(t('practice.searchNote'))}"><div class="opt-group" data-notes>${noteRows('')}</div>`;
      const q = /** @type {HTMLInputElement} */ (body.querySelector('[data-q]'));
      q.addEventListener('input', () => (body.querySelector('[data-notes]').innerHTML = noteRows(q.value)));
    } else if (d.a === 'note') {
      const n = state.notes[d.id];
      if (!n) return;
      if (mode === 'note') {
        if (add({ kind: 'note', note: n.id })) sheet.close();
        return;
      }
      body.innerHTML = `<h3 class="eyebrow">${esc(noteTitle(n))}</h3><div class="opt-group">${n.blocks
        .map(
          (b) =>
            `<button type="button" class="opt-row" data-a="block" data-note="${esc(n.id)}" data-id="${esc(b.id)}"><span>${esc(blockName(b))}</span><span class="opt-chev" aria-hidden="true">+</span></button>`,
        )
        .join('')}</div>`;
    } else if (d.a === 'block') {
      if (add({ kind: 'block', note: d.note, block: d.id })) sheet.close();
    }
  });
}

/**
 * Adds an item at the end of the program.
 * @param {Object} fields
 * @returns {boolean} Added.
 */
function add(fields) {
  const it = newItem(fields);
  if (!it || prog.items.length >= ITEMS_MAX) return false;
  prog.items.push(it);
  saveProgram(prog);
  refresh();
  return true;
}

// ---------- One item ----------

/**
 * Sheet of an item: text, duration, metronome, move, delete.
 * @param {string} id
 */
function openItem(id) {
  saveName();
  const i = prog.items.findIndex((x) => x.id === id);
  const it = prog.items[i];
  if (!it) return;
  const durations = [0, ...DURATIONS]
    .map(
      (m) =>
        `<button type="button" class="chip" data-a="minutes" data-m="${m}" aria-pressed="${(it.minutes || 0) === m}">${esc(m ? String(m) : t('practice.noDuration'))}</button>`,
    )
    .join('');
  const metro = it.metro
    ? `<div class="pmetro"><span>${esc(metroSummary(it.metro))}</span><button type="button" class="btn ghost" data-a="metroOff">${esc(t('practice.metroOff'))}</button></div>`
    : `<p class="psheet-hint">${esc(t('practice.metroHint'))}</p>`;
  const text =
    it.kind === 'text'
      ? `<textarea data-text rows="2" maxlength="${ITEM_TEXT_MAX}" aria-label="${esc(t('practice.addText'))}">${esc(it.text)}</textarea>`
      : '';
  const body = `${text}
  <h3 class="eyebrow">${esc(t('practice.duration'))}</h3>
  <div class="pchips">${durations}</div>
  <p class="psheet-hint">${esc(t('practice.durationHint'))}</p>
  <h3 class="eyebrow">${esc(t('metro.title'))}</h3>
  ${metro}
  <div class="sheet-actions">
    <button type="button" class="btn ghost danger" data-a="delete">${esc(t('common.delete'))}</button>
    <div class="grow"></div>
    <button type="button" class="btn icon-btn" data-a="up" aria-label="${esc(t('common.moveUp'))}"${i ? '' : ' disabled'}>&#8593;</button>
    <button type="button" class="btn icon-btn" data-a="down" aria-label="${esc(t('common.moveDown'))}"${i < prog.items.length - 1 ? '' : ' disabled'}>&#8595;</button>
  </div>`;
  const sheet = openSheet(itemLabel(it), body, (el, d) => {
    if (d.a === 'minutes') {
      const m = Number(d.m);
      if (m) it.minutes = m;
      else delete it.minutes;
      sheet.el
        .querySelectorAll('[data-a="minutes"]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    } else if (d.a === 'metroOff') {
      delete it.metro;
      el.closest('.pmetro').outerHTML = `<p class="psheet-hint">${esc(t('practice.metroHint'))}</p>`;
    } else if (d.a === 'up' || d.a === 'down') {
      const j = prog.items.indexOf(it);
      prog.items = moveItem(prog.items, j, d.a === 'up' ? j - 1 : j + 1);
      sheet.close();
    } else if (d.a === 'delete') {
      return confirmTap(/** @type {HTMLButtonElement} */ (el), t('common.confirm'), () => {
        prog.items = prog.items.filter((x) => x !== it);
        sheet.close();
        saveProgram(prog);
        refresh();
      });
    } else return;
    saveProgram(prog);
    refresh();
  });
  const ta = /** @type {HTMLTextAreaElement} */ (sheet.el.querySelector('[data-text]'));
  if (ta)
    ta.addEventListener('change', () => {
      const v = ta.value.trim().slice(0, ITEM_TEXT_MAX);
      if (!v) return;
      it.text = v;
      saveProgram(prog);
      refresh();
    });
}

// ---------- Drag and drop ----------

/**
 * Drags an item by its handle: the rows reorder under the finger, the new
 * order is saved on release.
 * @param {PointerEvent} e
 */
function dragItem(e) {
  const handle = /** @type {HTMLElement} */ (e.currentTarget);
  const li = /** @type {HTMLElement} */ (handle.closest('.pitem'));
  const list = /** @type {HTMLElement} */ (li.parentElement);
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  li.classList.add('dragging');
  const move = (ev) => {
    const rows = /** @type {Array.<HTMLElement>} */ ([...list.children]).filter((x) => x !== li);
    const before = rows.find((r) => {
      const box = r.getBoundingClientRect();
      return ev.clientY < box.top + box.height / 2;
    });
    if (before) {
      if (li.nextElementSibling !== before) list.insertBefore(li, before);
    } else if (list.lastElementChild !== li) list.appendChild(li);
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    li.classList.remove('dragging');
    const order = [...list.children].map((x) => /** @type {HTMLElement} */ (x).dataset.id);
    const byId = new Map(prog.items.map((it) => [it.id, it]));
    const next = order.map((id) => byId.get(id)).filter(Boolean);
    if (next.some((it, k) => it !== prog.items[k])) {
      prog.items = next;
      saveProgram(prog);
    }
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

registerScreen('program', renderProgram, saveName);
