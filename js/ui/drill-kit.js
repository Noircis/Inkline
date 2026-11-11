/**
 * @module ui/drill-kit
 * @description
 * Pieces shared by the rhythm practice screens (2.8): remembered settings,
 * time signature choice, playback and metronome settings, play button, light
 * highlight during playback.
 *
 * Used by {@link module:ui/training|ui/training} (Placements) and
 * {@link module:ui/exercises|ui/exercises} (random exercises).
 */

import { t } from '../i18n.js';
import { esc } from '../util.js';
import { getMeta, setMeta, DRILL_DEFAULTS } from '../storage.js';
import { METERS } from '../placements.js';
import * as audio from '../audio.js';
import { metroButton } from './common.js';

/** Subdivisions offered (only eighth notes are available for now). */
export const SUBDIVISIONS = [
  { key: '8', ready: true },
  { key: '16', ready: false },
  { key: '3', ready: false },
];

/**
 * Header shared by the practice screens.
 * @param {string} back Back button label.
 * @param {string} title
 * @param {string} [extra=''] HTML added to the right of the title.
 * @returns {string}
 */
export function header(back, title, extra = '') {
  return `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; ${esc(back)}</button><div class="grow"></div><h1 class="top-title">${esc(title)}</h1>${extra}${metroButton()}</header>`;
}

/**
 * Current settings (remembered between visits).
 * @returns {module:storage~DrillSettings}
 */
export function settings() {
  return getMeta().drill || { ...DRILL_DEFAULTS, beats: {} };
}

/**
 * Changes and remembers settings.
 * @param {Object} patch
 */
export function updateSettings(patch) {
  setMeta({ drill: { ...settings(), ...patch } });
}

/**
 * Metronome beats for a time signature (all by default).
 * @param {module:placements~Meter} m
 * @returns {Array.<boolean>}
 */
export function beatsFor(m) {
  return settings().beats[m.key] || m.groups.map(() => true);
}

/**
 * Playback options for {@link module:audio.playStaff|playStaff}.
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
 * Time signature picker (chips). Odd meters show their grouping in small
 * print (`7/8` `2+2+3`).
 * @param {string} selected Key of the chosen time signature.
 * @returns {string}
 */
export function meterChips(selected) {
  return `<div class="meters" role="radiogroup" aria-label="${esc(t('staff.time'))}">${METERS.map((m) => {
    const sub = m.kind === 'odd' ? `<small>${m.groups.join('+')}</small>` : '';
    return `<button type="button" role="radio" data-meter="${m.key}" aria-checked="${m.key === selected}" aria-label="${esc(m.label)}">${m.time}${sub}</button>`;
  }).join('')}</div>`;
}

/**
 * Subdivision picker (eighth notes only for now).
 * @returns {string}
 */
export function subdivisionSeg() {
  return `<div class="seg seg-sm" role="radiogroup" aria-label="${esc(t('train.subdivision'))}">${SUBDIVISIONS.map(
    (d) =>
      `<button type="button" role="radio" aria-checked="${d.key === '8'}"${d.ready ? '' : ' disabled'}>${esc(t('sub.' + d.key))}${d.ready ? '' : `<small>${esc(t('sub.soon'))}</small>`}</button>`,
  ).join('')}</div>`;
}

/**
 * Toggle button (`aria-pressed`) for a boolean setting.
 * @param {string} key
 * @param {string} label
 * @param {boolean} on
 * @param {boolean} [disabled=false]
 * @returns {string}
 */
export const toggle = (key, label, on, disabled = false) =>
  `<button type="button" class="chip" data-opt="${key}" aria-pressed="${on && !disabled}"${disabled ? ` disabled title="${esc(t('train.simpleOnly'))}"` : ''}>${esc(label)}</button>`;

/**
 * Tempo field (quarter note = …).
 * @param {number} tempo
 * @returns {string}
 */
export const tempoField = (tempo) =>
  `<label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" id="drillTempo" value="${tempo}" aria-label="Tempo"></label>`;

/**
 * Metronome settings: clicking beats (one button per group), accent,
 * count-in, muted rhythm.
 * @param {module:placements~Meter} m
 * @returns {string}
 */
export function metronomeControls(m) {
  const s = settings();
  return `<div class="drill-row"><span class="drill-lbl">${esc(t('train.beats'))}</span><div class="beats" role="group" aria-label="${esc(t('train.beatsLabel'))}">${beatsFor(
    m,
  )
    .map(
      (on, k) =>
        `<button type="button" data-beat="${k}" aria-pressed="${on}" aria-label="${esc(t('train.beatN', { n: k + 1 }))}">${k + 1}</button>`,
    )
    .join('')}</div></div>
    <div class="drill-row">${toggle('accent', t('train.accent'), s.accent)}${toggle('countIn', t('train.countIn'), s.countIn)}${toggle('mute', t('train.mute'), s.mute)}</div>`;
}

/**
 * Wires a screen's playback settings: tempo, toggles (`data-opt`),
 * metronome beats.
 * @param {HTMLElement} root
 * @param {module:placements~Meter} m
 * @param {function()} onChange After each change (current playback is already stopped).
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
 * Updates a play button (`data-play`): ▶ or ■.
 * @param {string} id
 * @param {boolean} [withText=true] Show "Listen" / "Stop" next to the symbol.
 */
export function updatePlay(id, withText = true) {
  const btn = document.querySelector(`[data-play="${CSS.escape(id)}"]`);
  if (!btn) return;
  const on = audio.isPlaying(id);
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-label', on ? t('play.stopLabel') : t('play.listen'));
  btn.innerHTML = withText
    ? on
      ? '&#9632; ' + esc(t('play.stop'))
      : '&#9654; ' + esc(t('play.listen'))
    : on
      ? '&#9632;'
      : '&#9654;';
}

/**
 * Highlights the played item in an already drawn staff, without redrawing
 * everything (a series can hold hundreds of measures). The `g.it` groups of
 * the SVG are in item order (none is hidden here).
 * @param {Element} el SVG container.
 * @param {?number} i Played item, `null` to clear.
 */
export function highlight(el, i) {
  if (!el) return;
  const prev = el.querySelector('g.it.play');
  if (prev) prev.classList.remove('play');
  if (i == null) return;
  const g = el.querySelectorAll('g.it')[i];
  if (g) {
    g.classList.add('play');
    // Long series: scroll the page when playback leaves the screen.
    const r = g.getBoundingClientRect();
    if (r.bottom > window.innerHeight - 70 || r.top < 0)
      g.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
