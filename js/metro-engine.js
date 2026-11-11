/**
 * @module metro-engine
 * @description
 * Metronome audio engine, **2.10 spike**: checks that a metronome keeps
 * playing with the phone screen locked. Browser glue (Web Audio, media
 * elements, Media Session); the timing math lives in
 * {@link module:metro-clock|metro-clock}.
 *
 * ## Why a pre-rendered loop
 *
 * Android throttles JavaScript timers in the background, so a `setTimeout`
 * lookahead scheduler stalls once the screen is locked. Here one cycle (one
 * bar, 4 beats in the spike) is rendered once with an `OfflineAudioContext`
 * into an `AudioBuffer`, then played by an `AudioBufferSourceNode` with
 * `loop = true`: no JavaScript runs while it plays.
 *
 * A tempo change renders a new cycle and swaps it in right away, even mid-beat
 * ({@link module:metro-clock.swapPoint|swapPoint}): the old source stops and
 * the new one starts at the same audio time.
 *
 * Tempo goes down to 1 BPM: one 4/4 bar then lasts 4 minutes, a 46 MB buffer
 * (23 MB as WAV). Fine for the spike; V1 may render one beat at very slow
 * tempos.
 *
 * ## Three outputs (to be measured on a phone)
 *
 * - `direct`: source → `AudioContext.destination`.
 * - `stream`: source → `MediaStreamAudioDestinationNode`, whose stream is
 *   played by an `<audio>` element. Chrome may only show lock-screen media
 *   controls (Media Session) for media elements.
 * - `wav`: the cycle is encoded as a WAV file (repeated to last about 10 s)
 *   and played by an `<audio loop>` element. No Web Audio at play time, but a
 *   tempo change is not sample-accurate (the phase is kept, not the beat).
 *
 * The shared audio context comes from {@link module:audio.getAudioContext|audio}.
 */

import { getAudioContext } from './audio.js';
import { cycleSamples, beatSample, beatAt, swapPoint } from './metro-clock.js';

/** Beats per cycle (spike: one bar of 4/4). */
const BEATS = 4;
/** Minimum delay (s) between rendering a new cycle and swapping it in. */
const LEAD = 0.06;
/** Tempo bounds (beats per minute). */
const MIN = 1;
const MAX = 400;
/** The WAV output repeats the cycle to last at least this long (s). */
const WAV_SECONDS = 10;

/**
 * Output route.
 * @typedef {'direct'|'stream'|'wav'} Output
 */

let tempo = 120;
/** @type {Output} */
let output = 'direct';
let running = false;
/** Render generation: a render whose generation is stale is dropped. */
let gen = 0;
/** @type {AudioBufferSourceNode|null} */
let src = null;
/** Every source not yet ended (a swap leaves the old one scheduled to stop). */
const live = new Set();
/** @type {module:metro-clock~Timeline|null} */
let tl = null;
/** Audio time of the last scheduled swap (a new swap may not come before it). */
let lastSwap = -Infinity;
/** Audio time at which the first beat sounds. */
let startAt = 0;
/** @type {HTMLAudioElement|null} */
let el = null;
/** @type {MediaStreamAudioDestinationNode|null} */
let msDest = null;
let wavUrl = '';
/** Duration (s) of one cycle inside the WAV file. */
let wavCycle = 0;

/**
 * Measurements shown by the spike panel.
 * @typedef {Object} Diag
 * @property {number} wall0 `Date.now()` at start (ms).
 * @property {number} audio0 Audio time at start (s).
 * @property {number} renderMs Duration of the last offline render.
 * @property {number} leadMs Delay between the last tempo change and its swap.
 * @property {number} swaps Swaps since start.
 * @property {number} awayWallMs Last time hidden: wall-clock duration.
 * @property {number} awayAudioMs Last time hidden: how far the audio clock moved.
 * @property {string} lastError Last playback error, if any.
 */

/** @type {Diag} */
const diag = {
  wall0: 0,
  audio0: 0,
  renderMs: 0,
  leadMs: 0,
  swaps: 0,
  awayWallMs: 0,
  awayAudioMs: 0,
  lastError: '',
};
let hiddenWall = 0;
let hiddenAudio = 0;

/**
 * Callbacks given by the interface.
 * @typedef {Object} EngineHooks
 * @property {function()} onChange State changed (running, tempo, output).
 * @property {function(number): {title: string, artist: string}} meta
 *   Media Session texts for a tempo.
 */

/** @type {EngineHooks} */
let hooks = { onChange: () => {}, meta: () => ({ title: '', artist: '' }) };

/**
 * Connects the engine to the interface: callbacks, Media Session handlers,
 * visibility tracking. Call once.
 * @param {EngineHooks} h
 */
export function init(h) {
  hooks = h;
  document.addEventListener('visibilitychange', trackVisibility);
  const ms = navigator.mediaSession;
  if (!ms) return;
  const on = (action, fn) => {
    try {
      ms.setActionHandler(action, fn);
    } catch (e) {
      /* action not supported */
    }
  };
  on('play', () => start());
  on('pause', () => stop());
  on('stop', () => stop());
  on('previoustrack', () => setTempo(tempo - 5));
  on('nexttrack', () => setTempo(tempo + 5));
}

/** Records how far the audio clock moved while the page was hidden. */
function trackVisibility() {
  const c = running ? getAudioContext() : null;
  if (!c) return;
  if (document.hidden) {
    hiddenWall = Date.now();
    hiddenAudio = c.currentTime;
  } else if (hiddenWall) {
    diag.awayWallMs = Date.now() - hiddenWall;
    diag.awayAudioMs = (c.currentTime - hiddenAudio) * 1000;
    hiddenWall = 0;
  }
}

/** @returns {boolean} */
export function isRunning() {
  return running;
}

/** @returns {number} Current tempo (BPM). */
export function getTempo() {
  return tempo;
}

/** @returns {Output} */
export function getOutput() {
  return output;
}

/**
 * Renders one cycle with an offline context: one click per beat, the first
 * one accented.
 * @param {number} sr Sample rate (Hz), the one of the live context.
 * @param {number} bpm
 * @returns {Promise.<AudioBuffer>}
 */
async function renderCycle(sr, bpm) {
  const len = cycleSamples(bpm, BEATS, sr);
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new C(1, len, sr);
  for (let i = 0; i < BEATS; i++) click(oc, beatSample(i, len, BEATS) / sr, i === 0);
  const t0 = performance.now();
  const buf = await oc.startRendering();
  diag.renderMs = performance.now() - t0;
  return buf;
}

/**
 * Synthesized click (same timbre as the practice metronome of
 * {@link module:audio|audio}), rendered into an offline context. The gain
 * starts at 0, so a click cut by a swap never pops.
 * @param {BaseAudioContext} c
 * @param {number} at Time (s) in the cycle.
 * @param {boolean} accent
 */
function click(c, at, accent) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(accent ? 2600 : 1900, at);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(accent ? 0.55 : 0.3, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
  g.gain.setValueAtTime(0, at + 0.046);
  o.connect(g);
  g.connect(c.destination);
  o.start(at);
  o.stop(at + 0.05);
}

/**
 * The `<audio>` element of the `stream` and `wav` outputs.
 * @returns {HTMLAudioElement}
 */
function mediaEl() {
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    el.addEventListener('error', () => (diag.lastError = 'media error ' + (el.error ? el.error.code : '')));
  }
  return el;
}

/**
 * Plays a media element, keeping the error for the panel.
 * @param {HTMLAudioElement} m
 */
function play(m) {
  const p = m.play();
  if (p) p.catch((e) => (diag.lastError = String(e && e.name)));
}

/**
 * Starts the metronome (call from a tap: browsers need a user gesture).
 */
export function start() {
  if (running) return;
  const c = getAudioContext();
  if (!c) return;
  running = true;
  diag.swaps = 0;
  diag.lastError = '';
  diag.wall0 = Date.now();
  diag.audio0 = c.currentTime;
  if (output === 'stream') {
    if (!msDest) msDest = c.createMediaStreamDestination();
    const m = mediaEl();
    m.removeAttribute('src');
    m.loop = false;
    m.srcObject = msDest.stream;
    play(m); // still inside the tap: the stream is silent until the loop starts
  }
  updateSession();
  hooks.onChange();
  apply();
}

/**
 * Stops the metronome and every scheduled source.
 */
export function stop() {
  if (!running) return;
  running = false;
  gen++;
  live.forEach((s) => {
    try {
      s.stop();
    } catch (e) {
      /* never started */
    }
    s.disconnect();
  });
  live.clear();
  src = null;
  tl = null;
  lastSwap = -Infinity;
  if (el) el.pause();
  updateSession();
  hooks.onChange();
}

/**
 * Changes the tempo; while playing, the new cycle takes over right away.
 * @param {number} bpm
 */
export function setTempo(bpm) {
  const next = Math.min(MAX, Math.max(MIN, Math.round(bpm)));
  if (next === tempo) return;
  tempo = next;
  updateSession();
  hooks.onChange();
  if (running) apply();
}

/**
 * Changes the output route (restarts the metronome if it is playing).
 * @param {Output} o
 */
export function setOutput(o) {
  const was = running;
  stop();
  output = o;
  if (el) {
    el.srcObject = null;
    el.removeAttribute('src');
  }
  hooks.onChange();
  if (was) start();
}

/**
 * Renders the cycle at the current tempo, then starts it, swaps it in, or
 * hands it to the WAV output. A render overtaken by a newer one is dropped.
 */
async function apply() {
  const c = getAudioContext();
  if (!c) return;
  const g = ++gen;
  const asked = c.currentTime;
  const buf = await renderCycle(c.sampleRate, tempo);
  if (g !== gen || !running) return;
  if (output === 'wav') playWav(buf);
  else if (!src) startLoop(c, buf);
  else swapLoop(c, buf, asked);
}

/**
 * A looping source on the current output.
 * @param {AudioContext} c
 * @param {AudioBuffer} buf
 * @returns {AudioBufferSourceNode}
 */
function source(c, buf) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.connect(output === 'stream' ? msDest : c.destination);
  live.add(s);
  s.onended = () => {
    s.disconnect();
    live.delete(s);
  };
  return s;
}

/**
 * First start of the loop, a little ahead so the first click is whole.
 * @param {AudioContext} c
 * @param {AudioBuffer} buf
 */
function startLoop(c, buf) {
  const at = c.currentTime + 0.1;
  src = source(c, buf);
  src.start(at);
  startAt = at;
  lastSwap = at;
  tl = { t0: at, len: buf.length, n: BEATS, sr: c.sampleRate };
}

/**
 * Swaps a new cycle in as soon as possible: same audio time for the old
 * source's stop and the new source's start.
 * @param {AudioContext} c
 * @param {AudioBuffer} buf
 * @param {number} asked Audio time of the tempo change (for the panel).
 */
function swapLoop(c, buf, asked) {
  const sp = swapPoint(tl, c.currentTime, LEAD, buf.length, lastSwap);
  const next = source(c, buf);
  next.start(sp.at, sp.offset);
  src.stop(sp.at);
  src = next;
  tl = sp.timeline;
  lastSwap = sp.at;
  diag.swaps++;
  diag.leadMs = (sp.at - asked) * 1000;
}

/**
 * WAV output: encodes the cycle (repeated) and plays it in a loop, keeping
 * the position within the cycle when the tempo changes.
 * @param {AudioBuffer} buf
 */
function playWav(buf) {
  const m = mediaEl();
  const phase = wavCycle && !m.paused ? (m.currentTime % wavCycle) / wavCycle : 0;
  const reps = Math.max(1, Math.ceil(WAV_SECONDS / buf.duration));
  const url = URL.createObjectURL(wavBlob(buf, reps));
  m.srcObject = null;
  m.loop = true;
  m.src = url;
  m.currentTime = phase * buf.duration;
  if (wavUrl) URL.revokeObjectURL(wavUrl);
  wavUrl = url;
  wavCycle = buf.duration;
  diag.swaps++;
  play(m);
}

/**
 * Encodes a mono buffer, repeated `reps` times, as a 16-bit PCM WAV file.
 * @param {AudioBuffer} buf
 * @param {number} reps
 * @returns {Blob}
 */
function wavBlob(buf, reps) {
  const data = buf.getChannelData(0);
  const n = data.length * reps;
  const sr = buf.sampleRate;
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true); // bytes per second
  v.setUint16(32, 2, true); // bytes per frame
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, data[i % data.length]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([v.buffer], { type: 'audio/wav' });
}

/**
 * Beat of the cycle sounding now, for the visuals (read from the audio
 * clock, or from the media element for the WAV output).
 * @returns {number} 0 to 3, or -1 when nothing sounds yet.
 */
export function currentBeat() {
  if (!running) return -1;
  if (output === 'wav') {
    if (!el || el.paused || !wavCycle) return -1;
    return Math.floor(((el.currentTime % wavCycle) / wavCycle) * BEATS) % BEATS;
  }
  const c = getAudioContext();
  if (!c || !tl) return -1;
  const now = c.currentTime - (c.outputLatency || 0);
  if (now < startAt) return -1;
  return ((beatAt(tl, now) % BEATS) + BEATS) % BEATS;
}

/**
 * Measurements plus live values, for the spike panel.
 * @typedef {Object} DiagSnapshot
 * @property {Diag} diag Stored measurements.
 * @property {number} runMs Wall time since start (ms).
 * @property {number} audioMs Audio time since start (ms).
 * @property {string} state Audio context state.
 */

/**
 * Snapshot of the measurements for the spike panel.
 * @returns {DiagSnapshot}
 */
export function getDiag() {
  const c = running ? getAudioContext() : null;
  return {
    diag: { ...diag },
    runMs: running ? Date.now() - diag.wall0 : 0,
    audioMs: running && c ? (c.currentTime - diag.audio0) * 1000 : 0,
    state: c ? c.state : '-',
  };
}

/** Media Session: lock-screen texts and playing state. */
function updateSession() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  if (window.MediaMetadata) {
    const m = hooks.meta(tempo);
    ms.metadata = new MediaMetadata({
      title: m.title,
      artist: m.artist,
      artwork: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
    });
  }
  ms.playbackState = running ? 'playing' : 'paused';
}
