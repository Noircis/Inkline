/**
 * @module ui/metronome
 * @description
 * **Metronome** interface (2.11), reachable from every screen.
 *
 * - The ♩ button of each screen header ({@link module:ui/common.metroButton|metroButton})
 *   opens a full-height **sheet** over the current screen. It is an overlay,
 *   not a screen: Android's back button closes it and the screen under it is
 *   left as it was ({@link module:ui/nav.openOverlay|openOverlay}).
 * - Collapsed while playing, the metronome becomes a **mini-bar** at the
 *   bottom of every screen (above an open palette): beat lights, tempo − +,
 *   stop, expand. Its height is reserved (`--metro-h`) so it never hides
 *   content.
 *
 * ```
 * ┌ ⌄            Metronome      ★ Presets ┐
 * │    ●     ○     ●     ○                 │  tap a beat: strong → normal → muted
 * │              ♩ = 120                   │  drag up/down on the number
 * │   [−5] [−1]   Allegro    [+1] [+5]     │  long press repeats
 * │               [ TAP ]                  │
 * │ Time signature, subdivision, swing, sound, jazz modes, options │
 * │              [ ▶ Start ]               │
 * ```
 *
 * Settings are remembered (`meta.metro`), as are the presets
 * (`meta.metroPresets`). What to play is computed by
 * {@link module:metronome|metronome}, played by {@link module:metro-engine|metro-engine}.
 *
 * While playing and visible, the lights follow the audio clock; the
 * vibration and flash options fire on audible beats; the "keep the screen on"
 * option holds a Wake Lock.
 */

import { t } from '../i18n.js';
import { esc, uid } from '../util.js';
import { getMeta, setMeta } from '../storage.js';
import {
  METRO_DEFAULTS,
  SOUNDS,
  SWING_MIN,
  SWING_MAX,
  PRESETS_MAX,
  PRESET_NAME_MAX,
  UNIT_GLYPHS,
  METRO_METERS,
  meterOf,
  sanitizeMetro,
  withMeter,
  beatsOf,
  beatUnit,
  beatLevels,
  subdivsFor,
  canTwoFour,
  swingApplies,
  clampTempo,
  tempoMarking,
  tapTempo,
  presetPart,
  applyPreset,
  cleanPresetName,
  cycleBars,
} from '../metronome.js';
import * as engine from '../metro-engine.js';
import { openOverlay, closeOverlay } from './nav.js';
import { confirmTap } from './common.js';

/** Subdivision → dictionary key suffix (keys cannot hold dots). */
const SUB_KEYS = { none: 'none', 8: 's8', 3: 's3', 16: 's16', 8.16: 's816' };

/** Tempo drag: pixels per BPM. */
const DRAG_PX = 6;

/** @type {module:metronome~MetroSettings} */
let s = sanitizeMetro(getMeta().metro || METRO_DEFAULTS);
/** @type {Array.<module:metronome~MetroPreset>} */
let presets = getMeta().metroPresets || [];
/** Sheet view: settings or preset list. */
let view = 'main';
/** Preset being renamed (id). */
let editing = null;
/** Tap tempo series (ms). */
let taps = [];
let sheetOpen = false;
let raf = 0;
let lastK = null;
/** @type {?WakeLockSentinel} */
let wake = null;
let configTimer = 0;

const sheet = document.createElement('section');
sheet.id = 'metroSheet';
sheet.className = 'metro-sheet';
sheet.hidden = true;
sheet.setAttribute('role', 'dialog');
sheet.setAttribute('aria-modal', 'true');
const mini = document.createElement('div');
mini.id = 'metroMini';
mini.className = 'metro-mini';
mini.hidden = true;
const flashEl = document.createElement('div');
flashEl.className = 'metro-flash';
flashEl.setAttribute('aria-hidden', 'true');
document.body.append(sheet, mini, flashEl);

// ---------- Settings ----------

/** Saves the settings and hands them to the engine. */
function save() {
  setMeta({ metro: s });
  engine.configure(s);
}

/**
 * Changes settings, then redraws.
 * @param {Object} patch
 */
function update(patch) {
  s = sanitizeMetro({ ...s, ...patch });
  save();
  render();
}

/**
 * Changes the tempo without redrawing everything (drag, steps, tap): only the
 * numbers change; the engine gets the new tempo at most every 60 ms.
 * @param {number} bpm
 * @param {boolean} [persist=true] Save now (false during a drag).
 */
function setTempo(bpm, persist = true) {
  const v = clampTempo(bpm);
  if (v === s.tempo && !persist) return;
  s = { ...s, tempo: v };
  sheet.querySelectorAll('#mTempoVal').forEach((el) => (el.textContent = String(v)));
  const mark = sheet.querySelector('#mMark');
  if (mark) mark.textContent = tempoMarking(v);
  const mt = mini.querySelector('.mm-tempo');
  if (mt) mt.textContent = `${UNIT_GLYPHS[beatUnit(s.meter)]} ${v}`;
  scheduleConfigure();
  if (persist) setMeta({ metro: s });
}

/** Hands the settings to the engine, at most every 60 ms (drags, sliders). */
function scheduleConfigure() {
  if (configTimer) return;
  configTimer = setTimeout(() => {
    configTimer = 0;
    engine.configure(s);
  }, 60);
}

// ---------- Sheet ----------

/** Opens the sheet over the current screen. */
function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true;
  view = 'main';
  editing = null;
  sheet.hidden = false;
  document.documentElement.classList.add('metro-open');
  openOverlay(hideSheet);
  render();
  sheet.querySelector('.metro-head button')?.focus({ preventScroll: true });
}

/** Hides the sheet (called by the history `popstate`). */
function hideSheet() {
  sheetOpen = false;
  sheet.hidden = true;
  sheet.innerHTML = '';
  document.documentElement.classList.remove('metro-open');
  renderMini();
}

/** Redraws the sheet (current view) and the mini-bar. */
function render() {
  if (sheetOpen) {
    sheet.setAttribute('aria-label', t('metro.title'));
    sheet.innerHTML = view === 'presets' ? presetsHtml() : mainHtml();
    lastK = null;
    paintLights(engine.position());
  }
  renderMini();
}

/**
 * Beat buttons (lights and accents).
 * @returns {string}
 */
function beatsHtml() {
  const levels = beatLevels(s, 0);
  const names = ['metro.muted', 'metro.normal', 'metro.strong'];
  const groups = meterOf(s.meter).groups;
  return levels
    .map(
      (lv, i) =>
        `<button type="button" class="mbeat lv${lv}${groups[i] === 3 && groups.some((g) => g === 2) ? ' long' : ''}" data-mbeat="${i}" aria-label="${esc(t('metro.beatN', { n: i + 1 }) + ', ' + t(names[lv]))}"><span class="dot"></span><span class="num">${i + 1}</span></button>`,
    )
    .join('');
}

/**
 * Settings view of the sheet.
 * @returns {string}
 */
function mainHtml() {
  const on = engine.isRunning();
  const unit = UNIT_GLYPHS[beatUnit(s.meter)];
  const step = (n) =>
    `<button type="button" class="btn mstep" data-step="${n}" aria-label="${esc(t('metro.stepN', { n: n > 0 ? '+' + n : String(n) }))}">${n > 0 ? '+' + n : '−' + -n}</button>`;
  const meters = METRO_METERS.map((m) => {
    const sub = m.kind === 'odd' ? `<small>${m.groups.join('+')}</small>` : '';
    return `<button type="button" class="chip" data-mmeter="${esc(m.key)}" aria-pressed="${m.key === s.meter}">${esc(m.time)}${sub}</button>`;
  }).join('');
  const subs = subdivsFor(s.meter)
    .map(
      (k) =>
        `<button type="button" data-msub="${esc(k)}" aria-pressed="${k === s.subdiv}" aria-label="${esc(t('metro.subs.' + SUB_KEYS[k]))}">${esc(t('metro.subGlyphs.' + SUB_KEYS[k]))}</button>`,
    )
    .join('');
  const sounds = SOUNDS.map(
    (k) => `<option value="${k}"${k === s.sound ? ' selected' : ''}>${esc(t('metro.sounds.' + k))}</option>`,
  ).join('');
  const swingOk = swingApplies(s);
  const n = beatsOf(s.meter);
  const onceOpts = Array.from(
    { length: n },
    (_, i) => `<option value="${i}"${i === s.onceBeat ? ' selected' : ''}>${i + 1}</option>`,
  ).join('');
  const opt = (k) =>
    `<button type="button" class="chip" data-mopt="${k}" aria-pressed="${!!s[k]}">${esc(t('metro.' + k))}</button>`;
  return `<div class="metro-wrap">
<header class="metro-head"><button type="button" class="btn icon-btn" data-m="close" aria-label="${esc(t('metro.collapse'))}">&#x2304;</button><h2>${esc(t('metro.title'))}</h2><span class="grow"></span><button type="button" class="btn" data-m="presets">&#9733; ${esc(t('metro.presets'))}</button></header>
<div class="metro-beats" id="mBeats">${beatsHtml()}</div>
<div class="metro-tempo" id="mTempo" aria-label="${esc(t('metro.tempoDrag'))}"><span class="mt-unit">${unit} =</span> <span id="mTempoVal" class="mt-val">${s.tempo}</span><div id="mMark" class="mt-mark">${esc(tempoMarking(s.tempo))}</div></div>
<div class="metro-steps">${step(-5)}${step(-1)}${step(1)}${step(5)}</div>
<button type="button" class="metro-tap" data-m="tap">${esc(t('metro.tap'))}</button>
<div class="metro-rows">
<div class="mrow"><span class="mlbl">${esc(t('metro.meter'))}</span><div class="mchips">${meters}</div></div>
<div class="mrow"><span class="mlbl">${esc(t('metro.subdiv'))}</span><div class="msub">${subs}</div></div>
<label class="mrow"><span class="mlbl">${esc(t('metro.subVol'))}</span><input type="range" min="0" max="100" step="5" data-k="subVol" value="${Math.round(s.subVol * 100)}"${s.subdiv === 'none' ? ' disabled' : ''}></label>
<label class="mrow"><span class="mlbl">${esc(t('metro.swing'))} <output id="mSwingVal">${esc(swingLabel(s.swing))}</output></span><input type="range" min="${SWING_MIN}" max="${SWING_MAX}" step="1" data-k="swing" value="${s.swing}"${swingOk ? '' : ' disabled'}></label>
${swingOk ? '' : `<p class="mhint">${esc(t('metro.swingHint'))}</p>`}
<label class="mrow"><span class="mlbl">${esc(t('metro.sound'))}</span><select data-k="sound">${sounds}</select></label>
<div class="mrow"><span class="mlbl">${esc(t('metro.jazz'))}</span><div class="mchips"><button type="button" class="chip" data-mjazz="24" aria-pressed="${s.jazz === '24'}"${canTwoFour(s.meter) ? '' : ' disabled'}>${esc(t('metro.jazz24'))}</button><button type="button" class="chip" data-mjazz="once" aria-pressed="${s.jazz === 'once'}">${esc(t('metro.jazzOnce'))}</button></div></div>
${
  s.jazz === 'once'
    ? `<div class="mrow mrow-sub"><label>${esc(t('metro.onceBeat'))} <select data-k="onceBeat">${onceOpts}</select></label><label class="mcheck"><input type="checkbox" data-k="twoBars"${s.twoBars ? ' checked' : ''}> ${esc(t('metro.twoBars'))}</label></div>`
    : ''
}
<div class="mrow"><span class="mlbl">${esc(t('metro.options'))}</span><div class="mchips">${opt('vibrate')}${opt('flash')}${opt('wake')}</div></div>
</div>
<button type="button" class="btn primary metro-play${on ? ' on' : ''}" data-m="play">${on ? '&#9632; ' + esc(t('metro.stop')) : '&#9654; ' + esc(t('metro.start'))}</button>
</div>`;
}

/**
 * Swing value as shown: "straight", "triplet" or a percentage.
 * @param {number} v
 * @returns {string}
 */
function swingLabel(v) {
  if (v <= SWING_MIN) return t('metro.swingStraight');
  if (v === 67) return t('metro.swingTriplet');
  return t('metro.swingValue', { n: v });
}

/**
 * Short description of a preset: tempo, time signature, jazz mode.
 * @param {module:metronome~MetroSettings} p
 * @returns {string}
 */
function presetSummary(p) {
  const jazz =
    p.jazz === '24' ? ' · ' + t('metro.jazz24') : p.jazz === 'once' ? ' · ' + t('metro.jazzOnce') : '';
  return `${UNIT_GLYPHS[beatUnit(p.meter)]} ${p.tempo} · ${meterOf(p.meter).time}${jazz}`;
}

/**
 * Preset view of the sheet.
 * @returns {string}
 */
function presetsHtml() {
  const rows = presets
    .map((p) => {
      if (p.id === editing)
        return `<li class="mpreset"><form class="mp-form" data-rename="${esc(p.id)}"><input type="text" name="name" maxlength="${PRESET_NAME_MAX}" value="${esc(p.name)}" aria-label="${esc(t('metro.presetName'))}" required><button type="submit" class="btn primary">${esc(t('metro.ok'))}</button></form></li>`;
      return `<li class="mpreset"><button type="button" class="mp-load" data-load="${esc(p.id)}"><span>${esc(p.name)}</span><small>${esc(presetSummary(p.s))}</small></button><button type="button" class="btn icon-btn" data-edit="${esc(p.id)}" aria-label="${esc(t('metro.presetRename'))}">&#9998;</button><button type="button" class="btn icon-btn" data-del="${esc(p.id)}" aria-label="${esc(t('metro.presetDelete'))}">&#x2715;</button></li>`;
    })
    .join('');
  const full = presets.length >= PRESETS_MAX;
  return `<div class="metro-wrap">
<header class="metro-head"><button type="button" class="btn ghost" data-m="main">&#8249; ${esc(t('metro.title'))}</button><span class="grow"></span><h2>${esc(t('metro.presets'))}</h2></header>
<form class="mp-form" id="mpSave"><input type="text" name="name" maxlength="${PRESET_NAME_MAX}" placeholder="${esc(t('metro.presetName'))}" aria-label="${esc(t('metro.presetName'))}"${full ? ' disabled' : ''}><button type="submit" class="btn primary"${full ? ' disabled' : ''}>${esc(t('metro.presetSave'))}</button></form>
<p class="mhint">${esc(t('metro.presetCurrent', { s: presetSummary(s) }))}</p>
${rows ? `<ul class="mpresets">${rows}</ul>` : `<p class="mhint">${esc(t('metro.presetEmpty'))}</p>`}
</div>`;
}

/** Saves the preset list. */
function savePresets() {
  setMeta({ metroPresets: presets });
}

// ---------- Mini-bar ----------

/** Shows the mini-bar while playing with the sheet closed; reserves its height. */
function renderMini() {
  const show = engine.isRunning() && !sheetOpen;
  mini.hidden = !show;
  if (show) {
    const dots = beatLevels(s, 0)
      .map((lv) => `<span class="mm-dot lv${lv}"></span>`)
      .join('');
    mini.innerHTML = `<div class="mm-in"><span class="mm-beats" id="mmBeats">${dots}</span><button type="button" class="btn icon-btn" data-m="minus" aria-label="${esc(t('metro.stepN', { n: '-1' }))}">&minus;</button><span class="mm-tempo">${UNIT_GLYPHS[beatUnit(s.meter)]} ${s.tempo}</span><button type="button" class="btn icon-btn" data-m="plus" aria-label="${esc(t('metro.stepN', { n: '+1' }))}">+</button><span class="mm-meter">${esc(meterOf(s.meter).time)}</span><span class="grow"></span><button type="button" class="btn icon-btn" data-m="stop" aria-label="${esc(t('metro.stop'))}">&#9632;</button><button type="button" class="btn icon-btn" data-m="open" aria-label="${esc(t('metro.expand'))}">&#x2303;</button></div>`;
    lastK = null;
  }
  document.documentElement.style.setProperty('--metro-h', show ? mini.offsetHeight + 'px' : '0px');
}

// ---------- Lights, vibration, flash ----------

/**
 * Lights the sounding beat in the sheet and the mini-bar.
 * @param {?{k: number, beat: number, bar: number, level: number}} p
 */
function paintLights(p) {
  for (const box of [sheet.querySelector('#mBeats'), mini.querySelector('#mmBeats')]) {
    if (!box) continue;
    [...box.children].forEach((el, i) => el.classList.toggle('on', !!p && i === p.beat));
    box.classList.toggle('silent-bar', !!p && p.bar === 1 && cycleBars(s) === 2);
  }
}

/** Animation loop: lights, and vibration / flash on each new audible beat. */
function loop() {
  raf = 0;
  if (!engine.isRunning() || document.hidden) return;
  const p = engine.position();
  if (p && p.k !== lastK) {
    const first = lastK === null;
    lastK = p.k;
    paintLights(p);
    if (!first && p.level) {
      if (s.vibrate && navigator.vibrate) navigator.vibrate(p.level === 2 ? 45 : 25);
      if (s.flash) {
        flashEl.classList.remove('go', 'strong');
        void flashEl.offsetWidth; // restart the animation
        flashEl.classList.add('go');
        if (p.level === 2) flashEl.classList.add('strong');
      }
    }
  }
  raf = requestAnimationFrame(loop);
}

/** Starts the light loop if needed. */
function kick() {
  if (!raf && engine.isRunning() && !document.hidden) raf = requestAnimationFrame(loop);
}

/** Holds or releases the screen Wake Lock according to the settings. */
async function syncWake() {
  const want = engine.isRunning() && s.wake && !document.hidden;
  if (want && !wake && navigator.wakeLock) {
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => (wake = null));
    } catch (e) {
      wake = null;
    }
  } else if (!want && wake) {
    wake.release().catch(() => {});
    wake = null;
  }
}

// ---------- Events ----------

/** Starts or stops the metronome. */
function togglePlay() {
  if (engine.isRunning()) engine.stop();
  else {
    engine.configure(s);
    engine.start();
  }
}

/**
 * Cycles the level of a beat: strong → normal → muted → strong. A jazz mode
 * is turned off first (its pattern becomes the starting point).
 * @param {number} i
 */
function cycleBeat(i) {
  const acc = s.jazz === 'off' ? s.accents.slice() : beatLevels(s, 0);
  acc[i] = (acc[i] + 2) % 3;
  update({ accents: acc, jazz: 'off' });
}

/**
 * Taps on the sheet and the mini-bar.
 * @param {MouseEvent} e
 */
function onClick(e) {
  const el = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.step) {
    if (e.detail === 0) setTempo(s.tempo + Number(d.step)); // keyboard; touch goes through pointerdown
    return;
  }
  if (d.m === 'tap') return; // handled on pointerdown (more precise)
  if (d.m === 'close') return closeOverlay();
  if (d.m === 'open') return openSheet();
  if (d.m === 'play' || d.m === 'stop') return togglePlay();
  if (d.m === 'minus') return setTempo(s.tempo - 1);
  if (d.m === 'plus') return setTempo(s.tempo + 1);
  if (d.m === 'presets' || d.m === 'main') {
    view = d.m === 'presets' ? 'presets' : 'main';
    editing = null;
    return render();
  }
  if (d.mbeat !== undefined) return cycleBeat(Number(d.mbeat));
  if (d.mmeter) {
    if (d.mmeter === s.meter) return;
    s = withMeter(s, d.mmeter);
    save();
    return render();
  }
  if (d.msub) return update({ subdiv: d.msub });
  if (d.mjazz) return update({ jazz: s.jazz === d.mjazz ? 'off' : d.mjazz });
  if (d.mopt) {
    update({ [d.mopt]: !s[d.mopt] });
    return syncWake();
  }
  if (d.load) {
    const p = presets.find((x) => x.id === d.load);
    if (p) {
      s = applyPreset(s, p);
      save();
      view = 'main';
      render();
    }
    return;
  }
  if (d.edit) {
    editing = d.edit;
    render();
    /** @type {HTMLInputElement} */ (sheet.querySelector('[data-rename] input'))?.focus();
    return;
  }
  if (d.del)
    confirmTap(/** @type {HTMLButtonElement} */ (el), t('metro.presetDeleteConfirm'), () => {
      presets = presets.filter((x) => x.id !== d.del);
      savePresets();
      render();
    });
}

/**
 * Form submissions: save a preset, rename a preset.
 * @param {SubmitEvent} e
 */
function onSubmit(e) {
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.target);
  const name = cleanPresetName(/** @type {HTMLInputElement} */ (form.elements.namedItem('name')).value);
  if (!name) return;
  if (form.dataset.rename) {
    presets = presets.map((p) => (p.id === form.dataset.rename ? { ...p, name } : p));
    editing = null;
  } else {
    // Same name: the preset is updated instead of duplicated.
    const same = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same) presets = presets.map((p) => (p === same ? { ...p, s: presetPart(s) } : p));
    else if (presets.length < PRESETS_MAX) presets = [...presets, { id: uid(), name, s: presetPart(s) }];
  }
  savePresets();
  render();
}

/**
 * Sliders while moving (no redraw: the finger keeps the slider).
 * @param {Event} e
 */
function onInput(e) {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (el.type !== 'range') return;
  if (el.dataset.k === 'subVol') s = { ...s, subVol: Number(el.value) / 100 };
  if (el.dataset.k === 'swing') {
    s = { ...s, swing: Number(el.value) };
    const out = sheet.querySelector('#mSwingVal');
    if (out) out.textContent = swingLabel(s.swing);
  }
  scheduleConfigure();
}

/**
 * Selects, check box, end of a slider move: saved.
 * @param {Event} e
 */
function onChange(e) {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const k = el.dataset.k;
  if (k === 'sound') return update({ sound: el.value });
  if (k === 'onceBeat') return update({ onceBeat: Number(el.value) });
  if (k === 'twoBars') return update({ twoBars: el.checked });
  if (k === 'subVol' || k === 'swing') save();
}

/** Repeat timer of a held −/+ button. */
let repeat = 0;

/**
 * Pointer down: tap tempo (on the press, more precise than the click), held
 * −/+ buttons (repeat), tempo drag on the big number.
 * @param {PointerEvent} e
 */
function onPointerDown(e) {
  const tgt = /** @type {HTMLElement} */ (e.target);
  const tap = tgt.closest('[data-m="tap"]');
  if (tap) {
    const r = tapTempo(taps, performance.now());
    taps = r.taps;
    tap.classList.remove('hit');
    void (/** @type {HTMLElement} */ (tap).offsetWidth);
    tap.classList.add('hit');
    if (r.bpm) setTempo(r.bpm);
    return;
  }
  const st = /** @type {HTMLElement} */ (tgt.closest('[data-step]'));
  if (st) {
    const d = Number(st.dataset.step);
    setTempo(s.tempo + d);
    const stopRepeat = () => {
      clearTimeout(repeat);
      repeat = 0;
      window.removeEventListener('pointerup', stopRepeat);
      window.removeEventListener('pointercancel', stopRepeat);
    };
    const again = () => {
      setTempo(s.tempo + d);
      repeat = setTimeout(again, 90);
    };
    repeat = setTimeout(again, 450);
    window.addEventListener('pointerup', stopRepeat);
    window.addEventListener('pointercancel', stopRepeat);
    return;
  }
  const zone = /** @type {HTMLElement} */ (tgt.closest('#mTempo'));
  if (zone) dragTempo(zone, e);
}

/**
 * Tempo drag: up = faster, one BPM every {@link DRAG_PX} px.
 * @param {HTMLElement} zone
 * @param {PointerEvent} e
 */
function dragTempo(zone, e) {
  const y0 = e.clientY;
  const t0 = s.tempo;
  zone.setPointerCapture(e.pointerId);
  zone.classList.add('drag');
  const move = (ev) => setTempo(t0 + Math.round((y0 - ev.clientY) / DRAG_PX), false);
  const end = () => {
    zone.classList.remove('drag');
    zone.removeEventListener('pointermove', move);
    zone.removeEventListener('pointerup', end);
    zone.removeEventListener('pointercancel', end);
    setMeta({ metro: s });
  };
  zone.addEventListener('pointermove', move);
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

for (const el of [sheet, mini]) el.addEventListener('click', onClick);
sheet.addEventListener('submit', onSubmit);
sheet.addEventListener('input', onInput);
sheet.addEventListener('change', onChange);
sheet.addEventListener('pointerdown', onPointerDown);

// The ♩ button of every screen header (headers are redrawn often).
document.addEventListener('click', (e) => {
  if (/** @type {HTMLElement} */ (e.target).closest('[data-metro-open]')) openSheet();
});

document.addEventListener('visibilitychange', () => {
  kick();
  syncWake();
});

engine.init({
  onChange: () => {
    render();
    kick();
    syncWake();
  },
  meta: () => ({ title: t('metro.title'), artist: `${s.tempo} BPM · ${meterOf(s.meter).time}` }),
  nudge: (d) => setTempo(s.tempo + d),
});
engine.configure(s);
