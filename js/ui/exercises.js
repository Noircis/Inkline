/**
 * @module ui/exercises
 * @description
 * **Entraînement › Exercices aléatoires** (2.8), en deux écrans :
 *
 * 1. `gen` : les réglages (mesure, longueur, notes par mesure, positions
 *    permises pour la première note, subdivision), puis « Générer » ;
 * 2. `genPlay` : l'exercice en grand, son numéro (↻ pour un autre), et une
 *    barre de lecture en bas (tempo, swing, boucle, métronome).
 *
 * Le tirage est fait par le module pur {@link module:exercise|exercise} ;
 * l'écriture des mesures, par {@link module:placements|placements}. Les
 * réglages sont mémorisés (`meta.gen`), avec le numéro du dernier exercice :
 * revenir sur l'écran redonne le même.
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

/** Identifiant de lecture de l'exercice. */
const PLAY_ID = 'gen';

/**
 * Réglages courants des exercices.
 * @returns {module:storage~GenSettings}
 */
function gen() {
  return getMeta().gen || { ...GEN_DEFAULTS, starts: {} };
}

/**
 * Modifie et mémorise des réglages.
 * @param {Object} patch
 */
function updateGen(patch) {
  setMeta({ gen: { ...gen(), ...patch } });
}

/**
 * Positions permises pour la première note (toutes par défaut).
 * @param {module:placements~Meter} m
 * @returns {Array.<number>}
 */
function startsFor(m) {
  return gen().starts[m.key] || Array.from({ length: slotsOf(m) }, (_, i) => i);
}

/**
 * Bouton « − valeur + ».
 * @param {string} key
 * @param {string} label
 * @param {number} value
 * @returns {string}
 */
const stepper = (key, label, value) =>
  `<span class="stepper" role="group" aria-label="${esc(label)}"><button type="button" class="btn" data-step="${key}" data-d="-1" aria-label="${esc(label + ' : ' + t('ex.less'))}">&minus;</button><output id="v_${key}">${value}</output><button type="button" class="btn" data-step="${key}" data-d="1" aria-label="${esc(label + ' : ' + t('ex.more'))}">+</button></span>`;

/**
 * Écran des réglages.
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
        max = Math.max(max, min); // « de » ne dépasse jamais « à »
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
 * Réglages complets d'un exercice, d'après les réglages mémorisés.
 * @returns {module:exercise~ExerciseSettings}
 */
function exerciseSettings() {
  const g = gen();
  const m = meterOf(g.meter);
  return { meter: m, measures: g.measures, min: g.min, max: g.max, starts: startsFor(m), seed: g.seed };
}

/**
 * Prévient quand les réglages ne permettent pas assez de mesures différentes
 * (une mesure reviendra forcément).
 */
function updateFewHint() {
  const el = /** @type {HTMLElement} */ (app.querySelector('#fewHint'));
  if (!el) return;
  const s = exerciseSettings();
  const n = candidates(s).length;
  el.hidden = n >= s.measures;
  el.textContent = n === 1 ? t('ex.onlyOne') : t('ex.onlyN', { n });
}

/** Bloc de l'exercice affiché. */
let block = null;

/**
 * Construit le bloc de l'exercice courant (réglages + numéro).
 * @returns {module:model~StaffBlock}
 */
function buildBlock() {
  const s = exerciseSettings();
  return seriesBlock(generateExercise(s), settings(), PLAY_ID, s.meter);
}

/**
 * Écran de l'exercice.
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
  // Appui long : « Jouer d'ici » ou boucle sur des mesures de l'exercice (2.8.4).
  const st = /** @type {HTMLElement} */ (app.querySelector('#genStaff'));
  bindMeasureSelect(
    st,
    staffTarget(st, () => (st._W && block ? layout(block, st._W, false, null) : null), {
      playId: () => PLAY_ID,
      // Une mesure : jusqu'à la fin, en boucle si « Boucle » est activé.
      play: (a, to, loop, done) => play({ from: a, to, loop: loop || settings().loop }, done),
    }),
  );
  requestAnimationFrame(draw);
}

registerScreen('genPlay', renderGenPlay);

/**
 * Lance ou arrête l'exercice.
 * @param {module:audio~PlayOptions} [extra] Partie à jouer (sélection de mesures, 2.8.4).
 * @param {function()} [done] À la fin de la lecture.
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
 * Dessine l'exercice. La portée est dessinée plus étroite que l'écran puis
 * agrandie par le CSS (×1,15) (`width: 100%`) : les notes sont plus grosses, à lire
 * de loin, pupitre posé.
 */
function draw() {
  const el = /** @type {HTMLElement} */ (app.querySelector('#genStaff'));
  if (!el || !block) return;
  const W = Math.max(220, Math.round((el.clientWidth || 300) / 1.15));
  el.innerHTML = staffSvg(block, W).svg;
  el._W = W;
  refreshMeasureSelect(el);
}
