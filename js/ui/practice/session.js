/**
 * @module ui/practice/session
 * @description
 * **Practice session** (`session` screen, 2.16): a program, one item at a
 * time.
 *
 * - The item fills the screen (text, note, block or exercise, read-only).
 * - Without a duration, a quiet stopwatch; with one, a ring that counts down,
 *   a soft chime at zero, then nothing more: the session waits for "Next".
 * - The metronome takes the item's settings (the item's own, else its
 *   note's) and has its controls at the bottom; "Save for this item" in the
 *   metronome sheet stores them in the program.
 * - It starts on the first item, or on the one chosen with ▶ in the program
 *   (2.17.1). ‹ › and the "2 / 5" list go anywhere, in any order. ✕ leaves
 *   at any time.
 *
 * Every visit is recorded when the item is left (time, and the metronome
 * tempo if it played): the session is saved as it goes, so leaving the app
 * loses nothing. A session shorter than
 * {@link module:practice.KEEP_SECONDS|KEEP_SECONDS} is not kept.
 */

import { t } from '../../i18n.js';
import { esc } from '../../util.js';
import { state, app } from '../state.js';
import * as audio from '../../audio.js';
import { registerScreen, backToList } from '../nav.js';
import { hideAllPalettes } from '../blocks.js';
import { metroButton } from '../common.js';
import {
  registerMetroTarget,
  applyMetro,
  metroUsage,
  metroNow,
  toggleMetro,
  nudgeMetro,
  openMetro,
  setMiniAllowed,
  onMetroChange,
} from '../metronome.js';
import { unitGlyph, meterLabel } from '../../metronome.js';
import { newSession, recordVisit, worthKeeping, sessionSeconds, clock } from '../../practice.js';
import {
  programById,
  saveProgram,
  storeSession,
  itemLabel,
  kindLabel,
  noteOf,
  openSheet,
  minutesLabel,
  takeSessionStart,
} from './shared.js';
import { itemHtml, drawItem, playShown } from './item-view.js';

/** A visit shorter than this (seconds) is not recorded: flipping through. */
const FLIP_SECONDS = 3;
/** Longest visit counted (seconds): the app left open on a stand all night counts 2 hours. */
const VISIT_MAX = 7200;
/** Circumference of the countdown ring (r = 52). */
const RING = 2 * Math.PI * 52;

/**
 * The session being played.
 * @typedef {Object} Run
 * @property {module:practice~Program} prog
 * @property {module:practice~Session} session
 * @property {number} index Item shown.
 * @property {number} shownAt When the item was shown (ms): its clock.
 * @property {number} countedTo Time recorded up to here (ms) for this item.
 * @property {Object} visit Identity of this visit (metronome target).
 * @property {boolean} chimed The countdown of this item has rung.
 * @property {boolean} finished The summary is shown.
 */

/** @type {?Run} */
let run = null;
let tick = 0;
/** @type {?WakeLockSentinel} */
let wake = null;
/** @type {?function()} */
let unlisten = null;

/**
 * Item shown.
 * @returns {?module:practice~PracticeItem}
 */
function current() {
  return run && !run.finished ? run.prog.items[run.index] || null : null;
}

// ---------- Visits ----------

/**
 * Shows an item: its metronome settings are loaded, its clock starts.
 * @param {number} i
 */
function enter(i) {
  run.index = Math.max(0, Math.min(run.prog.items.length - 1, i));
  run.shownAt = run.countedTo = Date.now();
  run.visit = {};
  run.chimed = false;
  const it = current();
  const part = it.metro || (noteOf(it) && noteOf(it).metro);
  if (part) applyMetro(part);
}

/**
 * Records the visit of the item shown (time, tempo), then saves the session.
 */
function leaveItem() {
  const it = current();
  if (!it) return;
  const now = Date.now();
  const seconds = Math.min(VISIT_MAX, (now - run.countedTo) / 1000);
  const use = metroUsage(run.countedTo);
  if (seconds < FLIP_SECONDS) return;
  run.countedTo = now;
  run.session = recordVisit(
    run.session,
    { item: it.id, label: itemLabel(it), seconds, tempo: use.played ? use.tempo : undefined },
    now,
  );
  if (worthKeeping(run.session)) storeSession(run.session);
}

/**
 * Goes to another item.
 * @param {number} i
 */
function goTo(i) {
  leaveItem();
  audio.stop();
  enter(i);
  render();
  window.scrollTo(0, 0);
}

/** Last item: shows the summary. */
function finish() {
  leaveItem();
  audio.stop();
  run.finished = true;
  render();
  window.scrollTo(0, 0);
}

// ---------- Screen ----------

/**
 * Session screen: a new session of the program in `state.view.id`, or the
 * one going on (redraw after a rotation).
 * @returns {boolean|void}
 */
function renderSession() {
  const prog = programById(state.view.id);
  if (!prog || !prog.items.length) return false;
  const startId = takeSessionStart();
  if (!run || run.prog !== prog) {
    run = {
      prog,
      session: newSession(prog),
      index: 0,
      shownAt: 0,
      countedTo: 0,
      visit: {},
      chimed: false,
      finished: false,
    };
    enter(
      Math.max(
        0,
        prog.items.findIndex((it) => it.id === startId),
      ),
    );
    setMiniAllowed(false);
    unlisten = onMetroChange(paintMetro);
    clearInterval(tick);
    tick = setInterval(paintClock, 500);
    holdScreen();
  }
  hideAllPalettes();
  render();
}

/** Draws the item or the summary. */
function render() {
  if (run.finished) return renderSummary();
  const it = current();
  const n = run.prog.items.length;
  const last = run.index === n - 1;
  app.innerHTML = `<header class="top session-top"><button type="button" class="btn icon-btn" id="sClose" aria-label="${esc(t('practice.close'))}">&#x2715;</button><div class="grow"><h1 class="top-title">${esc(run.prog.name || t('practice.unnamed'))}</h1></div><button type="button" class="btn ghost s-count" id="sList" aria-label="${esc(t('practice.itemList'))}">${run.index + 1} / ${n}</button>${metroButton()}</header>
  <article class="s-item">
    <p class="s-kind">${esc(kindLabel(it))}</p>
    ${it.kind === 'text' ? '' : `<h2 class="s-label">${esc(itemLabel(it))}</h2>`}
    <div class="s-body" id="sBody">${itemHtml(it)}</div>
  </article>
  <div class="s-dock">
    ${clockHtml(it)}
    <div class="s-metro" id="sMetro"></div>
    <div class="s-nav">
      <button type="button" class="btn" id="sPrev" aria-label="${esc(t('practice.previous'))}"${run.index ? '' : ' disabled'}>&#8249;</button>
      <button type="button" class="btn primary" id="sNext">${esc(last ? t('practice.finish') : t('practice.next'))} &#8250;</button>
    </div>
  </div>`;
  app.querySelector('#sClose').addEventListener('click', backToList);
  app.querySelector('#sList').addEventListener('click', openList);
  app.querySelector('#sPrev').addEventListener('click', () => goTo(run.index - 1));
  app.querySelector('#sNext').addEventListener('click', () => (last ? finish() : goTo(run.index + 1)));
  const body = /** @type {HTMLElement} */ (app.querySelector('#sBody'));
  body.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-pvplay]'));
    if (b) playShown(body, Number(b.dataset.pvplay));
  });
  app.querySelector('#sMetro').addEventListener('click', onMetroClick);
  requestAnimationFrame(() => drawItem(body));
  paintMetro();
  paintClock();
}

/**
 * Clock of the item: a ring with a duration, a stopwatch without.
 * @param {module:practice~PracticeItem} it
 * @returns {string}
 */
function clockHtml(it) {
  if (!it.minutes) return `<div class="s-clock watch"><span id="sTime">0:00</span></div>`;
  return `<div class="s-clock timer"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="52"/><circle class="ring" id="sRing" cx="60" cy="60" r="52" stroke-dasharray="${RING.toFixed(1)}" stroke-dashoffset="0"/></svg><span id="sTime" role="timer"></span><small id="sTimeNote">${esc(t('practice.minutes', { n: it.minutes }))}</small></div>`;
}

/** Updates the clock (twice a second). */
function paintClock() {
  const it = current();
  const time = app.querySelector('#sTime');
  if (!it || !time) return;
  const elapsed = (Date.now() - run.shownAt) / 1000;
  if (!it.minutes) {
    time.textContent = clock(elapsed);
    return;
  }
  const total = it.minutes * 60;
  const left = Math.max(0, total - elapsed);
  time.textContent = clock(Math.ceil(left));
  const ring = app.querySelector('#sRing');
  if (ring) ring.setAttribute('stroke-dashoffset', ((RING * (total - left)) / total).toFixed(1));
  if (!left) {
    app.querySelector('.s-clock').classList.add('done');
    app.querySelector('#sTimeNote').textContent = t('practice.timeUp');
    if (!run.chimed) {
      run.chimed = true;
      chime();
    }
  }
}

/** Metronome controls of the dock. */
function paintMetro() {
  const box = app.querySelector('#sMetro');
  if (!box || !run || run.finished) return;
  const { settings: m, running } = metroNow();
  box.innerHTML = `<button type="button" class="btn s-mopen" data-s="open" aria-label="${esc(t('metro.title'))}"><span><span class="mus">${esc(unitGlyph(m))}</span>${m.tempo}</span><small>${esc(meterLabel(m))}</small></button><button type="button" class="btn" data-s="minus" aria-label="${esc(t('metro.stepN', { n: '-1' }))}">&minus;</button><button type="button" class="btn" data-s="plus" aria-label="${esc(t('metro.stepN', { n: '+1' }))}">+</button><button type="button" class="playbtn round${running ? ' on' : ''}" data-s="toggle" aria-label="${esc(running ? t('metro.stop') : t('metro.start'))}">${running ? '&#9632;' : '&#9654;'}</button>`;
}

/**
 * Clicks on the metronome controls.
 * @param {MouseEvent} e
 */
function onMetroClick(e) {
  const b = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.target).closest('[data-s]'));
  if (!b) return;
  if (b.dataset.s === 'open') openMetro();
  if (b.dataset.s === 'toggle') toggleMetro();
  if (b.dataset.s === 'minus') nudgeMetro(-1);
  if (b.dataset.s === 'plus') nudgeMetro(1);
}

/** The "2 / 5" sheet: every item, to go to any of them. */
function openList() {
  const rows = run.prog.items
    .map((it, i) => {
      const done = run.session.items.find((e) => e.item === it.id);
      const mark = done
        ? `<span class="s-done" aria-label="${esc(t('practice.visited'))}">&#10003;</span>`
        : '';
      return `<button type="button" class="opt-row${i === run.index ? ' current' : ''}" data-a="go" data-i="${i}"><span>${esc(itemLabel(it))}<small>${esc(kindLabel(it))}</small></span>${mark}</button>`;
    })
    .join('');
  const sheet = openSheet(
    run.prog.name || t('practice.unnamed'),
    `<div class="opt-group">${rows}</div>`,
    (el, d) => {
      if (d.a !== 'go') return;
      sheet.close();
      goTo(Number(d.i));
    },
  );
}

/** End of the session: what was played, for how long, at which tempo. */
function renderSummary() {
  const s = run.session;
  const rows = s.items
    .map(
      (e) =>
        `<li><span class="sum-name">${esc(e.label)}</span><span class="sum-time">${esc(clock(e.seconds))}</span><span class="sum-tempo">${e.tempo ? '♩ ' + e.tempo : ''}</span></li>`,
    )
    .join('');
  app.innerHTML = `<header class="top session-top"><div class="grow"><h1 class="top-title">${esc(run.prog.name || t('practice.unnamed'))}</h1></div></header>
  <section class="s-summary">
    <h2>${esc(t('practice.sessionDone'))}</h2>
    <p class="sum-total">${esc(sessionSeconds(s) < 60 ? clock(sessionSeconds(s)) : minutesLabel(sessionSeconds(s)))}</p>
    ${rows ? `<ul class="sum-list">${rows}</ul>` : ''}
    <button type="button" class="btn primary wide" id="sDone">${esc(t('common.done'))}</button>
  </section>`;
  app.querySelector('#sDone').addEventListener('click', backToList);
}

// ---------- Leaving, screen, chime ----------

/** The screen is left (✕, Android back, another screen): the visit is recorded. */
function leaveSession() {
  if (!run) return;
  leaveItem();
  audio.stop();
  run = null;
  clearInterval(tick);
  if (unlisten) unlisten();
  unlisten = null;
  setMiniAllowed(true);
  releaseScreen();
}

/** Keeps the screen on during the session (music on a stand). */
async function holdScreen() {
  if (wake || !navigator.wakeLock || document.hidden) return;
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => (wake = null));
  } catch (e) {
    wake = null;
  }
}

/** Lets the screen sleep again. */
function releaseScreen() {
  if (wake) wake.release().catch(() => {});
  wake = null;
}

/** A soft two-note chime, when a countdown reaches zero. */
function chime() {
  const c = audio.getAudioContext();
  if (!c) return;
  [
    [880, 0],
    [1320, 0.18],
  ].forEach(([f, d]) => {
    const o = c.createOscillator();
    const g = c.createGain();
    const at = c.currentTime + d;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.18, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + 1.2);
    o.connect(g).connect(c.destination);
    o.start(at);
    o.stop(at + 1.3);
  });
}

document.addEventListener('visibilitychange', () => {
  if (!run || run.finished) return;
  // The app may be killed in the background: what was played is saved now.
  if (document.hidden) leaveItem();
  else holdScreen();
});

// "Save for this item" in the metronome sheet.
registerMetroTarget('session', () => {
  const it = current();
  if (!it) return null;
  return {
    stored: it.metro || null,
    visit: run.visit,
    autoload: false,
    labels: {
      save: 'practice.metroSave',
      update: 'practice.metroUpdate',
      saved: 'practice.metroSaved',
      forget: 'practice.metroForget',
      loaded: 'practice.metroLoaded',
    },
    save: (part) => {
      it.metro = part;
      saveProgram(run.prog);
    },
    forget: () => {
      delete it.metro;
      saveProgram(run.prog);
    },
  };
});

registerScreen('session', renderSession, leaveSession);
