/**
 * @module ui/training
 * @description
 * **Entraînement** (depuis la 2.3) : un écran d'accueil des exercices
 * (`training`), puis un écran par exercice.
 *
 * - **Rythme › Placements** (`rhythm`) : toutes les façons de placer n
 *   croches dans une mesure (toutes les mesures depuis la 2.8), en sections
 *   repliables selon la position de la première note, écrites proprement et
 *   jouées avec un métronome réglable.
 * - **Rythme › Exercices aléatoires** (2.8) : voir {@link module:ui/exercises|ui/exercises}.
 *
 * La logique (génération, règles d'écriture) est dans le module pur
 * {@link module:placements|placements} ; ce module ne fait que l'interface.
 * Les mesures sont de vrais blocs « ligne rythmique » : elles sont dessinées
 * par {@link module:render-staff.staffSvg|staffSvg} et jouées par
 * {@link module:audio.playStaff|playStaff}, comme dans une note.
 */

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
      <button class="opt-row" type="button" id="goExercises"><span>Exercices aléatoires<small>1, 2 ou 4 mesures à lire, tirées au hasard selon vos réglages</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    </div>
  </section>`;
  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#goPlacements').addEventListener('click', () => goChild('rhythm'));
  app.querySelector('#goExercises').addEventListener('click', () => goChild('gen'));
}

registerScreen('training', renderTraining);

/**
 * Sections affichées : id → bloc ligne rythmique, et état déplié. Recréé à
 * chaque génération.
 * @type {Map<string, {block: module:model~StaffBlock, open: boolean, drawn: boolean}>}
 */
let sections = new Map();

/**
 * Écran Rythme › Placements.
 */
function renderPlacements() {
  audio.stop();
  hideAllPalettes();
  const s = settings();
  const m = meterOf(s.meter);
  const slots = slotsOf(m);
  app.innerHTML = `${header('Entraînement', 'Placements')}
  <section class="opt">
    <h2 class="eyebrow">Mesure</h2>
    ${meterChips(m.key)}
    <h2 class="eyebrow">Notes par mesure</h2>
    <div class="nsel" role="radiogroup" aria-label="Notes par mesure">${Array.from(
      { length: slots },
      (_, i) =>
        `<button type="button" role="radio" data-n="${i + 1}" aria-checked="${i + 1 === s.notes}">${i + 1}</button>`,
    ).join('')}</div>
    <h2 class="eyebrow">Subdivision</h2>
    ${subdivisionSeg()}
    <h2 class="eyebrow">Lecture</h2>
    <div class="drill-row">${tempoField(s.tempo)}${toggle('swing', 'Swing', s.swing, m.kind !== 'simple')}</div>
    <h2 class="eyebrow">Métronome</h2>
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
  // Les SVG ont besoin de la largeur réelle : on les dessine après la mise en page.
  requestAnimationFrame(renderSections);
}

registerScreen('rhythm', renderPlacements);

/**
 * Reporte tempo et swing sur les séries affichées.
 */
function applyPlaySettings() {
  const { tempo, swing } = settings();
  sections.forEach(({ block }) => {
    block.tempo = tempo;
    block.swing = swing && meterOf(settings().meter).kind === 'simple';
  });
}

/**
 * Génère les sections pour le nombre de notes et la mesure choisis. Seule la
 * première est dépliée ; les portées ne sont dessinées qu'à l'ouverture (en
 * 12/8, six notes donnent 924 mesures).
 */
function renderSections() {
  audio.stop();
  const s = settings();
  const m = meterOf(s.meter);
  const series = placementSeries(s.notes, m);
  const measures = series.reduce((t, x) => t + x.length, 0);
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  app.querySelector('#drillCount').textContent =
    series.length > 1
      ? `${plural(measures, 'mesure')} · ${plural(series.length, 'départ')}`
      : plural(measures, 'mesure');
  sections = new Map();
  const single = s.notes === 1;
  const list = app.querySelector('#drills');
  list.innerHTML = series
    .map((sr, i) => {
      const id = 'drill' + i;
      sections.set(id, { block: seriesBlock(sr, s, id, m), open: i === 0, drawn: false });
      const p = sr[0][0];
      const title = single
        ? '<span class="drill-all">Toutes les positions</span>'
        : `<span class="drill-start mus" aria-hidden="true">${startGlyphs(p, m)}</span><span class="sr">Départ sur ${esc(startLabel(p, m))}</span>`;
      return `<div class="drill" data-sec="${id}"><div class="drill-head"><button type="button" class="drill-tog" data-tog="${id}" aria-expanded="false" aria-controls="ds_${id}"><span class="drill-chev" aria-hidden="true"></span>${title}<span class="drill-sub">${plural(sr.length, 'mesure')}</span></button><button type="button" class="playbtn round" data-play="${id}" aria-label="Écouter">&#9654;</button></div><div class="drill-staff" id="ds_${id}" data-drill="${id}" hidden></div></div>`;
    })
    .join('');
  sections.forEach((sec, id) => {
    list.querySelector(`[data-tog="${id}"]`).addEventListener('click', () => {
      setOpen(id, !sections.get(id).open);
      updateFoldAll();
    });
    list.querySelector(`[data-play="${id}"]`).addEventListener('click', () => play(id));
    // Appui long : « Jouer d'ici » ou boucle sur des mesures de la série (2.8.4).
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
 * Déplie ou replie une section (et dessine sa portée la première fois).
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

/** Libellé du bouton « Tout déplier / Tout replier ». */
function updateFoldAll() {
  const btn = app.querySelector('#foldAll');
  if (!btn) return;
  btn.hidden = sections.size < 2;
  btn.textContent = [...sections.values()].some((x) => !x.open) ? 'Tout déplier' : 'Tout replier';
}

/**
 * Joue une section (et la déplie si elle était repliée).
 * @param {string} id
 * @param {module:audio~PlayOptions} [extra] Partie à jouer (sélection de mesures, 2.8.4).
 * @param {function()} [done] À la fin de la lecture.
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
 * Dessine la portée d'une section.
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
