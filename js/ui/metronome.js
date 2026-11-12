/**
 * @module ui/metronome
 * @description
 * **Metronome** interface (2.11; pared-down layout 2.13), reachable from
 * every screen.
 *
 * - The ♩ button of each screen header ({@link module:ui/common.metroButton|metroButton})
 *   opens a full-height **sheet** over the current screen. It is an overlay,
 *   not a screen: Android's back button closes it and the screen under it is
 *   left as it was ({@link module:ui/nav.openOverlay|openOverlay}).
 * - The sheet shows only what is used every time; everything else is in
 *   **sub-pages** (time signature, subdivision, sound, jazz, options,
 *   presets), each opened from a row that shows its current value. A
 *   sub-page has its own history entry: Android's back button returns to the
 *   main page.
 * - Collapsed while playing, the metronome becomes a **mini-bar** at the
 *   bottom of every screen (above an open palette): beat lights, tempo − +,
 *   stop, expand. Its height is reserved (`--metro-h`) so it never hides
 *   content.
 *
 * ```
 * ┌ ⌄  Metronome                 ★ ┐
 * │   ▆ ▂ ▂ ▂                      │  bars = lights; tap: on/off, slide: level
 * │  (TAP)     ♩ = 120      [−][+] │  tap the number too; drag it up/down
 * │             Allegro            │  − + : hold for steps of 5
 * │  Time signature   7/8 2+2+3  › │
 * │  Subdivision      none       › │
 * │  Sound            Click      › │
 * │  Jazz             off        › │
 * │  Options                     › │
 * │        [  ▶  Start  ]          │  stuck to the bottom
 * ```
 *
 * TAP is small and outlined, away from the wide filled Start button, so the
 * two are never confused.
 *
 * Settings are remembered (`meta.metro`), as are the presets
 * (`meta.metroPresets`). What to play is computed by
 * {@link module:metronome|metronome}, played by {@link module:metro-engine|metro-engine}.
 *
 * ## Notes and blocks (2.15)
 *
 * - The metronome button of a staff or chart block sets the tempo, time
 *   signature and swing of that block ({@link module:metronome.fromBlock|fromBlock}).
 * - Opened from a note, the main page offers to save the settings in the
 *   note (`note.metro`); opened again from that note later, they are loaded.
 * - Either way a banner says so, with Undo (the settings from before).
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
  GAP_MODES,
  GROW_MINUTES,
  RAMP_ENDS,
  TEMPO_MIN,
  TEMPO_MAX,
  rampBars,
  withPoly,
  polyRatio,
  POLY_N_MIN,
  POLY_N_MAX,
  POLY_BARS_MAX,
  fromBlock,
  sameAsStored,
} from '../metronome.js';
import * as engine from '../metro-engine.js';
import { openOverlay, closeOverlay } from './nav.js';
import { confirmTap } from './common.js';
import { state, curNote, blockById, touch } from './state.js';

/** Subdivision → dictionary key suffix (keys cannot hold dots). */
const SUB_KEYS = { none: 'none', 8: 's8', 3: 's3', 16: 's16', 8.16: 's816' };

/** Sub-pages of the sheet, in the order of the rows. */
const PAGES = ['meter', 'subdiv', 'sound', 'jazz', 'poly', 'gap', 'ramp', 'options'];

/** Tempo drag: pixels per BPM. */
const DRAG_PX = 6;
/** Bar drag: pixels per level. */
const LEVEL_PX = 14;
/** Movement (px) under which a press is a tap, not a drag. */
const SLOP = 6;
/** Above this many pulses, the mini-bar shows a counter instead of dots. */
const MINI_DOTS_MAX = 12;

/** @type {module:metronome~MetroSettings} */
let s = sanitizeMetro(getMeta().metro || METRO_DEFAULTS);
/** @type {Array.<module:metronome~MetroPreset>} */
let presets = getMeta().metroPresets || [];
/** Sheet page: `main`, one of {@link PAGES}, or `presets`. */
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
/**
 * Banner of the main page after settings were loaded from a block or a note:
 * its text and the settings to go back to.
 * @type {?{text: string, prev: module:metronome~MetroSettings}}
 */
let banner = null;
/**
 * Visit of a note (its `state.view` object, new on every navigation) whose
 * settings were already loaded or saved: they are loaded once per visit.
 * @type {?Object}
 */
let loadedFor = null;

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
  replace(sanitizeMetro({ ...s, ...patch }));
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
 * Changes the tempo without redrawing everything (drag, steps, tap): only the
 * numbers change; the engine gets the new tempo at most every 60 ms.
 * @param {number} bpm
 * @param {boolean} [persist=true] Save now (false during a drag).
 */
function setTempo(bpm, persist = true) {
  const v = clampTempo(bpm);
  if (v === s.tempo && !persist) return;
  s = { ...s, tempo: v };
  const val = sheet.querySelector('#mTempoVal');
  if (val) val.textContent = String(v);
  const mark = sheet.querySelector('#mMark');
  if (mark) mark.textContent = tempoMarking(v);
  const mt = mini.querySelector('.mm-tempo');
  if (mt) mt.textContent = `${s.ramp.on ? '\u2934 ' : ''}${unitGlyph(s)} ${v}`;
  const note = sheet.querySelector('.mnote');
  if (note) note.outerHTML = noteHtml(); // saved / to update
  // During a ramp, a tempo set by hand starts the ramp again from there.
  scheduleConfigure(s.ramp.on);
  if (persist) setMeta({ metro: s });
}

/** A change waiting for {@link scheduleConfigure} asks to start the session again. */
let pendingRestart = false;

/**
 * Hands the settings to the engine, at most every 60 ms (drags, sliders).
 * @param {boolean} [restart=false] Start the session again (see {@link module:metro-engine.configure|configure}).
 */
function scheduleConfigure(restart = false) {
  pendingRestart = pendingRestart || restart;
  if (configTimer) return;
  configTimer = setTimeout(() => {
    configTimer = 0;
    engine.configure(s, { restart: pendingRestart });
    pendingRestart = false;
  }, 60);
}

// ---------- Sheet and pages ----------

/**
 * Opens the sheet over the current screen, on its main page.
 * @param {boolean} [fromHeader=false] Opened from the header button: a note's
 *   own settings are loaded (unless already playing).
 */
function openSheet(fromHeader = false) {
  if (sheetOpen) return;
  if (fromHeader) loadNoteSettings();
  sheetOpen = true;
  view = 'main';
  editing = null;
  sheet.hidden = false;
  document.documentElement.classList.add('metro-open');
  openOverlay(hideSheet);
  render();
}

/** Hides the sheet (called by the history `popstate`). */
function hideSheet() {
  sheetOpen = false;
  view = 'main';
  banner = null;
  sheet.hidden = true;
  sheet.innerHTML = '';
  document.documentElement.classList.remove('metro-open');
  renderMini();
}

/**
 * Opens a sub-page, with its own history entry (Android back returns to the
 * main page).
 * @param {string} page
 */
function openPage(page) {
  view = page;
  editing = null;
  openOverlay(() => {
    view = 'main';
    editing = null;
    render();
  });
  render();
  sheet.scrollTo(0, 0);
}

/** Redraws the sheet (current page) and the mini-bar. */
function render() {
  if (sheetOpen) {
    sheet.setAttribute('aria-label', t('metro.title'));
    sheet.innerHTML =
      view === 'main' ? mainHtml() : view === 'presets' ? presetsHtml() : pageHtml(view, PAGE_BODIES[view]());
    lastK = null;
    paintLights(engine.position());
  }
  renderMini();
}

/**
 * A sub-page: back button, title, content.
 * @param {string} page
 * @param {string} body
 * @returns {string}
 */
function pageHtml(page, body) {
  return `<div class="metro-wrap">
<header class="metro-head"><button type="button" class="btn ghost" data-m="back">&#8249; ${esc(t('metro.title'))}</button><span class="grow"></span><h2>${esc(t('metro.page.' + page))}</h2></header>
${body}
</div>`;
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
  return `<button type="button" class="mbar${cls}${v > 0 ? '' : ' off'}" ${attr} style="--lv:${Math.abs(v) / LEVEL_MAX}" aria-label="${esc(label)}"><span class="fill"></span></button>`;
}

/**
 * The pulses of the bar, as level bars (they are also the lights).
 *
 * @param {{cuts: (boolean|undefined), subs: (boolean|undefined)}} [opt]
 *   `cuts`: in /8 and /16, a thin button between two bars splits or joins a
 *   group (time signature page; elsewhere the group limits are only drawn).
 *   `subs`: the subdivision clicks of each pulse get small bars (subdivision page).
 * @returns {string}
 */
function barsHtml(opt = {}) {
  const levels = s.jazz === 'off' ? s.levels : pulseLevels(s);
  const heads = new Set(groupHeads(s.groups));
  const sc = opt.subs ? subCount(s.subdiv) : 0;
  let html = '';
  for (let i = 0; i < s.num; i++) {
    if (grouped(s.den) && i > 0)
      html += opt.cuts
        ? `<button type="button" class="mgap${heads.has(i) ? ' cut' : ''}" data-mcut="${i}" aria-label="${esc(t('metro.cutN', { n: i + 1 }))}" aria-pressed="${heads.has(i)}"></button>`
        : `<span class="mgap${heads.has(i) ? ' cut' : ''}" aria-hidden="true"></span>`;
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
  const w = sc
    ? s.num <= 4
      ? 64
      : s.num <= 6
        ? 48
        : 36
    : s.num <= 4
      ? 44
      : s.num <= 8
        ? 32
        : s.num <= 12
          ? 24
          : 20;
  return `<div class="mbars${grouped(s.den) ? ' grouped' : ''}${s.num > 16 ? ' dense' : ''}${s.jazz === 'off' ? '' : ' jazz'}" id="mBeats" style="--cw:${w}px">${html}</div>`;
}

/**
 * Short value shown on each row of the main page.
 * @param {string} page
 * @returns {string}
 */
function rowValue(page) {
  switch (page) {
    case 'meter':
      return meterLabel(s);
    case 'subdiv':
      return (
        t(s.subdiv === 'none' ? 'metro.subGlyphs.none' : 'metro.subs.' + SUB_KEYS[s.subdiv]) +
        (swingApplies(s) && s.swing > SWING_MIN ? ' · ' + t('metro.swing') + ' ' + swingLabel(s.swing) : '')
      );
    case 'sound':
      return t('metro.sounds.' + s.sound);
    case 'jazz':
      return t(s.jazz === '24' ? 'metro.jazz24' : s.jazz === 'once' ? 'metro.jazzOnce' : 'metro.jazzOff');
    case 'gap':
      if (s.gap.mode === 'bars') return `${s.gap.on} + ${s.gap.off}`;
      if (s.gap.mode === 'random')
        return `${t('metro.gapModes.random')} ${t('metro.pctN', { n: s.gap.pct })}`;
      if (s.gap.mode === 'grow')
        return `${t('metro.pctN', { n: s.gap.from })} → ${t('metro.pctN', { n: s.gap.to })}`;
      return t('metro.gapModes.off');
    case 'ramp':
      return s.ramp.on ? `${s.tempo} → ${s.ramp.to}` : t('metro.optionsNone');
    case 'poly':
      return s.poly.on ? polyRatio(s) : t('metro.polyOff');
    default: {
      const on = ['vibrate', 'flash', 'wake'].filter((k) => s[k]).map((k) => t('metro.' + k));
      return on.length ? on.join(', ') : t('metro.optionsNone');
    }
  }
}

/**
 * Main page: lights and levels, tempo, the rows to the sub-pages, Start.
 * @returns {string}
 */
function mainHtml() {
  const on = engine.isRunning();
  const step = (n) =>
    `<button type="button" class="btn icon-btn mstep" data-step="${n}" aria-label="${esc(t('metro.stepN', { n: n > 0 ? '+' + n : String(n) }))}">${n > 0 ? '+' : '&minus;'}</button>`;
  const rows = PAGES.map(
    (p) =>
      `<li><button type="button" class="mitem" data-page="${p}"><span class="mitem-lbl">${esc(t('metro.page.' + p))}</span><span class="mitem-val">${esc(rowValue(p))}</span><span class="mitem-go" aria-hidden="true">&#8250;</span></button></li>`,
  ).join('');
  return `<div class="metro-wrap">
<header class="metro-head"><button type="button" class="btn icon-btn" data-m="close" aria-label="${esc(t('metro.collapse'))}">&#x2304;</button><h2>${esc(t('metro.title'))}</h2><span class="grow"></span><button type="button" class="btn icon-btn" data-m="presets" aria-label="${esc(t('metro.presets'))}">&#9733;</button></header>
${banner ? `<div class="mbanner" role="status"><span>${esc(banner.text)}</span><button type="button" class="btn ghost" data-m="undo">${esc(t('metro.undo'))}</button></div>` : ''}
${barsHtml()}
${polyLightsHtml()}
<div class="metro-tempo-row">
<button type="button" class="mtap" data-m="tap">${esc(t('metro.tap'))}</button>
<div class="metro-tempo" id="mTempo" role="button" tabindex="0" aria-label="${esc(t('metro.tempoZone'))}"><span class="mt-unit">${unitGlyph(s)} =</span> <span id="mTempoVal" class="mt-val">${s.tempo}</span><div id="mMark" class="mt-mark">${esc(tempoMarking(s.tempo))}</div></div>
<div class="metro-steps">${step(-1)}${step(1)}</div>
</div>
${s.ramp.on ? `<div class="mramp" aria-hidden="true"><span>&#10548; <span class="mglyph">${unitGlyph(s)}</span> ${s.tempo} → ${s.ramp.to}</span><span class="mramp-bar"><span id="mRampFill"></span></span></div>` : ''}
<ul class="mlist">${rows}</ul>
${noteHtml()}
<button type="button" class="btn primary metro-play${on ? ' on' : ''}" data-m="play">${on ? '&#9632; ' + esc(t('metro.stop')) : '&#9654; ' + esc(t('metro.start'))}</button>
</div>`;
}

/**
 * Lights of the polyrhythm hits, under the bars (when it is on).
 * @returns {string}
 */
function polyLightsHtml() {
  if (!s.poly.on) return '';
  const dots = s.poly.levels
    .map(
      (v) => `<span class="mpoly-dot${v > 0 ? '' : ' off'}" style="--lv:${audible(v) / LEVEL_MAX}"></span>`,
    )
    .join('');
  return `<div class="mpoly" id="mPoly" role="img" aria-label="${esc(t('metro.polyLights') + ' ' + polyRatio(s))}"><span class="mpoly-ratio">${esc(polyRatio(s))}</span>${dots}</div>`;
}

/**
 * The note open under the sheet (note screen only).
 * @returns {?module:model~Note}
 */
function noteHere() {
  return (state.view.name === 'note' && curNote()) || null;
}

/**
 * Save to the note button (main page, note screen only): "saved" when the
 * note already holds these settings, with a button to remove them.
 * @returns {string}
 */
function noteHtml() {
  const n = noteHere();
  if (!n) return '';
  const forget = n.metro
    ? `<button type="button" class="btn icon-btn" data-m="noteForget" aria-label="${esc(t('metro.noteForget'))}">&#x2715;</button>`
    : '';
  if (sameAsStored(s, n.metro))
    return `<div class="mnote"><span class="mnote-ok">&#10003; ${esc(t('metro.noteSaved'))}</span>${forget}</div>`;
  return `<div class="mnote"><button type="button" class="btn" data-m="noteSave">${esc(t(n.metro ? 'metro.noteUpdate' : 'metro.noteSave'))}</button>${forget}</div>`;
}

/**
 * Opened from the header of a note that holds settings: they are loaded,
 * with the banner to undo. Not while playing (the sound would change under
 * the player), once per visit of the note.
 */
function loadNoteSettings() {
  const n = noteHere();
  if (!n || !n.metro || engine.isRunning() || loadedFor === state.view) return;
  loadedFor = state.view;
  if (sameAsStored(s, n.metro)) return;
  const prev = s;
  s = applyPreset(s, { s: n.metro });
  save();
  banner = { text: t('metro.fromNote'), prev };
}

/**
 * Metronome button of a block: its settings, the banner to undo, the sheet.
 * @param {string} id Block id.
 */
function openFromBlock(id) {
  const b = blockById(id);
  if (!b || (b.type !== 'staff' && b.type !== 'grid')) return;
  const prev = s;
  s = fromBlock(s, /** @type {any} */ (b));
  save();
  if (sheetOpen) closeOverlay(); // reopened below on the main page
  openSheet();
  banner = { text: t('metro.fromBlock'), prev };
  render();
}

/**
 * Time signature page: top and bottom numbers, shortcuts, bars with group
 * limits, groups, what the tempo counts.
 * @returns {string}
 */
function meterBody() {
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
  let html = `<div class="mmeter"><select data-k="num" aria-label="${esc(t('metro.num'))}">${nums}</select><span class="mslash">/</span><select data-k="den" aria-label="${esc(t('metro.den'))}">${dens}</select><span class="grow"></span><select data-k="shortcut" aria-label="${esc(t('metro.shortcuts'))}">${shortcuts}</select></div>
${barsHtml({ cuts: true })}
<p class="mhint">${esc(t(grouped(s.den) ? 'metro.levelHintGroups' : 'metro.levelHint'))}</p>
<div class="metro-rows">`;
  if (grouped(s.den)) {
    const key = s.groups.join('+');
    const choices = groupChoices(s.num, s.den).map((g) => g.join('+'));
    if (!choices.includes(key)) choices.unshift(key);
    html += `<label class="mrow"><span class="mlbl">${esc(t('metro.groups'))}</span><select data-k="groups">${choices
      .map((c) => `<option value="${c}"${c === key ? ' selected' : ''}>${c}</option>`)
      .join('')}</select></label>`;
  }
  if (canCountGroups(s)) {
    const radio = (u) =>
      `<label class="mcheck"><input type="radio" name="mUnit" data-k="unit" value="${u}"${s.unit === u ? ' checked' : ''}> <span class="mglyph">${unitGlyph({ ...s, unit: u })}</span> ${esc(t(u === 'group' ? 'metro.unitGroup' : 'metro.unitPulse'))}</label>`;
    html += `<div class="mrow"><span class="mlbl">${esc(t('metro.tempoCounts'))}</span><div class="mrow-sub">${radio('pulse')}${radio('group')}</div></div>`;
  }
  return html + '</div>';
}

/**
 * Subdivision page: the five choices, a small bar per click, swing.
 * @returns {string}
 */
function subdivBody() {
  if (grouped(s.den)) return `<p class="mhint mempty">${esc(t('metro.noSubdiv'))}</p>`;
  const subs = subdivsFor(s.den)
    .map(
      (k) =>
        `<button type="button" data-msub="${esc(k)}" aria-pressed="${k === s.subdiv}" aria-label="${esc(t('metro.subs.' + SUB_KEYS[k]))}">${esc(t('metro.subGlyphs.' + SUB_KEYS[k]))}</button>`,
    )
    .join('');
  let html = `<div class="msub">${subs}</div>`;
  if (s.subdiv !== 'none')
    html += `${barsHtml({ subs: true })}<p class="mhint">${esc(t('metro.levelHint'))}</p>`;
  if (swingApplies(s))
    html += `<div class="metro-rows"><label class="mrow"><span class="mlbl">${esc(t('metro.swing'))} <output id="mSwingVal">${esc(swingLabel(s.swing))}</output></span><input type="range" min="${SWING_MIN}" max="${SWING_MAX}" step="1" data-k="swing" value="${s.swing}"></label></div>`;
  return html;
}

/**
 * A list of choices, one checked (sound and jazz pages).
 * @param {string} name Radio group name and `data-k`.
 * @param {Array.<{v: string, label: string}>} items
 * @param {string} value Checked value.
 * @returns {string}
 */
function choiceList(name, items, value) {
  return `<ul class="mlist mchoices">${items
    .map(
      (x) =>
        `<li><label class="mitem"><span class="mitem-lbl">${esc(x.label)}</span><input type="radio" name="${name}" data-k="${name}" value="${esc(x.v)}"${x.v === value ? ' checked' : ''}></label></li>`,
    )
    .join('')}</ul>`;
}

/**
 * Sound page.
 * @returns {string}
 */
function soundBody() {
  return choiceList(
    'sound',
    SOUNDS.map((k) => ({ v: k, label: t('metro.sounds.' + k) })),
    s.sound,
  );
}

/**
 * Jazz page: off, 2 and 4, once per bar (with its beat and "every other bar").
 * @returns {string}
 */
function jazzBody() {
  const items = [
    { v: 'off', label: t('metro.jazzOff') },
    ...(canTwoFour(s) ? [{ v: '24', label: t('metro.jazz24') }] : []),
    { v: 'once', label: t('metro.jazzOnce') },
  ];
  let html = choiceList('jazz', items, s.jazz);
  if (!canTwoFour(s)) html += `<p class="mhint">${esc(t('metro.jazz24Hint'))}</p>`;
  if (s.jazz === 'once') {
    const onceOpts = Array.from(
      { length: s.num },
      (_, i) => `<option value="${i}"${i === s.onceBeat ? ' selected' : ''}>${i + 1}</option>`,
    ).join('');
    html += `<div class="metro-rows"><label class="mrow"><span class="mlbl">${esc(t('metro.onceBeat'))}</span><select data-k="onceBeat">${onceOpts}</select></label></div><p class="mhint">${esc(t('metro.onceHint'))}</p>`;
  }
  return html;
}

/**
 * Options page: vibration, flash, screen on.
 * @returns {string}
 */
function optionsBody() {
  return `<ul class="mlist mchoices">${['vibrate', 'flash', 'wake']
    .map(
      (k) =>
        `<li><label class="mitem"><span class="mitem-lbl">${esc(t('metro.' + k))}<small>${esc(t('metro.' + k + 'Hint'))}</small></span><input type="checkbox" class="switch" data-k="${k}"${s[k] ? ' checked' : ''}></label></li>`,
    )
    .join('')}</ul>`;
}

/**
 * A labelled menu of numbers.
 * @param {string} k `data-k` of the menu.
 * @param {string} label
 * @param {Array.<number>} values
 * @param {number} value Selected value.
 * @param {function(number): string} [fmt] Shown text of each value.
 * @returns {string}
 */
function numberMenu(k, label, values, value, fmt = String) {
  return `<label class="mrow mrow-inline"><span class="mlbl">${esc(label)}</span><select data-k="${k}">${values
    .map((v) => `<option value="${v}"${v === value ? ' selected' : ''}>${esc(fmt(v))}</option>`)
    .join('')}</select></label>`;
}

/**
 * Integers from `a` to `b` by `step`.
 * @param {number} a
 * @param {number} b
 * @param {number} [step=1]
 * @returns {Array.<number>}
 */
const range = (a, b, step = 1) =>
  Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

/**
 * Silences page: the four modes, and the settings of the chosen one.
 * @returns {string}
 */
function gapBody() {
  const g = s.gap;
  const pct = (n) => t('metro.pctN', { n });
  let html = choiceList(
    'gapMode',
    GAP_MODES.map((m) => ({ v: m, label: t('metro.gapModes.' + m) })),
    g.mode,
  );
  let rows = '';
  if (g.mode === 'bars')
    rows =
      numberMenu('gap.on', t('metro.gapOn'), range(1, 8), g.on) +
      numberMenu('gap.off', t('metro.gapOff'), range(1, 8), g.off);
  if (g.mode === 'random') rows = numberMenu('gap.pct', t('metro.gapPct'), range(10, 90, 10), g.pct, pct);
  if (g.mode === 'grow')
    rows =
      numberMenu('gap.from', t('metro.gapFrom'), range(0, 80, 10), g.from, pct) +
      numberMenu('gap.to', t('metro.gapTo'), range(g.from + 10, 90, 10), g.to, pct) +
      numberMenu('gap.minutes', t('metro.gapMinutes'), GROW_MINUTES.slice(), g.minutes, (n) =>
        t('metro.minutesN', { n }),
      );
  if (rows) html += `<div class="metro-rows">${rows}</div>`;
  return html + `<p class="mhint">${esc(t('metro.gapHint'))}</p>`;
}

/**
 * Tempo ramp page: switch, target, step, bars per step, end, summary.
 * @returns {string}
 */
function rampBody() {
  const r = s.ramp;
  const up = r.to >= s.tempo;
  const html = `<ul class="mlist mchoices"><li><label class="mitem"><span class="mitem-lbl">${esc(t('metro.rampOn'))}<small>${esc(t('metro.rampOnHint'))}</small></span><input type="checkbox" class="switch" data-k="rampOn"${r.on ? ' checked' : ''}></label></li></ul>
<div class="metro-rows${r.on ? '' : ' dim'}">
<div class="mrow mrow-inline"><span class="mlbl">${esc(t('metro.rampFrom'))}</span><strong><span class="mglyph">${unitGlyph(s)}</span> ${s.tempo}</strong></div>
${numberMenu('ramp.to', t('metro.rampTo'), range(TEMPO_MIN, TEMPO_MAX), r.to)}
${numberMenu('ramp.step', t('metro.rampStep'), range(1, 20), r.step, (n) => (up ? '+' : '−') + n)}
${numberMenu('ramp.every', t('metro.rampEvery'), range(1, 16), r.every, (n) => t('metro.barsN', { n }))}
<label class="mrow mrow-inline"><span class="mlbl">${esc(t('metro.rampEnd'))}</span><select data-k="ramp.end">${RAMP_ENDS.map(
    (e) => `<option value="${e}"${e === r.end ? ' selected' : ''}>${esc(t('metro.rampEnds.' + e))}</option>`,
  ).join('')}</select></label>
</div>`;
  return (
    html +
    `<p class="mhint">${esc(t('metro.rampSummary', { a: s.tempo, b: r.to, bars: t('metro.barsN', { n: rampBars(s) }) }))}</p>`
  );
}

/**
 * Polyrhythm page: switch, hits, bars, sound, a level bar per hit, summary.
 * @returns {string}
 */
function polyBody() {
  const p = s.poly;
  const bars = p.levels
    .map((v, k) => barHtml(`data-mpolybar="${k}"`, v, t('metro.polyHitN', { n: k + 1, l: audible(v) })))
    .join('');
  const w = p.n <= 4 ? 44 : p.n <= 8 ? 32 : 20;
  return `<ul class="mlist mchoices"><li><label class="mitem"><span class="mitem-lbl">${esc(t('metro.polyOn'))}<small>${esc(t('metro.polyOnHint'))}</small></span><input type="checkbox" class="switch" data-k="polyOn"${p.on ? ' checked' : ''}></label></li></ul>
<div class="metro-rows${p.on ? '' : ' dim'}">
${numberMenu('poly.n', t('metro.polyN'), range(POLY_N_MIN, POLY_N_MAX), p.n)}
${numberMenu('poly.bars', t('metro.polyBars'), range(1, POLY_BARS_MAX), p.bars, (n) => t('metro.barsN', { n }))}
<label class="mrow mrow-inline"><span class="mlbl">${esc(t('metro.polySound'))}</span><select data-k="poly.sound">${SOUNDS.map(
    (k) => `<option value="${k}"${k === p.sound ? ' selected' : ''}>${esc(t('metro.sounds.' + k))}</option>`,
  ).join('')}</select></label>
</div>
<div class="mbars mpolybars${p.on ? '' : ' dim'}" style="--cw:${w}px">${bars}</div>
<p class="mhint">${esc(t('metro.polySummary', { n: p.n, bars: t('metro.barsN', { n: p.bars }), p: s.num * p.bars, r: polyRatio(s) }))}</p>`;
}

/** Content of each sub-page. */
const PAGE_BODIES = {
  meter: meterBody,
  subdiv: subdivBody,
  sound: soundBody,
  jazz: jazzBody,
  poly: polyBody,
  gap: gapBody,
  ramp: rampBody,
  options: optionsBody,
};

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
  const ps = sanitizeMetro(p);
  const jazz =
    ps.jazz === '24' ? ' · ' + t('metro.jazz24') : ps.jazz === 'once' ? ' · ' + t('metro.jazzOnce') : '';
  return `${unitGlyph(ps)} ${ps.tempo} · ${meterLabel(ps)}${jazz}`;
}

/**
 * Preset page.
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
  return pageHtml(
    'presets',
    `<form class="mp-form" id="mpSave"><input type="text" name="name" maxlength="${PRESET_NAME_MAX}" placeholder="${esc(t('metro.presetName'))}" aria-label="${esc(t('metro.presetName'))}"${full ? ' disabled' : ''}><button type="submit" class="btn primary"${full ? ' disabled' : ''}>${esc(t('metro.presetSave'))}</button></form>
<p class="mhint">${esc(t('metro.presetCurrent', { s: presetSummary(s) }))}</p>
${rows ? `<ul class="mpresets">${rows}</ul>` : `<p class="mhint">${esc(t('metro.presetEmpty'))}</p>`}`,
  );
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
    const lv = pulseLevels(s);
    const beats =
      s.num <= MINI_DOTS_MAX
        ? `<span class="mm-beats" id="mmBeats">${lv.map((v) => `<span class="mm-dot lv${v}"></span>`).join('')}</span>`
        : `<span class="mm-count" id="mmCount">1/${s.num}</span>`;
    mini.innerHTML = `<div class="mm-in">${beats}<button type="button" class="btn icon-btn" data-m="minus" aria-label="${esc(t('metro.stepN', { n: '-1' }))}">&minus;</button><span class="mm-tempo">${s.ramp.on ? '&#10548; ' : ''}${unitGlyph(s)} ${s.tempo}</span><button type="button" class="btn icon-btn" data-m="plus" aria-label="${esc(t('metro.stepN', { n: '+1' }))}">+</button><span class="mm-meter">${esc(meterLabel(s))}</span><span class="grow"></span><button type="button" class="btn icon-btn" data-m="stop" aria-label="${esc(t('metro.stop'))}">&#9632;</button><button type="button" class="btn icon-btn" data-m="open" aria-label="${esc(t('metro.expand'))}">&#x2303;</button></div>`;
    lastK = null;
  }
  document.documentElement.style.setProperty('--metro-h', show ? mini.offsetHeight + 'px' : '0px');
}

// ---------- Lights, vibration, flash ----------

/**
 * Lights the sounding pulse in the sheet and the mini-bar.
 * @param {?{k: number, beat: number, bar: number, level: number}} p
 */
function paintLights(p) {
  const silent = !!p && p.silent;
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
  const pb = sheet.querySelector('#mPoly');
  if (pb) {
    const hit = p && p.poly ? p.poly.hit : -1;
    pb.querySelectorAll('.mpoly-dot').forEach((el, i) => el.classList.toggle('on', i === hit));
    pb.classList.toggle('silent-bar', !!(p && p.poly && p.poly.silent));
  }
  if (p && s.ramp.on) showRamp(p);
}

/**
 * During a ramp: the tempo playing now (the big number and the mini-bar),
 * and the progress of the ramp.
 * @param {{bar: number, tempo: number}} p
 */
function showRamp(p) {
  const val = sheet.querySelector('#mTempoVal');
  if (val) val.textContent = String(p.tempo);
  const mt = mini.querySelector('.mm-tempo');
  if (mt) mt.textContent = `\u2934 ${unitGlyph(s)} ${p.tempo}`;
  const fill = /** @type {HTMLElement} */ (sheet.querySelector('#mRampFill'));
  if (fill) {
    const total = rampBars(s);
    const done = s.ramp.end === 'loop' ? p.bar % total : Math.min(p.bar, total);
    fill.style.width = `${Math.round((100 * done) / total)}%`;
  }
}

/** Last polyrhythm hit lit (its counter). */
let lastPolyK = null;

/** Animation loop: lights, and vibration / flash on each new audible pulse. */
function loop() {
  raf = 0;
  if (!engine.isRunning() || document.hidden) return;
  const p = engine.position();
  const pk = p && p.poly ? p.poly.k : null;
  if (p && p.k === lastK && pk !== lastPolyK) paintLights(p);
  lastPolyK = pk;
  if (p && p.k !== lastK) {
    const first = lastK === null;
    lastK = p.k;
    paintLights(p);
    if (!first && p.level && !p.silent) {
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
  return pulseLevels(s).map((v) => (v > 0 ? v : -3));
}

/**
 * Sets the level of a pulse, subdivision or polyrhythm bar.
 * @param {'levels'|'subLevels'|'poly'} field
 * @param {number} i
 * @param {function(number): number} fn New level from the current one.
 * @returns {Object} Patch for {@link update}.
 */
function levelPatch(field, i, fn) {
  const arr =
    field === 'levels' ? editableLevels() : field === 'poly' ? s.poly.levels.slice() : s.subLevels.slice();
  arr[i] = fn(arr[i]);
  if (field === 'poly') return { poly: { ...s.poly, levels: arr } };
  return field === 'levels' ? { levels: arr, jazz: 'off' } : { subLevels: arr };
}

/**
 * Which levels a bar sets, and its index.
 * @param {HTMLElement} bar
 * @returns {{field: ('levels'|'subLevels'|'poly'), i: number}}
 */
function barTarget(bar) {
  const d = bar.dataset;
  if (d.mbar !== undefined) return { field: 'levels', i: Number(d.mbar) };
  if (d.mpolybar !== undefined) return { field: 'poly', i: Number(d.mpolybar) };
  return { field: 'subLevels', i: Number(d.msubbar) };
}

/**
 * Current level of a bar.
 * @param {{field: ('levels'|'subLevels'|'poly'), i: number}} tg
 * @returns {number}
 */
function barLevel(tg) {
  if (tg.field === 'levels') return editableLevels()[tg.i];
  return tg.field === 'poly' ? s.poly.levels[tg.i] : s.subLevels[tg.i];
}

/**
 * Switches a bar on or off (it keeps its level).
 * @param {HTMLElement} bar
 */
function toggleBar(bar) {
  const tg = barTarget(bar);
  update(levelPatch(tg.field, tg.i, toggleLevel));
}

/** Adds a tap to the tap tempo series. */
function tap() {
  const r = tapTempo(taps, performance.now());
  taps = r.taps;
  for (const el of sheet.querySelectorAll('.mtap, #mTempo')) {
    el.classList.remove('hit');
    void (/** @type {HTMLElement} */ (el).offsetWidth); // restart the animation
    el.classList.add('hit');
  }
  if (r.bpm) setTempo(r.bpm);
}

/**
 * Taps on the sheet and the mini-bar.
 * @param {MouseEvent} e
 */
function onClick(e) {
  const el = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!el || el.disabled) return;
  const d = el.dataset;
  // Pointer gestures (steps, TAP, bars) act on pointerdown; a click with
  // detail 0 comes from the keyboard.
  if (d.step) return e.detail === 0 && setTempo(s.tempo + Number(d.step));
  if (d.m === 'tap') return e.detail === 0 && tap();
  if (d.mbar !== undefined || d.msubbar !== undefined || d.mpolybar !== undefined)
    return e.detail === 0 && toggleBar(el);
  if (d.m === 'close' || d.m === 'back') return closeOverlay();
  if (d.m === 'open') return openSheet();
  if (d.m === 'play' || d.m === 'stop') return togglePlay();
  if (d.m === 'minus') return setTempo(s.tempo - 1);
  if (d.m === 'plus') return setTempo(s.tempo + 1);
  if (d.m === 'presets') return openPage('presets');
  if (d.m === 'undo' && banner) {
    s = banner.prev;
    banner = null;
    save();
    return render();
  }
  if (d.m === 'noteSave') return saveToNote();
  if (d.m === 'noteForget')
    return confirmTap(/** @type {HTMLButtonElement} */ (el), t('metro.noteForgetConfirm'), () => {
      const n = noteHere();
      if (!n) return;
      delete n.metro;
      touch(n);
      render();
    });
  if (d.page) return openPage(d.page);
  if (d.mcut) return replace(withGroups(s, cutOrJoin(s.groups, Number(d.mcut))));
  if (d.msub) return replace(withSubdiv(s, d.msub));
  if (d.load) {
    const p = presets.find((x) => x.id === d.load);
    if (p) {
      s = applyPreset(s, p);
      save();
      closeOverlay(); // back to the main page
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

/** Stores the musical settings in the note open under the sheet. */
function saveToNote() {
  const n = noteHere();
  if (!n) return;
  n.metro = presetPart(s);
  loadedFor = state.view;
  banner = null;
  touch(n);
  render();
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
 * Swing slider while moving (no redraw: the finger keeps the slider).
 * @param {Event} e
 */
function onInput(e) {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (el.dataset.k !== 'swing') return;
  s = { ...s, swing: Number(el.value) };
  const out = sheet.querySelector('#mSwingVal');
  if (out) out.textContent = swingLabel(s.swing);
  scheduleConfigure();
}

/**
 * Menus, choices, switches, end of a slider move: saved.
 * @param {Event} e
 */
function onChange(e) {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const k = el.dataset.k;
  if (k === 'sound' || k === 'jazz') return update({ [k]: el.value });
  if (k === 'onceBeat') return update({ onceBeat: Number(el.value) });
  if (k === 'gapMode') return update({ gap: { ...s.gap, mode: el.value } });
  if (k && k.startsWith('gap.')) return update({ gap: { ...s.gap, [k.slice(4)]: Number(el.value) } });
  if (k === 'polyOn') return replace(withPoly(s, { on: el.checked }));
  if (k === 'poly.sound') return replace(withPoly(s, { sound: el.value }));
  if (k === 'poly.n' || k === 'poly.bars') return replace(withPoly(s, { [k.slice(5)]: Number(el.value) }));
  if (k === 'rampOn') return update({ ramp: { ...s.ramp, on: el.checked } });
  if (k === 'ramp.end') return update({ ramp: { ...s.ramp, end: el.value } });
  if (k && k.startsWith('ramp.')) return update({ ramp: { ...s.ramp, [k.slice(5)]: Number(el.value) } });
  if (k === 'vibrate' || k === 'flash' || k === 'wake') {
    update({ [k]: el.checked });
    return syncWake();
  }
  if (k === 'num') return replace(withMeter(s, Number(el.value), s.den));
  if (k === 'den') return replace(withMeter(s, s.num, Number(el.value)));
  if (k === 'shortcut') return el.value !== '' && replace(withShortcut(s, Number(el.value)));
  if (k === 'groups') return replace(withGroups(s, el.value.split('+').map(Number)));
  if (k === 'unit') return replace(withUnit(s, /** @type {'pulse'|'group'} */ (el.value)));
  if (k === 'swing') save();
}

/** Repeat timer of a held − or + button. */
let repeat = 0;

/**
 * Pointer down: TAP (on the press, more precise than the click), − and +
 * (a tap = 1, held = steps of 5), the tempo number (tap or drag), the bars.
 * @param {PointerEvent} e
 */
function onPointerDown(e) {
  const tgt = /** @type {HTMLElement} */ (e.target);
  if (tgt.closest('[data-m="tap"]')) return tap();
  const st = /** @type {HTMLElement} */ (tgt.closest('[data-step]'));
  if (st) return holdStep(Math.sign(Number(st.dataset.step)));
  const bar = /** @type {HTMLElement} */ (tgt.closest('[data-mbar], [data-msubbar], [data-mpolybar]'));
  if (bar) return dragBar(bar, e);
  const zone = /** @type {HTMLElement} */ (tgt.closest('#mTempo'));
  if (zone) dragTempo(zone, e);
}

/**
 * − or + held: one step right away, then steps of 5 while held.
 * @param {number} dir -1 or 1.
 */
function holdStep(dir) {
  setTempo(s.tempo + dir);
  const stopRepeat = () => {
    clearTimeout(repeat);
    repeat = 0;
    window.removeEventListener('pointerup', stopRepeat);
    window.removeEventListener('pointercancel', stopRepeat);
  };
  const again = () => {
    setTempo(s.tempo + 5 * dir);
    repeat = setTimeout(again, 220);
  };
  repeat = setTimeout(again, 450);
  window.addEventListener('pointerup', stopRepeat);
  window.addEventListener('pointercancel', stopRepeat);
}

/**
 * Bar gesture: a tap switches the bar on or off; sliding up or down sets its
 * level, snapped to the steps 0 to 4 ({@link LEVEL_PX} px per step).
 * @param {HTMLElement} bar
 * @param {PointerEvent} e
 */
function dragBar(bar, e) {
  const { field, i } = barTarget(bar);
  const y0 = e.clientY;
  const start = audible(barLevel({ field, i }));
  let moved = false;
  bar.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const dy = y0 - ev.clientY;
    if (!moved && Math.abs(dy) < SLOP) return;
    moved = true;
    const lv = Math.max(0, Math.min(LEVEL_MAX, start + Math.round(dy / LEVEL_PX)));
    s = sanitizeMetro({ ...s, ...levelPatch(field, i, () => lv) });
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
 * Tempo number gesture: a tap is a tap-tempo tap (timed at the press); a
 * drag changes the tempo, up = faster, one BPM every {@link DRAG_PX} px.
 * @param {HTMLElement} zone
 * @param {PointerEvent} e
 */
function dragTempo(zone, e) {
  const y0 = e.clientY;
  const t0 = s.tempo;
  const pressed = performance.now();
  let moved = false;
  zone.setPointerCapture(e.pointerId);
  const move = (ev) => {
    if (!moved && Math.abs(y0 - ev.clientY) < SLOP) return;
    moved = true;
    zone.classList.add('drag');
    setTempo(t0 + Math.round((y0 - ev.clientY) / DRAG_PX), false);
  };
  const end = () => {
    zone.classList.remove('drag');
    zone.removeEventListener('pointermove', move);
    zone.removeEventListener('pointerup', end);
    zone.removeEventListener('pointercancel', end);
    if (moved) setMeta({ metro: s });
    else {
      // Timed at the press, like the TAP button.
      const r = tapTempo(taps, pressed);
      taps = r.taps;
      if (r.bpm) setTempo(r.bpm);
    }
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
sheet.addEventListener('keydown', (e) => {
  // The tempo number is a tap zone for the keyboard too.
  if (/** @type {HTMLElement} */ (e.target).id === 'mTempo' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    tap();
  }
});

// The ♩ button of every screen header (headers are redrawn often).
document.addEventListener('click', (e) => {
  const tgt = /** @type {HTMLElement} */ (e.target);
  if (tgt.closest('[data-metro-open]')) return openSheet(true);
  const blk = /** @type {HTMLElement} */ (tgt.closest('[data-metro-block]'));
  if (blk) openFromBlock(blk.dataset.metroBlock);
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
