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
 * ## Stream of bars (2.14)
 *
 * A tempo ramp or random silences make every bar different: no single cycle
 * can loop. The engine then plans the bars ({@link module:metronome.planBar|planBar}),
 * renders them by chunks of a few seconds and schedules each chunk at its
 * exact audio time, a little ahead (12 s while visible, 80 s once hidden:
 * Chrome may then run timers only once a minute). A change of settings drops
 * what comes after the next bar line and plans again from there.
 *
 * ## Output
 *
 * The loop plays straight into `AudioContext.destination`. Two other routes
 * were tried on a phone during the 2.10 spike and dropped: a `MediaStream`
 * played by an `<audio>` element (Chrome's jitter buffer adds a variable
 * delay, the clicks come out uneven) and a WAV file in an `<audio loop>`
 * element (Chrome does not loop media gaplessly: a hiccup at every loop point).
 *
 * ## Lock screen (2.15)
 *
 * Web Audio alone does not give the phone a media player on the lock screen.
 * While playing, a looping `<audio>` element plays a near-silent file (a blob
 * URL, built once): Chrome then shows the Inkline player, with play/pause and
 * ⏮ ⏭ (tempo −5 / +5). The clicks themselves still come from Web Audio.
 *
 * Only one tempo at a time: starting the metronome stops a staff, chart or
 * practice playback, and starting one of them stops the metronome. The audio
 * context is shared with {@link module:audio|audio}.
 */

import { getAudioContext, stop as stopPlayback, onPlaybackStart } from './audio.js';
import { cycleEvents, chunkEvents, planBar, pulseSeconds, streams, METRO_DEFAULTS } from './metronome.js';
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
/** Polyrhythm hits of the playing cycle (2.15). */
let polys = [];
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
  on('seekbackward', () => hooks.nudge(-5));
  on('seekforward', () => hooks.nudge(5));
  on('nexttrack', () => hooks.nudge(5));
}

/** @returns {boolean} */
export function isRunning() {
  return running;
}

/**
 * Sets the settings to play; while playing, the new cycle takes over right
 * away (a stream of bars: from the next bar line).
 * @param {module:metronome~MetroSettings} s
 * @param {{restart: (boolean|undefined)}} [opt] `restart`: start the session
 *   again (the tempo was changed by hand during a ramp).
 */
export function configure(s, opt = {}) {
  settings = s;
  updateSession();
  if (running) apply(!!opt.restart);
}

// ---------- Sounds ----------

/** Gain of each level (1 to 4); level 4 also uses the brighter "strong" pitch. */
const LEVEL_GAIN = [0, 0.22, 0.4, 0.65, 1];

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
 * Plays one hit of the chosen sound into an offline context. Pulses at
 * level 4 use the "strong" pitch, the others the "normal" one; subdivisions
 * their own, a little lower.
 * @param {BaseAudioContext} c
 * @param {AudioNode} out
 * @param {AudioBuffer} noise
 * @param {string} sound
 * @param {'pulse'|'sub'|'poly'} type A polyrhythm hit sounds like a pulse.
 * @param {number} level 1 to 4.
 * @param {number} at
 */
function hit(c, out, noise, sound, type, level, at) {
  const voice = VOICES[sound] || VOICES.click;
  const kind = type === 'sub' ? 'sub' : level === 4 ? 'strong' : 'normal';
  const v = voice[kind];
  const g = voice.strong.g * LEVEL_GAIN[level] * (type === 'sub' ? 0.85 : 1);
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
 * Renders a list of hits offline.
 * @param {number} sr Sample rate (Hz), the one of the live context.
 * @param {Array.<module:metronome~MetroEvent>} events
 * @param {module:metronome~MetroSettings} s
 * @param {number} length Length of the render (samples), tails included.
 * @returns {Promise.<AudioBuffer>}
 */
function renderEvents(sr, events, s, length) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const oc = new C(1, length, sr);
  const out = oc.createGain();
  out.gain.value = MASTER;
  out.connect(oc.destination);
  const noise = noiseBuffer(oc);
  for (const e of events)
    hit(
      oc,
      out,
      noise,
      e.kind === 'poly' ? s.poly.sound : s.sound,
      e.kind,
      e.level,
      Math.round(e.t * sr) / sr,
    );
  return oc.startRendering();
}

/**
 * Renders one looping cycle: every hit of {@link module:metronome.cycleEvents|cycleEvents},
 * tails folded back onto the start.
 * @param {number} sr
 * @param {module:metronome~MetroSettings} s
 * @returns {Promise.<{buf: AudioBuffer, len: number, marks: Array.<module:metronome~MetroMark>, samples: Array.<number>, polys: Array.<module:metronome~PolyMark>}>}
 */
async function renderCycle(sr, s) {
  const cyc = cycleEvents(s);
  const len = Math.max(1, Math.round(cyc.duration * sr));
  const raw = await renderEvents(sr, cyc.events, s, len + Math.round(TAIL * sr));
  // Fold the tail past the end back onto the start: the loop is circular.
  const d = raw.getChannelData(0);
  const data = new Float32Array(len);
  for (let i = 0; i < d.length; i++) data[i % len] += d[i];
  const buf = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 1 });
  buf.copyToChannel(data, 0);
  const samples = cyc.marks.map((m) => Math.round(m.t * sr));
  return { buf, len, marks: cyc.marks, samples, polys: cyc.polys };
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
  holdLockScreen(true);
  updateSession();
  hooks.onChange();
  apply(false);
}

/** Stops every source, forgets the loop and the stream. */
function teardown() {
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
  polys = [];
  lastSwap = -Infinity;
  if (stream) clearInterval(stream.timer);
  stream = null;
  mode = null;
}

/**
 * Stops the metronome and every scheduled source.
 */
export function stop() {
  if (!running) return;
  running = false;
  gen++;
  teardown();
  holdLockScreen(false);
  updateSession();
  hooks.onChange();
}

/**
 * Plays the current settings: a looping cycle, or a stream of bars (tempo
 * ramp, random or growing silences, see {@link module:metronome.streams|streams}).
 * Switching from one to the other restarts playback.
 * @param {boolean} restart Start the session again (a ramp starts again from the tempo).
 */
async function apply(restart) {
  const c = getAudioContext();
  if (!c) return;
  const g = ++gen;
  const want = streams(settings) ? 'stream' : 'loop';
  if (mode && mode !== want) teardown();
  mode = want;
  if (want === 'stream') {
    if (!stream) startStream(c);
    else replan(c, restart);
    return topUp(g);
  }
  const r = await renderCycle(c.sampleRate, settings);
  if (g !== gen || !running) return;
  if (!src) startLoop(c, r);
  else swapLoop(c, r);
  marks = r.marks;
  polys = r.polys;
}

/**
 * A source, connected to the speakers.
 * @param {AudioContext} c
 * @param {AudioBuffer} buf
 * @param {boolean} [loop=true]
 * @returns {AudioBufferSourceNode}
 */
function source(c, buf, loop = true) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = loop;
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

// ---------- Stream of bars (2.14) ----------

/**
 * Rendered ahead while the page is visible (s): short, so that a change is
 * re-rendered quickly.
 */
const AHEAD_VISIBLE = 12;
/**
 * Rendered ahead once the page is hidden (s). Chrome may then run timers
 * only once a minute: more than a minute must already be scheduled.
 */
const AHEAD_HIDDEN = 80;
/** Length of a rendered chunk (s), at least one bar. */
const CHUNK = 4;
/** Top-up period (ms). */
const TOP_UP = 3000;

/**
 * Stream state.
 * @typedef {Object} Stream
 * @property {number} seed Seed of the random silences of this session.
 * @property {number} nextBar Next bar to plan.
 * @property {number} nextT Audio time where the next chunk starts.
 * @property {number} elapsed Seconds of the session at `nextT`.
 * @property {Array.<{src: AudioBufferSourceNode, t0: number, t1: number}>} chunks Scheduled chunks.
 * @property {Array.<Object>} marks Pulse starts, absolute audio times, with a counter `k`.
 * @property {Array.<Object>} polys Polyrhythm hits, absolute audio times, with a counter `k`.
 * @property {Array.<{t: number, bar: number, elapsed: number}>} bars Bar starts.
 * @property {?number} endAt Audio time of the end (ramp ending with "stop").
 * @property {number} count Pulse counter (for `k`).
 * @property {number} busy Generation of the top-up running.
 * @property {number} timer Top-up interval.
 */

/** @type {?Stream} */
let stream = null;
/** @type {?('loop'|'stream')} */
let mode = null;

/**
 * Starts a stream, a little ahead so the first click is whole.
 * @param {AudioContext} c
 */
function startStream(c) {
  const at = c.currentTime + 0.1;
  startAt = at;
  stream = {
    seed: (Math.random() * 2 ** 31) | 0,
    nextBar: 0,
    nextT: at,
    elapsed: 0,
    chunks: [],
    marks: [],
    polys: [],
    bars: [],
    endAt: null,
    count: 0,
    polyCount: 0,
    busy: -1,
    timer: setInterval(() => topUp(gen), TOP_UP),
  };
}

/**
 * Settings changed while streaming: what is scheduled after the next bar
 * line is dropped, and the stream goes on from there with the new settings.
 * @param {AudioContext} c
 * @param {boolean} restart Start the session again from that bar line.
 */
function replan(c, restart) {
  const limit = c.currentTime + LEAD;
  const next = stream.bars.find((b) => b.t >= limit);
  const cut = next ? next.t : stream.nextT;
  for (const ch of stream.chunks) {
    if (ch.t0 >= cut) ch.src.stop();
    else if (ch.t1 > cut) ch.src.stop(cut);
  }
  stream.chunks = stream.chunks.filter((ch) => ch.t0 < cut);
  stream.marks = stream.marks.filter((m) => m.t < cut);
  stream.polys = stream.polys.filter((m) => m.t < cut);
  stream.bars = stream.bars.filter((b) => b.t < cut);
  stream.nextT = cut;
  stream.nextBar = restart ? 0 : next ? next.bar : stream.nextBar;
  stream.elapsed = restart ? 0 : next ? next.elapsed : stream.elapsed;
  stream.endAt = null;
}

/**
 * Renders and schedules chunks until enough is ahead. A top-up overtaken by
 * a newer generation (settings changed) drops its result.
 * @param {number} g Generation.
 */
async function topUp(g) {
  const c = getAudioContext();
  if (!c || !stream || stream.busy === g) return;
  stream.busy = g;
  const sr = c.sampleRate;
  while (running && g === gen && stream && stream.endAt === null) {
    const ahead = document.hidden ? AHEAD_HIDDEN : AHEAD_VISIBLE;
    if (stream.nextT >= c.currentTime + ahead) break;
    // Plan bars until the chunk is long enough.
    const plans = [];
    const bars = [];
    let dur = 0;
    let bar = stream.nextBar;
    let elapsed = stream.elapsed;
    while (dur < CHUNK && plans.length < 64) {
      const p = planBar(settings, bar, elapsed, stream.seed);
      if (!p) break;
      bars.push({ t: stream.nextT + dur, bar, elapsed });
      const d = settings.num * pulseSeconds(settings, p.tempo);
      plans.push(p);
      dur += d;
      elapsed += d;
      bar++;
    }
    if (!plans.length) {
      endStream(c);
      break;
    }
    const ch = chunkEvents(settings, plans, stream.nextBar);
    const buf = await renderEvents(sr, ch.events, settings, Math.round((ch.duration + TAIL) * sr));
    if (g !== gen || !running || !stream) return;
    const t0 = stream.nextT;
    const node = source(c, buf, false);
    // A late render still lands on the grid: started with the right offset.
    if (t0 >= c.currentTime) node.start(t0);
    else node.start(c.currentTime, c.currentTime - t0);
    stream.chunks.push({ src: node, t0, t1: t0 + ch.duration });
    for (const m of ch.marks) stream.marks.push({ ...m, t: t0 + m.t, k: stream.count++ });
    for (const m of ch.polys) stream.polys.push({ ...m, t: t0 + m.t, k: stream.polyCount++ });
    stream.bars.push(...bars);
    stream.nextT = t0 + ch.duration;
    stream.nextBar = bar;
    stream.elapsed = elapsed;
    prune(c);
  }
  if (stream && stream.busy === g) stream.busy = -1;
}

/**
 * The session is over (ramp ending with "stop"): the metronome stops once the
 * last bar has sounded.
 * @param {AudioContext} c
 */
function endStream(c) {
  stream.endAt = stream.nextT;
  const at = stream.endAt;
  setTimeout(
    () => {
      if (running && stream && stream.endAt === at) stop();
    },
    Math.max(0, (at - c.currentTime) * 1000) + 200,
  );
}

/**
 * Forgets what has already sounded (keeps a little for the lights).
 * @param {AudioContext} c
 */
function prune(c) {
  const old = c.currentTime - 2;
  stream.chunks = stream.chunks.filter((ch) => ch.t1 > old);
  const keep = (arr) => {
    const i = arr.findIndex((x) => x.t > old);
    return i > 1 ? arr.slice(i - 1) : arr;
  };
  stream.marks = keep(stream.marks);
  stream.polys = keep(stream.polys);
  stream.bars = keep(stream.bars);
}

// Hidden page: schedule more ahead right away (timers may slow down).
document.addEventListener('visibilitychange', () => {
  if (running && stream) topUp(gen);
});

/**
 * Last item of a list sorted by time whose time is not after `now`.
 * @param {Array.<{t: number}>} arr
 * @param {number} now
 * @returns {number} Index, -1 if none.
 */
function lastBefore(arr, now) {
  let lo = 0;
  let hi = arr.length - 1;
  if (!arr.length || arr[0].t > now) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid].t <= now) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Pulse sounding now, for the lights (read from the audio clock, output
 * latency included).
 * @returns {?{k: number, beat: number, bar: number, level: number, silent: boolean, tempo: number, poly: ?{k: number, hit: number, silent: boolean}}}
 *   `k`: pulse counter (changes on every pulse); `bar`: bar index (in the
 *   cycle, or since the start of a stream); `poly`: the last polyrhythm hit
 *   (2.15), its own counter `k`; `null` when nothing sounds yet.
 */
export function position() {
  if (!running) return null;
  const c = getAudioContext();
  if (!c) return null;
  const now = c.currentTime - (c.outputLatency || 0);
  if (now < startAt) return null;
  if (mode === 'stream') {
    if (!stream) return null;
    const i = lastBefore(stream.marks, now);
    if (i < 0) return null;
    const m = stream.marks[i];
    const j = lastBefore(stream.polys, now);
    const pm = j < 0 ? null : stream.polys[j];
    const poly = pm ? { k: pm.k, hit: pm.hit, silent: pm.silent } : null;
    return { k: m.k, beat: m.beat, bar: m.bar, level: m.level, silent: m.silent, tempo: m.tempo, poly };
  }
  if (!tl || !marks.length) return null;
  const k = beatAt(tl, now);
  const n = tl.marks.length;
  const m = marks[((k % n) + n) % n];
  return m
    ? { k, beat: m.beat, bar: m.bar, level: m.level, silent: m.silent, tempo: m.tempo, poly: loopPoly(now) }
    : null;
}

/**
 * Last polyrhythm hit of the looping cycle at `now`.
 * @param {number} now
 * @returns {?{k: number, hit: number, silent: boolean}}
 */
function loopPoly(now) {
  if (!polys.length) return null;
  const pos = (now - tl.t0) * tl.sr;
  const pass = Math.floor(pos / tl.len);
  const inCycle = (pos - pass * tl.len) / tl.sr;
  const j = lastBefore(polys, inCycle);
  // Before the first hit of the cycle: the last hit of the previous pass.
  const i = j < 0 ? polys.length - 1 : j;
  const p = polys[i];
  return { k: (j < 0 ? pass - 1 : pass) * polys.length + i, hit: p.hit, silent: p.silent };
}

// ---------- Lock screen (2.15) ----------

/** Looping near-silent `<audio>` that gives the lock screen a player. */
let keeper = null;

/**
 * A 10 s WAV, 8 kHz, 16 bit, mono, at the lowest level above silence (±1):
 * Chrome needs a media longer than 5 s to show its player.
 * @returns {string} Blob URL.
 */
function silentWav() {
  const sr = 8000;
  const n = sr * 10;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, x) => [...x].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i & 1 ? 1 : -1, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * Plays or pauses the near-silent loop. `play()` must come from a tap (or a
 * lock-screen button): {@link start} is always called from one.
 * @param {boolean} on
 */
function holdLockScreen(on) {
  try {
    if (on) {
      if (!keeper) {
        keeper = new Audio(silentWav());
        keeper.loop = true;
        keeper.volume = 0.01;
      }
      keeper.play().catch(() => {});
    } else if (keeper) keeper.pause();
  } catch (e) {
    /* no media element support: the clicks still play */
  }
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
