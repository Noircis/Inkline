/**
 * @module ui/measure-select
 * @description
 * **Measure selection by long press** (2.8.4), shared by staves, rhythm
 * lines, charts and practice screens.
 *
 * 1. **Long press** (450 ms without moving more than 10 px) on a measure: a
 *    frame appears around it, the phone vibrates briefly.
 * 2. Without lifting the finger, **dragging** extends the selection to the
 *    measure under the finger (both ways, across several lines). The page
 *    does not scroll during this drag.
 * 3. When the finger lifts, a **context bar** appears above the selection:
 *    "Play from here" for a single measure (to the end), "Loop" for several
 *    (the passage, looped). Both start with a count-in measure.
 *
 * A tap elsewhere clears the selection (and stops the playback it started),
 * as does ✕. There is only one selection at a time in the app.
 *
 * Each area (staff, chart…) plugs in with {@link bindMeasureSelect}, giving a
 * small {@link SelectTarget} object: how to find the measure under the
 * finger, where to draw the frame, how to play. After each redraw of the
 * area, it calls {@link refreshMeasureSelect} (the frame lives in the area;
 * a redraw erases it).
 *
 * ## Why so much care with the gesture
 *
 * - The browser sends a `click` when the finger lifts, even after a long
 *   press: it is swallowed, otherwise a chart would open the keyboard.
 * - Android opens a menu (or selects text) on a long press: this is
 *   prevented (`contextmenu`, CSS `-webkit-touch-callout`).
 * - To drag without scrolling the page, `touchmove` events are cancelled
 *   once the selection is armed (only then: before that, the finger may
 *   still be scrolling).
 */

import { t } from '../i18n.js';
import * as audio from '../audio.js';
import { geom } from '../layout.js';

/** Long press duration (ms). */
export const LONG_PRESS_MS = 450;
/** Movement tolerated during the long press (px). */
const SLOP = 10;

/**
 * What an area provides to be selectable.
 * @typedef {Object} SelectTarget
 * @property {function(number, number): ?number} measureAt Measure (written
 *   index) under a window point, `null` if none.
 * @property {function(number, number): Array.<{x: number, y: number, w: number, h: number}>} boxes
 *   Rectangles (in the area) covering measures `a` to `b`, one per line.
 * @property {function(number, number, boolean, function()): void} play
 *   Starts playback from `a` to `b` (looped or not), with a count-in; the
 *   last argument must be called when playback ends.
 * @property {function(): string} playId Playback id (to know whether it is running).
 * @property {function(PointerEvent): boolean} [skip] True if the gesture must
 *   not be used for selection (a note drag zone, for example).
 */

/**
 * Current selection.
 * @type {?{wrap: HTMLElement, t: SelectTarget, a: number, b: number, anchor: number, mine: boolean}}
 */
let cur = null;
/** Swallow the next `click` (the one following the long press). */
let swallowClick = false;
/** Context bar (created on first use). */
let bar = null;

/**
 * Clears the selection (frame and bar); stops playback if the selection
 * started it.
 */
export function clearMeasureSelect() {
  if (!cur) return;
  const { wrap, t: tg, mine } = cur;
  cur = null;
  wrap.querySelectorAll('.msel-box').forEach((x) => x.remove());
  if (bar) bar.hidden = true;
  if (mine && audio.isPlaying(tg.playId())) audio.stop();
}

/**
 * Current selection (for tests and screens).
 * @returns {?{a: number, b: number}}
 */
export function measureSelection() {
  return cur && { a: cur.a, b: cur.b };
}

/**
 * Redraws the frame and repositions the bar, after a redraw of the area.
 * @param {HTMLElement} wrap
 */
export function refreshMeasureSelect(wrap) {
  if (!cur || cur.wrap !== wrap) return;
  drawBoxes();
  placeBar();
}

/** Draws the frame around the selected measures. */
function drawBoxes() {
  const { wrap, t: tg, a, b } = cur;
  wrap.querySelectorAll('.msel-box').forEach((x) => x.remove());
  const boxes = tg.boxes(a, b);
  if (!boxes.length) {
    clearMeasureSelect(); // the measure no longer exists (block changed)
    return;
  }
  boxes.forEach(({ x, y, w, h }) => {
    const d = document.createElement('div');
    d.className = 'msel-box';
    d.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    wrap.appendChild(d);
  });
}

/** Creates the context bar. */
function makeBar() {
  bar = document.createElement('div');
  bar.className = 'msel-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('sel.label'));
  bar.innerHTML = `<button type="button" class="btn primary" data-msel="go"></button><button type="button" class="btn ghost" data-msel="close" aria-label="${t('sel.close')}">&#10005;</button>`;
  bar.hidden = true;
  document.body.appendChild(bar);
  bar.querySelector('[data-msel=close]').addEventListener('click', clearMeasureSelect);
  bar.querySelector('[data-msel=go]').addEventListener('click', () => {
    if (!cur) return;
    const { t: tg, a, b } = cur;
    if (cur.mine && audio.isPlaying(tg.playId())) {
      audio.stop();
      return;
    }
    audio.stop();
    cur.mine = true;
    // One measure: to the end; several: the passage, looped.
    tg.play(a, a === b ? Infinity : b, a !== b, updateBar);
    updateBar();
  });
}

/** Label of the bar's button. */
function updateBar() {
  if (!bar || !cur) return;
  const go = bar.querySelector('[data-msel=go]');
  const on = cur.mine && audio.isPlaying(cur.t.playId());
  go.classList.toggle('on', on);
  go.textContent = on
    ? '■ ' + t('play.stop')
    : cur.a === cur.b
      ? '▶ ' + t('sel.playFrom')
      : '🔁 ' + t('play.loop');
}

/** Places the bar above the selection (below if there is no room). */
function placeBar() {
  if (!bar) makeBar();
  if (!cur) return;
  updateBar();
  bar.hidden = false;
  const boxes = [...cur.wrap.querySelectorAll('.msel-box')].map((x) => x.getBoundingClientRect());
  if (!boxes.length) return;
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  const bw = bar.offsetWidth || 200;
  const bh = bar.offsetHeight || 44;
  let top = first.top - bh - 8;
  if (top < 64) top = last.bottom + 8; // under the header: go below
  const left = Math.max(8, Math.min(window.innerWidth - bw - 8, first.left + first.width / 2 - bw / 2));
  bar.style.left = `${left + window.scrollX}px`;
  bar.style.top = `${top + window.scrollY}px`;
}

/**
 * Makes an area selectable by long press.
 * @param {HTMLElement} wrap Element of the area (must be `position: relative`).
 * @param {SelectTarget} tg
 */
export function bindMeasureSelect(wrap, tg) {
  wrap.classList.add('msel-zone');
  /** Pending press: start position and timer. */
  let press = null;
  /** Selection drag in progress. */
  let armed = false;

  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  wrap.addEventListener('pointerdown', (e) => {
    cancel();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (tg.skip && tg.skip(e)) return;
    const m = tg.measureAt(e.clientX, e.clientY);
    if (m == null) return;
    const id = e.pointerId;
    press = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press = null;
        if (!wrap.isConnected) return;
        // Armed: new selection, current playback stops.
        clearMeasureSelect();
        audio.stop();
        cur = { wrap, t: tg, a: m, b: m, anchor: m, mine: false };
        armed = true;
        swallowClick = true;
        try {
          navigator.vibrate?.(15);
        } catch {
          /* no vibrator */
        }
        try {
          wrap.setPointerCapture(id);
        } catch {
          /* finger already lifted */
        }
        drawBoxes();
        if (bar) bar.hidden = true;
      }, LONG_PRESS_MS),
    };
  });

  wrap.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancel();
    if (!armed || !cur) return;
    const m = tg.measureAt(e.clientX, e.clientY);
    if (m == null) return;
    const a = Math.min(cur.anchor, m);
    const b = Math.max(cur.anchor, m);
    if (a !== cur.a || b !== cur.b) {
      cur.a = a;
      cur.b = b;
      drawBoxes();
    }
  });

  const end = () => {
    cancel();
    if (!armed) return;
    armed = false;
    if (cur && cur.wrap === wrap) placeBar();
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  // Selection drag: the finger selects, the page does not scroll.
  wrap.addEventListener(
    'touchmove',
    (e) => {
      if (armed) e.preventDefault();
    },
    { passive: false },
  );
  // No browser menu on a long press.
  wrap.addEventListener('contextmenu', (e) => {
    if (press || armed || (cur && cur.wrap === wrap)) e.preventDefault();
  });
}

// The `click` following the long press is swallowed; a tap outside the
// bar clears the selection. (Capture-phase listener, before the areas.)
document.addEventListener(
  'pointerdown',
  () => {
    // New tap: the `click` of an old long press (which is not always sent,
    // for example after a drag) must no longer be swallowed.
    swallowClick = false;
  },
  true,
);
document.addEventListener(
  'click',
  (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (cur && !(bar && bar.contains(/** @type {Node} */ (e.target)))) clearMeasureSelect();
  },
  true,
);
// The area is gone (another screen, note closed…): clear the selection.
new MutationObserver(() => {
  if (cur && !cur.wrap.isConnected) clearMeasureSelect();
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', () => cur && refreshMeasureSelect(cur.wrap));

/**
 * {@link SelectTarget} for a staff drawn by
 * {@link module:render-staff.staffSvg|staffSvg}: measures are found in the
 * layout ({@link module:layout~Layout|Layout}, `mrects`).
 *
 * @param {HTMLElement} wrap SVG container.
 * @param {function(): ?module:layout~Layout} getLayout Layout as drawn.
 * @param {Omit<SelectTarget, 'measureAt'|'boxes'>} rest `play`, `playId`, `skip`.
 * @returns {SelectTarget}
 */
export function staffTarget(wrap, getLayout, rest) {
  /**
   * Position of the SVG on screen: it may be offset in the area (margins) and
   * enlarged by CSS (random exercises).
   */
  const frame = () => {
    const svg = wrap.querySelector('svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const w = Number(svg.getAttribute('width')) || r.width;
    return { r, k: r.width / w };
  };
  return {
    ...rest,
    measureAt(cx, cy) {
      const L = getLayout();
      const f = frame();
      if (!L || !f || !L.mrects.length) return null;
      const x = (cx - f.r.left) / f.k;
      const y = (cy - f.r.top) / f.k;
      const si = Math.max(0, Math.min(L.systems.length - 1, Math.floor(y / L.SH)));
      const on = L.mrects.map((m, k) => ({ ...m, k })).filter((m) => m.sys === si);
      if (!on.length) return null; // empty line (add zone)
      const hit = on.find((m) => x >= m.x0 && x < m.x1);
      if (hit) return hit.k;
      return x < on[0].x0 ? on[0].k : on[on.length - 1].k;
    },
    boxes(a, b) {
      const L = getLayout();
      const f = frame();
      if (!L || !f || b >= L.mrects.length) return [];
      const w = wrap.getBoundingClientRect();
      const ox = f.r.left - w.left;
      const oy = f.r.top - w.top;
      const out = [];
      for (let k = a; k <= b; k++) {
        const m = L.mrects[k];
        const last = out[out.length - 1];
        if (last && last.sys === m.sys) last.x1 = m.x1;
        else out.push({ sys: m.sys, x0: m.x0, x1: m.x1 });
      }
      return out.map(({ sys, x0, x1 }) => {
        const g = geom(L, sys);
        const top = g.staffTop - 12;
        const h = Math.max(32, g.staffBottom - g.staffTop + 24);
        const y0 = g.staffTop === g.staffBottom ? g.staffTop - h / 2 : top;
        return { x: ox + (x0 - 2) * f.k, y: oy + y0 * f.k, w: (x1 - x0 + 4) * f.k, h: h * f.k };
      });
    },
  };
}
