/**
 * @module ui/practice/item-view
 * @description
 * Read-only view of a practice item during a session (2.16): a free text in
 * large print, a note (its blocks, one under the other), one block, or an
 * exercise. Staves and charts are drawn as SVG, to the width of the screen,
 * each with its ▶ button.
 *
 * Nothing is editable here: a session is for playing, the note screen for
 * writing.
 */

import { t } from '../../i18n.js';
import { esc } from '../../util.js';
import * as audio from '../../audio.js';
import { staffSvg } from '../../render-staff.js';
import { gridSvg } from '../../grid.js';
import { highlight, updatePlay } from '../drill-kit.js';
import { noteOf, blockOf, noteTitle, blockName } from './shared.js';

/** Blocks drawn by the last {@link itemHtml} (index = `data-pv`). */
let shown = [];

/**
 * The blocks an item shows.
 * @param {module:practice~PracticeItem} it
 * @returns {?Array.<module:model~Block>} `null` when its note is gone.
 */
function blocksOf(it) {
  if (it.kind === 'exercise') return [it.staff];
  if (it.kind === 'note') {
    const n = noteOf(it);
    return n ? n.blocks : null;
  }
  if (it.kind === 'block') {
    const b = blockOf(it);
    return b ? [b] : null;
  }
  return [];
}

/**
 * HTML of one block, before drawing.
 * @param {module:model~Block} b
 * @param {number} k Index in {@link shown}.
 * @returns {string}
 */
function blockHtml(b, k) {
  if (b.type === 'text') return b.text.trim() ? `<p class="pv-text">${esc(b.text)}</p>` : '';
  const play = `<button type="button" class="playbtn" data-play="${esc(b.id)}" data-pvplay="${k}">&#9654; ${esc(t('play.listen'))}</button>`;
  return `<div class="pv-block"><div class="pv-head"><span>${esc(blockName(b))}</span>${play}</div><div class="pv-draw ${b.type === 'grid' ? 'pv-grid' : 'pv-staff'}" data-pv="${k}"></div></div>`;
}

/**
 * HTML of an item (staves are drawn afterwards by {@link drawItem}).
 * @param {module:practice~PracticeItem} it
 * @returns {string}
 */
export function itemHtml(it) {
  if (it.kind === 'text') {
    shown = [];
    return `<p class="pv-free">${esc(it.text)}</p>`;
  }
  const blocks = blocksOf(it);
  if (!blocks) {
    shown = [];
    return `<p class="pv-missing">${esc(t('practice.missingNote'))}</p>`;
  }
  shown = blocks;
  const n = it.kind === 'note' ? noteOf(it) : null;
  const title = n ? `<h2 class="pv-title">${esc(noteTitle(n))}</h2>` : '';
  return title + blocks.map(blockHtml).join('');
}

/**
 * Draws the staves and charts of the item shown, to their width.
 * @param {HTMLElement} root
 */
export function drawItem(root) {
  root.querySelectorAll('[data-pv]').forEach((el) => {
    const box = /** @type {HTMLElement} */ (el);
    const b = shown[Number(box.dataset.pv)];
    const W = Math.max(220, box.clientWidth || 300);
    if (b.type === 'grid') {
      const g = gridSvg(b, W);
      box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -14 ${W} ${g.height + 14}" width="${W}" height="${g.height + 14}">${g.svg}</svg>`;
    } else box.innerHTML = staffSvg(/** @type {module:model~StaffBlock} */ (b), W).svg;
  });
}

/**
 * Plays (or stops) a block of the item shown.
 * @param {HTMLElement} root
 * @param {number} k Index in {@link shown}.
 */
export function playShown(root, k) {
  const b = shown[k];
  if (!b) return;
  const el = root.querySelector(`[data-pv="${k}"]`);
  const cb = {
    onStep: (i) => b.type === 'staff' && highlight(el, i),
    onEnd: () => {
      highlight(el, null);
      updatePlay(b.id);
    },
  };
  if (b.type === 'grid') audio.playGrid(/** @type {module:model~GridBlock} */ (b), cb);
  else audio.playStaff(/** @type {module:model~StaffBlock} */ (b), cb);
  updatePlay(b.id);
}
