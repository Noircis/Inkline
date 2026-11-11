/**
 * @module grid
 * @description
 * **Pure** logic of chord charts (iReal Pro style): input, durations,
 * playback order, HTML rendering (screen) and SVG rendering (image export).
 * Interaction (palette, taps) is in {@link module:ui/grid-ui|ui/grid-ui}.
 *
 * ## Rendering
 *
 * The chart is a 4-column CSS Grid: one measure per cell, 4 measures per
 * line as in iReal. Barlines are not drawn: they are the cells' **borders**,
 * chosen through CSS classes from the flags of the measure and of its left
 * neighbor:
 *
 * | Class      | Meaning                                          |
 * |------------|--------------------------------------------------|
 * | `lb-rs`    | left border = start repeat `‖:`                  |
 * | `lb-dbl`   | left border = double barline (section start)     |
 * | `lb-none`  | no left border (the neighbor already has a special barline) |
 * | `rb-re`    | right border = end repeat `:‖`                   |
 * | `rb-dbl`   | right border = double barline                    |
 * | `rb-fin`   | right border = final barline                     |
 * | `rb`       | simple right border (end of line)                |
 */

import { t } from './i18n.js';
import { esc } from './util.js';
import { mlen } from './model.js';
import { chordHtml, chordParts } from './chords.js';

/** iReal Pro styles offered (an imported tune's style is added if missing). */
export const STYLES = [
  'Medium Swing',
  'Medium Up Swing',
  'Up Tempo Swing',
  'Slow Swing',
  'Ballad',
  'Jazz Waltz',
  'Bossa Nova',
  'Samba',
  'Latin',
  'Afro Cuban',
  'Funk',
  'Even 8ths',
  'Rock',
  'Pop',
  'Blues',
  'Gospel',
  'Waltz',
];

/** The 12 tonics, iReal notation (flats rather than sharps, except the usual exceptions). */
export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Sequence of section marks cycled by the "Section" button. */
export const SECTIONS = ['', 'A', 'B', 'C', 'D', 'Intro'];

/**
 * Label of an iReal key in the interface language (`'Bb'` → `'B♭ major'`, `'C-'` → `'C minor'`).
 * @param {string} k
 * @returns {string}
 */
export function keyLabel(k) {
  return k.endsWith('-')
    ? t('key.minor', { k: k.slice(0, -1).replace('b', '♭') })
    : t('key.major', { k: k.replace('b', '♭') });
}

/**
 * Turns a measure's input into slots.
 *
 * - separators: spaces and commas;
 * - `/` → empty slot (continues the previous chord);
 * - `n`, `NC`, `N.C.` → *no chord*;
 * - `%` → measure repeat;
 * - the first letter is capitalized (`bb7` → `Bb7`), handy on a phone keyboard.
 *
 * @example
 * gridTokens('cm7 / f7 NC')  // ['Cm7', '', 'F7', 'n']
 *
 * @param {string} txt
 * @returns {string[]}
 */
export function gridTokens(txt) {
  return txt
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((tok) => {
      if (/^(n|nc|n\.c\.?)$/i.test(tok)) return 'n';
      if (tok === '/') return '';
      if (tok === '%') return '%';
      return /^[a-g]/.test(tok) ? tok[0].toUpperCase() + tok.slice(1) : tok;
    });
}

/**
 * Edit text of a measure (inverse of {@link gridTokens}).
 * @param {module:model~GridMeasure} m
 * @returns {string}
 */
export function measureText(m) {
  return m.ch.map((x) => (x === '' ? '/' : x === 'n' ? 'NC' : x)).join(' ');
}

/**
 * Duration (in quarter notes) of each of the `k` slots of a measure.
 *
 * The measure's **beats** are spread over the slots, the first ones getting
 * the surplus, as in iReal:
 * - 4/4, 2 chords → 2 + 2; 3 chords → 2 + 1 + 1; 4 chords → 1 each;
 * - 3/4, 2 chords → 2 + 1.
 * In compound time (x/8), the beat is the dotted quarter note.
 *
 * @param {number} k Number of slots.
 * @param {string} time
 * @returns {number[]}
 */
export function slotDurations(k, time) {
  const total = mlen(time);
  const n = Number(time.split('/')[0]);
  const units = time.endsWith('/8') ? n / 3 : n;
  const u = total / units;
  if (k >= units) return Array(k).fill(total / k);
  const base = Math.floor(units / k);
  const extra = units % k;
  return Array.from({ length: k }, (_, i) => (base + (i < extra ? 1 : 0)) * u);
}

/**
 * Playback order of the measures, with repeats and endings.
 *
 * State machine with three variables:
 * - `rsI`: index of the last start repeat (0 by default);
 * - `pass`: 1st or 2nd pass through the current repeat;
 * - `jumped`: end repeats already taken.
 *
 * Transitions:
 * - a new `rs` measure (other than the one just jumped to) opens a repeat:
 *   `pass = 1`;
 * - on the 2nd pass, a measure starting the 1st ending jumps straight to the
 *   2nd ending;
 * - an end repeat not yet taken goes back to `rsI` with `pass = 2`;
 * - a final barline stops playback.
 *
 * @param {module:model~GridMeasure[]} M
 * @returns {number[]} Sequence of measure indices.
 */
export function gridPlayOrder(M) {
  const order = [];
  let i = 0;
  let rsI = 0;
  let pass = 1;
  const jumped = new Set();
  while (i < M.length && order.length < 2000) {
    const m = M[i];
    if (m.rs && i !== rsI) {
      rsI = i;
      pass = 1;
    }
    if (m.ending === 1 && pass === 2) {
      const j = M.findIndex((x, k) => k > i && x.ending === 2);
      if (j > 0) {
        i = j;
        continue;
      }
    }
    order.push(i);
    if (m.re && !jumped.has(i)) {
      jumped.add(i);
      i = rsI;
      pass = 2;
      continue;
    }
    if (m.fin) break;
    i++;
  }
  return order;
}

/**
 * HTML of the chart.
 *
 * Each measure is a `<button data-gm="index">` (native touch target,
 * keyboard accessible). A `+` cell ends the chart as long as it is not
 * closed by a final barline.
 *
 * @param {module:model~GridBlock} b
 * @param {number|null} selI Selected measure.
 * @param {number|null} playI Measure being played.
 * @param {number} [limit=0] Show only the first `limit` measures (collapsed
 *   block, no `+` cell). 0: all.
 * @returns {string}
 */
export function gridHtml(b, selI, playI, limit = 0) {
  const all = b.measures;
  const M = limit ? all.slice(0, limit) : all;
  const ended = all.length && all[all.length - 1].fin;
  let h = '<div class="grid">';
  M.forEach((m, i) => {
    const prev = M[i - 1];
    const c = ['gm', 'n' + Math.min(4, m.ch.length)]; // n0..n4: font size by number of chords
    if (i === selI) c.push('sel');
    if (i === playI) c.push('play');
    // Left barline: the left neighbor already draws a special barline
    // on the same line → don't add another (avoids double strokes).
    const special = prev && (prev.re || prev.fin || prev.dbl);
    if (m.rs) c.push('lb-rs');
    else if (special && i % 4 !== 0) c.push('lb-none');
    else if (m.sec || special) c.push('lb-dbl');
    if (m.re) c.push('rb-re');
    else if (m.fin) c.push('rb-fin');
    else if (m.dbl) c.push('rb-dbl');
    if (i % 4 === 3 || (i === all.length - 1 && ended)) c.push('rb');
    const inner =
      m.ch.length === 1 && m.ch[0] === '%'
        ? `<span class="sim" aria-label="${esc(t('grid.repeatedBar'))}">\u{1D10E}</span>`
        : m.ch.map((x) => `<span class="gc">${chordHtml(x)}</span>`).join('');
    h +=
      `<button type="button" class="${c.join(' ')}" data-gm="${i}">` +
      (m.sec ? `<span class="sec">${esc(m.sec)}</span>` : '') +
      (m.ending ? `<span class="volta">${esc(String(m.ending))}.</span>` : '') +
      `<span class="gcs">${inner}</span></button>`;
  });
  if (!ended && M.length === all.length)
    h += '<button type="button" class="gm add" data-gm="add" aria-label="Ajouter une mesure">+</button>';
  return h + '</div>';
}

/** Height of a measure in the export (px). */
const SVG_ROW = 58;
/** Space between two lines of measures (px), where sections and endings go. */
const SVG_GAP = 18;
/** Top margin reserved for the marks of the first line (px). */
const SVG_TOP = 14;

/** Vertical barline stroke (rectangle, for a crisp thickness). */
const svgVline = (x, y, w = 1.4) => `<rect class="f" x="${x}" y="${y}" width="${w}" height="${SVG_ROW}"/>`;

/** Two repeat dots, vertically centered. */
const svgDots = (x, y) =>
  `<circle class="f" cx="${x}" cy="${y + SVG_ROW / 2 - 6}" r="2.1"/><circle class="f" cx="${x}" cy="${y + SVG_ROW / 2 + 6}" r="2.1"/>`;

/**
 * SVG rendering of a chart, for image or PDF export.
 *
 * Same logic as {@link module:grid.gridHtml|gridHtml}, but barlines are real
 * strokes (not CSS borders) and chords are `<text>` elements: the result is
 * self-contained and can be rasterized.
 *
 * Layout: 4 measures per line, cells `W / 4` wide. Section and ending marks
 * overflow above each line, hence the space reserved at the top.
 *
 * @param {module:model~GridBlock} b
 * @param {number} W Width in px.
 * @returns {{svg: string, height: number}} SVG fragment (no enclosing `<svg>` tag) and height.
 */
export function gridSvg(b, W) {
  const M = b.measures;
  const cellW = W / 4;
  let out = '';
  M.forEach((m, i) => {
    const col = i % 4;
    const x0 = col * cellW;
    const x1 = x0 + cellW;
    const y0 = SVG_TOP + Math.floor(i / 4) * (SVG_ROW + SVG_GAP);
    out += svgBarlines(M, i, col, x0, x1, y0);
    out += svgLabels(m, x0, x1, y0);
    out += svgChords(m, x0 + (m.rs ? 18 : 9), x1 - (m.re ? 16 : 6), y0);
  });
  const rows = Math.max(1, Math.ceil(M.length / 4));
  return { svg: out, height: SVG_TOP + rows * (SVG_ROW + SVG_GAP) - SVG_GAP + 4 };
}

/**
 * Left and right barlines of measure `i` (same logic as the `lb-*` / `rb-*`
 * classes of {@link module:grid.gridHtml|gridHtml}).
 * @param {module:model~GridMeasure[]} M
 * @param {number} i
 * @param {number} col Column (0 to 3).
 * @param {number} x0 Left edge.
 * @param {number} x1 Right edge.
 * @param {number} y0 Top of the measure.
 * @returns {string}
 */
function svgBarlines(M, i, col, x0, x1, y0) {
  const m = M[i];
  const prev = M[i - 1];
  const prevSpecial = prev && (prev.re || prev.fin || prev.dbl);
  let out = '';
  // Left. If the left neighbor (same line) already has a special barline, don't add another.
  const leftAlreadyDrawn = prevSpecial && col !== 0;
  if (m.rs) {
    out += svgVline(x0, y0, 4) + svgVline(x0 + 6, y0) + svgDots(x0 + 11.5, y0);
  } else if (!leftAlreadyDrawn) {
    out += m.sec || prevSpecial ? svgVline(x0, y0) + svgVline(x0 + 3.5, y0) : svgVline(x0, y0);
  }
  // Right.
  if (m.re) out += svgDots(x1 - 11.5, y0) + svgVline(x1 - 7.4, y0) + svgVline(x1 - 4, y0, 4);
  else if (m.fin) out += svgVline(x1 - 7.4, y0) + svgVline(x1 - 4, y0, 4);
  else if (m.dbl) out += svgVline(x1 - 5, y0) + svgVline(x1 - 1.4, y0);
  else if (col === 3 || i === M.length - 1) out += svgVline(x1 - 1.4, y0);
  return out;
}

/**
 * Section mark (filled label) and ending (bracket), above the measure.
 * @param {module:model~GridMeasure} m
 * @param {number} x0
 * @param {number} x1
 * @param {number} y0
 * @returns {string}
 */
function svgLabels(m, x0, x1, y0) {
  let out = '';
  let voltaX = x0 + 14;
  if (m.sec) {
    const w = m.sec.length * 7.5 + 9;
    out += `<rect class="f" x="${x0 - 3}" y="${y0 - 12}" width="${w}" height="16" rx="3"/><text class="secl" x="${x0 - 3 + w / 2}" y="${y0 + 0.5}" text-anchor="middle">${esc(m.sec)}</text>`;
    voltaX = x0 + w + 4; // the ending starts after the section label
  }
  if (m.ending) {
    out += `<path class="s" stroke-width="1.4" d="M${voltaX} ${y0 + 2} V${y0 - 9} H${x1 - 3}"/><text class="volt" x="${voltaX + 4}" y="${y0 + 1}">${esc(String(m.ending))}.</text>`;
  }
  return out;
}

/**
 * Chords of a measure, between `left` and `right`.
 * 1 or 2 chords: on one line; 3 or 4: in a 2 × 2 square (smaller).
 * The quality is superscript (`tspan` shifted by 42% of the font size).
 * @param {module:model~GridMeasure} m
 * @param {number} left
 * @param {number} right
 * @param {number} y0
 * @returns {string}
 */
function svgChords(m, left, right, y0) {
  if (m.ch.length === 1 && m.ch[0] === '%') {
    return `<text class="simg" x="${(left + right) / 2}" y="${y0 + SVG_ROW / 2 + 9}" text-anchor="middle">\u{1D10E}</text>`;
  }
  const k = m.ch.length;
  const fs = k <= 1 ? 20 : k === 2 ? 17 : 13.5;
  const slotW = (right - left) / (k <= 2 ? Math.max(1, k) : 2);
  let out = '';
  m.ch.forEach((c, j) => {
    const cx = left + (k <= 2 ? j : j % 2) * slotW;
    const cy = y0 + (k <= 2 ? SVG_ROW / 2 + fs * 0.35 : j < 2 ? SVG_ROW * 0.42 : SVG_ROW * 0.82);
    if (c === '') {
      out += `<text class="chm" x="${cx}" y="${cy}" font-size="${fs}">/</text>`;
      return;
    }
    if (c === 'n') {
      out += `<text class="chg" x="${cx}" y="${cy}" font-size="${fs * 0.7}">N.C.</text>`;
      return;
    }
    const p = chordParts(c);
    if (!p) {
      out += `<text class="chg" x="${cx}" y="${cy}" font-size="${fs}">${esc(c)}</text>`;
      return;
    }
    const up = (fs * 0.42).toFixed(1);
    out +=
      `<text class="chg" x="${cx}" y="${cy}" font-size="${fs}">${esc(p.root)}` +
      (p.quality ? `<tspan font-size="${fs * 0.62}" dy="-${up}">${esc(p.quality)}</tspan>` : '') +
      (p.bass
        ? `<tspan font-size="${fs * 0.72}" font-weight="500" dy="${p.quality ? up : 0}">${esc(p.bass)}</tspan>`
        : '') +
      '</text>';
  });
  return out;
}
