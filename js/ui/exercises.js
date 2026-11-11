/**
 * @module ui/exercises
 * @description
 * **Practice › Random exercises** (2.8), in two screens:
 *
 * 1. `gen`: the settings (time signature, length, notes per measure, allowed
 *    positions for the first note, subdivision), then "Generate";
 * 2. `genPlay`: the exercise in large print, its number (↻ for another one),
 *    and a playback bar at the bottom (tempo, swing, loop, metronome).
 *
 * The draw is done by the pure module {@link module:exercise|exercise}; the
 * writing of the measures by {@link module:placements|placements}. Settings
 * are remembered (`meta.gen`), with the number of the last exercise: coming
 * back to the screen gives the same one.
 */

import { t } from '../i18n.js';
import { app } from './state.js';
import { esc } from '../util.js';
import { getMeta, setMeta, GEN_DEFAULTS } from '../storage.js';
import { staffSvg } from '../render-staff.js';
import { seriesBlock, meterOf, slotsOf, startGlyphs, startLabel } from '../placements.js';
import { generateExercise, candidates, newSeed } from '../exercise.js';
import * as audio from '../audio.js';
import { registerScreen, goChild, backToList } from './nav.js';
import { hideAllPalettes } from './blocks.js';
import { layout } from '../layout.js';
import { bindMeasureSelect, staffTarget, refreshMeasureSelect } from './measure-select.js';
import {
  header,
  settings,
  playOptions,
  meterChips,
  subdivisionSeg,
  toggle,
  tempoField,
  metronomeControls,
  bindPlayControls,
  updatePlay,
  highlight,
} from './drill-kit.js';

/** Playback id of the exercise. */
const PLAY_ID = 'gen';

/**
 * Current exercise settings.
 * @returns {module:storage~GenSettings}
 */
function gen() {
  return getMeta().gen || { ...GEN_DEFAULTS, starts: {} };
}

/**
 * Changes and remembers settings.
 * @param {Object} patch
 */
function updateGen(patch) {
  setMeta({ gen: { ...gen(), ...patch } });
}

/**
 * Allowed positions for the first note (all by default).
 * @param {module:placements~Meter} m
 * @returns {Array.<number>}
 */
function startsFor(m) {
  return gen().starts[m.key] || Array.from({ length: slotsOf(m) }, (_, i) => i);
}

/**
 * "− value +" button.
 * @param {string} key
 * @param {string} label
 * @param {number} value
 * @returns {string}
 */
const stepper = (key, label, value) =>
  `<span class="stepper" role="group" aria-label="${esc(label)}"><button type="button" class="btn" data-step="${key}" data-d="-1" aria-label="${esc(label + ' : ' + t('ex.less'))}">&minus;</button><output id="v_${key}">${value}</output><button type="button" class="btn" data-step="${key}" data-d="1" aria-label="${esc(label + ' : ' + t('ex.more'))}">+</button></span>`;

/**
 * Settings screen.
 */
function renderGen() {
  audio.stop();
  hideAllPalettes();
  const g = gen();
  const m = meterOf(g.meter);
  const starts = new Set(startsFor(m));
  app.innerHTML = `${header(t('home.training'), t('ex.title'))}
  <section class="opt">
    <h2 class="eyebrow">${esc(t('staff.time'))}</h2>
    ${meterChips(m.key)}
    <h2 class="eyebrow">${esc(t('ex.length'))}</h2>
    <div class="seg seg-sm" role="radiogroup" aria-label="${esc(t('ex.length'))}">${[1, 2, 4]
      .map(
        (n) =>
          `<button type="button" role="radio" data-len="${n}" aria-checked="${n === g.measures}">${esc(t('train.bars', { n }))}</button>`,
      )
      .join('')}</div>
    <h2 class="eyebrow">${esc(t('train.notesPerBar'))}</h2>
    <div class="drill-row gen-range"><span class="drill-lbl">${esc(t('ex.from'))}</span>${stepper('min', t('ex.atLeast'), g.min)}<span class="drill-lbl">${esc(t('ex.to'))}</span>${stepper('max', t('ex.atMost'), g.max)}</div>
    <h2 class="eyebrow">${esc(t('ex.firstNote'))}</h2>
    <div class="starts" role="group" aria-label="${esc(t('ex.firstNoteLabel'))}">${Array.from(
      { length: slotsOf(m) },
      (_, p) =>
        `<button type="button" data-start="${p}" aria-pressed="${starts.has(p)}" aria-label="Sur ${esc(startLabel(p, m))}"><span class="mus" aria-hidden="true">${startGlyphs(p, m)}</span></button>`,
    ).join('')}</div>
    <p class="hint" id="startsHint" hidden>${esc(t('ex.keepOne'))}</p>
    <p class="hint" id="fewHint" hidden></p>
    <h2 class="eyebrow">${esc(t('train.subdivision'))}</h2>
    ${subdivisionSeg()}
    <button type="button" class="btn primary wide" id="genGo">${esc(t('ex.generate'))}</button>
  </section>`;

  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelectorAll('[data-meter]').forEach((b) =>
    b.addEventListener('click', () => {
      const nm = meterOf(/** @type {HTMLElement} */ (b).dataset.meter);
      const n = slotsOf(nm);
      const min = Math.min(gen().min, n);
      updateGen({ meter: nm.key, min, max: Math.max(min, Math.min(gen().max, n)) });
      renderGen();
    }),
  );
  app.querySelectorAll('[data-len]').forEach((b) =>
    b.addEventListener('click', () => {
      updateGen({ measures: Number(/** @type {HTMLElement} */ (b).dataset.len) });
      updateFewHint();
      app.querySelectorAll('[data-len]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }),
  );
  app.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const el = /** @type {HTMLElement} */ (b);
      const n = slotsOf(m);
      let { min, max } = gen();
      const d = Number(el.dataset.d);
      if (el.dataset.step === 'min') {
        min = Math.max(1, Math.min(n, min + d));
        max = Math.max(max, min); // "from" never goes beyond "to"
      } else {
        max = Math.max(1, Math.min(n, max + d));
        min = Math.min(min, max);
      }
      updateGen({ min, max });
      updateFewHint();
      app.querySelector('#v_min').textContent = String(min);
      app.querySelector('#v_max').textContent = String(max);
    }),
  );
  app.querySelectorAll('[data-start]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = Number(/** @type {HTMLElement} */ (b).dataset.start);
      const set = new Set(startsFor(m));
      if (set.has(p)) set.delete(p);
      else set.add(p);
      const hint = /** @type {HTMLElement} */ (app.querySelector('#startsHint'));
      hint.hidden = set.size > 0;
      if (!set.size) return;
      updateGen({ starts: { ...gen().starts, [m.key]: [...set].sort((a, b2) => a - b2) } });
      updateFewHint();
      b.setAttribute('aria-pressed', String(set.has(p)));
    }),
  );
  updateFewHint();
  app.querySelector('#genGo').addEventListener('click', () => {
    updateGen({ seed: newSeed() });
    goChild('genPlay');
  });
}

registerScreen('gen', renderGen);

/**
 * Full settings of an exercise, from the remembered settings.
 * @returns {module:exercise~ExerciseSettings}
 */
function exerciseSettings() {
  const g = gen();
  const m = meterOf(g.meter);
  return { meter: m, measures: g.measures, min: g.min, max: g.max, starts: startsFor(m), seed: g.seed };
}

/**
 * Warns when the settings do not allow enough distinct measures (a measure
 * will necessarily come back).
 */
function updateFewHint() {
  const el = /** @type {HTMLElement} */ (app.querySelector('#fewHint'));
  if (!el) return;
  const s = exerciseSettings();
  const n = candidates(s).length;
  el.hidden = n >= s.measures;
  el.textContent = n === 1 ? t('ex.onlyOne') : t('ex.onlyN', { n });
}

/** Block of the exercise shown. */
let block = null;

/**
 * Builds the block of the current exercise (settings + number).
 * @returns {module:model~StaffBlock}
 */
function buildBlock() {
  const s = exerciseSettings();
  return seriesBlock(generateExercise(s), settings(), PLAY_ID, s.meter);
}

/**
 * Exercise screen.
 */
function renderGenPlay() {
  audio.stop();
  hideAllPalettes();
  const g = gen();
  const s = settings();
  const m = meterOf(g.meter);
  block = buildBlock();
  const range = g.min === g.max ? `${g.min}` : t('ex.range', { a: g.min, b: g.max });
  app.innerHTML = `${header(t('ex.settings'), t('ex.number', { n: g.seed }), `<button type="button" class="btn icon-btn" id="reroll" aria-label="${esc(t('ex.new'))}">&#8635;</button>`)}
  <p class="gen-info">${esc(m.label)} · ${esc(t('train.bars', { n: g.measures }))} · ${esc(t('ex.notesPerBar', { r: range, n: g.max }))}</p>
  <div class="gen-staff" id="genStaff"></div>
  <div class="transport">
    <div class="metro-panel" id="metroPanel" hidden>${metronomeControls(m)}</div>
    <div class="transport-bar">
      <button type="button" class="btn" data-tempo="-5" aria-label="${esc(t('ex.slower'))}">&minus;</button>${tempoField(s.tempo)}<button type="button" class="btn" data-tempo="5" aria-label="${esc(t('ex.faster'))}">+</button>
      ${toggle('swing', 'Swing', s.swing, m.kind !== 'simple')}
      ${toggle('loop', t('play.loop'), s.loop)}
      <button type="button" class="btn icon-btn" id="metroBtn" aria-expanded="false" aria-controls="metroPanel" aria-label="${esc(t('train.metronome'))}">&#9881;</button>
    </div>
    <button type="button" class="playbtn big" data-play="${PLAY_ID}">&#9654; ${esc(t('play.listen'))}</button>
  </div>`;

  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#reroll').addEventListener('click', () => {
    updateGen({ seed: newSeed() });
    renderGenPlay();
  });
  bindPlayControls(app, m, () => {
    block.tempo = settings().tempo;
    block.swing = settings().swing && m.kind === 'simple';
  });
  app.querySelectorAll('[data-tempo]').forEach((b) =>
    b.addEventListener('click', () => {
      const tp = /** @type {HTMLInputElement} */ (app.querySelector('#drillTempo'));
      tp.value = String(
        (parseInt(tp.value, 10) || 80) + Number(/** @type {HTMLElement} */ (b).dataset.tempo),
      );
      tp.dispatchEvent(new Event('change'));
    }),
  );
  const metroBtn = app.querySelector('#metroBtn');
  metroBtn.addEventListener('click', () => {
    const panel = /** @type {HTMLElement} */ (app.querySelector('#metroPanel'));
    panel.hidden = !panel.hidden;
    metroBtn.setAttribute('aria-expanded', String(!panel.hidden));
  });
  app.querySelector(`[data-play="${PLAY_ID}"]`).addEventListener('click', () => play());
  // Long press: "Play from here" or loop over measures of the exercise (2.8.4).
  const st = /** @type {HTMLElement} */ (app.querySelector('#genStaff'));
  bindMeasureSelect(
    st,
    staffTarget(st, () => (st._W && block ? layout(block, st._W, false, null) : null), {
      playId: () => PLAY_ID,
      // One measure: to the end, looping if "Loop" is on.
      play: (a, to, loop, done) => play({ from: a, to, loop: loop || settings().loop }, done),
    }),
  );
  requestAnimationFrame(draw);
}

registerScreen('genPlay', renderGenPlay);

/**
 * Starts or stops the exercise.
 * @param {module:audio~PlayOptions} [extra] Part to play (measure selection, 2.8.4).
 * @param {function()} [done] At the end of playback.
 */
function play(extra = {}, done = () => {}) {
  const el = app.querySelector('#genStaff');
  audio.playStaff(
    block,
    {
      onStep: (i) => highlight(el, i),
      onEnd: () => {
        highlight(el, null);
        updatePlay(PLAY_ID);
        done();
      },
    },
    { ...playOptions(meterOf(gen().meter), settings().loop), ...extra },
  );
  updatePlay(PLAY_ID);
}

/**
 * Draws the exercise. The staff is drawn narrower than the screen, then
 * enlarged by CSS (×1.15) (`width: 100%`): the notes are bigger, readable
 * from a distance with the phone on a music stand.
 */
function draw() {
  const el = /** @type {HTMLElement} */ (app.querySelector('#genStaff'));
  if (!el || !block) return;
  const W = Math.max(220, Math.round((el.clientWidth || 300) / 1.15));
  el.innerHTML = staffSvg(block, W).svg;
  el._W = W;
  refreshMeasureSelect(el);
}
