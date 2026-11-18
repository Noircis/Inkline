/**
 * @module ui/random-grid
 * @description
 * **Practice › Random chord charts** (2.18), in two screens, like the random
 * exercises:
 *
 * 1. `rgrid`: the settings (time signature, number of measures, chords per
 *    measure, spelling of the black keys), then "Generate";
 * 2. `rgridPlay`: the chart, its number (↻ for another one), a playback bar
 *    (tempo, swing, loop) and "Add to…": a note and/or a practice program,
 *    where the chart stays as it is.
 *
 * The draw is done by the pure module {@link module:random-grid|random-grid}.
 * Settings are remembered (`meta.rgrid`), with the number of the last chart;
 * tempo, swing and loop are those of the other practice screens.
 */

import { t } from '../i18n.js';
import { app } from './state.js';
import { esc } from '../util.js';
import { getMeta, setMeta } from '../storage.js';
import { gridHtml } from '../grid.js';
import { newSeed } from '../exercise.js';
import {
  RGRID_DEFAULTS,
  RGRID_TIMES,
  RGRID_PER_BAR,
  RGRID_ACCS,
  RGRID_MAX,
  randomGridBlock,
} from '../random-grid.js';
import * as audio from '../audio.js';
import { registerScreen, goChild, backToList } from './nav.js';
import { hideAllPalettes } from './blocks.js';
import { header, settings, toggle, tempoField, bindPlayControls, updatePlay } from './drill-kit.js';
import { openAddTo } from './practice/add-to.js';

/** Playback id of the chart. */
const PLAY_ID = 'rgrid';

/**
 * Current settings.
 * @returns {module:random-grid~RandomGridSettings}
 */
function rgrid() {
  return getMeta().rgrid || { ...RGRID_DEFAULTS };
}

/**
 * Changes and remembers settings.
 * @param {Object} patch
 */
function updateRgrid(patch) {
  setMeta({ rgrid: { ...rgrid(), ...patch } });
}

/**
 * Segmented choice (radio buttons).
 * @param {string} name `data-` attribute and settings key.
 * @param {string} label
 * @param {Array.<*>} values
 * @param {*} current
 * @param {function(*): string} text Label of a value.
 * @returns {string}
 */
function seg(name, label, values, current, text) {
  return `<div class="seg seg-sm" role="radiogroup" aria-label="${esc(label)}">${values
    .map(
      (v) =>
        `<button type="button" role="radio" data-rg="${name}" data-v="${esc(String(v))}" aria-checked="${v === current}">${esc(text(v))}</button>`,
    )
    .join('')}</div>`;
}

/** Labels of the "chords per measure" choices. */
const PER_BAR_LABEL = { 1: '1', 2: '2', 0: '' };

/**
 * Settings screen.
 */
function renderRgrid() {
  audio.stop();
  hideAllPalettes();
  const g = rgrid();
  const perBar = (v) => PER_BAR_LABEL[v] || t('rgrid.oneOrTwo');
  const acc = (v) => (v === 'b' ? '♭' : v === '#' ? '♯' : t('rgrid.both'));
  app.innerHTML = `${header(t('home.training'), t('rgrid.title'))}
  <section class="opt">
    <h2 class="eyebrow">${esc(t('staff.time'))}</h2>
    ${seg('time', t('staff.time'), RGRID_TIMES, g.time, (v) => v)}
    <h2 class="eyebrow">${esc(t('rgrid.measures'))}</h2>
    <div class="rg-count"><span class="stepper" role="group" aria-label="${esc(t('rgrid.measures'))}"><button type="button" class="btn" data-count="-1" aria-label="${esc(t('rgrid.measures') + ' : ' + t('ex.less'))}">&minus;</button><input type="number" inputmode="numeric" id="rgCount" min="1" max="${RGRID_MAX}" value="${g.measures}" aria-label="${esc(t('rgrid.measures'))}"><button type="button" class="btn" data-count="1" aria-label="${esc(t('rgrid.measures') + ' : ' + t('ex.more'))}">+</button></span></div>
    <h2 class="eyebrow">${esc(t('rgrid.perBar'))}</h2>
    ${seg('perBar', t('rgrid.perBar'), RGRID_PER_BAR, g.perBar, perBar)}
    <h2 class="eyebrow">${esc(t('rgrid.accidentals'))}</h2>
    ${seg('acc', t('rgrid.accidentals'), RGRID_ACCS, g.acc, acc)}
    <p class="hint">${esc(t('rgrid.hint'))}</p>
    <button type="button" class="btn primary wide" id="rgGo">${esc(t('rgrid.generate'))}</button>
  </section>`;

  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelectorAll('[data-rg]').forEach((b) =>
    b.addEventListener('click', () => {
      const el = /** @type {HTMLElement} */ (b);
      const raw = el.dataset.v;
      const value = el.dataset.rg === 'perBar' ? Number(raw) : raw;
      updateRgrid({ [el.dataset.rg]: value });
      app
        .querySelectorAll(`[data-rg="${el.dataset.rg}"]`)
        .forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }),
  );
  const count = /** @type {HTMLInputElement} */ (app.querySelector('#rgCount'));
  /** Puts a number of measures in range, shows and remembers it. */
  const setCount = (n) => {
    const v = Math.max(1, Math.min(RGRID_MAX, Number.isFinite(n) ? n : rgrid().measures));
    count.value = String(v);
    updateRgrid({ measures: v });
  };
  count.addEventListener('change', () => setCount(parseInt(count.value, 10)));
  app
    .querySelectorAll('[data-count]')
    .forEach((b) =>
      b.addEventListener('click', () =>
        setCount(rgrid().measures + Number(/** @type {HTMLElement} */ (b).dataset.count)),
      ),
    );
  app.querySelector('#rgGo').addEventListener('click', () => {
    setCount(parseInt(count.value, 10));
    updateRgrid({ seed: newSeed() });
    goChild('rgridPlay');
  });
}

registerScreen('rgrid', renderRgrid);

/** Chart shown. */
let block = null;
/** Measure being played, highlighted. */
let playing = null;

/**
 * Builds the chart from the settings and the playback options.
 * @returns {module:model~GridBlock}
 */
function buildBlock() {
  const s = settings();
  return randomGridBlock(rgrid(), { id: PLAY_ID, tempo: s.tempo, swing: s.swing });
}

/** Draws the chart, the measure being played highlighted. */
function draw() {
  const el = app.querySelector('#rgGrid');
  if (el && block) el.innerHTML = gridHtml(block, null, playing);
}

/**
 * Chart screen.
 */
function renderRgridPlay() {
  audio.stop();
  hideAllPalettes();
  const g = rgrid();
  const s = settings();
  block = buildBlock();
  playing = null;
  const title = `${t('rgrid.number', { n: g.seed })} · ${t('train.bars', { n: g.measures })}`;
  app.innerHTML = `${header(t('ex.settings'), t('rgrid.number', { n: g.seed }), `<button type="button" class="btn icon-btn" id="reroll" aria-label="${esc(t('rgrid.new'))}">&#8635;</button>`)}
  <p class="gen-info">${esc(g.time)} · ${esc(t('train.bars', { n: g.measures }))}</p>
  <div class="rg-grid" id="rgGrid"></div>
  <div class="transport">
    <div class="transport-bar">
      <button type="button" class="btn" data-tempo="-5" aria-label="${esc(t('ex.slower'))}">&minus;</button>${tempoField(s.tempo)}<button type="button" class="btn" data-tempo="5" aria-label="${esc(t('ex.faster'))}">+</button>
      ${toggle('swing', 'Swing', s.swing)}
      ${toggle('loop', t('play.loop'), s.loop)}
    </div>
    <div class="transport-go"><button type="button" class="playbtn big" data-play="${PLAY_ID}">&#9654; ${esc(t('play.listen'))}</button><button type="button" class="btn addto" id="addTo">+ ${esc(t('practice.add'))}</button></div>
  </div>`;

  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#reroll').addEventListener('click', () => {
    updateRgrid({ seed: newSeed() });
    renderRgridPlay();
  });
  // Tempo, swing, loop: the chart is rebuilt (playback was stopped).
  bindPlayControls(app, null, () => {
    block = buildBlock();
    playing = null;
    draw();
    updatePlay(PLAY_ID);
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
  app.querySelector(`[data-play="${PLAY_ID}"]`).addEventListener('click', play);
  app.querySelector('#addTo').addEventListener('click', () => openAddTo({ block, title }));
  draw();
}

registerScreen('rgridPlay', renderRgridPlay);

/** Starts or stops the chart. */
function play() {
  audio.playGrid(
    block,
    {
      onStep: (i) => {
        playing = i;
        draw();
      },
      onEnd: () => {
        playing = null;
        draw();
        updatePlay(PLAY_ID);
      },
    },
    { loop: settings().loop },
  );
  updatePlay(PLAY_ID);
}
