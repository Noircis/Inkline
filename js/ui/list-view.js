/**
 * @module ui/list-view
 * @description
 * The **three displays** of the note list, chosen in Settings:
 *
 * | Mode      | Key      | Content                                                   |
 * |-----------|----------|-----------------------------------------------------------|
 * | Cards     | `cards`  | large card: title, date, summary, start of text, first staff line |
 * | Mosaic    | `mosaic` | squares, 2 per row: title + preview suited to the content |
 * | List      | `list`   | one line per note: title, dates, summary                  |
 *
 * ## Mosaic preview
 *
 * A whole staff shrunk to ~170 px would be unreadable. The preview therefore
 * depends on the note's content, by priority:
 * 1. a **staff**: its first measures, drawn at a reduced width (fewer
 *    measures per line) then scaled: it is a zoom;
 * 2. a **chart**: its first chords, as text;
 * 3. otherwise the **start of the text**.
 *
 * SVG thumbnails are drawn after layout (in a `requestAnimationFrame`), when
 * the real width of the cards is known.
 */

import { t, locale } from '../i18n.js';
import { esc } from '../util.js';
import { staffSvg } from '../render-staff.js';
import { chordParts } from '../chords.js';
import { folderOf, catsOf } from '../folders.js';
import { PIN_ICON } from './icons.js';

/**
 * List display options.
 * @typedef {Object} ListOptions
 * @property {Object.<string, module:folders~Folder>} [folders] Folders (for the labels).
 * @property {boolean} [showFolder] Show each note's folder (useless when the
 *   list shows a single folder).
 */

/** Display modes, in picker order. */
export const LIST_VIEWS = [{ key: 'cards' }, { key: 'mosaic' }, { key: 'list' }];

/** Width (px) at which the staff is drawn before shrinking, in mosaic. */
const MOSAIC_STAFF_W = 260;

/**
 * Short date ("Nov 4").
 * @param {number} ts
 * @returns {string}
 */
function shortDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  } catch (e) {
    return '';
  }
}

/**
 * Relative date for a recent change ("today", "yesterday"), short date
 * beyond that.
 * @param {number} ts
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function relativeDate(ts, now = Date.now()) {
  const day = (ms) => {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const diff = Math.round((day(now) - day(ts)) / 86400000);
  if (diff <= 0) return t('list.today');
  if (diff === 1) return t('list.yesterday');
  return shortDate(ts);
}

/**
 * Summary of a note's content ("1 staff · 2 charts").
 * @param {module:model~Note} n
 * @returns {string}
 */
export function noteSummary(n) {
  const st = n.blocks.filter((b) => b.type === 'staff');
  const r = st.filter((b) => b.clef === 'rhythm').length;
  const p = st.length - r;
  const gr = n.blocks.filter((b) => b.type === 'grid').length;
  const parts = [];
  if (p) parts.push(t('list.staves', { n: p }));
  if (r) parts.push(t('list.rhythms', { n: r }));
  if (gr) parts.push(t('list.grids', { n: gr }));
  return parts.join(' · ');
}

/** First non-empty text of a note (or empty string). */
const firstText = (n) => ((n.blocks.find((b) => b.type === 'text' && b.text.trim()) || {}).text || '').trim();

/** First non-empty staff of a note. */
const firstStaff = (n) => n.blocks.find((b) => b.type === 'staff' && b.items.length);

/**
 * First chords of a note (charts first, otherwise chord symbols of staves),
 * formatted as in the chart (quality as superscript).
 * @param {module:model~Note} n
 * @param {number} max
 * @returns {string} HTML fragment (escaped), empty if there is no chord.
 */
function chordsPreview(n, max) {
  const out = [];
  const push = (c) => {
    if (out.length >= max || !c || c === 'n' || c === '%') return;
    const p = chordParts(c);
    if (p)
      out.push(
        `<span class="pc">${esc(p.root)}${p.quality ? `<sup>${esc(p.quality)}</sup>` : ''}${esc(p.bass)}</span>`,
      );
  };
  n.blocks.forEach((b) => {
    if (b.type === 'grid') b.measures.forEach((m) => m.ch.forEach(push));
  });
  if (!out.length)
    n.blocks.forEach((b) => {
      if (b.type === 'staff') b.items.forEach((it) => push(it.c));
    });
  return out.join(' ');
}

/**
 * Folder label (dot + name), or empty string.
 * @param {module:model~Note} n
 * @param {ListOptions} opt
 * @returns {string}
 */
function folderTag(n, opt) {
  const f = opt.showFolder && opt.folders ? folderOf(n, opt.folders) : null;
  return f
    ? `<span class="ftag"><span class="fdot fc-${f.color}" aria-hidden="true"></span>${esc(f.name)}${catLabel(n, opt.folders)}</span>`
    : '';
}

/**
 * HTML of a note for the given mode.
 * @param {module:model~Note} n
 * @param {string} mode
 * @param {ListOptions} [opt={}]
 * @returns {string}
 */
function itemHtml(n, mode, opt = {}) {
  const pin = n.pinned
    ? `<span class="pin" title="${esc(t('list.pinned'))}">${PIN_ICON}<span class="sr">${esc(t('list.pinned'))}</span></span>`
    : '';
  const title = pin + esc(n.title || t('list.untitled'));
  const tag = folderTag(n, opt);
  const sum = noteSummary(n);
  const txt = firstText(n);
  if (mode === 'list') {
    const sub = [t('list.createdOn', { date: shortDate(n.created || n.updated) }), sum]
      .filter(Boolean)
      .join(' · ');
    return `<span class="row-main"><span class="row-title">${title}</span><span class="row-sub">${tag}${esc(sub)}</span></span><span class="row-date">${esc(relativeDate(n.updated))}</span>`;
  }
  if (mode === 'mosaic') {
    // Preview: staff (drawn later) > chords > text.
    let preview = '';
    if (firstStaff(n)) preview = '<div class="mz-thumb"></div>';
    else {
      const ch = chordsPreview(n, 10);
      preview = ch
        ? `<div class="mz-chords">${ch}</div>`
        : txt
          ? `<p class="mz-text">${esc(txt)}</p>`
          : `<p class="mz-text mz-empty">${esc(t('list.emptyNote'))}</p>`;
    }
    return `<h3>${title}</h3>${preview}<div class="mz-foot">${tag}<span>${esc(shortDate(n.updated))}</span>${sum ? `<span>${esc(sum)}</span>` : ''}</div>`;
  }
  return `<h3>${title}</h3><div class="meta">${tag}<span>${esc(shortDate(n.updated))}</span>${sum ? `<span>${esc(sum)}</span>` : ''}</div>${txt ? `<p class="snip">${esc(txt.split('\n')[0])}</p>` : ''}<div class="thumb"></div>`;
}

/**
 * A note's categories after its folder ("› Technique, Son"), 2.8.6.
 * @param {module:model~Note} n
 * @param {Object.<string, module:folders~Folder>} folders
 * @returns {string}
 */
function catLabel(n, folders) {
  const cats = catsOf(n, folders);
  return cats.length ? ` › ${esc(cats.map((c) => c.name).join(', '))}` : '';
}

/**
 * Builds the note list in `container`.
 *
 * @param {HTMLElement} container
 * @param {module:model~Note[]} notes Notes already sorted.
 * @param {'cards'|'mosaic'|'list'} mode
 * @param {function(string)} onOpen Called with the id of the tapped note.
 * @param {ListOptions} [opt={}]
 */
export function renderNoteList(container, notes, mode, onOpen, opt = {}) {
  const wrap = document.createElement('div');
  wrap.className = mode === 'mosaic' ? 'mosaic' : mode === 'list' ? 'rows' : 'list';
  notes.forEach((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = mode === 'mosaic' ? 'mz' : mode === 'list' ? 'row' : 'card';
    btn.innerHTML = itemHtml(n, mode, opt);
    btn.onclick = () => onOpen(n.id);
    wrap.appendChild(btn);
  });
  container.appendChild(wrap);

  if (mode === 'list') return;
  // SVG thumbnails, once the real width is known.
  requestAnimationFrame(() => {
    [...wrap.children].forEach((el, k) => {
      const st = firstStaff(notes[k]);
      const th = el.querySelector(mode === 'mosaic' ? '.mz-thumb' : '.thumb');
      if (!st || !th) return;
      // Mosaic: drawn at a fixed reduced width, then scaled by CSS (zoom on the start).
      th.innerHTML = staffSvg(st, mode === 'mosaic' ? MOSAIC_STAFF_W : th.clientWidth || 300, {
        maxSystems: 1,
      }).svg;
    });
  });
}
