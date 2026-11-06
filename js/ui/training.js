/**
 * @module ui/training
 * @description
 * **Entraînement** (depuis la 2.3) : un écran d'accueil des exercices
 * (`training`), puis un écran par exercice. Le premier est **Rythme ›
 * Placements** (`rhythm`) : toutes les façons de placer n croches dans une
 * mesure de 4/4, écrites proprement et écoutables.
 *
 * La logique (génération, règles d'écriture) est dans le module pur
 * {@link module:placements|placements} ; ce module ne fait que l'interface.
 * Les mesures sont de vrais blocs « ligne rythmique » : elles sont dessinées
 * par {@link module:render-staff.staffSvg|staffSvg} et jouées par
 * {@link module:audio.playStaff|playStaff}, comme dans une note.
 */

import { app } from './state.js';
import { esc } from '../util.js';
import { getMeta, setMeta } from '../storage.js';
import { staffSvg } from '../render-staff.js';
import { combinations, placementBlock, SLOTS, COUNT_LABELS } from '../placements.js';
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

/** Placements affichés : id → { block, positions }. Recréé à chaque génération. */
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
      <button class="opt-row" type="button" id="goPlacements"><span>Placements<small>Toutes les façons de placer des notes dans une mesure, à lire et à écouter</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    </div>
  </section>`;
  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#goPlacements').addEventListener('click', () => goChild('rhythm'));
}

registerScreen('training', renderTraining);

/**
 * Réglages courants de l'exercice (mémorisés entre deux visites).
 * @returns {{notes: number, tempo: number}}
 */
function settings() {
  return getMeta().drill || { notes: 1, tempo: 80 };
}

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
    <div class="drill-bar"><span class="listbar-lbl" id="drillCount"></span><div class="grow"></div><label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" id="drillTempo" value="${s.tempo}" aria-label="Tempo"></label></div>
  </section>
  <div class="drills" id="drills"></div>`;

  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelectorAll('[data-n]').forEach((b) =>
    b.addEventListener('click', () => {
      setMeta({ drill: { ...settings(), notes: Number(/** @type {HTMLElement} */ (b).dataset.n) } });
      app.querySelectorAll('[data-n]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      renderDrills();
    }),
  );
  const tp = /** @type {HTMLInputElement} */ (app.querySelector('#drillTempo'));
  tp.addEventListener('change', () => {
    const v = Math.max(30, Math.min(300, parseInt(tp.value, 10) || 80));
    tp.value = String(v);
    setMeta({ drill: { ...settings(), tempo: v } });
    drills.forEach((d) => {
      d.block.tempo = v;
    });
  });
  // Les SVG ont besoin de la largeur réelle : on les dessine après la mise en page.
  requestAnimationFrame(renderDrills);
}

registerScreen('rhythm', renderPlacements);

/**
 * Génère et affiche tous les placements pour le nombre de notes choisi.
 */
function renderDrills() {
  audio.stop();
  const { notes, tempo } = settings();
  const all = combinations(SLOTS, notes);
  app.querySelector('#drillCount').textContent = `${all.length} placement${all.length > 1 ? 's' : ''}`;
  drills = new Map();
  const list = app.querySelector('#drills');
  list.innerHTML = all
    .map((pos, i) => {
      const id = 'drill' + i;
      drills.set(id, { block: placementBlock(pos, tempo, id), positions: pos });
      return `<div class="drill"><div class="drill-head"><span class="drill-n">${i + 1}</span><span class="drill-count" data-count="${id}"></span><button type="button" class="playbtn" data-play="${id}">&#9654; Écouter</button></div><div class="drill-staff" data-drill="${id}"></div></div>`;
    })
    .join('');
  drills.forEach((d, id) => {
    redrawDrill(id);
    list.querySelector(`[data-play="${id}"]`).addEventListener('click', () => {
      audio.playStaff(d.block, {
        onStep: (i) => redrawDrill(id, i),
        onEnd: () => {
          redrawDrill(id);
          updatePlayBtn(id);
        },
      });
      updatePlayBtn(id);
    });
  });
}

/**
 * Dessine un placement : la mesure, et le comptage avec les positions jouées en gras.
 * @param {string} id
 * @param {?number} [playIdx] Élément en cours de lecture.
 */
function redrawDrill(id, playIdx = null) {
  const d = drills.get(id);
  const el = /** @type {HTMLElement} */ (app.querySelector(`[data-drill="${id}"]`));
  if (!d || !el) return;
  el.innerHTML = staffSvg(d.block, Math.max(220, el.clientWidth || 300), { play: playIdx }).svg;
  const count = app.querySelector(`[data-count="${id}"]`);
  if (count && !count.childElementCount)
    count.innerHTML = COUNT_LABELS.map(
      (c, p) => `<span${d.positions.includes(p) ? ' class="hit"' : ''}>${c}</span>`,
    ).join('');
}
