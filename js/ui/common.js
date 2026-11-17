/**
 * @module ui/common
 * @description
 * Small interface helpers shared by screens and blocks: version, file
 * reading, confirm buttons, audio play button, space reserved for palettes.
 * This module depends on no screen.
 */

import { t } from '../i18n.js';
import { esc } from '../util.js';
import { state } from './state.js';
import * as audio from '../audio.js';
import { METRONOME } from './icons.js';

/** Version shown in Settings (keep it in line with CHANGELOG.md). */
export const APP_VERSION = '2.17.1';

/**
 * HTML of an active block's tools.
 * @param {string} [extra] HTML of the block's own buttons, placed first. They
 *   must not use `data-tool`, which the note screen wires for every block.
 * @returns {string}
 */
export function toolsHtml(extra = '') {
  return `<div class="tools">${extra}<button type="button" data-tool="up" aria-label="${esc(t('common.moveUp'))}">&#8593;</button><button type="button" data-tool="down" aria-label="${esc(t('common.moveDown'))}">&#8595;</button><button type="button" data-tool="del">${esc(t('common.delete'))}</button></div>`;
}

/**
 * Fits a `<textarea>` height to its content (no inner scrollbar).
 *
 * The height is first reset to `auto` to measure the content: for a moment
 * the page is shorter, and the browser pulls the scroll position back up to
 * fit it (on a phone, to the top of the note while typing in the middle of a
 * long text). The scroll position is put back right after, before anything
 * is drawn.
 * @param {HTMLTextAreaElement} el
 */
export function autosize(el) {
  const y = window.scrollY;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
  if (window.scrollY !== y) window.scrollTo(0, y);
}

/**
 * Reads the file chosen in an `<input type=file>` and passes its text to `fn`.
 * @param {Event} e
 * @param {function(string)} fn
 */
export function readFile(e, fn) {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => fn(String(r.result));
  r.readAsText(f);
  input.value = ''; // so the same file can be chosen again
}

/**
 * Destructive action in two steps: the first tap "arms" the button (new
 * label, alert style), the second runs it. Without a second tap, the button
 * returns to its initial state. Native `confirm()` dialogs are awkward on
 * mobile.
 *
 * @param {HTMLButtonElement} btn
 * @param {string} armedLabel Label once armed.
 * @param {function()} action
 * @param {number} [delay=3500] Time (ms) the button stays armed.
 * @returns {boolean} `true` if the action was run.
 */
export function confirmTap(btn, armedLabel, action, delay = 3500) {
  if (btn.dataset.armed) {
    action();
    return true;
  }
  const label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = armedLabel;
  btn.classList.add('confirm');
  setTimeout(() => {
    if (btn.isConnected && btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.textContent = label;
      btn.classList.remove('confirm');
    }
  }, delay);
  return false;
}

/**
 * Header button that opens the metronome (2.11), on every screen. The click
 * is handled by {@link module:ui/metronome|ui/metronome} (delegated listener).
 * @returns {string}
 */
export function metroButton() {
  return `<button class="btn icon-btn" type="button" data-metro-open aria-label="${esc(t('metro.open'))}">${METRONOME}</button>`;
}

/**
 * Metronome button of a staff or chart block header (2.15): opens the
 * metronome set to the block's tempo, time signature and swing.
 * @param {string} id Block id.
 * @returns {string}
 */
export function metroBlockButton(id) {
  return `<button type="button" class="chip metro-chip" data-metro-block="${esc(id)}" aria-label="${esc(t('metro.blockOpen'))}">${METRONOME}</button>`;
}

/**
 * Reserves the height of the open palette at the bottom of the page (CSS
 * variable `--pal-h`), so the content does not go under it.
 */
export function syncPaletteSpace() {
  const pal = document.getElementById('palette');
  const gpal = document.getElementById('gpal');
  const h = !pal.hidden ? pal.offsetHeight : !gpal.hidden ? gpal.offsetHeight : 0;
  document.documentElement.style.setProperty('--pal-h', h + 'px');
}

/**
 * Updates a block's Listen/Stop button.
 * @param {string} id
 */
export function updatePlayBtn(id) {
  const btn = document.querySelector(`[data-play="${CSS.escape(id)}"]`);
  if (!btn) return;
  const on = audio.isPlaying(id);
  btn.classList.toggle('on', on);
  btn.innerHTML = on ? '&#9632; ' + esc(t('play.stop')) : '&#9654; ' + esc(t('play.listen'));
}

/**
 * Playback callbacks shared by staves and charts: highlight of the item
 * being played (on each staff of a block, 2.17), then reset at the end.
 * @param {string} id Block being played.
 * @param {function(string)} redraw Block redraw function.
 * @returns {module:audio~PlayCallbacks}
 */
export function playCallbacks(id, redraw) {
  return {
    onStep: (i, k = 0) => {
      state.playIdx = i;
      state.playAt[k] = i;
      redraw(id);
    },
    onEnd: () => {
      state.playIdx = null;
      state.playAt = [];
      redraw(id);
      updatePlayBtn(id);
    },
  };
}
