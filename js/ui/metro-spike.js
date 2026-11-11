/**
 * @module ui/metro-spike
 * @description
 * **Temporary** panel of the 2.10 metronome spike, to test the engine
 * ({@link module:metro-engine|metro-engine}) on a phone: start/stop, tempo
 * -5 -1 +1 +5, output route, beat lights and measurements (audio clock
 * against wall clock, time away with the screen locked, render time, swap
 * delay). It is replaced by the real metronome sheet in 2.10.
 *
 * Opened by the metronome button of the home header (`#metroSpikeBtn`). The panel
 * lives in `<body>`, outside `#app`: it survives navigation, like the mini-bar
 * will.
 */

import { t } from '../i18n.js';
import { esc } from '../util.js';
import * as engine from '../metro-engine.js';

/** @type {HTMLElement|null} */
let panel = null;
let raf = 0;
let lastDiag = 0;

/** Output routes offered by the panel. */
const OUTPUTS = ['direct', 'stream', 'wav'];

/**
 * Formats a duration as m:ss.
 * @param {number} ms
 * @returns {string}
 */
function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** Builds the panel once. */
function build() {
  panel = document.createElement('section');
  panel.id = 'metroSpike';
  panel.className = 'ms-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', t('metroSpike.title'));
  document.body.appendChild(panel);
  panel.addEventListener('click', onClick);
  panel.addEventListener('change', (e) => {
    const r = /** @type {HTMLInputElement} */ (e.target);
    if (r.name === 'msOut') engine.setOutput(/** @type {module:metro-engine~Output} */ (r.value));
  });
}

/**
 * Taps in the panel.
 * @param {MouseEvent} e
 */
function onClick(e) {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!b) return;
  if (b.dataset.ms === 'close') return toggle(false);
  if (b.dataset.ms === 'play') return engine.isRunning() ? engine.stop() : engine.start();
  if (b.dataset.step) engine.setTempo(engine.getTempo() + Number(b.dataset.step));
}

/** Redraws the panel controls (not the live values). */
function render() {
  if (!panel) return;
  const on = engine.isRunning();
  const out = engine.getOutput();
  const step = (n) =>
    `<button type="button" class="btn" data-step="${n}">${n > 0 ? '+' + n : '−' + -n}</button>`;
  const radio = (o) =>
    `<label class="ms-out"><input type="radio" name="msOut" value="${o}"${o === out ? ' checked' : ''}> ${esc(t('metroSpike.out_' + o))}</label>`;
  panel.innerHTML = `<div class="ms-head"><strong>${esc(t('metroSpike.title'))}</strong><span class="grow"></span><button type="button" class="btn" data-ms="close" aria-label="${esc(t('metroSpike.close'))}">&#x2715;</button></div>
<div class="ms-bpm"><span id="msBpm">${engine.getTempo()}</span> <small>${esc(t('metroSpike.bpmUnit'))}</small></div>
<div class="ms-lights" aria-hidden="true">${'<span></span>'.repeat(4)}</div>
<div class="ms-row">${step(-5)}${step(-1)}<button type="button" class="btn primary ms-play" data-ms="play">${esc(on ? t('metroSpike.stop') : t('metroSpike.start'))}</button>${step(1)}${step(5)}</div>
<fieldset class="ms-outs"><legend>${esc(t('metroSpike.output'))}</legend>${OUTPUTS.map(radio).join('')}</fieldset>
<pre class="ms-diag" id="msDiag"></pre>`;
  updateLive(true);
}

/**
 * Live values: beat lights every frame, measurements a few times a second.
 * @param {boolean} [force] Refresh the measurements now.
 */
function updateLive(force) {
  if (!panel || panel.hidden) return;
  const beat = engine.currentBeat();
  panel.querySelectorAll('.ms-lights span').forEach((s, i) => s.classList.toggle('on', i === beat));
  const now = performance.now();
  if (!force && now - lastDiag < 250) return;
  lastDiag = now;
  const d = engine.getDiag();
  const lines = [
    t('metroSpike.diagRun', {
      run: clock(d.runMs),
      audio: clock(d.audioMs),
      drift: Math.round(d.audioMs - d.runMs),
      state: d.state,
    }),
    t('metroSpike.diagAway', { wall: clock(d.diag.awayWallMs), audio: clock(d.diag.awayAudioMs) }),
    t('metroSpike.diagSwap', {
      render: d.diag.renderMs.toFixed(1),
      lead: Math.round(d.diag.leadMs),
      swaps: d.diag.swaps,
    }),
  ];
  if (d.diag.lastError) lines.push(t('metroSpike.diagError', { e: d.diag.lastError }));
  panel.querySelector('#msDiag').textContent = lines.join('\n');
}

/** Animation loop, only while the panel is shown and the page visible. */
function loop() {
  raf = 0;
  if (!panel || panel.hidden || document.hidden) return;
  updateLive(false);
  raf = requestAnimationFrame(loop);
}

/**
 * Shows or hides the panel.
 * @param {boolean} show
 */
function toggle(show) {
  if (!panel) build();
  panel.hidden = !show;
  if (show) {
    render();
    if (!raf) raf = requestAnimationFrame(loop);
  }
}

engine.init({
  onChange: render,
  meta: (bpm) => ({ title: t('metroSpike.title'), artist: t('metroSpike.bpm', { n: bpm }) }),
});

// The home header is redrawn often: one delegated listener for its button.
document.addEventListener('click', (e) => {
  if (/** @type {HTMLElement} */ (e.target).closest('#metroSpikeBtn')) toggle(!panel || panel.hidden);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && panel && !panel.hidden && !raf) raf = requestAnimationFrame(loop);
});
