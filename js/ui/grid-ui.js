/**
 * @module ui/grid-ui
 * @description
 * Interaction with a **chord chart** block:
 *
 * - header (key, time signature, style, tempo, iReal, playback);
 * - **iReal Pro** panel: open/copy the link, import a link or a file;
 * - selecting a measure by tapping;
 * - **palette**: chord input field, structure marks, navigation.
 *
 * ## Fast input
 *
 * The field updates the measure **on every keystroke** (live preview). Enter
 * (or ↵) confirms and moves to the next measure, creating one if needed. The
 * `|` character fills several measures at once; it is interpreted only on
 * confirmation, so that no measures are created while typing.
 */

import { t } from '../i18n.js';
import { state, app, curNote, blockById, touch } from './state.js';
import { esc } from '../util.js';
import { TIME_SIGNATURES } from '../model.js';
import { chordOk } from '../chords.js';
import { applyChordKey } from '../chord-keys.js';
import { mountChordKeyboard } from './chord-keyboard.js';
import { STYLES, KEYS, SECTIONS, keyLabel, gridTokens, measureText, gridHtml } from '../grid.js';
import { toIRealLink, parseIRealAll } from '../ireal.js';
import { pushSnapshot } from '../history.js';
import { sanitizeBlock } from '../sanitize.js';
import * as audio from '../audio.js';
import { toolsHtml, syncPaletteSpace, updatePlayBtn, playCallbacks, readFile } from './common.js';
import { setActive, undo, registerBlockKind } from './blocks.js';
import { isFolded, applyFold, guardFoldedTaps, FOLD_PREVIEW_LINES } from './fold.js';
import { renderScreen } from './nav.js';
import { bindMeasureSelect, refreshMeasureSelect } from './measure-select.js';

/** Measures per chart line. */
const GRID_COLS = 4;

const gpal = /** @type {HTMLElement} */ (document.getElementById('gpal'));
const gin = /** @type {HTMLInputElement} */ (document.getElementById('gIn'));
const gText = /** @type {HTMLElement} */ (document.getElementById('gText'));
const gKeys = /** @type {HTMLElement} */ (document.getElementById('gKeys'));

/**
 * Typing in the text field (phone keyboard) rather than on the chord
 * keyboard (2.8.5). Kept for the session.
 */
let textMode = false;
/** Measure for which an undo snapshot has already been taken. */
let snapFor = null;

/**
 * A slot of the measure is not a recognized chord.
 * @param {module:model~GridMeasure} m
 * @returns {boolean}
 */
const badMeasure = (m) => m.ch.some((c) => !chordOk(c));

/** Chord keyboard of the chart. */
const kb = mountChordKeyboard(gKeys, {
  mode: 'grid',
  onKey: (k) => {
    const n = curNote();
    const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
    if (!n || !b || state.sel == null) return;
    const m = b.measures[state.sel];
    // A single snapshot per measure typed: "Undo" erases the whole typed measure.
    const key = b.id + ':' + state.sel;
    if (snapFor !== key) {
      pushSnapshot(n);
      snapFor = key;
    }
    m.ch = applyChordKey(m.ch, k);
    touch(n);
    redrawGrid(b.id);
    kb.show(m.ch);
  },
  onNext: () => nextMeasure(),
  onText: () => setTextMode(true),
  onUndo: () => {
    undo();
    const b = blockById(state.activeId);
    if (b && b.type === 'grid') loadInput(/** @type {module:model~GridBlock} */ (b));
  },
});

/**
 * Switches from the chord keyboard to the text field, or back.
 * @param {boolean} on
 */
function setTextMode(on) {
  textMode = on;
  gText.hidden = !on;
  gKeys.hidden = on;
  const b = blockById(state.activeId);
  if (b && b.type === 'grid') loadInput(/** @type {module:model~GridBlock} */ (b));
  if (on) gin.focus();
  else gin.blur();
  syncPaletteSpace();
}

/**
 * Palette tab: chords or structure (barlines, sections, measures).
 * @param {'chords'|'struct'} tab
 */
function setTab(tab) {
  const chords = tab === 'chords';
  document.getElementById('gChords').hidden = !chords;
  document.getElementById('gStruct').hidden = chords;
  document.getElementById('gTabChords').setAttribute('aria-selected', String(chords));
  document.getElementById('gTabStruct').setAttribute('aria-selected', String(!chords));
  if (!chords) gin.blur();
  syncPaletteSpace();
}

/**
 * HTML of a chart block: settings header, iReal panel (collapsed), chart area, tools.
 * @param {module:model~GridBlock} b
 * @returns {string}
 */
function gridBlockHtml(b) {
  const id = esc(b.id);
  const keyOptions =
    KEYS.map((k) => `<option value="${k}">${keyLabel(k)}</option>`).join('') +
    KEYS.map((k) => `<option value="${k}-">${keyLabel(k + '-')}</option>`).join('');
  // An imported style missing from the list is added to it, so it is not lost.
  const styles = STYLES.includes(b.style) ? STYLES : [b.style, ...STYLES];
  return (
    `<div class="shead"><span class="kind">${esc(t('grid.kind'))}</span>
    <select data-f="key" aria-label="${esc(t('grid.key'))}">${keyOptions}</select>
    <select data-f="time" aria-label="${esc(t('staff.time'))}">${TIME_SIGNATURES.map((ts) => `<option>${ts}</option>`).join('')}</select>
    <select data-f="style" aria-label="Style">${styles.map((st) => `<option>${esc(st)}</option>`).join('')}</select>
    <label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" data-f="tempo" aria-label="Tempo"></label>
    <button type="button" class="chip" data-f="ireal" aria-expanded="false">iReal</button>
    <button type="button" class="playbtn" data-play="${id}">&#9654; ${esc(t('play.listen'))}</button></div>
    <div class="irealbox" hidden>
      <div class="ir-actions"><a class="btn" data-ir="open" href="#">${esc(t('ireal.open'))}</a><button class="btn" type="button" data-ir="copy">${esc(t('ireal.copy'))}</button></div>
      <label class="ir-lbl" for="ir_${id}">${esc(t('ireal.import1'))} <code>irealb://</code> ${esc(t('ireal.import2'))}</label>
      <textarea id="ir_${id}" rows="2" placeholder="irealb://…" spellcheck="false"></textarea>
      <div class="ir-actions"><button class="btn primary" type="button" data-ir="import">${esc(t('ireal.replace'))}</button><label class="btn" for="irf_${id}">${esc(t('ireal.openFile'))}</label><input type="file" id="irf_${id}" accept=".html,.htm,.txt,text/html,text/plain" hidden></div>
      <div class="status ir-msg"></div>
    </div>
    <div class="gridwrap" data-grid="${id}"></div>` + toolsHtml()
  );
}

/**
 * Wires the header settings (key, time signature, style, tempo) and the Listen button.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function bindGridSettings(n, b, el) {
  /** @param {string} k */
  const field = (k) => /** @type {HTMLInputElement} */ (el.querySelector(`[data-f=${k}]`));
  // Key, time signature, style: same handling (undoable, saved).
  ['key', 'time', 'style'].forEach((k) => {
    field(k).value = b[k];
    field(k).onchange = () => {
      pushSnapshot(n);
      b[k] = field(k).value;
      touch(n);
    };
  });
  const tempo = field('tempo');
  tempo.value = String(b.tempo);
  tempo.onchange = () => {
    const v = Math.max(30, Math.min(300, parseInt(tempo.value, 10) || 120));
    tempo.value = String(v);
    b.tempo = v;
    touch(n);
  };
  el.querySelector('[data-play]').onclick = () => {
    // A collapsed block can be played without expanding it: it is not activated.
    if (!el.classList.contains('folded')) setActive(b.id);
    audio.playGrid(b, playCallbacks(b.id, redrawGrid));
    updatePlayBtn(b.id);
  };
}

/**
 * Replaces a chart's content with the first iReal tune found in `txt`.
 * The tune goes through validation, like any imported data.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {string} txt Link or file content.
 * @param {Element} msg Message area of the panel.
 */
function importIntoGrid(n, b, txt, msg) {
  const songs = parseIRealAll(txt);
  if (!songs.length) {
    msg.textContent = t('ireal.none');
    return;
  }
  const song = songs[0];
  pushSnapshot(n);
  const clean = sanitizeBlock({
    ...b,
    type: 'grid',
    time: song.time,
    key: song.key,
    style: song.style,
    tempo: song.tempo || b.tempo,
    measures: song.measures,
  });
  Object.assign(b, {
    time: clean.time,
    key: clean.key,
    style: clean.style,
    tempo: clean.tempo,
    measures: clean.measures,
  });
  if (!n.title.trim()) n.title = song.title.slice(0, 200);
  touch(n);
  state.sel = null;
  renderScreen({ keepScroll: true });
  // The block was recreated by the re-render: write into its new message area.
  const newMsg = app.querySelector(`[data-block="${CSS.escape(b.id)}"] .ir-msg`);
  if (newMsg) {
    newMsg.textContent =
      t('ireal.imported', { title: song.title, n: song.measures.length }) +
      (songs.length > 1 ? t('ireal.ignored', { n: songs.length - 1 }) : '.');
  }
}

/**
 * Wires the iReal panel: open in iReal Pro, copy the link, import.
 * The link is recomputed on tap: the chart may have changed since the panel
 * was opened.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function bindIRealPanel(n, b, el) {
  const toggle = el.querySelector('[data-f=ireal]');
  const box = /** @type {HTMLElement} */ (el.querySelector('.irealbox'));
  const msg = el.querySelector('.ir-msg');
  const textarea = /** @type {HTMLTextAreaElement} */ (el.querySelector('textarea'));
  const openLink = /** @type {HTMLAnchorElement} */ (el.querySelector('[data-ir=open]'));
  const link = () => toIRealLink(n.title || t('list.untitled'), b);

  toggle.onclick = () => {
    box.hidden = !box.hidden;
    toggle.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) openLink.href = link();
  };
  openLink.addEventListener('click', () => {
    openLink.href = link();
  });
  el.querySelector('[data-ir=copy]').onclick = () => {
    const l = link();
    // Clipboard refused (old browser, permission): select the link for a manual copy.
    const fallback = () => {
      textarea.value = l;
      textarea.select();
      msg.textContent = t('ireal.copyBlocked');
    };
    try {
      navigator.clipboard.writeText(l).then(() => {
        msg.textContent = t('ireal.copied');
      }, fallback);
    } catch (e) {
      fallback();
    }
  };
  el.querySelector('[data-ir=import]').onclick = () => importIntoGrid(n, b, textarea.value, msg);
  el.querySelector('input[type=file]').onchange = (e) =>
    readFile(e, (text) => importIntoGrid(n, b, text, msg));
}

/**
 * Wires measure selection (or adding through the "+" cell).
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function bindMeasureSelection(n, b, el) {
  const wrap = /** @type {HTMLElement} */ (el.querySelector('.gridwrap'));
  guardFoldedTaps(wrap, b);
  bindGridSelect(b, wrap);
  wrap.addEventListener('click', (e) => {
    const cell = /** @type {HTMLElement} */ (e.target).closest('[data-gm]');
    if (!cell) return;
    if (state.activeId !== b.id) setActive(b.id);
    if (cell.dataset.gm === 'add') {
      pushSnapshot(n);
      b.measures.push({ ch: [] });
      touch(n);
      state.sel = b.measures.length - 1;
    } else {
      state.sel = Number(cell.dataset.gm);
    }
    loadInput(b);
    redrawGrid(b.id);
    if (textMode) gin.focus();
  });
}

/**
 * Long press on a cell: measure selection (2.8.4), see
 * {@link module:ui/measure-select|ui/measure-select}. Cells are buttons: they
 * are found under the finger and their place on screen is measured.
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} wrap
 */
function bindGridSelect(b, wrap) {
  const cell = (k) => wrap.querySelector(`[data-gm="${k}"]`);
  bindMeasureSelect(wrap, {
    playId: () => b.id,
    measureAt(cx, cy) {
      const el = document.elementFromPoint(cx, cy);
      const c = el && /** @type {HTMLElement} */ (el.closest('[data-gm]'));
      if (!c || !wrap.contains(c) || c.dataset.gm === 'add') return null;
      return Number(c.dataset.gm);
    },
    boxes(a, z) {
      const r = wrap.getBoundingClientRect();
      const out = [];
      for (let k = a; k <= z; k++) {
        const c = cell(k);
        if (!c) return [];
        const q = c.getBoundingClientRect();
        const last = out[out.length - 1];
        const box = { x: q.left - r.left, y: q.top - r.top, w: q.width, h: q.height };
        if (last && Math.abs(last.y - box.y) < 2) last.w = box.x + box.w - last.x;
        else out.push(box);
      }
      return out.map((x) => ({ x: x.x - 2, y: x.y - 2, w: x.w + 4, h: x.h + 4 }));
    },
    play(a, to, loop, done) {
      const cb = playCallbacks(b.id, redrawGrid);
      audio.playGrid(
        b,
        {
          onStep: cb.onStep,
          onEnd: () => {
            cb.onEnd();
            done();
          },
        },
        { from: a, to: to === Infinity ? undefined : to, loop, countIn: true },
      );
      updatePlayBtn(b.id);
    },
  });
}

/**
 * Fills a chart block's element and wires its interactions.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function gridBlockEl(n, b, el) {
  el.innerHTML = gridBlockHtml(b);
  bindGridSettings(n, b, el);
  bindIRealPanel(n, b, el);
  bindMeasureSelection(n, b, el);
}

/**
 * Redraws a chart (no effect if `id` is not a chart on screen).
 * @param {string} id
 */
export function redrawGrid(id) {
  const b = blockById(id);
  if (!b || b.type !== 'grid') return;
  const w = /** @type {HTMLElement} */ (app.querySelector(`[data-grid="${CSS.escape(id)}"]`));
  if (!w) return;
  const lines = Math.ceil(b.measures.length / GRID_COLS);
  const folded = isFolded(b, lines);
  w.innerHTML = gridHtml(
    b,
    state.activeId === id ? state.sel : null,
    audio.isPlaying(id) ? state.playIdx : null,
    folded ? FOLD_PREVIEW_LINES * GRID_COLS : 0,
  );
  applyFold(w, b, lines, folded);
  refreshMeasureSelect(w);
  if (state.activeId === id) updateGridPalette();
}

/**
 * Fills the input field with the selected measure.
 * @param {module:model~GridBlock} b
 */
function loadInput(b) {
  const m = state.sel != null && b.measures[state.sel];
  gin.value = m ? measureText(m) : '';
  gin.classList.remove('err');
  kb.show(m ? m.ch : []);
  snapFor = null;
}

/**
 * Shows or hides the chart palette. When opened with no selection, it goes to
 * the first empty measure (where you want to write).
 * @param {boolean} on
 */
function showGridPalette(on) {
  gpal.hidden = !on;
  if (!on) return;
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!b) return;
  if (state.sel == null) {
    const empty = b.measures.findIndex((m) => !m.ch.length);
    state.sel = empty >= 0 ? empty : 0;
    redrawGrid(b.id);
  }
  loadInput(b);
  updateGridPalette();
}

/**
 * Updates the message and the button states of the chart palette.
 */
function updateGridPalette() {
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!b || b.type !== 'grid') return;
  const m = state.sel != null ? b.measures[state.sel] : null;
  const info = document.getElementById('gInfo');
  info.textContent = m
    ? t('grid.measureN', { n: state.sel + 1 }) +
      (m.sec ? ' · ' + t('grid.sectionN', { s: m.sec }) : '') +
      (m.ending ? ' · ' + t('grid.endingN', { n: m.ending }) : '') +
      ((textMode ? gin.classList.contains('err') : badMeasure(m)) ? ' · ' + t('grid.badChord') : '')
    : t('grid.tapMeasure');
  gpal.querySelectorAll('[data-g]').forEach((x) => {
    const k = x.dataset.g;
    const on =
      !!m &&
      ({ sec: !!m.sec, end: !!m.ending, rs: !!m.rs, re: !!m.re, dbl: !!m.dbl, fin: !!m.fin }[k] || false);
    if (k === 'sec') x.textContent = m && m.sec ? t('grid.section') + ' ' + m.sec : t('grid.section');
    if (k === 'end') x.textContent = m && m.ending ? t('grid.endingN', { n: m.ending }) : t('grid.volta');
    x.setAttribute('aria-pressed', String(on));
  });
  syncPaletteSpace();
}

/**
 * Applies the field's content to the selected measure.
 * @param {boolean} commit `true` on confirmation: also interprets the `|`
 *   (following measures), reusing the empty measures already there.
 */
function applyInput(commit) {
  const n = curNote();
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!n || !b || state.sel == null) return;
  const parts = gin.value.split('|');
  const bad = gin.value
    .split(/[\s,|]+/)
    .filter(Boolean)
    .map((c) => (/^(n|nc|n\.c\.?|\/)$/i.test(c) ? '' : c))
    .some((c) => !chordOk(c));
  gin.classList.toggle('err', bad);
  b.measures[state.sel].ch = gridTokens(parts[0]);
  if (commit && parts.length > 1) {
    parts.slice(1).forEach((p, k) => {
      const idx = state.sel + 1 + k;
      const ch = gridTokens(p);
      if (idx < b.measures.length && !b.measures[idx].ch.length) b.measures[idx].ch = ch;
      else b.measures.splice(idx, 0, { ch });
    });
    state.sel += parts.length - 1;
  }
  touch(n);
  redrawGrid(b.id);
}

/** Confirms the input and moves to the next measure (except after a final barline). */
function nextMeasure() {
  const n = curNote();
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!n || !b || state.sel == null) return;
  if (textMode) applyInput(true);
  if (b.measures[state.sel].fin) {
    gin.blur();
    return;
  }
  if (state.sel >= b.measures.length - 1) {
    b.measures.push({ ch: [] });
    touch(n);
  }
  state.sel++;
  loadInput(b);
  redrawGrid(b.id);
  const c = app.querySelector(`[data-grid="${CSS.escape(b.id)}"] [data-gm="${state.sel}"]`);
  if (c) c.scrollIntoView({ block: 'nearest' });
}

// ---------- Wiring (only once) ----------
gin.addEventListener('focus', () => {
  const n = curNote();
  if (n) pushSnapshot(n);
});
gin.addEventListener('input', () => {
  if (!gin.value.includes('|')) applyInput(false);
});
gin.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    nextMeasure();
  }
});
document.getElementById('gKb').onclick = () => setTextMode(false);
document.getElementById('gTabChords').onclick = () => setTab('chords');
document.getElementById('gTabStruct').onclick = () => setTab('struct');
document.getElementById('gOk').onclick = () => {
  nextMeasure();
  gin.focus();
};
document.getElementById('gDone').onclick = () => {
  gin.blur();
  setActive(null);
};

gpal.addEventListener('click', (e) => {
  const x = /** @type {HTMLElement} */ (e.target).closest('[data-g]');
  if (!x) return;
  const k = x.dataset.g;
  const n = curNote();
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!n || !b) return;
  if (k === 'prev' || k === 'next') {
    if (state.sel != null && textMode) applyInput(false);
    state.sel =
      state.sel == null
        ? 0
        : Math.max(0, Math.min(b.measures.length - 1, state.sel + (k === 'prev' ? -1 : 1)));
    loadInput(b);
    redrawGrid(b.id);
    return;
  }
  if (k === 'undo') {
    undo();
    return;
  }
  if (state.sel == null) return;
  const m = b.measures[state.sel];
  pushSnapshot(n);
  switch (k) {
    case 'sec': // A → B → C → D → Intro → (none)
      m.sec = SECTIONS[(SECTIONS.indexOf(m.sec || '') + 1) % SECTIONS.length];
      if (!m.sec) delete m.sec;
      break;
    case 'end': // 1st ending → 2nd ending → (none)
      m.ending = /** @type {any} */ (((m.ending || 0) + 1) % 3);
      if (!m.ending) delete m.ending;
      break;
    case 'sim':
      m.ch = ['%'];
      loadInput(b);
      break;
    case 'ins':
      b.measures.splice(state.sel + 1, 0, { ch: [] });
      state.sel++;
      loadInput(b);
      break;
    case 'del':
      if (b.measures.length > 1) {
        b.measures.splice(state.sel, 1);
        state.sel = Math.min(state.sel, b.measures.length - 1);
        loadInput(b);
      }
      break;
    default: {
      // Barlines: rs, re, dbl, fin (a right barline excludes the others).
      const flag = { rs: 'rs', re: 're', dbl: 'dbl', fin: 'fin' }[k];
      if (!flag) break;
      if (m[flag]) {
        delete m[flag];
        break;
      }
      m[flag] = true;
      if (flag === 'fin') {
        delete m.dbl;
        delete m.re;
      }
      if (flag === 're') {
        delete m.fin;
        delete m.dbl;
      }
      if (flag === 'dbl') {
        delete m.fin;
        delete m.re;
      }
    }
  }
  touch(n);
  redrawGrid(b.id);
  updateGridPalette();
});

registerBlockKind('grid', { build: gridBlockEl, redraw: redrawGrid, showPalette: showGridPalette });
