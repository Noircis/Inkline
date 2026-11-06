/**
 * @module ui/training
 * @description
 * **Entraînement** (depuis la 2.3) : un écran d'accueil des exercices
 * (`training`), puis un écran par exercice. Le premier est **Rythme ›
 * Placements** (`rhythm`) : toutes les façons de placer n croches dans une
 * mesure de 4/4, regroupées en séries (même position de la première note),
 * écrites proprement et jouées avec un métronome réglable (temps qui
 * cliquent, accent, décompte, rythme coupé pour jouer soi-même).
 *
 * La logique (génération, règles d'écriture) est dans le module pur
 * {@link module:placements|placements} ; ce module ne fait que l'interface.
 * Les mesures sont de vrais blocs « ligne rythmique » : elles sont dessinées
 * par {@link module:render-staff.staffSvg|staffSvg} et jouées par
 * {@link module:audio.playStaff|playStaff}, comme dans une note.
 */

import { app } from './state.js';
import { esc } from '../util.js';
import { getMeta, setMeta, DRILL_DEFAULTS } from '../storage.js';
import { staffSvg } from '../render-staff.js';
import { placementSeries, seriesBlock, SLOTS } from '../placements.js';
import * as audio from '../audio.js';
import { registerScreen, goChild, backToList } from './nav.js';
import { updatePlayBtn } from './common.js';
import { hideAllPalettes } from './blocks.js';

/** Subdivisions proposées (seules les croches sont disponibles pour l'instant). */
const SUBDIVISIONS = [
  { key: '8', label: 'Croches', ready: true },
  { key: '16', label: 'Doubles', ready: false },
  { key: '3', label: 'Triolets', ready: false },
];

/** Séries affichées : id → bloc ligne rythmique. Recréé à chaque génération. */
let drills = new Map();

/**
 * En-tête commun aux écrans d'entraînement.
 * @param {string} back Libellé du bouton retour.
 * @param {string} title
 * @returns {string}
 */
function header(back, title) {
  return `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; ${esc(back)}</button><div class="grow"></div><h1 class="top-title">${esc(title)}</h1></header>`;
}

/**
 * Écran d'accueil de l'entraînement : la liste des exercices.
 */
function renderTraining() {
  audio.stop();
  hideAllPalettes();
  app.innerHTML = `${header('Notes', 'Entraînement')}
  <section class="opt">
    <h2 class="eyebrow">Rythme</h2>
    <div class="opt-group">
      <button class="opt-row" type="button" id="goPlacements"><span>Placements<small>Toutes les façons de placer des notes dans une mesure, à lire et à jouer</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    </div>
  </section>`;
  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#goPlacements').addEventListener('click', () => goChild('rhythm'));
}

registerScreen('training', renderTraining);

/**
 * Réglages courants de l'exercice (mémorisés entre deux visites).
 * @returns {module:storage~DrillSettings}
 */
function settings() {
  return getMeta().drill || { ...DRILL_DEFAULTS, beats: DRILL_DEFAULTS.beats.slice() };
}

/**
 * Modifie et mémorise des réglages.
 * @param {Object} patch
 */
function updateSettings(patch) {
  setMeta({ drill: { ...settings(), ...patch } });
}

/**
 * Bouton bascule (`aria-pressed`) pour un réglage booléen.
 * @param {string} key
 * @param {string} label
 * @param {boolean} on
 * @returns {string}
 */
const toggle = (key, label, on) =>
  `<button type="button" class="chip" data-opt="${key}" aria-pressed="${on}">${esc(label)}</button>`;

/**
 * Écran Rythme › Placements.
 */
function renderPlacements() {
  audio.stop();
  hideAllPalettes();
  const s = settings();
  app.innerHTML = `${header('Entraînement', 'Placements')}
  <section class="opt">
    <h2 class="eyebrow">Notes par mesure</h2>
    <div class="nsel" role="radiogroup" aria-label="Notes par mesure">${Array.from(
      { length: SLOTS },
      (_, i) =>
        `<button type="button" role="radio" data-n="${i + 1}" aria-checked="${i + 1 === s.notes}">${i + 1}</button>`,
    ).join('')}</div>
    <h2 class="eyebrow">Subdivision</h2>
    <div class="seg seg-sm" role="radiogroup" aria-label="Subdivision">${SUBDIVISIONS.map(
      (d) =>
        `<button type="button" role="radio" aria-checked="${d.key === '8'}"${d.ready ? '' : ' disabled'}>${esc(d.label)}${d.ready ? '' : '<small>bientôt</small>'}</button>`,
    ).join('')}</div>
    <h2 class="eyebrow">Lecture</h2>
    <div class="drill-row"><label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" id="drillTempo" value="${s.tempo}" aria-label="Tempo"></label>${toggle('swing', 'Swing', s.swing)}${toggle('mute', 'Couper le rythme', s.mute)}</div>
    <h2 class="eyebrow">Métronome</h2>
    <div class="drill-row"><span class="drill-lbl">Temps</span><div class="beats" role="group" aria-label="Temps du métronome">${s.beats
      .map(
        (on, k) =>
          `<button type="button" data-beat="${k}" aria-pressed="${on}" aria-label="Temps ${k + 1}">${k + 1}</button>`,
      )
      .join('')}</div></div>
    <div class="drill-row">${toggle('accent', 'Accent sur le 1', s.accent)}${toggle('countIn', 'Décompte', s.countIn)}</div>
    <div class="drill-bar"><span class="listbar-lbl" id="drillCount"></span></div>
  </section>
  <div class="drills" id="drills"></div>`;

  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelectorAll('[data-n]').forEach((b) =>
    b.addEventListener('click', () => {
      updateSettings({ notes: Number(/** @type {HTMLElement} */ (b).dataset.n) });
      app.querySelectorAll('[data-n]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      renderDrills();
    }),
  );
  const tp = /** @type {HTMLInputElement} */ (app.querySelector('#drillTempo'));
  tp.addEventListener('change', () => {
    const v = Math.max(30, Math.min(300, parseInt(tp.value, 10) || 80));
    tp.value = String(v);
    updateSettings({ tempo: v });
    applyPlaySettings();
  });
  app.querySelectorAll('[data-opt]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = /** @type {HTMLElement} */ (b).dataset.opt;
      const on = !settings()[key];
      updateSettings({ [key]: on });
      b.setAttribute('aria-pressed', String(on));
      applyPlaySettings();
    }),
  );
  app.querySelectorAll('[data-beat]').forEach((b) =>
    b.addEventListener('click', () => {
      const beats = settings().beats.slice();
      const k = Number(/** @type {HTMLElement} */ (b).dataset.beat);
      beats[k] = !beats[k];
      updateSettings({ beats });
      b.setAttribute('aria-pressed', String(beats[k]));
      audio.stop();
    }),
  );
  // Les SVG ont besoin de la largeur réelle : on les dessine après la mise en page.
  requestAnimationFrame(renderDrills);
}

registerScreen('rhythm', renderPlacements);

/**
 * Reporte tempo et swing sur les séries affichées. Une lecture en cours est
 * arrêtée : elle a été programmée avec les anciens réglages.
 */
function applyPlaySettings() {
  const { tempo, swing } = settings();
  audio.stop();
  drills.forEach((b) => {
    b.tempo = tempo;
    b.swing = swing;
  });
}

/**
 * Génère et affiche les séries pour le nombre de notes choisi.
 */
function renderDrills() {
  audio.stop();
  const s = settings();
  const series = placementSeries(s.notes);
  const measures = series.reduce((t, x) => t + x.length, 0);
  app.querySelector('#drillCount').textContent =
    series.length > 1
      ? `${series.length} séries · ${measures} mesures`
      : `${measures} mesure${measures > 1 ? 's' : ''}`;
  drills = new Map();
  const list = app.querySelector('#drills');
  list.innerHTML = series
    .map((sr, i) => {
      const id = 'drill' + i;
      drills.set(id, seriesBlock(sr, s, id));
      return `<div class="drill"><div class="drill-head"><span class="drill-n">${i + 1}</span><span class="drill-sub">${sr.length} mesure${sr.length > 1 ? 's' : ''}</span><button type="button" class="playbtn" data-play="${id}">&#9654; Écouter</button></div><div class="drill-staff" data-drill="${id}"></div></div>`;
    })
    .join('');
  drills.forEach((b, id) => {
    redrawDrill(id);
    list.querySelector(`[data-play="${id}"]`).addEventListener('click', () => {
      const o = settings();
      audio.playStaff(
        b,
        {
          onStep: (i) => redrawDrill(id, i),
          onEnd: () => {
            redrawDrill(id);
            updatePlayBtn(id);
          },
        },
        { countIn: o.countIn, beats: o.beats.some(Boolean) ? o.beats : null, accent: o.accent, mute: o.mute },
      );
      updatePlayBtn(id);
    });
  });
}

/**
 * Dessine une série.
 * @param {string} id
 * @param {?number} [playIdx] Élément en cours de lecture.
 */
function redrawDrill(id, playIdx = null) {
  const b = drills.get(id);
  const el = /** @type {HTMLElement} */ (app.querySelector(`[data-drill="${id}"]`));
  if (!b || !el) return;
  el.innerHTML = staffSvg(b, Math.max(220, el.clientWidth || 300), { play: playIdx }).svg;
}
