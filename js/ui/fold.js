/**
 * @module ui/fold
 * @description
 * **Collapsed long blocks** (since 2.2): a staff, rhythm line or chart of
 * {@link module:ui/fold.FOLD_MIN_LINES|FOLD_MIN_LINES} lines or more can show
 * only its first {@link module:ui/fold.FOLD_PREVIEW_LINES|FOLD_PREVIEW_LINES}
 * lines, with a "Show all" button.
 *
 * ## Who decides whether a block is collapsed?
 *
 * The rule is the pure function {@link module:folding.shouldFold|shouldFold}.
 *
 * In order:
 * 1. **a block being edited is always shown in full**: notes are added at
 *    the end, which would be hidden;
 * 2. a block that is too short is never collapsed (there would be nothing
 *    to hide);
 * 3. the **manual choice** stored on the block (`fold: 'open'` or `'closed'`);
 * 4. otherwise, the **"Collapse long blocks automatically"** option in
 *    Settings (`meta.autoFold`).
 *
 * Tapping a collapsed block activates it (so it is shown in full while it is
 * edited) without storing a choice: with the automatic option, it collapses
 * again when you move on.
 *
 * Collapsing is not editing: the note's date does not change
 * ({@link module:ui/state.saveArrangement|saveArrangement}), and a shared
 * `.inkline` file does not carry this state.
 */

import { t } from '../i18n.js';
import { state, curNote, saveArrangement } from './state.js';
import { getMeta } from '../storage.js';
import { setActive, redrawBlock } from './blocks.js';
import { shouldFold, FOLD_MIN_LINES, FOLD_PREVIEW_LINES } from '../folding.js';

export { FOLD_MIN_LINES, FOLD_PREVIEW_LINES };

/**
 * Should the block on screen be collapsed? See {@link module:folding.shouldFold|shouldFold}.
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 * @param {number} lines Total number of lines of the block at the current width.
 * @returns {boolean}
 */
export function isFolded(b, lines) {
  return shouldFold(b, lines, state.activeId === b.id, !!getMeta().autoFold);
}

/**
 * Updates the "collapsed" look of a block after drawing it: CSS class (fade
 * at the bottom), "Show all" / "Collapse" button.
 *
 * @param {HTMLElement} wrap Drawing area of the block (`.staff-wrap`, `.gridwrap`).
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 * @param {number} lines Total number of lines.
 * @param {boolean} folded Result of {@link isFolded}.
 */
export function applyFold(wrap, b, lines, folded) {
  const blockEl = wrap.closest('.block');
  if (blockEl) blockEl.classList.toggle('folded', folded);
  let bar = /** @type {HTMLButtonElement|null} */ (
    wrap.nextElementSibling && wrap.nextElementSibling.classList.contains('foldbtn')
      ? wrap.nextElementSibling
      : null
  );
  if (lines < FOLD_MIN_LINES) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'foldbtn';
    wrap.after(bar);
    bar.addEventListener('click', () => toggleFold(b, wrap));
  }
  bar.setAttribute('aria-expanded', String(!folded));
  bar.textContent = folded ? t('fold.showAll', { n: lines }) : t('fold.collapse');
}

/**
 * "Show all" / "Collapse" button: stores the choice on the block.
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 * @param {HTMLElement} wrap
 */
function toggleFold(b, wrap) {
  const folded = wrap.closest('.block').classList.contains('folded');
  b.fold = folded ? 'open' : 'closed';
  const n = curNote();
  if (n) saveArrangement(n);
  // An active block is always shown in full: to collapse it, deactivate it.
  if (!folded && state.activeId === b.id) setActive(null);
  redrawBlock(b.id);
  // After collapsing, bring the top of the block back on screen (the content got shorter).
  if (!folded) wrap.closest('.block').scrollIntoView({ block: 'nearest' });
}

/**
 * Intercepts taps on a collapsed block: instead of acting on the music
 * (placing a note, choosing a measure), the tap activates the block, which
 * is then shown in full. **Capture**-phase listener: it runs before those of
 * the staff or chart and can cut them short.
 *
 * @param {HTMLElement} wrap
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 */
export function guardFoldedTaps(wrap, b) {
  wrap.addEventListener(
    'click',
    (e) => {
      if (!wrap.closest('.block').classList.contains('folded')) return;
      e.stopPropagation();
      e.preventDefault();
      setActive(b.id);
    },
    { capture: true },
  );
}
