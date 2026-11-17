/**
 * @module ui/staff/view
 * @description
 * **Header and drawing** of a staff block (or rhythm line): clef, key
 * signature, time signature, tempo, swing, playback, then the staff itself
 * as SVG.
 *
 * With several staves (2.17), the clef, key signature and instrument menus
 * show and change the staff being edited; time signature, tempo and swing
 * are the block's.
 */

import { noteName } from '../../pitch.js';
import { t } from '../../i18n.js';
import { esc } from '../../util.js';
import { state, app, blockById, touch } from '../state.js';
import { TIME_SIGNATURES, INSTRUMENTS, instrumentOf } from '../../model.js';
import { changeInstrument } from '../../transpose.js';
import { partsOf, partView, setKey, setPartClef, PARTS_MAX } from '../../parts.js';
import { chainEnd } from '../../measure-fit.js';
import { staffSvg } from '../../render-staff.js';
import { layout } from '../../layout.js';
import { pushSnapshot } from '../../history.js';
import * as audio from '../../audio.js';
import { toolsHtml, updatePlayBtn, playCallbacks, metroBlockButton } from '../common.js';
import { setActive } from '../blocks.js';
import { isFolded, applyFold, guardFoldedTaps, FOLD_PREVIEW_LINES } from '../fold.js';
import { hooks, staffUi, clampCursor, flash, activePart, refitAll } from './shared.js';
import { bindStaffInput, dragZonesHtml } from './input.js';
import { addStaffTo, openPartMenu } from './part-menu.js';
import { bindMeasureSelect, staffTarget, refreshMeasureSelect } from '../measure-select.js';

/**
 * Key signatures offered: number of sharps (> 0) or flats (< 0), with the
 * matching major and minor keys.
 * @type {Array.<{v: number, label: string}>}
 */
const KEY_SIGS = (() => {
  // Keys: [degree, accidental] of the major, then of the relative minor.
  const SHARPS = [
    [4, '', 2, ''],
    [1, '', 6, ''],
    [5, '', 3, '♯'],
    [2, '', 0, '♯'],
    [6, '', 4, '♯'],
    [3, '♯', 1, '♯'],
    [0, '♯', 5, '♯'],
  ];
  const FLATS = [
    [3, '', 1, ''],
    [6, '♭', 4, ''],
    [2, '♭', 0, ''],
    [5, '♭', 3, ''],
    [1, '♭', 6, '♭'],
    [4, '♭', 2, '♭'],
    [0, '♭', 5, '♭'],
  ];
  const label = (n, acc, [M, ma, m, mia]) =>
    t('ks.label', { n, acc, maj: noteName(M) + ma, min: noteName(m) + mia });
  return [
    { v: 0, label: t('ks.none') },
    ...SHARPS.map((k, i) => ({ v: i + 1, label: label(i + 1, '♯', k) })),
    ...FLATS.map((k, i) => ({ v: -(i + 1), label: label(i + 1, '♭', k) })),
  ];
})();

/**
 * Time signatures of the menu: the usual ones, plus the block's own when it
 * comes from a practice screen (7/8, 9/8…).
 * @param {string} time
 * @returns {Array.<string>}
 */
function timeChoices(time) {
  return TIME_SIGNATURES.includes(time) ? TIME_SIGNATURES : [...TIME_SIGNATURES, time];
}

/**
 * The staff of a block the header shows: the one being edited.
 * @param {module:model~StaffBlock} b
 * @returns {module:model~StaffBlock}
 */
const shownPart = (b) => partView(b, activePart(b));

/**
 * Label of the block kind: rhythm line, staff, or "Staff 2/3" with several.
 * @param {module:model~StaffBlock} b
 * @returns {string}
 */
function kindLabel(b) {
  const count = partsOf(b).length;
  if (count > 1) return t('parts.staffN', { n: activePart(b) + 1, count });
  return b.clef === 'rhythm' ? t('staff.rhythm') : t('staff.staff');
}

/**
 * HTML of the block header. The clef, key signature and instrument menus
 * are hidden on a rhythm line ({@link syncHeader}).
 * @param {module:model~StaffBlock} b
 * @returns {string}
 */
function headerHtml(b) {
  const id = esc(b.id);
  return `<div class="shead"><span class="kind">${esc(kindLabel(b))}</span>
    <select data-f="clef" id="c_${id}" aria-label="${esc(t('staff.clef'))}"><option value="treble">${esc(t('staff.treble'))}</option><option value="bass">${esc(t('staff.bass'))}</option></select>
    <select data-f="ks" id="k_${id}" aria-label="${esc(t('staff.keySig'))}">${KEY_SIGS.map((k) => `<option value="${k.v}">${esc(k.label)}</option>`).join('')}</select>
    <select data-f="tr" id="i_${id}" aria-label="${esc(t('staff.instrument'))}">${INSTRUMENTS.map((x) => `<option value="${x.key}">${esc(t('instr.' + x.key))}</option>`).join('')}</select>
    <select data-f="time" id="m_${id}" aria-label="${esc(t('staff.time'))}">${timeChoices(b.time)
      .map((ts) => `<option>${ts}</option>`)
      .join('')}</select>
    <label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" data-f="tempo" id="tp_${id}"></label>
    <button type="button" class="chip" data-f="swing" aria-pressed="${!!b.swing}">Swing</button>
    ${metroBlockButton(b.id)}<button type="button" class="playbtn" data-play="${id}">&#9654; ${esc(t('play.listen'))}</button></div>`;
}

/**
 * Brings the header in line with the staff being edited: kind label, clef,
 * key signature and instrument (hidden on a rhythm line).
 * @param {module:model~StaffBlock} b
 * @param {HTMLElement} el Block element.
 */
function syncHeader(b, el) {
  const head = el.querySelector('.shead');
  if (!head) return;
  const p = shownPart(b);
  const rh = p.clef === 'rhythm';
  head.querySelector('.kind').textContent = kindLabel(b);
  const sel = (f) => /** @type {HTMLSelectElement} */ (head.querySelector(`[data-f=${f}]`));
  ['clef', 'ks', 'tr'].forEach((f) => (sel(f).hidden = rh));
  sel('clef').value = rh ? 'treble' : p.clef;
  sel('ks').value = String(p.ks || 0);
  sel('tr').value = instrumentOf(p.tr).key;
  const add = /** @type {HTMLButtonElement} */ (el.querySelector('[data-staff-tool=add]'));
  if (add) add.disabled = partsOf(b).length >= PARTS_MAX;
}

/**
 * Wires a header `<select>`: `apply` receives the chosen value, with undo,
 * save and redraw.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {?HTMLSelectElement} sel
 * @param {function(string)} apply
 */
function bindSelect(n, b, sel, apply) {
  if (!sel) return;
  sel.onchange = () => {
    pushSnapshot(n);
    apply(sel.value);
    touch(n);
    redrawStaff(b.id);
  };
}

/**
 * Instrument menu (2.8.3). On an empty staff, the instrument simply changes
 * (the key signature stays as chosen). If there are notes already, the user
 * is asked what to do with them (see {@link module:transpose|transpose}):
 * transpose (same sound, the writing changes) or keep the writing (the sound
 * changes).
 * With several staves, it is the instrument of the staff being edited.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} block
 * @param {HTMLElement} el
 */
function bindInstrument(n, block, el) {
  const sel = /** @type {?HTMLSelectElement} */ (el.querySelector('[data-f=tr]'));
  if (!sel) return;
  const apply = (keep) => {
    pushSnapshot(n);
    const { octaves } = changeInstrument(shownPart(block), sel.value, { keep });
    touch(n);
    redrawStaff(block.id);
    if (octaves) flash(octaves > 1 ? t('tr.octaves', { n: octaves }) : t('tr.octave'));
  };
  const closeAsk = () => el.querySelector('.tr-ask')?.remove();
  sel.onchange = () => {
    closeAsk();
    const b = shownPart(block);
    if (!b.items.some((it) => !it.r)) return apply(true);
    const from = instrumentOf(b.tr);
    const to = instrumentOf(sel.value);
    const ask = document.createElement('div');
    ask.className = 'tr-ask';
    ask.setAttribute('role', 'group');
    ask.setAttribute('aria-label', t('tr.askLabel'));
    ask.innerHTML = `<p>${esc(t('tr.ask', { from: t('instr.' + from.key), to: t('instr.' + to.key) }))}</p>
      <div class="tr-ask-btns"><button type="button" class="btn primary" data-tr="move">${esc(t('tr.move'))}<small>${esc(t('tr.moveSub'))}</small></button><button type="button" class="btn" data-tr="keep">${esc(t('tr.keep'))}<small>${esc(t('tr.keepSub'))}</small></button><button type="button" class="btn ghost" data-tr="cancel">${esc(t('common.cancel'))}</button></div>`;
    el.querySelector('.shead').after(ask);
    ask.querySelector('[data-tr=move]').addEventListener('click', () => {
      closeAsk();
      apply(false);
    });
    ask.querySelector('[data-tr=keep]').addEventListener('click', () => {
      closeAsk();
      apply(true);
    });
    ask.querySelector('[data-tr=cancel]').addEventListener('click', () => {
      closeAsk();
      sel.value = instrumentOf(shownPart(block).tr).key;
    });
  };
}

/**
 * Fills a staff block's element: header, SVG area, tools.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {HTMLElement} el
 */
export function staffBlockEl(n, b, el) {
  const addStaff = `<button type="button" data-staff-tool="add">+ ${esc(t('parts.add'))}</button>`;
  el.innerHTML =
    headerHtml(b) + `<div class="staff-wrap" data-staff="${esc(b.id)}"></div>` + toolsHtml(addStaff);
  const q = (s) => /** @type {HTMLSelectElement} */ (el.querySelector(s));

  bindSelect(n, b, q('[data-f=clef]'), (v) => setPartClef(shownPart(b), /** @type {any} */ (v)));
  bindSelect(n, b, q('[data-f=ks]'), (v) => setKey(b, activePart(b), Number(v)));
  q('[data-f=time]').value = b.time;
  bindSelect(n, b, q('[data-f=time]'), (v) => {
    b.time = v;
    delete b.groups; // the grouping of the old time signature
    refitAll(b); // everything is re-split for the new time signature
  });
  syncHeader(b, el);
  /** @type {HTMLButtonElement} */ (el.querySelector('[data-staff-tool=add]')).onclick = () => {
    if (!addStaffTo(b)) return;
    redrawStaff(b.id);
    openPartMenu(b);
  };

  bindInstrument(n, b, el);

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
    // A collapsed block can be played without expanding it: it is not activated.
    if (!el.classList.contains('folded')) setActive(b.id);
    audio.playStaff(b, playCallbacks(b.id, redrawStaff));
    updatePlayBtn(b.id);
  };
  const wrap = /** @type {HTMLElement} */ (el.querySelector('.staff-wrap'));
  guardFoldedTaps(wrap, b);
  bindStaffInput(n, b, wrap);
  // Long press: measure selection, "Play from here" or loop (2.8.4).
  bindMeasureSelect(
    wrap,
    staffTarget(wrap, () => renderedLayout(b, wrap), {
      playId: () => b.id,
      skip: (e) => !!(/** @type {Element} */ (e.target).closest('.drag-zone')),
      play: (a, to, loop, done) => {
        const cb = playCallbacks(b.id, redrawStaff);
        audio.playStaff(
          b,
          {
            onStep: cb.onStep,
            onEnd: () => {
              cb.onEnd();
              done();
            },
          },
          { from: a, to, loop, countIn: true },
        );
        updatePlayBtn(b.id);
      },
    }),
  );
}

/**
 * Redraws the SVG of a staff block (no effect if `id` is not a staff on screen).
 * The width used is stored on the element (`_W`) so that hit testing redoes
 * exactly the same layout.
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
  const part = activePart(b);
  const view = partView(b, part);
  if (isAct) clampCursor(view);
  // Number of lines at this width, to decide on the collapsed display.
  const lines = layout(b, W, isAct, null, part).systems.length;
  const folded = isFolded(b, lines);
  const chord = staffUi.chordTarget;
  wrap.innerHTML =
    staffSvg(b, W, {
      part,
      // In Write mode, nothing is selected; only the note whose chord symbol
      // is being typed is highlighted.
      sel: isAct ? (write ? (chord ? chord.i : null) : state.sel) : null,
      selEnd:
        isAct && !write && state.sel != null && view.items[state.sel]
          ? chainEnd(view.items, state.sel)
          : null,
      play: audio.isPlaying(id) ? state.playAt : null,
      cursor: write,
      insertAt: write ? state.cursor : null,
      maxSystems: folded ? FOLD_PREVIEW_LINES : undefined,
    }).svg + (folded ? '' : dragZonesHtml(b, W));
  applyFold(wrap, b, lines, folded);
  wrap._W = W;
  const el = wrap.closest('.block');
  if (el) syncHeader(b, /** @type {HTMLElement} */ (el));
  refreshMeasureSelect(wrap);
  if (isAct) hooks.refreshPalette();
}

hooks.redraw = redrawStaff;

/**
 * Layout as drawn by {@link redrawStaff} (same width, same cursor), to find
 * the measures under the finger.
 * @param {module:model~StaffBlock} b
 * @param {HTMLElement} wrap
 * @returns {?module:layout~Layout}
 */
function renderedLayout(b, wrap) {
  if (!wrap._W) return null;
  const write = state.activeId === b.id && state.mode === 'write';
  return layout(b, wrap._W, write, write ? state.cursor : null, activePart(b));
}
