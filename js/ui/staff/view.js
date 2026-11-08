/**
 * @module ui/staff/view
 * @description
 * **En-tête et dessin** d'un bloc portée (ou ligne rythmique) : clé, armure,
 * mesure, tempo, swing, lecture, puis la portée elle-même en SVG.
 */

import { esc } from '../../util.js';
import { state, app, blockById, touch } from '../state.js';
import { TIME_SIGNATURES } from '../../model.js';
import { chainEnd } from '../../measure-fit.js';
import { staffSvg } from '../../render-staff.js';
import { layout } from '../../layout.js';
import { pushSnapshot } from '../../history.js';
import * as audio from '../../audio.js';
import { toolsHtml, updatePlayBtn, playCallbacks } from '../common.js';
import { setActive } from '../blocks.js';
import { isFolded, applyFold, guardFoldedTaps, FOLD_PREVIEW_LINES } from '../fold.js';
import { hooks, staffUi, clampCursor, refit } from './shared.js';
import { staffTap } from './input.js';

/**
 * Armures proposées : nombre de dièses (> 0) ou de bémols (< 0), avec les
 * tonalités majeure et mineure correspondantes.
 * @type {Array.<{v: number, label: string}>}
 */
const KEY_SIGS = [
  { v: 0, label: 'Sans armure' },
  ...['Sol / Mi m', 'Ré / Si m', 'La / Fa♯ m', 'Mi / Do♯ m', 'Si / Sol♯ m', 'Fa♯ / Ré♯ m', 'Do♯ / La♯ m'].map(
    (t, i) => ({ v: i + 1, label: `${i + 1}♯ · ${t}` }),
  ),
  ...[
    'Fa / Ré m',
    'Si♭ / Sol m',
    'Mi♭ / Do m',
    'La♭ / Fa m',
    'Ré♭ / Si♭ m',
    'Sol♭ / Mi♭ m',
    'Do♭ / La♭ m',
  ].map((t, i) => ({ v: -(i + 1), label: `${i + 1}♭ · ${t}` })),
];

/**
 * HTML de l'en-tête du bloc.
 * @param {module:model~StaffBlock} b
 * @returns {string}
 */
function headerHtml(b) {
  const rh = b.clef === 'rhythm';
  const id = esc(b.id);
  return `<div class="shead"><span class="kind">${rh ? 'Rythme' : 'Portée'}</span>
    ${rh ? '' : `<select data-f="clef" id="c_${id}" aria-label="Clé"><option value="treble">Sol</option><option value="bass">Fa</option></select>`}
    ${rh ? '' : `<select data-f="ks" id="k_${id}" aria-label="Armure">${KEY_SIGS.map((k) => `<option value="${k.v}">${k.label}</option>`).join('')}</select>`}
    <select data-f="time" id="m_${id}" aria-label="Mesure">${TIME_SIGNATURES.map((t) => `<option>${t}</option>`).join('')}</select>
    <label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" data-f="tempo" id="tp_${id}"></label>
    <button type="button" class="chip" data-f="swing" aria-pressed="${!!b.swing}">Swing</button>
    <button type="button" class="playbtn" data-play="${id}">&#9654; Écouter</button></div>`;
}

/**
 * Branche un `<select>` de l'en-tête : `apply` reçoit la valeur choisie,
 * avec annulation, sauvegarde et redessin.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {?HTMLSelectElement} sel
 * @param {string} value Valeur initiale.
 * @param {function(string)} apply
 */
function bindSelect(n, b, sel, value, apply) {
  if (!sel) return;
  sel.value = value;
  sel.onchange = () => {
    pushSnapshot(n);
    apply(sel.value);
    touch(n);
    redrawStaff(b.id);
  };
}

/**
 * Remplit l'élément d'un bloc portée : en-tête, zone SVG, outils.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {HTMLElement} el
 */
export function staffBlockEl(n, b, el) {
  el.innerHTML = headerHtml(b) + `<div class="staff-wrap" data-staff="${esc(b.id)}"></div>` + toolsHtml();
  const q = (s) => /** @type {HTMLSelectElement} */ (el.querySelector(s));

  bindSelect(n, b, q('[data-f=clef]'), b.clef, (v) => {
    b.clef = /** @type {any} */ (v);
  });
  bindSelect(n, b, q('[data-f=ks]'), String(b.ks || 0), (v) => {
    if (Number(v)) b.ks = Number(v);
    else delete b.ks;
  });
  bindSelect(n, b, q('[data-f=time]'), b.time, (v) => {
    b.time = v;
    refit(b); // tout est recoupé selon la nouvelle mesure
  });

  const tp = /** @type {HTMLInputElement} */ (el.querySelector('[data-f=tempo]'));
  tp.value = String(b.tempo);
  tp.onchange = () => {
    const v = Math.max(30, Math.min(300, parseInt(tp.value, 10) || 100));
    tp.value = String(v);
    b.tempo = v;
    touch(n);
  };
  const swb = el.querySelector('[data-f=swing]');
  swb.onclick = () => {
    b.swing = !b.swing;
    swb.setAttribute('aria-pressed', String(b.swing));
    touch(n);
  };
  el.querySelector('[data-play]').onclick = () => {
    // Un bloc réduit s'écoute sans se déplier : on ne l'active pas.
    if (!el.classList.contains('folded')) setActive(b.id);
    audio.playStaff(b, playCallbacks(b.id, redrawStaff));
    updatePlayBtn(b.id);
  };
  const wrap = /** @type {HTMLElement} */ (el.querySelector('.staff-wrap'));
  guardFoldedTaps(wrap, b);
  wrap.addEventListener('click', (e) => staffTap(n, b, /** @type {MouseEvent} */ (e)));
}

/**
 * Redessine le SVG d'un bloc portée (sans effet si `id` n'est pas une portée affichée).
 * La largeur utilisée est mémorisée sur l'élément (`_W`) pour que le
 * hit-testing refasse exactement la même mise en page.
 * @param {string} id
 */
export function redrawStaff(id) {
  const b = blockById(id);
  if (!b || b.type !== 'staff') return;
  const wrap = /** @type {HTMLElement} */ (app.querySelector(`[data-staff="${CSS.escape(id)}"]`));
  if (!wrap) return;
  const W = Math.max(220, wrap.clientWidth || 300);
  const isAct = state.activeId === id;
  const write = isAct && state.mode === 'write';
  if (isAct) clampCursor(b);
  // Nombre de lignes à cette largeur, pour décider de l'affichage réduit.
  const lines = layout(b, W, isAct).systems.length;
  const folded = isFolded(b, lines);
  const chord = staffUi.chordTarget;
  wrap.innerHTML = staffSvg(b, W, {
    // En mode Écrire, rien n'est sélectionné ; on surligne seulement la note
    // dont on saisit l'accord chiffré.
    sel: isAct ? (write ? (chord ? chord.i : null) : state.sel) : null,
    selEnd: isAct && !write && state.sel != null && b.items[state.sel] ? chainEnd(b.items, state.sel) : null,
    play: audio.isPlaying(id) ? state.playIdx : null,
    cursor: write,
    insertAt: write ? state.cursor : null,
    maxSystems: folded ? FOLD_PREVIEW_LINES : undefined,
  }).svg;
  applyFold(wrap, b, lines, folded);
  wrap._W = W;
  if (isAct) hooks.refreshPalette();
}

hooks.redraw = redrawStaff;
