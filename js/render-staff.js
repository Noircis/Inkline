/**
 * @module render-staff
 * @description
 * Rendering of a staff as **SVG**, as a string.
 *
 * Rendering starts from the layout ({@link module:layout.layout|layout}) and
 * draws in layers, in this order (SVG order is painting order):
 *
 * 1. background of the add zone (if the block is being edited);
 * 2. staff lines, clef, time signature, measure numbers;
 * 3. barlines and start repeats;
 * 4. items: highlight, chord symbol, head, accidental, dot, stem, flags;
 * 5. beams;
 * 6. ties;
 * 7. triplet brackets;
 * 8. add cursor.
 *
 * ## Graphic conventions
 *
 * - Colors are never hard-coded: each shape gets a CSS class (`f` = filled,
 *   `s` = stroke, `h` = hollow head, `l` = staff line…) whose color comes
 *   from the theme variables. The SVG thus follows light/dark mode
 *   automatically.
 * - Heads are rotated ellipses, stems are lines, beams are polygons (to
 *   handle the slope), rests and accidentals are hand-drawn Bézier paths.
 * - Clefs use the Unicode glyphs of the "Musical Symbols" block (U+1D11E
 *   treble clef, U+1D122 bass clef) with the Noto Music font.
 *
 * ## Stem direction
 *
 * Single note: stem up if the head is below the 3rd line (`s < 4`),
 * otherwise down. Beamed group: one direction for the whole group, from the
 * average position. Rhythm line: always up.
 */

import { t } from './i18n.js';
import { esc, mod } from './util.js';
import { layout, geom, yOfStep, HALF_SPACE, KEY_ACC_W, INSERT_GAP } from './layout.js';
import { beamGroups, tupletGroups } from './rhythm.js';
import { instrumentOf } from './model.js';
import { chordParts } from './chords.js';

/** Replaces `b` and `#` with the real ♭ and ♯ signs in a chord symbol. */
/**
 * Chord symbol as SVG, as in the chart and iReal Pro (2.8.5): root, quality
 * as superscript (`−7`, `Δ7`, `ø7`), bass. An unrecognized text is written as
 * is (with ♭ and ♯ formatted).
 * @param {string} c
 * @returns {string} Content of the `<text>` element (escaped).
 */
function chordSvgText(c) {
  const p = chordParts(c);
  if (!p) return esc(c.replace(/([A-G])b/g, '$1♭').replace(/#/g, '♯'));
  const q = p.quality ? `<tspan dy="-5" font-size="10.5">${esc(p.quality)}</tspan>` : '';
  const bass = p.bass ? `<tspan${p.quality ? ' dy="5"' : ''}>${esc(p.bass)}</tspan>` : '';
  return esc(p.root) + q + bass;
}

/** Standard stem length (px), a little more than an octave. */
const STEM = 34;

/** Horizontal offset (px) of the stem from the center of the head. */
const STEM_DX = 5.6;

/**
 * Draws a rest.
 * @param {module:model~DurationCode} d
 * @param {number} x Center.
 * @param {module:layout~SystemGeom} g
 * @param {boolean} rh Rhythm line.
 * @returns {string} SVG fragment.
 */
function restSvg(d, x, g, rh) {
  const m = g.mid;
  // Whole rest: rectangle under the 4th line. Half rest: sitting on the 3rd line.
  if (d === 'w') {
    const y = rh ? m : g.staffTop + 10;
    return `<rect class="f" x="${x - 6}" y="${y}" width="12" height="5"/>`;
  }
  if (d === 'h') return `<rect class="f" x="${x - 6}" y="${m - 5}" width="12" height="5"/>`;
  // Quarter rest: thick zigzag stroke ending with a hook.
  if (d === 'q')
    return `<path class="s" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" d="M${x - 2} ${m - 15} L${x + 4} ${m - 8} L${x - 1} ${m - 2} L${x + 4} ${m + 4} C${x - 2} ${m + 1} ${x - 4} ${m + 8} ${x + 1} ${m + 12}"/>`;
  // Eighth (and sixteenth) rest: one (two) dot(s) with a hook, on a slanted stem.
  let s = `<circle class="f" cx="${x - 3}" cy="${m - 5}" r="2.6"/><path class="s" stroke-width="1.6" stroke-linecap="round" d="M${x - 3} ${m - 3} Q${x + 1} ${m - 2} ${x + 4} ${m - 7} L${x - 1} ${m + (d === '16' ? 14 : 10)}"/>`;
  if (d === '16')
    s += `<circle class="f" cx="${x - 5}" cy="${m + 2}" r="2.6"/><path class="s" stroke-width="1.6" stroke-linecap="round" d="M${x - 5} ${m + 4} Q${x - 1} ${m + 5} ${x + 2} ${m + 1}"/>`;
  return s;
}

/**
 * Draws an accidental to the left of a head.
 * @param {number} a Flat, natural, sharp.
 * @param {number} x Center of the accidental.
 * @param {number} y Y of the head.
 * @returns {string}
 */
function accSvg(a, x, y) {
  if (a === 1)
    return `<path class="s" stroke-width="1.2" d="M${x - 2.5} ${y - 9}V${y + 10}M${x + 2.5} ${y - 10}V${y + 9}"/><path class="s" stroke-width="2.6" d="M${x - 5} ${y - 2}L${x + 5} ${y - 4.5}M${x - 5} ${y + 4.5}L${x + 5} ${y + 2}"/>`;
  if (a === 0)
    return `<path class="s" stroke-width="1.2" d="M${x - 3} ${y - 10}V${y + 4}M${x + 3} ${y - 4}V${y + 10}"/><path class="s" stroke-width="2.4" d="M${x - 3} ${y - 1.5}L${x + 3} ${y - 3.5}M${x - 3} ${y + 3.5}L${x + 3} ${y + 1.5}"/>`;
  return `<path class="s" stroke-width="1.3" d="M${x - 3} ${y - 13}V${y + 5}"/><path class="s" stroke-width="1.9" d="M${x - 3} ${y + 5}C${x + 6} ${y - 1} ${x + 5} ${y - 6} ${x - 3} ${y - 1}"/>`;
}

/**
 * Positions (`s`, treble clef) of the key signature accidentals, in the
 * order they are written. In bass clef, everything is two positions lower.
 */
const KEY_POS = {
  sharp: [8, 5, 9, 6, 3, 7, 4], // F5 C5 G5 D5 A4 E5 B4
  flat: [4, 7, 3, 6, 2, 5, 1], // B4 E5 A4 D5 G4 C5 F4
};

/** X of the first key signature accidental (right after the clef). */
const KEY_X = 36;

/**
 * Draws a line's key signature.
 * @param {module:model~StaffBlock} b
 * @param {module:layout~Layout} L
 * @param {module:layout~SystemGeom} g
 * @returns {string}
 */
function keySigSvg(b, L, g) {
  const ks = b.ks || 0;
  if (!ks || b.clef === 'rhythm') return '';
  const shift = b.clef === 'bass' ? -2 : 0;
  const list = (ks > 0 ? KEY_POS.sharp : KEY_POS.flat).slice(0, Math.abs(ks));
  return list
    .map((s, k) => accSvg(ks > 0 ? 1 : -1, KEY_X + k * KEY_ACC_W, yOfStep(L, g, s + shift)))
    .join('');
}

/**
 * Draws a barline.
 * @param {string} type `'single'`, `'double'`, `'final'`, `'rep'` (end repeat).
 * @param {number} x X of the barline (right edge for compound barlines).
 * @param {module:layout~SystemGeom} g
 * @param {boolean} rh
 * @param {boolean} start `true` for a start repeat `‖:` (x = left edge).
 * @returns {string}
 */
function barSvg(type, x, g, rh, start) {
  const y1 = rh ? g.line - 10 : g.staffTop;
  const y2 = rh ? g.line + 10 : g.staffBottom;
  const h = y2 - y1;
  const thin = (xx) => `<line class="bar" x1="${xx}" x2="${xx}" y1="${y1}" y2="${y2}"/>`;
  const thick = (xx) => `<rect class="f" x="${xx}" y="${y1}" width="4" height="${h}"/>`;
  // Repeat dots: in the 2nd and 3rd spaces.
  const dots = (xx) =>
    (rh ? [g.line - 5, g.line + 5] : [g.staffTop + 15, g.staffTop + 25])
      .map((y) => `<circle class="f" cx="${xx}" cy="${y}" r="2"/>`)
      .join('');
  if (start) return thick(x) + thin(x + 7) + dots(x + 12);
  if (type === 'double') return thin(x - 4) + thin(x);
  if (type === 'final') return thin(x - 6) + thick(x - 3);
  if (type === 'rep') return dots(x - 12) + thin(x - 7) + thick(x - 3);
  return thin(x);
}

/**
 * Draws a tie: a filled crescent (two quadratic Bézier curves with different
 * heights), more elegant than a plain stroke.
 *
 * @param {number} x1 Start.
 * @param {number} x2 End.
 * @param {number} y Y of the heads.
 * @param {number} dir `1` = tie under the heads (curving down), `-1` = above.
 * @returns {string}
 */
function tieSvg(x1, x2, y, dir) {
  if (x2 - x1 < 4) return '';
  const xm = (x1 + x2) / 2;
  const h = Math.max(4, Math.min(9, (x2 - x1) * 0.15)); // height proportional to the length
  const y0 = y + dir * 6; // starts slightly away from the head
  return `<path class="f" d="M${x1} ${y0} Q${xm} ${y0 + dir * h * 2} ${x2} ${y0} Q${xm} ${y0 + dir * (h * 2 - 2.6)} ${x1} ${y0} Z"/>`;
}

/**
 * Render options.
 * @typedef {Object} StaffSvgOptions
 * @property {number|null} [sel] Index of the selected item (highlighted).
 * @property {number|null} [selEnd] Last highlighted item (note split into several pieces); `sel` by default.
 * @property {number|null} [play] Index of the item being played.
 * @property {boolean} [cursor] Show the add zone and cursor (block being edited, Write mode).
 * @property {?number} [insertAt] Insertion cursor before this item (with `cursor`); missing: at the end of the staff.
 * @property {number} [maxSystems] Limit the number of lines (list thumbnails).
 */

/** Thickness of a beam (px). */
const BEAM_THICKNESS = 4.6;

/** Vertical gap between the main and secondary beam (sixteenths). */
const BEAM_GAP = 7.4;

/** Maximum slope of a beam (to stay readable). */
const MAX_BEAM_SLOPE = 0.22;

/** Minimum length of a stem under a beam (px). */
const MIN_BEAMED_STEM = 27;

/**
 * Data shared by the drawing functions of a staff.
 *
 * The `stemUp`, `beamOf` and `tops` tables are filled as the layers go:
 * beams first, then items; ties and triplets read them afterwards.
 *
 * @typedef {Object} RenderContext
 * @property {module:model~StaffBlock} b Block drawn.
 * @property {module:model~StaffItem[]} items Its items.
 * @property {module:layout~Layout} L Layout.
 * @property {number} W Width in px.
 * @property {number} sysCount Number of lines drawn.
 * @property {StaffSvgOptions} opt Render options.
 * @property {Object.<number, {sx: number, y1: number, y2: number}>} beamStem Stem imposed by the beam.
 * @property {Object.<number, boolean>} stemUp Stem direction of each note (`true` = up).
 * @property {Object.<number, number>} beamOf Beam group of each note.
 * @property {Object.<number, number>} tops Highest point of each item (to place triplets).
 */

/**
 * Is item `i` on a drawn line?
 * @param {RenderContext} ctx
 * @param {number} i
 * @returns {boolean}
 */
function isVisible(ctx, i) {
  return !!ctx.L.pos[i] && ctx.L.pos[i].sys < ctx.sysCount;
}

/**
 * Layer 2: staff lines, clef, time signature (1st line) or measure number (following lines).
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawStaffLines(ctx) {
  const { L, b, W } = ctx;
  let out = '';
  for (let sys = 0; sys < ctx.sysCount; sys++) {
    const g = geom(L, sys);
    const system = L.systems[sys];
    // After a final barline, the lines stop at the barline (engraving convention).
    const xEnd = L.ended && sys === L.systems.length - 1 ? system.end : W;
    if (L.rh) {
      out += `<line class="l" x1="0" x2="${xEnd}" y1="${g.line}" y2="${g.line}"/>`;
      // Percussion "clef": two vertical bars.
      out += `<rect class="f" x="9" y="${g.line - 10}" width="3.2" height="20"/><rect class="f" x="15" y="${g.line - 10}" width="3.2" height="20"/>`;
    } else {
      for (let k = 0; k < 5; k++) {
        const y = g.staffTop + k * 10;
        out += `<line class="l" x1="0" x2="${xEnd}" y1="${y}" y2="${y}"/>`;
      }
      out += `<line class="bar" x1="0.6" x2="0.6" y1="${g.staffTop}" y2="${g.staffBottom}"/>`;
      out +=
        b.clef === 'bass'
          ? `<text class="clef" x="4" y="${g.staffTop + 30}" font-size="38">\u{1D122}</text>`
          : `<text class="clef" x="3" y="${g.staffTop + 30}" font-size="38">\u{1D11E}</text>`;
      out += keySigSvg(b, L, g);
    }
    if (sys === 0) {
      const [num, den] = b.time.split('/').map(esc);
      const tx = 46 + L.ksw;
      out += L.rh
        ? `<text class="t" x="34" y="${g.line - 3}" font-size="15" text-anchor="middle">${num}</text><text class="t" x="34" y="${g.line + 14}" font-size="15" text-anchor="middle">${den}</text>`
        : `<text class="t" x="${tx}" y="${g.staffTop + 17}" font-size="21" text-anchor="middle">${num}</text><text class="t" x="${tx}" y="${g.staffTop + 37}" font-size="21" text-anchor="middle">${den}</text>`;
      // Transposing instrument (2.8.3): "E♭", "B♭"… above the time signature.
      const tag = L.rh ? '' : instrumentOf(b.tr).tag;
      if (tag)
        out += `<text class="t trtag" x="${tx}" y="${g.staffTop - 7}" font-size="13" text-anchor="middle">${esc(tag)}</text>`;
    } else if (system.ms.length) {
      out += `<text class="mnum" x="2" y="${L.rh ? g.line - 16 : g.staffTop - 8}">${system.firstMeasure}</text>`;
    }
  }
  return out;
}

/**
 * Layer 3: end-of-measure barlines and start repeats.
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawBars(ctx) {
  const { L } = ctx;
  let out = '';
  L.bars.forEach((bar) => {
    if (bar.sys < ctx.sysCount) out += barSvg(bar.type, bar.x, geom(L, bar.sys), L.rh, false);
  });
  L.starts.forEach((start) => {
    if (start.sys < ctx.sysCount) out += barSvg('rs', start.x, geom(L, start.sys), L.rh, true);
  });
  return out;
}

/**
 * Beam groups, further split by line: a beam does not cross a line break.
 * @param {RenderContext} ctx
 * @returns {number[][]}
 */
function beamGroupsBySystem(ctx) {
  const { L } = ctx;
  const groups = [];
  beamGroups(ctx.items, ctx.b.time, ctx.b.groups).forEach((group) => {
    let cur = [];
    group.forEach((i) => {
      if (cur.length && L.pos[i].sys !== L.pos[cur[0]].sys) {
        if (cur.length >= 2) groups.push(cur);
        cur = [];
      }
      cur.push(i);
    });
    if (cur.length >= 2) groups.push(cur);
  });
  return groups;
}

/**
 * Layer 5: beams. Also fills `beamStem`, `stemUp` and `beamOf`, because the
 * beam imposes the direction and length of its group's stems.
 *
 * Computing a group's beam:
 * 1. common stem direction, from the average position of the heads;
 * 2. natural slope from the tip of the 1st stem to that of the last,
 *    bounded to ±{@link MAX_BEAM_SLOPE};
 * 3. shift of the whole beam so that no stem is shorter than
 *    {@link MIN_BEAMED_STEM} px, and the beam reaches at least the 3rd line;
 * 4. secondary beam for sixteenths: continuous between neighboring
 *    sixteenths, otherwise a half beam toward the inside of the group.
 *
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawBeams(ctx) {
  const { L, items } = ctx;
  let out = '';
  beamGroupsBySystem(ctx).forEach((group, groupIndex) => {
    const sys = L.pos[group[0]].sys;
    if (sys >= ctx.sysCount) return;
    const g = geom(L, sys);
    const avgStep = group.reduce((acc, i) => acc + (L.rh ? 0 : items[i].s), 0) / group.length;
    const up = L.rh || avgStep < 4;
    const points = group.map((i) => ({
      i,
      y: yOfStep(L, g, L.rh ? 4 : items[i].s),
      sx: L.pos[i].x + (up ? STEM_DX : -STEM_DX),
    }));
    const first = points[0];
    const last = points[points.length - 1];

    const end0 = up ? first.y - (STEM - 2) : first.y + (STEM - 2);
    const end1 = up ? last.y - (STEM - 2) : last.y + (STEM - 2);
    let slope = last.sx > first.sx ? (end1 - end0) / (last.sx - first.sx) : 0;
    slope = Math.max(-MAX_BEAM_SLOPE, Math.min(MAX_BEAM_SLOPE, slope));
    const naturalY = (x) => end0 + slope * (x - first.sx);

    let shift = 0;
    points.forEach((p) => {
      const missing = up ? naturalY(p.sx) - (p.y - MIN_BEAMED_STEM) : p.y + MIN_BEAMED_STEM - naturalY(p.sx);
      if (missing > shift) shift = missing;
      // Like a single stem: the beam reaches at least the 3rd line
      // (very high or very low notes, 2.8.2).
      if (!L.rh) {
        const toMid = up ? naturalY(p.sx) - g.mid : g.mid - naturalY(p.sx);
        if (toMid > shift) shift = toMid;
      }
    });
    const beamY = (x) => naturalY(x) + (up ? -shift : shift);

    const dir = up ? 1 : -1;
    const beamPolygon = (x1, x2, offset) => {
      const a = beamY(x1) + offset * dir;
      const c = beamY(x2) + offset * dir;
      return `<polygon class="f" points="${x1},${a} ${x2},${c} ${x2},${c + BEAM_THICKNESS * dir} ${x1},${a + BEAM_THICKNESS * dir}"/>`;
    };
    out += beamPolygon(first.sx - (up ? 0.8 : 0), last.sx + (up ? 0 : 0.8), 0);

    for (let k = 0; k < points.length; k++) {
      if (items[points[k].i].d !== '16') continue;
      let j = k;
      while (j + 1 < points.length && items[points[j + 1].i].d === '16') j++;
      if (j > k) {
        out += beamPolygon(points[k].sx, points[j].sx, BEAM_GAP);
      } else {
        const x = points[k].sx;
        out += k === points.length - 1 ? beamPolygon(x - 8, x, BEAM_GAP) : beamPolygon(x, x + 8, BEAM_GAP);
      }
      k = j;
    }

    points.forEach((p) => {
      ctx.beamStem[p.i] = { sx: p.sx, y1: p.y + (up ? -1 : 1), y2: beamY(p.sx) };
      ctx.stemUp[p.i] = up;
      ctx.beamOf[p.i] = groupIndex;
    });
  });
  return out;
}

/**
 * Ledger lines of a head outside the staff (below the staff for s ≤ -2,
 * above for s ≥ 10).
 * @param {RenderContext} ctx
 * @param {module:layout~SystemGeom} g
 * @param {number} x Center of the head.
 * @param {number} step Position of the head.
 * @returns {string}
 */
function ledgerLines(ctx, g, x, step) {
  let out = '';
  const line = (k) => {
    const ly = yOfStep(ctx.L, g, k);
    out += `<line class="s" stroke-width="1.2" x1="${x - 10}" x2="${x + 10}" y1="${ly}" y2="${ly}"/>`;
  };
  for (let k = -2; k >= step; k -= 2) line(k);
  for (let k = 10; k <= step; k += 2) line(k);
  return out;
}

/**
 * Stem (and flags) of an unbeamed note.
 * Stem up if the head is below the 3rd line; it reaches at least the middle
 * line (engraving rule).
 * @param {RenderContext} ctx
 * @param {module:model~StaffItem} it
 * @param {number} i
 * @param {module:layout~SystemGeom} g
 * @param {number} x Center of the head.
 * @param {number} y Y of the head.
 * @param {number} step Position of the head.
 * @returns {{svg: string, top: number|null}} `top`: top end of the stem if it goes up.
 */
function freeStem(ctx, it, i, g, x, y, step) {
  const rh = ctx.L.rh;
  const up = rh || step < 4;
  ctx.stemUp[i] = up;
  const sx = x + (up ? STEM_DX : -STEM_DX);
  let ey = up ? y - STEM : y + STEM;
  if (!rh) {
    if (up && ey > g.mid) ey = g.mid;
    if (!up && ey < g.mid) ey = g.mid;
  }
  let svg = `<line class="s" stroke-width="1.3" x1="${sx}" x2="${sx}" y1="${y + (up ? -1 : 1)}" y2="${ey}"/>`;
  const flagCount = it.d === '8' ? 1 : it.d === '16' ? 2 : 0;
  for (let k = 0; k < flagCount; k++) {
    const o = k * 7;
    svg += up
      ? `<path class="s" stroke-width="2" stroke-linecap="round" d="M${sx} ${ey + o} C${sx} ${ey + o + 7} ${sx + 9} ${ey + o + 11} ${sx + 7} ${ey + o + 22}"/>`
      : `<path class="s" stroke-width="2" stroke-linecap="round" d="M${sx} ${ey - o} C${sx} ${ey - o - 7} ${sx + 9} ${ey - o - 11} ${sx + 7} ${ey - o - 22}"/>`;
  }
  return { svg, top: up ? ey : null };
}

/**
 * Drawing of a note: ledger lines, head, accidental, dot, stem.
 * Fills in `tops[i]`.
 * @param {RenderContext} ctx
 * @param {module:model~StaffItem} it
 * @param {number} i
 * @param {module:layout~SystemGeom} g
 * @param {number} x
 * @returns {string}
 */
function drawNote(ctx, it, i, g, x) {
  const rh = ctx.L.rh;
  const step = rh ? 4 : it.s;
  const y = yOfStep(ctx.L, g, step);
  let out = rh ? '' : ledgerLines(ctx, g, x, step);

  // Head: hollow for whole and half notes, filled otherwise.
  const whole = it.d === 'w';
  const hollow = whole || it.d === 'h';
  const rx = whole ? 7.6 : 6.2;
  const ry = whole ? 4.8 : 4.5;
  out += `<ellipse class="${hollow ? 'h' : 'f'}" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${whole ? -8 : -22} ${x} ${y})"${hollow ? ' stroke-width="' + (whole ? 2.4 : 1.8) + '"' : ''}/>`;
  if (it.a != null && !rh) out += accSvg(it.a, x - 15, y);

  // Dot: in the space above if the head is on a line.
  if (it.dot) {
    const dy = rh || mod(step, 2) === 0 ? y - HALF_SPACE : y;
    out += `<circle class="f" cx="${x + (whole ? 13 : 11)}" cy="${dy}" r="1.9"/>`;
  }

  let top = y - 6;
  if (whole) {
    ctx.stemUp[i] = step < 4; // no stem, but the direction is used by ties
  } else if (ctx.beamStem[i]) {
    const st = ctx.beamStem[i];
    out += `<line class="s" stroke-width="1.3" x1="${st.sx}" x2="${st.sx}" y1="${st.y1}" y2="${st.y2}"/>`;
    if (ctx.stemUp[i]) top = st.y2;
  } else {
    const stem = freeStem(ctx, it, i, g, x, y, step);
    out += stem.svg;
    if (stem.top != null) top = stem.top;
  }
  ctx.tops[i] = top;
  return out;
}

/**
 * Layer 4: items (highlight, chord symbol, note or rest).
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawItems(ctx) {
  const { L, opt } = ctx;
  let out = '';
  ctx.items.forEach((it, i) => {
    if (!isVisible(ctx, i)) return;
    const p = L.pos[i];
    const g = geom(L, p.sys);
    // A note split by a barline (automatic pieces) is highlighted as a whole.
    const selected = opt.sel != null && i >= opt.sel && i <= (opt.selEnd ?? opt.sel);
    const cls = 'it' + (selected ? ' sel' : '') + (opt.play === i ? ' play' : '');
    let s = `<g class="${cls}">`;
    if (selected) {
      const top = L.rh ? g.line - 26 : g.staffTop - 14;
      s += `<rect class="selbg" x="${p.x0}" y="${top}" width="${p.x1 - p.x0}" height="${L.rh ? 52 : 68}" rx="4"/>`;
    }
    if (it.c) s += `<text class="chord" x="${p.x - 6}" y="${g.chordY}">${chordSvgText(it.c)}</text>`;
    if (it.r) {
      s += restSvg(it.d, p.x, g, L.rh);
      if (it.dot) s += `<circle class="f" cx="${p.x + 10}" cy="${g.mid - 5}" r="1.9"/>`;
      ctx.tops[i] = L.rh ? g.line - 16 : g.staffTop;
    } else {
      s += drawNote(ctx, it, i, g, p.x);
    }
    out += s + '</g>';
  });
  return out;
}

/**
 * Layer 6: ties.
 *
 * A tie goes from the tied head to the next head, on the side opposite the
 * stem. If the next note is on the following line, two half ties are drawn:
 * to the end of the line, then from the start of the next one. With no next
 * note, a short "pending" tie.
 *
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawTies(ctx) {
  const { L, items } = ctx;
  let out = '';
  items.forEach((it, i) => {
    if (!it.tie || it.r || !isVisible(ctx, i)) return;
    const p = L.pos[i];
    const y = yOfStep(L, geom(L, p.sys), L.rh ? 4 : it.s);
    const dir = L.rh || ctx.stemUp[i] ? 1 : -1;
    const next = items[i + 1];
    const q = L.pos[i + 1];
    if (!next || next.r || !q) {
      out += tieSvg(p.x + 7, p.x + 22, y, dir);
    } else if (q.sys === p.sys) {
      out += tieSvg(p.x + 7, q.x - 7, y, dir);
    } else {
      out += tieSvg(p.x + 7, Math.max(p.x + 20, L.systems[p.sys].end - 2), y, dir);
      if (q.sys < ctx.sysCount) {
        const nextY = yOfStep(L, geom(L, q.sys), L.rh ? 4 : next.s);
        out += tieSvg(L.systems[q.sys].start - 10, q.x - 7, nextY, dir);
      }
    }
  });
  return out;
}

/**
 * Layer 7: triplets. A "3" above the group; if the group is not exactly a
 * stems-up beam, a horizontal bracket with two small hooks pointing down is
 * added.
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawTuplets(ctx) {
  const { L } = ctx;
  let out = '';
  tupletGroups(ctx.items, ctx.b.time).forEach((tg) => {
    const shown = tg.idx.filter((i) => isVisible(ctx, i));
    if (!shown.length) return;
    const sys = L.pos[shown[0]].sys;
    const onLine = shown.filter((i) => L.pos[i].sys === sys); // only the 1st line of the group carries the number
    const g = geom(L, sys);
    const x0 = L.pos[onLine[0]].x - 8;
    const x1 = L.pos[onLine[onLine.length - 1]].x + 8;
    const minTop = Math.min(...onLine.map((i) => ctx.tops[i] ?? g.staffTop), L.rh ? g.line - 30 : g.staffTop);
    const y = Math.max(g.top + 26, minTop - 8);
    const xm = (x0 + x1) / 2;
    const singleBeam =
      onLine.length >= 2 &&
      onLine.every(
        (i) => ctx.beamOf[i] !== undefined && ctx.beamOf[i] === ctx.beamOf[onLine[0]] && ctx.stemUp[i],
      );
    if (!singleBeam) {
      out += `<path class="s" stroke-width="1.1" d="M${x0} ${y + 5} V${y} H${xm - 7} M${xm + 7} ${y} H${x1} V${y + 5}"/>`;
    }
    out += `<text class="tup" x="${xm}" y="${y + 4}" text-anchor="middle">3</text>`;
  });
  return out;
}

/**
 * Layers 1 and 8: add zone background and dotted cursor.
 * @param {RenderContext} ctx
 * @returns {{background: string, cursor: string}}
 */
function drawAppendZone(ctx) {
  const { L, W } = ctx;
  if (!ctx.opt.cursor) return { background: '', cursor: '' };
  if (L.insertX != null && L.insertSys < ctx.sysCount) {
    // Insertion cursor in the middle of the staff: narrow zone in the opened gap.
    const g = geom(L, L.insertSys);
    const y1 = L.rh ? g.line - 18 : g.staffTop - 10;
    const y2 = L.rh ? g.line + 18 : g.staffBottom + 10;
    const half = INSERT_GAP / 2;
    return {
      background: `<rect class="cursorbg" x="${L.insertX - half}" y="${y1}" width="${INSERT_GAP}" height="${y2 - y1}" rx="4"/>`,
      cursor: `<line class="cursor" x1="${L.insertX}" x2="${L.insertX}" y1="${y1}" y2="${y2}"/>`,
    };
  }
  if (L.appendX == null || L.appendSys >= ctx.sysCount) return { background: '', cursor: '' };
  const g = geom(L, L.appendSys);
  const y1 = L.rh ? g.line - 18 : g.staffTop - 10;
  const y2 = L.rh ? g.line + 18 : g.staffBottom + 10;
  return {
    background: `<rect class="cursorbg" x="${L.appendX - 6}" y="${y1}" width="${Math.max(30, W - L.appendX + 6)}" height="${y2 - y1}" rx="4"/>`,
    cursor: `<line class="cursor" x1="${L.appendX}" x2="${L.appendX}" y1="${y1}" y2="${y2}"/>`,
  };
}

/**
 * Renders a full staff as SVG.
 *
 * Layers are computed in dependency order (beams before notes, which get
 * their stems from them; notes before ties and triplets, which need stem
 * directions and high points), then assembled in the painting order
 * described in the module header.
 *
 * @param {module:model~StaffBlock} b
 * @param {number} W Width in px.
 * @param {StaffSvgOptions} [opt]
 * @returns {{svg: string, L: module:layout~Layout}} The SVG and the layout
 *   used (reused by the caller for hit testing).
 */
export function staffSvg(b, W, opt = {}) {
  const L = layout(b, W, !!opt.cursor, opt.cursor ? (opt.insertAt ?? null) : null);
  const sysCount = opt.maxSystems ? Math.min(opt.maxSystems, L.systems.length) : L.systems.length;
  const height = sysCount * L.SH;
  /** @type {RenderContext} */
  const ctx = { b, items: b.items, L, W, sysCount, opt, beamStem: {}, stemUp: {}, beamOf: {}, tops: {} };

  const staff = drawStaffLines(ctx);
  const bars = drawBars(ctx);
  const beams = drawBeams(ctx);
  const items = drawItems(ctx);
  const ties = drawTies(ctx);
  const tuplets = drawTuplets(ctx);
  const zone = drawAppendZone(ctx);

  const svg =
    `<svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(t('staff.staff'))}">` +
    zone.background +
    staff +
    bars +
    items +
    beams +
    ties +
    tuplets +
    zone.cursor +
    '</svg>';
  return { svg, L };
}
