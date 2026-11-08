/**
 * @module ui/staff/chord
 * @description
 * **Accord chiffré** au-dessus d'une note : petit champ de saisie qui
 * s'ouvre au-dessus de la palette (bouton « Acc. »).
 */

import { state, curNote, touch } from '../state.js';
import { pushSnapshot } from '../../history.js';
import { hooks, staffUi, targetIndex } from './shared.js';

const barBar = /** @type {HTMLElement} */ (document.getElementById('barBar'));
const chordBar = /** @type {HTMLElement} */ (document.getElementById('chordBar'));
const chordIn = /** @type {HTMLInputElement} */ (document.getElementById('chordIn'));

/**
 * Ouvre le champ d'accord pour la note visée (sélection, ou note avant le curseur).
 * @param {module:model~StaffBlock} b
 */
export function openChord(b) {
  barBar.hidden = true;
  staffUi.chordTarget = { b, i: targetIndex(b) };
  if (state.mode === 'edit' && state.sel == null) state.sel = staffUi.chordTarget.i;
  hooks.redraw(b.id); // surligne la note visée
  chordIn.value = b.items[staffUi.chordTarget.i].c || '';
  chordBar.hidden = false;
  hooks.refreshPalette();
  chordIn.focus();
}

/** Ferme le champ d'accord sans appliquer. */
export function closeChord() {
  chordBar.hidden = true;
  staffUi.chordTarget = null;
}

/** Applique l'accord saisi (vide = suppression), 16 caractères au plus. */
function applyChord() {
  const t = staffUi.chordTarget;
  if (!t) return;
  const n = curNote();
  const it = t.b.items[t.i];
  if (it && n) {
    pushSnapshot(n);
    const v = chordIn.value.trim().slice(0, 16);
    if (v) it.c = v;
    else delete it.c;
    touch(n);
  }
  closeChord();
  chordIn.blur();
  hooks.redraw(t.b.id);
  hooks.refreshPalette();
}

document.getElementById('chordOk').onclick = applyChord;
document.getElementById('chordCancel').onclick = () => {
  closeChord();
  chordIn.blur();
  hooks.refreshPalette();
};
chordIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyChord();
  }
});
