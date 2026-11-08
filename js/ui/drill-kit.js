/**
 * @module ui/drill-kit
 * @description
 * Pièces communes aux écrans d'entraînement rythmique (2.8) : réglages
 * mémorisés, choix de la mesure, réglages de lecture et du métronome,
 * bouton lecture, surlignage léger pendant la lecture.
 *
 * Utilisé par {@link module:ui/training|ui/training} (Placements) et
 * {@link module:ui/exercises|ui/exercises} (exercices aléatoires).
 */

import { esc } from '../util.js';
import { getMeta, setMeta, DRILL_DEFAULTS } from '../storage.js';
import { METERS } from '../placements.js';
import * as audio from '../audio.js';

/** Subdivisions proposées (seules les croches sont disponibles pour l'instant). */
export const SUBDIVISIONS = [
  { key: '8', label: 'Croches', ready: true },
  { key: '16', label: 'Doubles', ready: false },
  { key: '3', label: 'Triolets', ready: false },
];

/**
 * En-tête commun aux écrans d'entraînement.
 * @param {string} back Libellé du bouton retour.
 * @param {string} title
 * @param {string} [extra=''] HTML ajouté à droite du titre.
 * @returns {string}
 */
export function header(back, title, extra = '') {
  return `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; ${esc(back)}</button><div class="grow"></div><h1 class="top-title">${esc(title)}</h1>${extra}</header>`;
}

/**
 * Réglages courants (mémorisés entre deux visites).
 * @returns {module:storage~DrillSettings}
 */
export function settings() {
  return getMeta().drill || { ...DRILL_DEFAULTS, beats: {} };
}

/**
 * Modifie et mémorise des réglages.
 * @param {Object} patch
 */
export function updateSettings(patch) {
  setMeta({ drill: { ...settings(), ...patch } });
}

/**
 * Temps du métronome pour une mesure (tous par défaut).
 * @param {module:placements~Meter} m
 * @returns {Array.<boolean>}
 */
export function beatsFor(m) {
  return settings().beats[m.key] || m.groups.map(() => true);
}

/**
 * Options de lecture pour {@link module:audio.playStaff|playStaff}.
 * @param {module:placements~Meter} m
 * @param {boolean} [loop=false]
 * @returns {module:audio~PlayOptions}
 */
export function playOptions(m, loop = false) {
  const s = settings();
  const beats = beatsFor(m);
  return {
    countIn: s.countIn,
    beats: beats.some(Boolean) ? beats : null,
    accent: s.accent,
    mute: s.mute,
    loop,
  };
}

/**
 * Sélecteur de mesure (puces). Les mesures asymétriques affichent leur
 * groupement en petit (`7/8` `2+2+3`).
 * @param {string} selected Clé de la mesure choisie.
 * @returns {string}
 */
export function meterChips(selected) {
  return `<div class="meters" role="radiogroup" aria-label="Mesure">${METERS.map((m) => {
    const sub = m.kind === 'odd' ? `<small>${m.groups.join('+')}</small>` : '';
    return `<button type="button" role="radio" data-meter="${m.key}" aria-checked="${m.key === selected}" aria-label="${esc(m.label)}">${m.time}${sub}</button>`;
  }).join('')}</div>`;
}

/**
 * Sélecteur de subdivision (seules les croches pour l'instant).
 * @returns {string}
 */
export function subdivisionSeg() {
  return `<div class="seg seg-sm" role="radiogroup" aria-label="Subdivision">${SUBDIVISIONS.map(
    (d) =>
      `<button type="button" role="radio" aria-checked="${d.key === '8'}"${d.ready ? '' : ' disabled'}>${esc(d.label)}${d.ready ? '' : '<small>bientôt</small>'}</button>`,
  ).join('')}</div>`;
}

/**
 * Bouton bascule (`aria-pressed`) pour un réglage booléen.
 * @param {string} key
 * @param {string} label
 * @param {boolean} on
 * @param {boolean} [disabled=false]
 * @returns {string}
 */
export const toggle = (key, label, on, disabled = false) =>
  `<button type="button" class="chip" data-opt="${key}" aria-pressed="${on && !disabled}"${disabled ? ' disabled title="Seulement en mesure simple (x/4)"' : ''}>${esc(label)}</button>`;

/**
 * Champ tempo (noire = …).
 * @param {number} tempo
 * @returns {string}
 */
export const tempoField = (tempo) =>
  `<label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" id="drillTempo" value="${tempo}" aria-label="Tempo"></label>`;

/**
 * Réglages du métronome : temps qui cliquent (un bouton par groupe), accent,
 * décompte, rythme coupé.
 * @param {module:placements~Meter} m
 * @returns {string}
 */
export function metronomeControls(m) {
  const s = settings();
  return `<div class="drill-row"><span class="drill-lbl">Temps</span><div class="beats" role="group" aria-label="Temps du métronome">${beatsFor(
    m,
  )
    .map(
      (on, k) =>
        `<button type="button" data-beat="${k}" aria-pressed="${on}" aria-label="Temps ${k + 1}">${k + 1}</button>`,
    )
    .join('')}</div></div>
    <div class="drill-row">${toggle('accent', 'Accent sur le 1', s.accent)}${toggle('countIn', 'Décompte', s.countIn)}${toggle('mute', 'Couper le rythme', s.mute)}</div>`;
}

/**
 * Branche les réglages de lecture d'un écran : tempo, bascules
 * (`data-opt`), temps du métronome.
 * @param {HTMLElement} root
 * @param {module:placements~Meter} m
 * @param {function()} onChange Après chaque changement (la lecture en cours est déjà arrêtée).
 */
export function bindPlayControls(root, m, onChange) {
  const tp = /** @type {HTMLInputElement} */ (root.querySelector('#drillTempo'));
  if (tp)
    tp.addEventListener('change', () => {
      const v = Math.max(30, Math.min(300, parseInt(tp.value, 10) || 80));
      tp.value = String(v);
      updateSettings({ tempo: v });
      audio.stop();
      onChange();
    });
  root.querySelectorAll('[data-opt]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = /** @type {HTMLElement} */ (b).dataset.opt;
      const on = !settings()[key];
      updateSettings({ [key]: on });
      b.setAttribute('aria-pressed', String(on));
      audio.stop();
      onChange();
    }),
  );
  root.querySelectorAll('[data-beat]').forEach((b) =>
    b.addEventListener('click', () => {
      const beats = beatsFor(m).slice();
      const k = Number(/** @type {HTMLElement} */ (b).dataset.beat);
      beats[k] = !beats[k];
      updateSettings({ beats: { ...settings().beats, [m.key]: beats } });
      b.setAttribute('aria-pressed', String(beats[k]));
      audio.stop();
      onChange();
    }),
  );
}

/**
 * Met à jour un bouton lecture (`data-play`) : ▶ ou ■.
 * @param {string} id
 * @param {boolean} [withText=true] Afficher « Écouter » / « Stop » à côté du symbole.
 */
export function updatePlay(id, withText = true) {
  const btn = document.querySelector(`[data-play="${CSS.escape(id)}"]`);
  if (!btn) return;
  const on = audio.isPlaying(id);
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-label', on ? 'Arrêter' : 'Écouter');
  btn.innerHTML = withText ? (on ? '&#9632; Stop' : '&#9654; Écouter') : on ? '&#9632;' : '&#9654;';
}

/**
 * Surligne l'élément joué dans une portée déjà dessinée, sans tout redessiner
 * (une série peut compter des centaines de mesures). Les groupes `g.it` du
 * SVG sont dans l'ordre des éléments (aucun n'est masqué ici).
 * @param {Element} el Conteneur du SVG.
 * @param {?number} i Élément joué, `null` pour effacer.
 */
export function highlight(el, i) {
  if (!el) return;
  const prev = el.querySelector('g.it.play');
  if (prev) prev.classList.remove('play');
  if (i == null) return;
  const g = el.querySelectorAll('g.it')[i];
  if (g) {
    g.classList.add('play');
    // Longue série : on fait défiler la page quand la lecture sort de l'écran.
    const r = g.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 70 || r.top < 0)
      g.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
