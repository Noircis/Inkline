/**
 * @module metro-engine
 * @description
 * **Metronome audio engine** (2.11). Browser glue (Web Audio, Media Session);
 * what to play is computed by {@link module:metronome|metronome}, the timing
 * math lives in {@link module:metro-clock|metro-clock}.
 *
 * ## Why a pre-rendered loop
 *
 * Android throttles JavaScript timers in the background, so a `setTimeout`
 * lookahead scheduler stalls once the screen is locked. Here one cycle (one
 * or two bars) is rendered with an `OfflineAudioContext` into an
 * `AudioBuffer`, then played by an `AudioBufferSourceNode` with `loop = true`:
 * no JavaScript runs while it plays, the screen can be locked.
 *
 * Any settings change renders a new cycle and swaps it in right away, even
 * mid-beat ({@link module:metro-clock.swapPoint|swapPoint}): the old source
 * stops and the new one starts at the same audio time.
 *
 * Sound tails that run past the end of the cycle are folded back onto its
 * start (the loop is circular), so a click near the loop point is never cut.
 *
 * ## Output
 *
 * The loop plays straight into `AudioContext.destination`. Two other routes
 * were tried on a phone during the 2.10 spike and dropped: a `MediaStream`
 * played by an `<audio>` element (Chrome's jitter buffer adds a variable
 * delay, the clicks come out uneven) and a WAV file in an `<audio loop>`
 * element (Chrome does not loop media gaplessly: a hiccup at every loop point).
 *
 * Only one tempo at a time: starting the metronome stops a staff, chart or
 * practice playback, and starting one of them stops the metronome. The audio
 * context is shared with {@link module:audio|audio}.
 */

import { getAudioContext, stop as stopPlayback, onPlaybackStart } from './audio.js';
import { cycleEvents, METRO_DEFAULTS } from './metronome.js';
import { beatAt, swapPoint } from './metro-clock.js';

/** Minimum delay (s) between rendering a new cycle and swapping it in. */
const LEAD = 0.06;
/** Longest sound tail (s), folded back onto the start of the cycle. */
const TAIL = 0.4;
/** Master gain of the clicks. */
const MASTER = 0.8;

/** @type {module:metronome~MetroSettings} */
let settings = { ...METRO_DEFAULTS };
let running = false;
/** Render generation: a render whose generation is stale is dropped. */
let gen = 0;
/** @type {AudioBufferSourceNode|null} */
let src = null;
/** Every source not yet ended (a swap leaves the old one scheduled to stop). */
const live = new Set();
/** @type {module:metro-clock~Timeline|null} */
let tl = null;
/** Beat starts of the playing cycle (beat, bar, level). */
let marks = [];
/** Audio time of the last scheduled swap (a new swap may not come before it). */
let lastSwap = -Infinity;
/** Audio time at which the first beat sounds. */
let startAt = 0;

/**
 * Callbacks given by the interface.
 * @typedef {Object} EngineHooks
 * @property {function()} onChange Started or stopped.
 * @property {function(): {title: string, artist: string}} meta Media Session texts.
 * @property {function(number)} nudge Tempo change asked from the lock screen (±5).
 */

/** @type {EngineHooks} */
let hooks = { onChange: () => {}, meta: () => ({ title: '', artist: '' }), nudge: () => {} };

/**
 * Connects the engine to the interface: callbacks and Media Session handlers.
 * Call once.
 * @param {EngineHooks} h
 */
export function init(h) {
  hooks = h;
  onPlaybackStart(() => stop());
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
  on('previoustrack', () => hooks.nudge(-5));
  on('nexttrack', () => hooks.nudge(5));
}

/** @returns {boolean} */
export function isRunning() {
  return running;
}

/**
 * Sets the settings to play; while playing, the new cycle takes over right away.
 * @param {module:metronome~MetroSettings} s
 */
export function configure(s) {
  settings = s;
  updateSession();
  if (running) apply();
}

// ---------- Sounds ----------

/**
 * Pitch (Hz) and gain of each sound for each kind of hit.
 * @type {Object.<string, Object.<string, {f: number, g: number}>>}
 */
const VOICES = {
  click: { strong: { f: 2600, g: 0.55 }, normal: { f: 1900, g: 0.32 }, sub: { f: 1400, g: 0.3 } },
  wood: { strong: { f: 1250, g: 0.9 }, normal: { f: 1000, g: 0.6 }, sub: { f: 820, g: 0.55 } },
  cowbell: { strong: { f: 800, g: 0.42 }, normal: { f: 800, g: 0.26 }, sub: { f: 680, g: 0.24 } },
  rim: { strong: { f: 1900, g: 0.9 }, normal: { f: 1700, g: 0.55 }, sub: { f: 1500, g: 0.5 } },
  hat: { strong: { f: 9000, g: 0.75 }, normal: { f: 8000, g: 0.45 }, sub: { f: 7000, g: 0.4 } },
};

/**
 * Gain envelope: silent, very fast attack, exponential decay, silent again.
 * Starting and ending at 0, a hit never pops.
 * @param {GainNode} g
 * @param {number} at
 * @param {number} peak
 * @param {number} decay Seconds to fade out.
 */
function env(g, at, peak, decay) {
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + 0.0015);
  g.gain.exponentialRampToValueAtTime(0.0005, at + decay);
  g.gain.setValueAtTime(0, at + decay + 0.001);
}

/**
 * One oscillator through a gain envelope.
 * @param {BaseAudioContext} c
 * @param {AudioNode} out
 * @param {string} type Oscillator type.
 * @param {number} f
 * @param {number} at
 * @param {number} peak
 * @param {number} decay
 */
function tone(c, out, type, f, at, peak, decay) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = /** @type {OscillatorType} */ (type);
  o.frequency.setValueAtTime(f, at);
  env(g, at, peak, decay);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + decay + 0.01);
}

/**
 * Filtered noise burst (rim and hi-hat).
 * @param {BaseAudioContext} c
 * @param {AudioNode} out
 * @param {AudioBuffer} noise
 * @param {number} f High-pass cutoff (Hz).
 * @param {number} at
 * @param {number} peak
 * @param {number} decay
 */
function noiseHit(c, out, noise, f, at, peak, decay) {
  const s = c.createBufferSource();
  s.buffer = noise;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = f;
  const g = c.createGain();
  env(g, at, peak, decay);
  s.connect(hp).connect(g).connect(out);
  s.start(at);
  s.stop(at + decay + 0.01);
}

/**
 * Plays one hit of the chosen sound into an offline context.
 * @param {BaseAudioContext} c
 * @param {AudioNode} out
 * @param {AudioBuffer} noise
 * @param {string} sound
 * @param {'strong'|'normal'|'sub'} kind
 * @param {number} at
 * @param {number} subVol
 */
function hit(c, out, noise, sound, kind, at, subVol) {
  const v = (VOICES[sound] || VOICES.click)[kind];
  const g = v.g * (kind === 'sub' ? subVol : 1);
  switch (sound) {
    case 'wood':
      tone(c, out, 'sine', v.f, at, g, 0.07);
      tone(c, out, 'sine', v.f * 2.7, at, g * 0.25, 0.025);
      break;
    case 'cowbell':
      tone(c, out, 'square', v.f, at, g * 0.5, 0.28);
      tone(c, out, 'square', v.f * 1.48, at, g * 0.5, 0.2);
      break;
    case 'rim':
      noiseHit(c, out, noise, 1800, at, g * 0.6, 0.03);
      tone(c, out, 'triangle', v.f, at, g * 0.5, 0.03);
      break;
    case 'hat':
      noiseHit(c, out, noise, v.f, at, g, kind === 'strong' ? 0.06 : 0.04);
      break;
    default:
      tone(c, out, 'triangle', v.f, at, g, 0.045);
  }
}

/**
 * White noise buffer for the noise-based sounds.
 * @param {BaseAudioContext} c
 * @returns {AudioBuffer}
 */
function noiseBuffer(c) {
  const b = c.createBuffer(1, Math.round(c.sampleRate * 0.2), c.sampleRate);
  const d = b.getChannelData(0);
  let x = 12345;
  for (let i = 0; i < d.length; i++) {
    // Small deterministic generator: the same noise on every render.
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (x / 0x3fffffff - 1) * 0.8;
  }
  return b;
}

/**
 * Renders one cycle: every hit of {@link module:metronome.cycleEvents|cycleEvents},
 * tails folded back onto the start.
 * @param {number} sr Sample rate (Hz), the one of the live context.
 * @param {module:metronome~MetroSettings} s
 * @returns {Promise.<{buf: AudioBuffer, len: number, marks: Array.<module:metronome~MetroMark>, samples: Array.<number>}>}
 */
async function renderCycle(sr, s) {
  const cyc = cycleEvents(s);
  const len = Math.max(1, Math.round(cyc.duration * sr));
  const extra = Math.round(TAIL * sr);
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new C(1, len + extra, sr);
  const out = oc.createGain();
  out.gain.value = MASTER;
  out.connect(oc.destination);
  const noise = noiseBuffer(oc);
  for (const e of cyc.events) hit(oc, out, noise, s.sound, e.kind, Math.round(e.t * sr) / sr, s.subVol);
  const raw = await oc.startRendering();
  // Fold the tail past the end back onto the start: the loop is circular.
  const d = raw.getChannelData(0);
  const data = new Float32Array(len);
  for (let i = 0; i < d.length; i++) data[i % len] += d[i];
  const buf = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
  buf.copyToChannel(data, 0);
  const samples = cyc.marks.map((m) => Math.round(m.t * sr));
  return { buf, len, marks: cyc.marks, samples };
}

// ---------- Playback ----------

/**
 * Starts the metronome (call from a tap: browsers need a user gesture).
 * Stops any staff, chart or practice playback.
 */
export function start() {
  if (running) return;
  stopPlayback();
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
  marks = [];
  lastSwap = -Infinity;
  updateSession();
  hooks.onChange();
}

/**
 * Renders the cycle with the current settings, then starts it or swaps it in.
 * A render overtaken by a newer one is dropped.
 */
async function apply() {
  const c = getAudioContext();
  if (!c) return;
  const g = ++gen;
  const r = await renderCycle(c.sampleRate, settings);
  if (g !== gen || !running) return;
  if (!src) startLoop(c, r);
  else swapLoop(c, r);
  marks = r.marks;
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
 * @param {{buf: AudioBuffer, len: number, samples: Array.<number>}} r
 */
function startLoop(c, r) {
  const at = c.currentTime + 0.1;
  src = source(c, r.buf);
  src.start(at);
  startAt = at;
  lastSwap = at;
  tl = { t0: at, len: r.len, marks: r.samples, sr: c.sampleRate };
}

/**
 * Swaps a new cycle in as soon as possible: same audio time for the old
 * source's stop and the new source's start.
 * @param {AudioContext} c
 * @param {{buf: AudioBuffer, len: number, samples: Array.<number>}} r
 */
function swapLoop(c, r) {
  const sp = swapPoint(tl, c.currentTime, LEAD, r.len, r.samples, lastSwap);
  const next = source(c, r.buf);
  next.start(sp.at, sp.offset);
  src.stop(sp.at);
  src = next;
  tl = sp.timeline;
  lastSwap = sp.at;
}

/**
 * Beat sounding now, for the lights (read from the audio clock, output
 * latency included).
 * @returns {?{k: number, beat: number, bar: number, level: number}} `k`:
 *   global beat count (changes on every beat); `null` when nothing sounds yet.
 */
export function position() {
  if (!running || !tl || !marks.length) return null;
  const c = getAudioContext();
  if (!c) return null;
  const now = c.currentTime - (c.outputLatency || 0);
  if (now < startAt) return null;
  const k = beatAt(tl, now);
  const n = tl.marks.length;
  const m = marks[((k % n) + n) % n];
  return m ? { k, beat: m.beat, bar: m.bar, level: m.level } : null;
}

/** Media Session: lock-screen texts and playing state. */
function updateSession() {
  const ms = navigator.mediaSession;
  if (!ms) return;
  if (window.MediaMetadata) {
    const m = hooks.meta();
    ms.metadata = new MediaMetadata({
      title: m.title,
      artist: m.artist,
      artwork: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }],
    });
  }
  ms.playbackState = running ? 'playing' : 'paused';
}
