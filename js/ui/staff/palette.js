/**
 * @module ui/staff/palette
 * @description
 * **Palette** des portées, fixée en bas d'écran : mode (Écrire / Modifier),
 * valeurs, point, triolet, silence, liaison, altérations, barres, accord
 * chiffré, navigation, annuler, effacer.
 *
 * Chaque bouton agit selon le mode :
 * - **Écrire** : il règle la **prochaine** note
 *   (voir {@link module:ui/state~InputSettings|InputSettings}) ;
 * - **Modifier** : il modifie la **note sélectionnée**. Changer sa durée
 *   garde la suite en place (compensation par des silences, voir
 *   {@link module:measure-fit.resizeEvent|resizeEvent}).
 *
 * Toute modification est précédée de `pushSnapshot` (annulation) et suivie de
 * `touch` (sauvegarde), d'une remise en mesure et d'un redessin.
 */

import { t } from '../../i18n.js';
import { state, touch } from '../state.js';
import { pitchName } from '../../pitch.js';
import { resizeEvent, chainStart, chainEnd } from '../../measure-fit.js';
import { pushSnapshot } from '../../history.js';
import * as audio from '../../audio.js';
import { syncPaletteSpace } from '../common.js';
import { setActive, undo } from '../blocks.js';
import { hooks, staffUi, flash, activeStaff, refit, insertIndex, logicalValue, withSel } from './shared.js';
import { setMode } from './input.js';
import { barBar, applyBar, syncBarMenu } from './bars.js';
import { openChord, closeChord } from './chord.js';

const pal = /** @type {HTMLElement} */ (document.getElementById('palette'));

/** Glyphes Unicode des boutons de valeur, en mode note et en mode silence. */
const GLYPHS = {
  note: { w: '\u{1D15D}', h: '\u{1D15E}', q: '\u{1D15F}', 8: '\u{1D160}', 16: '\u{1D161}' },
  rest: { w: '\u{1D13B}', h: '\u{1D13C}', q: '\u{1D13D}', 8: '\u{1D13E}', 16: '\u{1D13F}' },
};

/** Noms accessibles des boutons de valeur. */
const LABELS = {
  note: (d) => t('dur.' + d),
  rest: (d) => t('rest.' + d),
};

/**
 * Affiche ou cache la palette de portée.
 * @param {boolean} on
 */
export function showStaffPalette(on) {
  if (!on) {
    closeChord();
    barBar.hidden = true;
  }
  pal.hidden = !on;
  if (on) updateStaffPalette();
}

/**
 * Valeurs que la palette doit montrer : celles de la note sélectionnée (mode
 * Modifier ; une note coupée par une barre montre sa valeur entière), sinon
 * les réglages de saisie.
 * @param {module:model~StaffBlock} b
 * @returns {{sel: ?Object, d: string, dot: boolean, rest: boolean, acc: ?number, tup: boolean, tie: boolean}}
 */
function shownValues(b) {
  const inp = state.input;
  const sel =
    state.mode === 'edit' && state.sel != null && b.items[state.sel]
      ? { ...b.items[state.sel], ...logicalValue(b, state.sel) }
      : null;
  if (!sel) return { sel, d: inp.d, dot: inp.dot, rest: inp.rest, acc: inp.acc, tup: inp.tup, tie: inp.tie };
  return {
    sel,
    d: sel.d,
    dot: !!sel.dot,
    rest: !!sel.r,
    acc: sel.a ?? null,
    tup: !!sel.tup,
    tie: !!b.items[chainEnd(b.items, state.sel)].tie && !b.items[chainEnd(b.items, state.sel)].auto,
  };
}

/**
 * Message d'aide, du plus spécifique au plus général.
 * @param {module:model~StaffBlock} b
 * @param {ReturnType<shownValues>} v
 * @returns {string}
 */
function helpText(b, v) {
  if (staffUi.notice) return staffUi.notice;
  const inp = state.input;
  const rh = b.clef === 'rhythm';
  const last = b.items[b.items.length - 1];
  if (v.sel) {
    if (v.sel.r) return t('hint.restSelected');
    if (rh) return t('hint.noteSelected');
    return pitchName(b.clef, v.sel.s, v.sel.a, b.ks) + ' · ' + t('hint.moveNote');
  }
  if (state.mode === 'edit') return t('hint.editMode');
  if (state.cursor != null) return t('hint.insertBefore', { n: state.cursor + 1 });
  if (last && last.bar === 'final') return t('hint.finished');
  if (inp.tie) return t('hint.tie');
  if (inp.rs) return t('hint.repeat');
  if (v.rest) return t('hint.restMode', { rest: LABELS.rest(v.d).toLowerCase() });
  if (inp.tup) return t('hint.tripletMode');
  return rh ? t('hint.addRhythm') : t('hint.addStaff');
}

/**
 * Met la palette en accord avec le mode, la sélection ou les réglages de
 * saisie : boutons enfoncés, glyphes (note ou silence), message d'aide.
 */
function updateStaffPalette() {
  const a = activeStaff();
  if (!a) return;
  const { b } = a;
  const editing = state.mode === 'edit';
  const v = shownValues(b);
  const kind = v.rest ? 'rest' : 'note';

  pal.querySelectorAll('[data-mode]').forEach((x) => {
    x.setAttribute('aria-checked', String(/** @type {HTMLElement} */ (x).dataset.mode === state.mode));
  });
  pal
    .querySelector('[data-act=del]')
    .setAttribute('aria-label', editing ? t('pal.deleteSelected') : t('pal.deleteBefore'));
  pal.querySelectorAll('[data-dur]').forEach((x) => {
    const k = /** @type {HTMLElement} */ (x).dataset.dur;
    x.setAttribute('aria-pressed', String(k === v.d));
    x.textContent = GLYPHS[kind][k];
    x.setAttribute('aria-label', LABELS[kind](k));
    x.classList.toggle('restmode', v.rest);
  });
  const press = (sel, on) => pal.querySelector(sel).setAttribute('aria-pressed', String(on));
  press('[data-act=dot]', v.dot);
  press('[data-act=rest]', v.rest);
  press('[data-act=tup]', v.tup);
  press('[data-act=tie]', v.tie);
  press('[data-act=bar]', !barBar.hidden);
  pal.querySelectorAll('[data-acc]').forEach((x) => {
    /** @type {HTMLElement} */ (x).hidden = b.clef === 'rhythm';
    x.setAttribute('aria-pressed', String(v.acc != null && String(v.acc) === x.dataset.acc));
  });
  syncBarMenu(b, v.sel);
  document.getElementById('palInfo').textContent = helpText(b, v);
  syncPaletteSpace();
}

hooks.refreshPalette = updateStaffPalette;

// ---------- Actions ----------

/**
 * Mode Modifier : change la durée de la note sélectionnée, en gardant la
 * suite à sa place ({@link module:measure-fit.resizeEvent|resizeEvent}).
 * @param {function({d: string, dot: boolean, tup: boolean}): {d: string, dot: boolean, tup: boolean}} change
 * @returns {boolean} `false` hors mode Modifier ou sans sélection.
 */
function resizeSel(change) {
  if (state.mode !== 'edit') return false;
  const a = activeStaff();
  if (!a || state.sel == null || !a.b.items[state.sel]) return false;
  const { n, b } = a;
  const value = change(logicalValue(b, state.sel));
  const res = resizeEvent(b.items, b.time, state.sel, value);
  if (value.tup && res.tupCross.has(res.index)) {
    flash(t('hint.tripletBar'));
    return true;
  }
  pushSnapshot(n);
  b.items = res.items;
  state.sel = res.index;
  touch(n);
  hooks.redraw(b.id);
  audio.previewItem(b, state.sel);
  return true;
}

/**
 * Bascule un réglage de saisie (mode Écrire) puis rafraîchit la palette.
 * @param {function(module:ui/state~InputSettings)} fn
 */
function setInput(fn) {
  fn(state.input);
  updateStaffPalette();
}

/**
 * Liaison : en mode Modifier, sur la note sélectionnée (la note suivante
 * prend sa hauteur et perd son altération) ; en mode Écrire, la prochaine
 * note sera liée à celle qui précède le curseur.
 * @param {module:model~StaffBlock} b
 */
function toggleTie(b) {
  const done = withSel((first, blk) => {
    // La liaison de l'utilisateur part de la fin de la note logique.
    const it = blk.items[chainEnd(blk.items, state.sel)];
    if (it.r || it.auto) return;
    if (it.tie) {
      delete it.tie;
      return;
    }
    it.tie = true;
    const next = blk.items[chainEnd(blk.items, state.sel) + 1];
    if (next && !next.r) {
      next.s = it.s;
      delete next.a;
    }
  });
  if (done) audio.previewItem(b, state.sel);
  else {
    const prev = b.items[insertIndex(b) - 1];
    if (prev && !prev.r) setInput((inp) => (inp.tie = !inp.tie));
  }
}

/**
 * Note ⇄ silence (toute la note logique, tous ses morceaux).
 * @param {module:model~StaffItem} it Premier morceau.
 * @param {module:model~StaffBlock} blk
 */
function toggleRestOf(it, blk) {
  const toNote = !!it.r;
  for (let k = state.sel; k <= chainEnd(blk.items, state.sel); k++) {
    const p = blk.items[k];
    if (toNote) {
      delete p.r;
      if (blk.clef !== 'rhythm') p.s = it.s ?? 4;
      if (p.auto) p.tie = true;
    } else {
      p.r = true;
      delete p.tie;
      delete p.a;
    }
  }
}

/**
 * ◀ ▶ : déplace le curseur (Écrire) ou la sélection (Modifier), d'une note
 * logique à l'autre (jamais au milieu d'une note coupée).
 * @param {module:model~StaffBlock} b
 * @param {boolean} back
 */
function step(b, back) {
  if (!b.items.length) return;
  if (state.mode === 'write') {
    const cur = insertIndex(b);
    const c = back
      ? cur > 0
        ? chainStart(b.items, cur - 1)
        : 0
      : cur < b.items.length
        ? chainEnd(b.items, cur) + 1
        : cur;
    state.cursor = c >= b.items.length ? null : c;
    hooks.redraw(b.id);
    return;
  }
  if (state.sel == null) state.sel = chainStart(b.items, back ? b.items.length - 1 : 0);
  else if (back) state.sel = chainStart(b.items, Math.max(0, state.sel - 1));
  else {
    const nx = chainEnd(b.items, state.sel) + 1;
    if (nx < b.items.length) state.sel = nx;
  }
  hooks.redraw(b.id);
  audio.previewItem(b, state.sel);
}

/**
 * ⌫ : en mode Écrire, efface la note juste avant le curseur ; en mode
 * Modifier, la note sélectionnée (à défaut, la dernière). Une note coupée
 * s'efface en entier.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 */
function erase(n, b) {
  if (!b.items.length) return;
  const write = state.mode === 'write';
  const last = write
    ? insertIndex(b) - 1
    : state.sel != null
      ? chainEnd(b.items, state.sel)
      : b.items.length - 1;
  if (last < 0) return;
  const i = chainStart(b.items, last);
  pushSnapshot(n);
  b.items.splice(i, last - i + 1);
  if (write && state.cursor != null) state.cursor = i;
  // Une liaison qui menait à la note supprimée n'a plus de sens.
  if (b.items[i - 1] && b.items[i - 1].tie && (!b.items[i] || b.items[i].r)) delete b.items[i - 1].tie;
  if (state.sel != null)
    state.sel = b.items.length ? chainStart(b.items, Math.min(i, b.items.length - 1)) : null;
  if (state.cursor != null && state.cursor >= b.items.length) state.cursor = null;
  refit(b);
  touch(n);
  hooks.redraw(b.id);
}

/**
 * Boutons `data-act` de la palette.
 * @type {Object.<string, function(module:model~Note, module:model~StaffBlock)>}
 */
const ACTIONS = {
  bar: () => {
    barBar.hidden = !barBar.hidden;
    if (!barBar.hidden) closeChord();
    updateStaffPalette();
  },
  dot: () => resizeSel((v) => ({ ...v, dot: !v.dot })) || setInput((inp) => (inp.dot = !inp.dot)),
  tup: () => resizeSel((v) => ({ ...v, tup: !v.tup })) || setInput((inp) => (inp.tup = !inp.tup)),
  tie: (n, b) => toggleTie(b),
  rest: () => withSel(toggleRestOf) || setInput((inp) => (inp.rest = !inp.rest)),
  prev: (n, b) => step(b, true),
  next: (n, b) => step(b, false),
  undo: () => undo(),
  del: (n, b) => erase(n, b),
  chord: (n, b) => b.items.length && openChord(b),
};

/**
 * Bouton de valeur (ronde… double croche).
 * @param {string} d
 */
function onDuration(d) {
  if (!resizeSel((v) => ({ ...v, d }))) setInput((inp) => (inp.d = /** @type {any} */ (d)));
}

/**
 * Bouton d'altération (♭ ♮ ♯).
 * @param {module:model~StaffBlock} b
 * @param {number} a
 */
function onAccidental(b, a) {
  const done = withSel((it) => {
    if (it.r) return;
    if (it.a === a) delete it.a;
    else it.a = a;
  });
  if (done) audio.previewItem(b, state.sel);
  else setInput((inp) => (inp.acc = inp.acc === a ? null : a));
}

// Câblage, une seule fois au chargement du module.
pal.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button');
  const a = activeStaff();
  if (!btn || !a) return;
  if (btn.dataset.mode) setMode(/** @type {'write'|'edit'} */ (btn.dataset.mode));
  else if (btn.dataset.bar) applyBar(btn.dataset.bar);
  else if (btn.dataset.dur) onDuration(btn.dataset.dur);
  else if (btn.hasAttribute('data-acc')) onAccidental(a.b, Number(btn.dataset.acc));
  else if (ACTIONS[btn.dataset.act]) ACTIONS[btn.dataset.act](a.n, a.b);
});
document.getElementById('palDone').onclick = () => setActive(null);
