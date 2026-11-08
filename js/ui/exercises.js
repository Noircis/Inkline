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

import { app } from './state.js';
import { esc } from '../util.js';
import { getMeta, setMeta, GEN_DEFAULTS } from '../storage.js';
import { staffSvg } from '../render-staff.js';
import { seriesBlock, meterOf, slotsOf, startGlyphs, startLabel } from '../placements.js';
import { generateExercise, newSeed } from '../exercise.js';
import * as audio from '../audio.js';
import { registerScreen, goChild, backToList } from './nav.js';
import { hideAllPalettes } from './blocks.js';
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
  `<span class="stepper" role="group" aria-label="${esc(label)}"><button type="button" class="btn" data-step="${key}" data-d="-1" aria-label="${esc(label)} : moins">&minus;</button><output id="v_${key}">${value}</output><button type="button" class="btn" data-step="${key}" data-d="1" aria-label="${esc(label)} : plus">+</button></span>`;

/**
 * Écran des réglages.
 */
function renderGen() {
  audio.stop();
  hideAllPalettes();
  const g = gen();
  const m = meterOf(g.meter);
  const starts = new Set(startsFor(m));
  app.innerHTML = `${header('Entraînement', 'Exercices')}
  <section class="opt">
    <h2 class="eyebrow">Mesure</h2>
    ${meterChips(m.key)}
    <h2 class="eyebrow">Longueur</h2>
    <div class="seg seg-sm" role="radiogroup" aria-label="Longueur">${[4, 8, 12]
      .map(
        (n) =>
          `<button type="button" role="radio" data-len="${n}" aria-checked="${n === g.measures}">${n} mesures</button>`,
      )
      .join('')}</div>
    <h2 class="eyebrow">Notes par mesure</h2>
    <div class="drill-row gen-range"><span class="drill-lbl">de</span>${stepper('min', 'Au moins', g.min)}<span class="drill-lbl">à</span>${stepper('max', 'Au plus', g.max)}</div>
    <h2 class="eyebrow">Première note de chaque mesure</h2>
    <div class="starts" role="group" aria-label="Positions permises pour la première note">${Array.from(
      { length: slotsOf(m) },
      (_, p) =>
        `<button type="button" data-start="${p}" aria-pressed="${starts.has(p)}" aria-label="Sur ${esc(startLabel(p, m))}"><span class="mus" aria-hidden="true">${startGlyphs(p, m)}</span></button>`,
    ).join('')}</div>
    <p class="hint" id="startsHint" hidden>Gardez au moins une position.</p>
    <h2 class="eyebrow">Subdivision</h2>
    ${subdivisionSeg()}
    <button type="button" class="btn primary wide" id="genGo">Générer l’exercice</button>
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
      b.setAttribute('aria-pressed', String(set.has(p)));
    }),
  );
  app.querySelector('#genGo').addEventListener('click', () => {
    updateGen({ seed: newSeed() });
    goChild('genPlay');
  });
}

registerScreen('gen', renderGen);

/** Bloc de l'exercice affiché. */
let block = null;

/**
 * Construit le bloc de l'exercice courant (réglages + numéro).
 * @returns {module:model~StaffBlock}
 */
function buildBlock() {
  const g = gen();
  const m = meterOf(g.meter);
  const placements = generateExercise({
    meter: m,
    measures: g.measures,
    min: g.min,
    max: g.max,
    starts: startsFor(m),
    seed: g.seed,
  });
  return seriesBlock(placements, settings(), PLAY_ID, m);
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
  const range = g.min === g.max ? `${g.min}` : `${g.min} à ${g.max}`;
  app.innerHTML = `${header('Réglages', `Exercice n° ${g.seed}`, '<button type="button" class="btn icon-btn" id="reroll" aria-label="Nouvel exercice">&#8635;</button>')}
  <p class="gen-info">${esc(m.label)} · ${g.measures} mesures · ${range} note${g.max > 1 ? 's' : ''} par mesure</p>
  <div class="gen-staff" id="genStaff"></div>
  <div class="transport">
    <div class="metro-panel" id="metroPanel" hidden>${metronomeControls(m)}</div>
    <div class="transport-bar">
      <button type="button" class="btn" data-tempo="-5" aria-label="Plus lent">&minus;</button>${tempoField(s.tempo)}<button type="button" class="btn" data-tempo="5" aria-label="Plus vite">+</button>
      ${toggle('swing', 'Swing', s.swing, m.kind !== 'simple')}
      ${toggle('loop', 'Boucle', s.loop)}
      <button type="button" class="btn icon-btn" id="metroBtn" aria-expanded="false" aria-controls="metroPanel" aria-label="Métronome">&#9881;</button>
    </div>
    <button type="button" class="playbtn big" data-play="${PLAY_ID}">&#9654; Écouter</button>
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
  app.querySelector(`[data-play="${PLAY_ID}"]`).addEventListener('click', play);
  requestAnimationFrame(draw);
}

registerScreen('genPlay', renderGenPlay);

/** Lance ou arrête l'exercice. */
function play() {
  const el = app.querySelector('#genStaff');
  audio.playStaff(
    block,
    {
      onStep: (i) => highlight(el, i),
      onEnd: () => {
        highlight(el, null);
        updatePlay(PLAY_ID);
      },
    },
    playOptions(meterOf(gen().meter), settings().loop),
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
  el.innerHTML = staffSvg(block, Math.max(220, Math.round((el.clientWidth || 300) / 1.15))).svg;
}
