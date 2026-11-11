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
 * │  █  ▆  ▆  ▆        one bar per pulse     │  tap: on / off; slide: level 0 to 4
 * │  1  2  3  4        (small bars: subdivisions)
 * │              ♩ = 120                   │  drag up/down on the number
 * │   [−5] [−1]   Allegro    [+1] [+5]     │  long press repeats
 * │               [ TAP ]                  │
 * │ [4 ▾] / [4 ▾]          [shortcuts ▾]   │  any time signature, 1 to 32 over 2 to 16
 * │ groups, subdivision, swing, sound, jazz modes, options │
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
  NUM_MAX,
  DENS,
  LEVEL_MAX,
  SHORTCUTS,
  sanitizeMetro,
  withMeter,
  withGroups,
  withSubdiv,
  withUnit,
  withShortcut,
  cutOrJoin,
  grouped,
  groupHeads,
  groupChoices,
  subCount,
  pulseLevels,
  subdivsFor,
  canTwoFour,
  canCountGroups,
  swingApplies,
  unitGlyph,
  meterLabel,
  shortcutIndex,
  clampTempo,
  tempoMarking,
  tapTempo,
  toggleLevel,
  audible,
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
/** Bar drag: pixels per level. */
const LEVEL_PX = 14;
/** Above this many pulses, the mini-bar shows a counter instead of dots. */
const MINI_DOTS_MAX = 12;

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
  if (mt) mt.textContent = `${unitGlyph(s)} ${v}`;
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
 * One level bar: a button whose fill shows the level (0 to 4). A muted bar
 * keeps a faint fill at the level it will come back to.
 * @param {string} attr `data-mbar="3"` or `data-msubbar="7"`.
 * @param {number} v Stored level (-4 to 4).
 * @param {string} label Accessible name.
 * @param {string} [cls='']
 * @returns {string}
 */
function barHtml(attr, v, label, cls = '') {
  const on = v > 0;
  return `<button type="button" class="mbar${cls}${on ? '' : ' off'}" ${attr} style="--lv:${Math.abs(v) / LEVEL_MAX}" aria-label="${esc(label)}"><span class="fill"></span></button>`;
}

/**
 * The pulses of the bar, as level bars (they are also the lights). In /8 and
 * /16, a thin button between two bars splits or joins a group. In /2 and /4,
 * the subdivision clicks of each pulse have their own small bars.
 * @returns {string}
 */
function barsHtml() {
  const levels = s.jazz === 'off' ? s.levels : pulseLevels(s, 0);
  const heads = new Set(groupHeads(s.groups));
  const sc = subCount(s.subdiv);
  let html = '';
  for (let i = 0; i < s.num; i++) {
    if (grouped(s.den) && i > 0)
      html += `<button type="button" class="mgap${heads.has(i) ? ' cut' : ''}" data-mcut="${i}" aria-label="${esc(t('metro.cutN', { n: i + 1 }))}" aria-pressed="${heads.has(i)}"></button>`;
    let subs = '';
    for (let k = 0; k < sc; k++) {
      const j = i * sc + k;
      const lv = s.subLevels[j];
      subs += barHtml(
        `data-msubbar="${j}"`,
        lv,
        t('metro.subN', { k: k + 1, n: i + 1, l: audible(lv) }),
        ' small',
      );
    }
    html += `<div class="mcol${heads.has(i) ? ' head' : ''}">${barHtml(`data-mbar="${i}"`, levels[i], t('metro.pulseN', { n: i + 1, l: audible(levels[i]) }))}<span class="mnum">${i + 1}</span>${sc ? `<div class="msubs">${subs}</div>` : ''}</div>`;
  }
  // Same width for every bar, so that long bars wrap into even rows.
  const w = s.num <= 4 ? 52 : s.num <= 8 ? 36 : s.num <= 12 ? 24 : 20;
  return `<div class="mbars${grouped(s.den) ? ' grouped' : ''}${s.num > 16 ? ' dense' : ''}${s.jazz === 'off' ? '' : ' jazz'}" id="mBeats" style="--cw:${w}px">${html}</div>
<p class="mhint mbars-hint">${esc(t(grouped(s.den) ? 'metro.levelHintGroups' : 'metro.levelHint'))}</p>`;
}

/**
 * Time signature section: top and bottom numbers, shortcuts, groups, what the
 * tempo counts.
 * @returns {string}
 */
function meterHtml() {
  const nums = Array.from(
    { length: NUM_MAX },
    (_, i) => `<option value="${i + 1}"${i + 1 === s.num ? ' selected' : ''}>${i + 1}</option>`,
  ).join('');
  const dens = DENS.map((d) => `<option value="${d}"${d === s.den ? ' selected' : ''}>${d}</option>`).join(
    '',
  );
  const cur = shortcutIndex(s);
  const shortcuts =
    `<option value=""${cur < 0 ? ' selected' : ''}>${esc(t('metro.custom'))}</option>` +
    SHORTCUTS.map((x, k) => {
      const label = meterLabel({ ...s, num: x.num, den: x.den, groups: x.groups });
      return `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('');
  let html = `<div class="mrow"><span class="mlbl">${esc(t('metro.meter'))}</span><div class="mmeter"><select data-k="num" aria-label="${esc(t('metro.num'))}">${nums}</select><span class="mslash">/</span><select data-k="den" aria-label="${esc(t('metro.den'))}">${dens}</select><span class="grow"></span><select data-k="shortcut" aria-label="${esc(t('metro.shortcuts'))}">${shortcuts}</select></div></div>`;
  if (grouped(s.den)) {
    const key = s.groups.join('+');
    const choices = groupChoices(s.num, s.den).map((g) => g.join('+'));
    if (!choices.includes(key)) choices.unshift(key);
    html += `<label class="mrow"><span class="mlbl">${esc(t('metro.groups'))}</span><select data-k="groups">${choices
      .map((c) => `<option value="${c}"${c === key ? ' selected' : ''}>${c}</option>`)
      .join('')}</select></label>`;
  }
  if (canCountGroups(s)) {
    const radio = (u, glyph) =>
      `<label class="mcheck"><input type="radio" name="mUnit" data-k="unit" value="${u}"${s.unit === u ? ' checked' : ''}> <span class="mglyph">${glyph}</span> ${esc(t(u === 'group' ? 'metro.unitGroup' : 'metro.unitPulse'))}</label>`;
    html += `<div class="mrow"><span class="mlbl">${esc(t('metro.tempoCounts'))}</span><div class="mrow-sub">${radio('pulse', unitGlyph({ ...s, unit: 'pulse' }))}${radio('group', unitGlyph({ ...s, unit: 'group' }))}</div></div>`;
  }
  return html;
}

/**
 * Settings view of the sheet.
 * @returns {string}
 */
function mainHtml() {
  const on = engine.isRunning();
  const step = (n) =>
    `<button type="button" class="btn mstep" data-step="${n}" aria-label="${esc(t('metro.stepN', { n: n > 0 ? '+' + n : String(n) }))}">${n > 0 ? '+' + n : '−' + -n}</button>`;
  const subdivs = subdivsFor(s.den);
  const subs = subdivs
    .map(
      (k) =>
        `<button type="button" data-msub="${esc(k)}" aria-pressed="${k === s.subdiv}" aria-label="${esc(t('metro.subs.' + SUB_KEYS[k]))}">${esc(t('metro.subGlyphs.' + SUB_KEYS[k]))}</button>`,
    )
    .join('');
  const sounds = SOUNDS.map(
    (k) => `<option value="${k}"${k === s.sound ? ' selected' : ''}>${esc(t('metro.sounds.' + k))}</option>`,
  ).join('');
  const swingOk = swingApplies(s);
  const onceOpts = Array.from(
    { length: s.num },
    (_, i) => `<option value="${i}"${i === s.onceBeat ? ' selected' : ''}>${i + 1}</option>`,
  ).join('');
  const opt = (k) =>
    `<button type="button" class="chip" data-mopt="${k}" aria-pressed="${!!s[k]}">${esc(t('metro.' + k))}</button>`;
  return `<div class="metro-wrap">
<header class="metro-head"><button type="button" class="btn icon-btn" data-m="close" aria-label="${esc(t('metro.collapse'))}">&#x2304;</button><h2>${esc(t('metro.title'))}</h2><span class="grow"></span><button type="button" class="btn" data-m="presets">&#9733; ${esc(t('metro.presets'))}</button></header>
${barsHtml()}
<div class="metro-tempo" id="mTempo" aria-label="${esc(t('metro.tempoDrag'))}"><span class="mt-unit">${unitGlyph(s)} =</span> <span id="mTempoVal" class="mt-val">${s.tempo}</span><div id="mMark" class="mt-mark">${esc(tempoMarking(s.tempo))}</div></div>
<div class="metro-steps">${step(-5)}${step(-1)}${step(1)}${step(5)}</div>
<button type="button" class="metro-tap" data-m="tap">${esc(t('metro.tap'))}</button>
<div class="metro-rows">
${meterHtml()}
${subdivs.length > 1 ? `<div class="mrow"><span class="mlbl">${esc(t('metro.subdiv'))}</span><div class="msub">${subs}</div></div>` : ''}
${
  swingOk
    ? `<label class="mrow"><span class="mlbl">${esc(t('metro.swing'))} <output id="mSwingVal">${esc(swingLabel(s.swing))}</output></span><input type="range" min="${SWING_MIN}" max="${SWING_MAX}" step="1" data-k="swing" value="${s.swing}"></label>`
    : ''
}
<label class="mrow"><span class="mlbl">${esc(t('metro.sound'))}</span><select data-k="sound">${sounds}</select></label>
<div class="mrow"><span class="mlbl">${esc(t('metro.jazz'))}</span><div class="mchips"><button type="button" class="chip" data-mjazz="24" aria-pressed="${s.jazz === '24'}"${canTwoFour(s) ? '' : ' disabled'}>${esc(t('metro.jazz24'))}</button><button type="button" class="chip" data-mjazz="once" aria-pressed="${s.jazz === 'once'}">${esc(t('metro.jazzOnce'))}</button></div></div>
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
 * @param {Object} p Settings (or the stored part of them).
 * @returns {string}
 */
function presetSummary(p) {
  const jazz =
    p.jazz === '24' ? ' · ' + t('metro.jazz24') : p.jazz === 'once' ? ' · ' + t('metro.jazzOnce') : '';
  const ps = sanitizeMetro(p);
  return `${unitGlyph(ps)} ${ps.tempo} · ${meterLabel(ps)}${jazz}`;
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
    const lv = pulseLevels(s, 0);
    const beats =
      s.num <= MINI_DOTS_MAX
        ? `<span class="mm-beats" id="mmBeats">${lv.map((v) => `<span class="mm-dot lv${v}"></span>`).join('')}</span>`
        : `<span class="mm-count" id="mmCount">1/${s.num}</span>`;
    mini.innerHTML = `<div class="mm-in">${beats}<button type="button" class="btn icon-btn" data-m="minus" aria-label="${esc(t('metro.stepN', { n: '-1' }))}">&minus;</button><span class="mm-tempo">${unitGlyph(s)} ${s.tempo}</span><button type="button" class="btn icon-btn" data-m="plus" aria-label="${esc(t('metro.stepN', { n: '+1' }))}">+</button><span class="mm-meter">${esc(meterLabel(s))}</span><span class="grow"></span><button type="button" class="btn icon-btn" data-m="stop" aria-label="${esc(t('metro.stop'))}">&#9632;</button><button type="button" class="btn icon-btn" data-m="open" aria-label="${esc(t('metro.expand'))}">&#x2303;</button></div>`;
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
  const silent = !!p && p.bar === 1 && cycleBars(s) === 2;
  for (const [box, sel] of [
    [sheet.querySelector('#mBeats'), '[data-mbar]'],
    [mini.querySelector('#mmBeats'), '.mm-dot'],
  ]) {
    if (!box) continue;
    box.querySelectorAll(sel).forEach((el, i) => el.classList.toggle('on', !!p && i === p.beat));
    box.classList.toggle('silent-bar', silent);
  }
  const count = mini.querySelector('#mmCount');
  if (count && p) count.textContent = `${p.beat + 1}/${s.num}`;
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
      if (s.vibrate && navigator.vibrate) navigator.vibrate(p.level === LEVEL_MAX ? 45 : 25);
      if (s.flash) {
        flashEl.classList.remove('go', 'strong');
        void flashEl.offsetWidth; // restart the animation
        flashEl.classList.add('go');
        if (p.level === LEVEL_MAX) flashEl.classList.add('strong');
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
 * Pulse levels to edit: the stored ones, or the pattern of the jazz mode
 * (which is then turned off: its pattern becomes the starting point; its
 * silent pulses come back at 3).
 * @returns {Array.<number>}
 */
function editableLevels() {
  if (s.jazz === 'off') return s.levels.slice();
  return pulseLevels(s, 0).map((v) => (v > 0 ? v : -3));
}

/**
 * Sets the level of a pulse or subdivision bar.
 * @param {'levels'|'subLevels'} field
 * @param {number} i
 * @param {function(number): number} fn New level from the current one.
 * @returns {Object} Patch for {@link update}.
 */
function levelPatch(field, i, fn) {
  const arr = field === 'levels' ? editableLevels() : s.subLevels.slice();
  arr[i] = fn(arr[i]);
  return field === 'levels' ? { levels: arr, jazz: 'off' } : { subLevels: arr };
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
  if (d.mbar !== undefined || d.msubbar !== undefined) {
    if (e.detail === 0) toggleBar(el); // keyboard; touch goes through pointerdown
    return;
  }
  if (d.mcut) return replace(withGroups(s, cutOrJoin(s.groups, Number(d.mcut))));
  if (d.msub) return replace(withSubdiv(s, d.msub));
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
 * Replaces the settings with derived ones, then saves and redraws.
 * @param {module:metronome~MetroSettings} next
 */
function replace(next) {
  s = next;
  save();
  render();
}

/**
 * Switches a bar on or off (it keeps its level).
 * @param {HTMLElement} bar
 */
function toggleBar(bar) {
  const pulse = bar.dataset.mbar !== undefined;
  const i = Number(pulse ? bar.dataset.mbar : bar.dataset.msubbar);
  update(levelPatch(pulse ? 'levels' : 'subLevels', i, toggleLevel));
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
  if (k === 'num') return replace(withMeter(s, Number(el.value), s.den));
  if (k === 'den') return replace(withMeter(s, s.num, Number(el.value)));
  if (k === 'shortcut') return el.value !== '' && replace(withShortcut(s, Number(el.value)));
  if (k === 'groups') return replace(withGroups(s, el.value.split('+').map(Number)));
  if (k === 'unit') return replace(withUnit(s, /** @type {'pulse'|'group'} */ (el.value)));
  if (k === 'swing') save();
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
  const bar = /** @type {HTMLElement} */ (tgt.closest('[data-mbar], [data-msubbar]'));
  if (bar) return dragBar(bar, e);
  const zone = /** @type {HTMLElement} */ (tgt.closest('#mTempo'));
  if (zone) dragTempo(zone, e);
}

/**
 * Bar gesture: a tap switches the bar on or off; sliding up or down sets its
 * level, snapped to the steps 0 to 4 ({@link LEVEL_PX} px per step).
 * @param {HTMLElement} bar
 * @param {PointerEvent} e
 */
function dragBar(bar, e) {
  const pulse = bar.dataset.mbar !== undefined;
  const field = pulse ? 'levels' : 'subLevels';
  const i = Number(pulse ? bar.dataset.mbar : bar.dataset.msubbar);
  const y0 = e.clientY;
  const start = audible(pulse ? editableLevels()[i] : s.subLevels[i]);
  let moved = false;
  bar.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dy = y0 - ev.clientY;
    if (!moved && Math.abs(dy) < 6) return;
    moved = true;
    const lv = Math.max(0, Math.min(LEVEL_MAX, start + Math.round(dy / LEVEL_PX)));
    const patch = levelPatch(field, i, () => lv);
    s = sanitizeMetro({ ...s, ...patch });
    bar.style.setProperty('--lv', String(lv / LEVEL_MAX));
    bar.classList.toggle('off', lv === 0);
    scheduleConfigure();
  };
  const end = () => {
    bar.removeEventListener('pointermove', move);
    bar.removeEventListener('pointerup', end);
    bar.removeEventListener('pointercancel', end);
    if (moved) {
      save();
      render();
    } else toggleBar(bar);
  };
  bar.addEventListener('pointermove', move);
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
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
  meta: () => ({ title: t('metro.title'), artist: `${s.tempo} BPM · ${meterLabel(s)}` }),
  nudge: (d) => setTempo(s.tempo + d),
});
engine.configure(s);
