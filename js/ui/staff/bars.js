/**
 * @module ui/staff/bars
 * @description
 * **Barline submenu** of the palette: single, double, final, end repeat,
 * start repeat, none. The barline goes after the target note (the end of the
 * logical note if it is split); a start repeat goes before it.
 */

import { state, touch } from '../state.js';
import { chainEnd } from '../../measure-fit.js';
import { pushSnapshot } from '../../history.js';
import { hooks, activeStaff, refit, targetIndex } from './shared.js';

/** Submenu bar (in index.html). */
export const barBar = /** @type {HTMLElement} */ (document.getElementById('barBar'));

/**
 * Applies a choice from the barline submenu.
 * @param {string} type `'single'|'double'|'final'|'rep'|'rs'|'none'`
 */
export function applyBar(type) {
  const a = activeStaff();
  if (!a) return;
  const { n, b } = a;
  if (type === 'rs') {
    // A start repeat goes BEFORE a note: on the selection, or on the next note.
    if (state.mode === 'edit' && state.sel != null) {
      pushSnapshot(n);
      const it = b.items[state.sel];
      if (it.rs) delete it.rs;
      else it.rs = true;
      refit(b);
      touch(n);
    } else state.input.rs = !state.input.rs;
  } else {
    const tgt = targetIndex(b);
    if (tgt < 0) return;
    pushSnapshot(n);
    const it = b.items[chainEnd(b.items, tgt)];
    if (type === 'none') {
      delete it.bar;
      delete it.rs;
    } else if (it.bar === type) delete it.bar;
    else it.bar = /** @type {any} */ (type);
    refit(b);
    touch(n);
  }
  barBar.hidden = true;
  hooks.redraw(b.id);
  hooks.refreshPalette();
}

/**
 * Pressed state of the submenu buttons.
 * @param {module:model~StaffBlock} b
 * @param {?module:model~StaffItem} sel Selected note (Edit mode).
 */
export function syncBarMenu(b, sel) {
  const target = b.items[targetIndex(b)] ? b.items[chainEnd(b.items, targetIndex(b))] : null;
  barBar.querySelectorAll('[data-bar]').forEach((x) => {
    const t = /** @type {HTMLElement} */ (x).dataset.bar;
    const on = t === 'rs' ? (sel ? !!sel.rs : state.input.rs) : !!target && t !== 'none' && target.bar === t;
    x.setAttribute('aria-pressed', String(on));
  });
}
