/**
 * @module ui/staff/chord
 * @description
 * **Chord symbol** above a note (the palette's "Chd" button).
 *
 * Since 2.8.5 it is typed on the **chord keyboard**
 * ({@link module:ui/chord-keyboard|ui/chord-keyboard}), which replaces the
 * palette while typing; `⌨` switches to the text field (phone or computer
 * keyboard). The chord is applied only on "OK".
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

/** Chord being typed (one slot). */
let buf = [];
/** Typing in the text field rather than on the chord keyboard (kept for the session). */
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
 * Switches from the chord keyboard to the text field, or back (keeping the chord).
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
 * Opens chord input for the target note (selection, or the note before the cursor).
 * @param {module:model~StaffBlock} b
 */
export function openChord(b) {
  barBar.hidden = true;
  staffUi.chordTarget = { b, i: targetIndex(b) };
  if (state.mode === 'edit' && state.sel == null) state.sel = staffUi.chordTarget.i;
  hooks.redraw(b.id); // highlights the target note
  const c = b.items[staffUi.chordTarget.i].c || '';
  buf = c ? [c] : [];
  chordBar.hidden = false;
  setTextMode(textMode);
  hooks.refreshPalette();
}

/** Closes chord input without applying it. */
export function closeChord() {
  chordBar.hidden = true;
  staffUi.chordTarget = null;
}

/** Applies the typed chord (empty = removal), 16 characters at most. */
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
