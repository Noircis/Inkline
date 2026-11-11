/**
 * @module ui/training
 * @description
 * **Practice** (since 2.3): a home screen listing the exercises
 * (`training`), then one screen per exercise.
 *
 * - **Rhythm › Placements** (`rhythm`): every way to place n eighth notes in
 *   a measure (every time signature since 2.8), in collapsible sections by
 *   position of the first note, cleanly written and played with an
 *   adjustable metronome.
 * - **Rhythm › Random exercises** (2.8): see {@link module:ui/exercises|ui/exercises}.
 *
 * The logic (generation, writing rules) is in the pure module
 * {@link module:placements|placements}; this module only does the interface.
 * Measures are real "rhythm line" blocks: they are drawn by
 * {@link module:render-staff.staffSvg|staffSvg} and played by
 * {@link module:audio.playStaff|playStaff}, as in a note.
 */

import { t } from '../i18n.js';
import { app } from './state.js';
import { esc } from '../util.js';
import { staffSvg } from '../render-staff.js';
import { placementSeries, seriesBlock, meterOf, slotsOf, startGlyphs, startLabel } from '../placements.js';
import * as audio from '../audio.js';
import { registerScreen, goChild, backToList } from './nav.js';
import { hideAllPalettes } from './blocks.js';
import { layout } from '../layout.js';
import {
  bindMeasureSelect,
  staffTarget,
  refreshMeasureSelect,
  clearMeasureSelect,
} from './measure-select.js';
import {
  header,
  settings,
  updateSettings,
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

/**
 * Practice home screen: the list of exercises.
 */
function renderTraining() {
  audio.stop();
  hideAllPalettes();
  app.innerHTML = `${header(t('note.back'), t('home.training'))}
  <section class="opt">
    <h2 class="eyebrow">${esc(t('staff.rhythm'))}</h2>
    <div class="opt-group">
      <button class="opt-row" type="button" id="goPlacements"><span>${esc(t('train.placements'))}<small>${esc(t('train.placementsHint'))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
      <button class="opt-row" type="button" id="goExercises"><span>${esc(t('train.exercises'))}<small>${esc(t('train.exercisesHint'))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    </div>
  </section>`;
  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#goPlacements').addEventListener('click', () => goChild('rhythm'));
  app.querySelector('#goExercises').addEventListener('click', () => goChild('gen'));
}

registerScreen('training', renderTraining);

/**
 * Sections shown: id → rhythm line block, and expanded state. Recreated on
 * each generation.
 * @type {Map<string, {block: module:model~StaffBlock, open: boolean, drawn: boolean}>}
 */
let sections = new Map();

/**
 * Rhythm › Placements screen.
 */
function renderPlacements() {
  audio.stop();
  hideAllPalettes();
  const s = settings();
  const m = meterOf(s.meter);
  const slots = slotsOf(m);
  app.innerHTML = `${header(t('home.training'), t('train.placements'))}
  <section class="opt">
    <h2 class="eyebrow">${esc(t('staff.time'))}</h2>
    ${meterChips(m.key)}
    <h2 class="eyebrow">${esc(t('train.notesPerBar'))}</h2>
    <div class="nsel" role="radiogroup" aria-label="${esc(t('train.notesPerBar'))}">${Array.from(
      { length: slots },
      (_, i) =>
        `<button type="button" role="radio" data-n="${i + 1}" aria-checked="${i + 1 === s.notes}">${i + 1}</button>`,
    ).join('')}</div>
    <h2 class="eyebrow">${esc(t('train.subdivision'))}</h2>
    ${subdivisionSeg()}
    <h2 class="eyebrow">${esc(t('train.playback'))}</h2>
    <div class="drill-row">${tempoField(s.tempo)}${toggle('swing', 'Swing', s.swing, m.kind !== 'simple')}</div>
    <h2 class="eyebrow">${esc(t('train.metronome'))}</h2>
    ${metronomeControls(m)}
    <div class="drill-bar"><span class="listbar-lbl" id="drillCount"></span><button type="button" class="btn ghost small" id="foldAll"></button></div>
  </section>
  <div class="drills" id="drills"></div>`;

  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelectorAll('[data-meter]').forEach((b) =>
    b.addEventListener('click', () => {
      const nm = meterOf(/** @type {HTMLElement} */ (b).dataset.meter);
      updateSettings({ meter: nm.key, notes: Math.min(settings().notes, slotsOf(nm)) });
      renderPlacements();
    }),
  );
  app.querySelectorAll('[data-n]').forEach((b) =>
    b.addEventListener('click', () => {
      updateSettings({ notes: Number(/** @type {HTMLElement} */ (b).dataset.n) });
      app.querySelectorAll('[data-n]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      renderSections();
    }),
  );
  bindPlayControls(app, m, applyPlaySettings);
  app.querySelector('#foldAll').addEventListener('click', () => {
    const open = [...sections.values()].some((x) => !x.open);
    sections.forEach((_, id) => setOpen(id, open));
    updateFoldAll();
  });
  // SVGs need the real width: they are drawn after layout.
  requestAnimationFrame(renderSections);
}

registerScreen('rhythm', renderPlacements);

/**
 * Carries tempo and swing over to the series shown.
 */
function applyPlaySettings() {
  const { tempo, swing } = settings();
  sections.forEach(({ block }) => {
    block.tempo = tempo;
    block.swing = swing && meterOf(settings().meter).kind === 'simple';
  });
}

/**
 * Generates the sections for the chosen number of notes and time signature.
 * Only the first is expanded; staves are drawn only when opened (in 12/8,
 * six notes give 924 measures).
 */
function renderSections() {
  audio.stop();
  const s = settings();
  const m = meterOf(s.meter);
  const series = placementSeries(s.notes, m);
  const measures = series.reduce((sum, x) => sum + x.length, 0);
  app.querySelector('#drillCount').textContent =
    series.length > 1
      ? `${t('train.bars', { n: measures })} · ${t('train.starts', { n: series.length })}`
      : t('train.bars', { n: measures });
  sections = new Map();
  const single = s.notes === 1;
  const list = app.querySelector('#drills');
  list.innerHTML = series
    .map((sr, i) => {
      const id = 'drill' + i;
      sections.set(id, { block: seriesBlock(sr, s, id, m), open: i === 0, drawn: false });
      const p = sr[0][0];
      const title = single
        ? `<span class="drill-all">${esc(t('train.allPositions'))}</span>`
        : `<span class="drill-start mus" aria-hidden="true">${startGlyphs(p, m)}</span><span class="sr">${esc(t('train.startOn', { pos: startLabel(p, m) }))}</span>`;
      return `<div class="drill" data-sec="${id}"><div class="drill-head"><button type="button" class="drill-tog" data-tog="${id}" aria-expanded="false" aria-controls="ds_${id}"><span class="drill-chev" aria-hidden="true"></span>${title}<span class="drill-sub">${esc(t('train.bars', { n: sr.length }))}</span></button><button type="button" class="playbtn round" data-play="${id}" aria-label="${esc(t('play.listen'))}">&#9654;</button></div><div class="drill-staff" id="ds_${id}" data-drill="${id}" hidden></div></div>`;
    })
    .join('');
  sections.forEach((sec, id) => {
    list.querySelector(`[data-tog="${id}"]`).addEventListener('click', () => {
      setOpen(id, !sections.get(id).open);
      updateFoldAll();
    });
    list.querySelector(`[data-play="${id}"]`).addEventListener('click', () => play(id));
    // Long press: "Play from here" or loop over measures of the series (2.8.4).
    const el = /** @type {HTMLElement} */ (list.querySelector(`[data-drill="${id}"]`));
    bindMeasureSelect(
      el,
      staffTarget(el, () => (el._W ? layout(sec.block, el._W, false, null) : null), {
        playId: () => id,
        play: (a, to, loop, done) => play(id, { from: a, to, loop }, done),
      }),
    );
    setOpen(id, sec.open);
  });
  updateFoldAll();
}

/**
 * Expands or collapses a section (and draws its staff the first time).
 * @param {string} id
 * @param {boolean} open
 */
function setOpen(id, open) {
  const sec = sections.get(id);
  const el = /** @type {HTMLElement} */ (app.querySelector(`[data-drill="${id}"]`));
  if (!sec || !el) return;
  sec.open = open;
  el.hidden = !open;
  app.querySelector(`[data-tog="${id}"]`).setAttribute('aria-expanded', String(open));
  if (open && !sec.drawn) {
    sec.drawn = true;
    draw(id);
  }
  if (!open) {
    if (audio.isPlaying(id)) audio.stop();
    clearMeasureSelect();
  }
}

/** Label of the "Expand all / Collapse all" button. */
function updateFoldAll() {
  const btn = app.querySelector('#foldAll');
  if (!btn) return;
  btn.hidden = sections.size < 2;
  btn.textContent = [...sections.values()].some((x) => !x.open)
    ? t('train.expandAll')
    : t('train.collapseAll');
}

/**
 * Plays a section (and expands it if it was collapsed).
 * @param {string} id
 * @param {module:audio~PlayOptions} [extra] Part to play (measure selection, 2.8.4).
 * @param {function()} [done] At the end of playback.
 */
function play(id, extra = {}, done = () => {}) {
  const sec = sections.get(id);
  if (!sec) return;
  if (!sec.open) {
    setOpen(id, true);
    updateFoldAll();
  }
  const el = app.querySelector(`[data-drill="${id}"]`);
  audio.playStaff(
    sec.block,
    {
      onStep: (i) => highlight(el, i),
      onEnd: () => {
        highlight(el, null);
        updatePlay(id, false);
        done();
      },
    },
    { ...playOptions(meterOf(settings().meter)), ...extra },
  );
  updatePlay(id, false);
}

/**
 * Draws a section's staff.
 * @param {string} id
 */
function draw(id) {
  const sec = sections.get(id);
  const el = /** @type {HTMLElement} */ (app.querySelector(`[data-drill="${id}"]`));
  if (!sec || !el) return;
  const W = Math.max(220, el.clientWidth || 300);
  el.innerHTML = staffSvg(sec.block, W).svg;
  el._W = W;
  refreshMeasureSelect(el);
}
