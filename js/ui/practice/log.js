/**
 * @module ui/practice/log
 * @description
 * **History** of the practice sessions (`history` screen, 2.16) and the
 * **tempo curve** of an item (`curve` screen).
 *
 * - History: the sessions, newest first, grouped by day; for each, what was
 *   played, for how long, at which tempo. A tempo can be corrected (or added)
 *   by tapping it; a session can be removed.
 * - Curve: the tempo of one item, session after session, and the values.
 */

import { t } from '../../i18n.js';
import { esc } from '../../util.js';
import { state, app } from '../state.js';
import * as audio from '../../audio.js';
import { registerScreen, goChild, backToList } from '../nav.js';
import { confirmTap } from '../common.js';
import { header } from '../drill-kit.js';
import { TEMPO_MIN, TEMPO_MAX } from '../../metronome.js';
import {
  sortedSessions,
  sessionSeconds,
  tempoHistory,
  setEntryTempo,
  curvePoints,
  clock,
} from '../../practice.js';
import { storeSession, removeSession, longDay, minutesLabel } from './shared.js';

/** Sessions shown at first (more on demand). */
const PAGE = 30;
/** Sessions shown now. */
let shownCount = PAGE;

/**
 * One session of the history.
 * @param {module:practice~Session} s
 * @returns {string}
 */
function sessionHtml(s) {
  const rows = s.items
    .map(
      (e) =>
        `<li><button type="button" class="h-name" data-curve="${esc(e.item)}">${esc(e.label)}</button><span class="h-time">${esc(clock(e.seconds))}</span><button type="button" class="h-tempo${e.tempo ? '' : ' none'}" data-tempo="${esc(s.id)}" data-item="${esc(e.item)}" aria-label="${esc(t('practice.editTempo'))}">♩ ${e.tempo || '–'}</button></li>`,
    )
    .join('');
  return `<article class="hcard"><div class="h-head"><span class="h-prog">${esc(s.name || t('practice.unnamed'))}</span><span class="h-total">${esc(minutesLabel(sessionSeconds(s)))}</span><button type="button" class="btn icon-btn h-del" data-del="${esc(s.id)}" aria-label="${esc(t('practice.deleteSession'))}">&#x2715;</button></div><ul class="h-items">${rows}</ul></article>`;
}

/**
 * History screen.
 */
function renderHistory() {
  audio.stop();
  const all = sortedSessions(state.sessions);
  let html = '';
  let day = '';
  all.slice(0, shownCount).forEach((s) => {
    const d = longDay(s.start);
    if (d !== day) {
      day = d;
      html += `<h2 class="eyebrow h-day">${esc(d)}</h2>`;
    }
    html += sessionHtml(s);
  });
  const more =
    all.length > shownCount
      ? `<button type="button" class="btn wide" id="hMore">${esc(t('practice.showMore'))}</button>`
      : '';
  app.innerHTML = `${header(t('home.training'), t('practice.history'))}
  <section class="h-list">${html || `<p class="h-empty">${esc(t('practice.historyEmpty'))}</p>`}${more}</section>`;
  app.querySelector('#back').addEventListener('click', backToList);
  const moreBtn = app.querySelector('#hMore');
  if (moreBtn)
    moreBtn.addEventListener('click', () => {
      shownCount += PAGE;
      renderHistory();
    });
  app.querySelector('.h-list').addEventListener('click', onHistoryClick);
}

/**
 * Clicks in the history: curve, tempo, delete.
 * @param {MouseEvent} e
 */
function onHistoryClick(e) {
  const el = /** @type {HTMLElement} */ (
    /** @type {HTMLElement} */ (e.target).closest('[data-curve], [data-tempo], [data-del]')
  );
  if (!el) return;
  const d = el.dataset;
  if (d.curve) return goChild('curve', d.curve);
  if (d.del)
    return confirmTap(/** @type {HTMLButtonElement} */ (el), t('practice.deleteConfirm'), () => {
      removeSession(d.del);
      const y = window.scrollY;
      renderHistory();
      window.scrollTo(0, y);
    });
  if (d.tempo) editTempo(el, d.tempo, d.item);
}

/**
 * Replaces a tempo by a number field; the new value is saved on change
 * (empty: no tempo).
 * @param {HTMLElement} btn
 * @param {string} sid Session id.
 * @param {string} item Item id.
 */
function editTempo(btn, sid, item) {
  const s = state.sessions[sid];
  const e = s && s.items.find((x) => x.item === item);
  if (!e) return;
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = String(TEMPO_MIN);
  input.max = String(TEMPO_MAX);
  input.className = 'h-tempo-in';
  input.value = e.tempo ? String(e.tempo) : '';
  input.setAttribute('aria-label', t('practice.editTempo'));
  btn.replaceWith(input);
  input.focus();
  let saved = false;
  const done = () => {
    if (saved) return;
    saved = true;
    const v = parseInt(input.value, 10);
    const next = setEntryTempo(s, item, Number.isFinite(v) ? v : null);
    storeSession(next);
    const y = window.scrollY;
    renderHistory();
    window.scrollTo(0, y);
  };
  input.addEventListener('change', done);
  input.addEventListener('blur', done, { once: true });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') input.blur();
  });
}

// ---------- Tempo curve ----------

/** Size of the curve drawing (viewBox units). */
const CW = 340;
const CH = 180;
const CPAD = 24;

/**
 * SVG of a tempo curve.
 * @param {Array.<{t: number, tempo: number}>} data
 * @returns {string}
 */
function curveSvg(data) {
  const { points, lo, hi } = curvePoints(data, CW, CH, CPAD);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const dots = points
    .map((p) => `<circle class="c-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4"/>`)
    .join('');
  return `<svg class="c-svg" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${esc(t('practice.curveLabel', { lo, hi }))}">
    <line class="c-axis" x1="${CPAD}" y1="${CPAD}" x2="${CW - CPAD}" y2="${CPAD}"/>
    <line class="c-axis" x1="${CPAD}" y1="${CH - CPAD}" x2="${CW - CPAD}" y2="${CH - CPAD}"/>
    <text class="c-lbl" x="2" y="${CPAD + 4}">${hi}</text><text class="c-lbl" x="2" y="${CH - CPAD + 4}">${lo}</text>
    <path class="c-line" d="${path}"/>${dots}</svg>`;
}

/**
 * Curve screen of an item (`state.view.id`).
 * @returns {boolean|void}
 */
function renderCurve() {
  const item = state.view.id;
  const data = tempoHistory(state.sessions, item);
  const last = sortedSessions(state.sessions)
    .map((s) => s.items.find((e) => e.item === item))
    .find(Boolean);
  if (!last) return false;
  const rows = data
    .slice()
    .reverse()
    .map((d) => `<li><span>${esc(longDay(d.t))}</span><b>♩ ${d.tempo}</b></li>`)
    .join('');
  const body = data.length
    ? `${data.length > 1 ? curveSvg(data) : `<p class="c-one">♩ ${data[0].tempo}</p>`}
      ${data.length > 1 ? '' : `<p class="h-empty">${esc(t('practice.curveSoon'))}</p>`}
      <ul class="c-list">${rows}</ul>`
    : `<p class="h-empty">${esc(t('practice.noTempo'))}</p>`;
  app.innerHTML = `${header(t('practice.history'), '')}
  <h1 class="c-title">${esc(last.label)}</h1>
  <section class="c-box">${body}</section>`;
  app.querySelector('#back').addEventListener('click', backToList);
}

registerScreen('history', renderHistory);
registerScreen('curve', renderCurve);
