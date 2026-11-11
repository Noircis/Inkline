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
 * Tempo goes down to 1 BPM: one 4/4 bar then lasts 4 minutes, a 46 MB buffer.
 * Fine for the spike; V1 may render one beat at very slow tempos.
 *
 * ## Output
 *
 * The loop plays straight into `AudioContext.destination`. Two other routes
 * were tried on a phone and dropped: a `MediaStream` played by an `<audio>`
 * element (Chrome's jitter buffer adds a variable delay, the clicks come out
 * uneven) and a WAV file in an `<audio loop>` element (Chrome does not loop
 * media gaplessly: a hiccup at every loop point).
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

let tempo = 120;
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

/**
 * Callbacks given by the interface.
 * @typedef {Object} EngineHooks
 * @property {function()} onChange State changed (running, tempo).
 * @property {function(number): {title: string, artist: string}} meta
 *   Media Session texts for a tempo.
 */

/** @type {EngineHooks} */
let hooks = { onChange: () => {}, meta: () => ({ title: '', artist: '' }) };

/**
 * Connects the engine to the interface: callbacks and Media Session handlers.
 * Call once.
 * @param {EngineHooks} h
 */
export function init(h) {
  hooks = h;
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

/** @returns {boolean} */
export function isRunning() {
  return running;
}

/** @returns {number} Current tempo (BPM). */
export function getTempo() {
  return tempo;
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
  return oc.startRendering();
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
 * Starts the metronome (call from a tap: browsers need a user gesture).
 */
export function start() {
  if (running) return;
  const c = getAudioContext();
  if (!c) return;
  running = true;
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
 * Renders the cycle at the current tempo, then starts it or swaps it in. A
 * render overtaken by a newer one is dropped.
 */
async function apply() {
  const c = getAudioContext();
  if (!c) return;
  const g = ++gen;
  const buf = await renderCycle(c.sampleRate, tempo);
  if (g !== gen || !running) return;
  if (!src) startLoop(c, buf);
  else swapLoop(c, buf);
}

/**
 * A looping source, connected to the speakers.
 * @param {AudioContext} c
 * @param {AudioBuffer} buf
 * @returns {AudioBufferSourceNode}
 */
function source(c, buf) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.connect(c.destination);
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
 */
function swapLoop(c, buf) {
  const sp = swapPoint(tl, c.currentTime, LEAD, buf.length, lastSwap);
  const next = source(c, buf);
  next.start(sp.at, sp.offset);
  src.stop(sp.at);
  src = next;
  tl = sp.timeline;
  lastSwap = sp.at;
}

/**
 * Beat of the cycle sounding now, for the visuals (read from the audio clock).
 * @returns {number} 0 to 3, or -1 when nothing sounds yet.
 */
export function currentBeat() {
  if (!running) return -1;
  const c = getAudioContext();
  if (!c || !tl) return -1;
  const now = c.currentTime - (c.outputLatency || 0);
  if (now < startAt) return -1;
  return ((beatAt(tl, now) % BEATS) + BEATS) % BEATS;
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
