/**
 * @module ui/staff/chord
 * @description
 * **Accord chiffré** au-dessus d'une note (bouton « Acc. » de la palette).
 *
 * Depuis la 2.8.5, il se saisit au **clavier d'accords**
 * ({@link module:ui/chord-keyboard|ui/chord-keyboard}) qui remplace la
 * palette le temps de la saisie ; `⌨` repasse au champ texte (clavier du
 * téléphone ou de l'ordinateur). L'accord n'est appliqué qu'à « OK ».
 */

import { state, curNote, touch } from '../state.js';
import { pushSnapshot } from '../../history.js';
import { applyChordKey } from '../../chord-keys.js';
import { mountChordKeyboard } from '../chord-keyboard.js';
import { hooks, staffUi, targetIndex } from './shared.js';

const barBar = /** @type {HTMLElement} */ (document.getElementById('barBar'));
const chordBar = /** @type {HTMLElement} */ (document.getElementById('chordBar'));
const chordText = /** @type {HTMLElement} */ (document.getElementById('chordText'));
const chordIn = /** @type {HTMLInputElement} */ (document.getElementById('chordIn'));
const chordKeys = /** @type {HTMLElement} */ (document.getElementById('chordKeys'));

/** Accord en cours de saisie (une case). */
let buf = [];
/** Saisie au champ texte plutôt qu'au clavier d'accords (gardé le temps de la session). */
let textMode = false;

const kb = mountChordKeyboard(chordKeys, {
  mode: 'staff',
  onKey: (k) => {
    buf = applyChordKey(buf, k).slice(0, 1);
    kb.show(buf);
  },
  onNext: () => applyChord(),
  onText: () => setTextMode(true),
});

/**
 * Passe du clavier d'accords au champ texte, ou l'inverse (en gardant l'accord).
 * @param {boolean} on
 */
function setTextMode(on) {
  textMode = on;
  if (on) chordIn.value = buf[0] || '';
  else buf = chordIn.value.trim() ? [chordIn.value.trim()] : [];
  chordText.hidden = !on;
  chordKeys.hidden = on;
  if (on) chordIn.focus();
  else {
    chordIn.blur();
    kb.show(buf);
  }
}

/**
 * Ouvre la saisie d'accord pour la note visée (sélection, ou note avant le curseur).
 * @param {module:model~StaffBlock} b
 */
export function openChord(b) {
  barBar.hidden = true;
  staffUi.chordTarget = { b, i: targetIndex(b) };
  if (state.mode === 'edit' && state.sel == null) state.sel = staffUi.chordTarget.i;
  hooks.redraw(b.id); // surligne la note visée
  const c = b.items[staffUi.chordTarget.i].c || '';
  buf = c ? [c] : [];
  chordBar.hidden = false;
  setTextMode(textMode);
  hooks.refreshPalette();
}

/** Ferme la saisie d'accord sans appliquer. */
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
    const v = (textMode ? chordIn.value : buf[0] || '').trim().slice(0, 16);
    if (v && v !== 'n' && !v.endsWith('/')) it.c = v;
    else delete it.c;
    touch(n);
  }
  closeChord();
  chordIn.blur();
  hooks.redraw(t.b.id);
  hooks.refreshPalette();
}

document.getElementById('chordOk').onclick = applyChord;
document.getElementById('chordKb').onclick = () => setTextMode(false);
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
