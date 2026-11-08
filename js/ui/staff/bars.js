/**
 * @module ui/staff/bars
 * @description
 * **Sous-menu des barres** de la palette : barre simple, double, de fin, de
 * reprise, début de reprise, aucune. La barre se place après la note visée
 * (la fin de la note logique si elle est coupée) ; le début de reprise, avant.
 */

import { state, touch } from '../state.js';
import { chainEnd } from '../../measure-fit.js';
import { pushSnapshot } from '../../history.js';
import { hooks, activeStaff, refit, targetIndex } from './shared.js';

/** Barre du sous-menu (dans index.html). */
export const barBar = /** @type {HTMLElement} */ (document.getElementById('barBar'));

/**
 * Applique un choix du sous-menu des barres.
 * @param {string} type `'single'|'double'|'final'|'rep'|'rs'|'none'`
 */
export function applyBar(type) {
  const a = activeStaff();
  if (!a) return;
  const { n, b } = a;
  if (type === 'rs') {
    // Le début de reprise se place AVANT une note : sur la sélection, ou sur la prochaine note.
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
 * État enfoncé des boutons du sous-menu.
 * @param {module:model~StaffBlock} b
 * @param {?module:model~StaffItem} sel Note sélectionnée (mode Modifier).
 */
export function syncBarMenu(b, sel) {
  const target = b.items[targetIndex(b)] ? b.items[chainEnd(b.items, targetIndex(b))] : null;
  barBar.querySelectorAll('[data-bar]').forEach((x) => {
    const t = /** @type {HTMLElement} */ (x).dataset.bar;
    const on = t === 'rs' ? (sel ? !!sel.rs : state.input.rs) : !!target && t !== 'none' && target.bar === t;
    x.setAttribute('aria-pressed', String(on));
  });
}
