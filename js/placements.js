/**
 * @module placements
 * @description
 * **Rhythm practice: placements** (since 2.3, every time signature since
 * 2.8). Pure functions, shared with the exercise generator
 * ({@link module:exercise|exercise}).
 *
 * A measure is split into eighth-note **positions**. In 4/4:
 *
 * ```
 * position: 0  1  2  3  4  5  6  7
 * count:    1  &  2  &  3  &  4  &
 * ```
 *
 * Eighth notes are arranged in **groups** of 2 or 3 (one beat): pairs in
 * x/4, groups of 3 in 6/8, 9/8, 12/8, and a mix in 5/8 or 7/8 (see
 * {@link METERS}). For `n` notes, every way of choosing `n` positions is
 * generated ({@link combinations}), each placement is written group by group
 * ({@link placementItems}), then grouped into series by position of the
 * first note ({@link placementSeries}).
 *
 * ## Writing rules (eighth notes)
 *
 * Group of 2 (one beat in x/4):
 *
 * | eighths | written as                 |
 * |---------|----------------------------|
 * | x.      | quarter note               |
 * | .x      | eighth rest + eighth note  |
 * | xx      | two eighths (beamed)       |
 * | ..      | quarter rest               |
 *
 * Group of 3 (one beat of compound time):
 *
 * | eighths | written as                           |
 * |---------|--------------------------------------|
 * | x..     | dotted quarter note                  |
 * | .x.     | eighth rest, eighth note, eighth rest |
 * | ..x     | quarter rest, eighth note            |
 * | xx.     | eighth note, quarter note            |
 * | x.x     | quarter note, eighth note            |
 * | .xx     | eighth rest, two eighths             |
 * | xxx     | three eighths                        |
 * | ...     | dotted quarter rest                  |
 *
 * A note never spills over into the next group (no syncopation). Then the
 * rests of two neighboring empty beats are merged (half rest, or dotted half
 * rest in compound time):
 * - in 3 beats (3/4, 9/8): any pair;
 * - otherwise, only a pair starting on an odd beat (1-2, 3-4): in 4/4, the
 *   middle of the measure must stay visible, never 2-3;
 * - never in odd meters (5/8, 7/8): each group stays readable.
 */

import { t } from './i18n.js';

/**
 * A time signature offered in practice.
 * @typedef {Object} Meter
 * @property {string} key Id (`'4/4'`, `'7/8:2+3+2'`).
 * @property {string} time Time signature.
 * @property {Array.<number>} groups Eighth-note groups.
 * @property {string} label Short label.
 * @property {'simple'|'compound'|'odd'} kind Simple (x/4), compound, odd.
 */

/**
 * Builds a {@link Meter}.
 * @param {string} time
 * @param {Array.<number>} groups
 * @returns {Meter}
 */
export function meter(time, groups) {
  const odd = groups.some((g) => g !== groups[0]);
  return {
    key: odd ? `${time}:${groups.join('+')}` : time,
    time,
    groups,
    label: odd ? `${time} (${groups.join('+')})` : time,
    kind: odd ? 'odd' : groups[0] === 3 ? 'compound' : 'simple',
  };
}

/** Time signatures offered, in display order. */
export const METERS = Object.freeze([
  meter('4/4', [2, 2, 2, 2]),
  meter('3/4', [2, 2, 2]),
  meter('2/4', [2, 2]),
  meter('5/4', [2, 2, 2, 2, 2]),
  meter('6/8', [3, 3]),
  meter('9/8', [3, 3, 3]),
  meter('12/8', [3, 3, 3, 3]),
  meter('3/8', [3]),
  meter('5/8', [2, 3]),
  meter('5/8', [3, 2]),
  meter('7/8', [2, 2, 3]),
  meter('7/8', [2, 3, 2]),
  meter('7/8', [3, 2, 2]),
]);

/**
 * Time signature from its id (4/4 if unknown).
 * @param {string} key
 * @returns {Meter}
 */
export function meterOf(key) {
  return METERS.find((m) => m.key === key) || METERS[0];
}

/**
 * Number of positions (eighth notes) of a time signature.
 * @param {Meter} m
 * @returns {number}
 */
export const slotsOf = (m) => m.groups.reduce((s, g) => s + g, 0);

/** Positions per measure in 4/4 (2.3 compatibility). */
export const SLOTS = 8;

/**
 * Every way of choosing `k` positions among `n`, in lexicographic order:
 * `[0,1]`, `[0,2]`… Classic recursive algorithm: for each possible first
 * position, complete with the combinations of the following positions.
 *
 * @param {number} n Number of positions.
 * @param {number} k Number of positions to choose.
 * @returns {Array.<Array.<number>>}
 */
export function combinations(n, k) {
  const out = [];
  const pick = (start, chosen) => {
    if (chosen.length === k) {
      out.push(chosen.slice());
      return;
    }
    // Enough positions must remain to complete: i <= n - (k - chosen.length).
    for (let i = start; i <= n - (k - chosen.length); i++) {
      chosen.push(i);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  if (k >= 0 && k <= n) pick(0, []);
  return out;
}

/** Writing of a group of 2 eighths according to the positions played. */
const PAIR = {
  'x.': [{ d: 'q' }],
  '.x': [{ d: '8', r: true }, { d: '8' }],
  xx: [{ d: '8' }, { d: '8' }],
};

/** Writing of a group of 3 eighths (see the table in the module header). */
const TRIPLE = {
  'x..': [{ d: 'q', dot: true }],
  '.x.': [{ d: '8', r: true }, { d: '8' }, { d: '8', r: true }],
  '..x': [{ d: 'q', r: true }, { d: '8' }],
  'xx.': [{ d: '8' }, { d: 'q' }],
  'x.x': [{ d: 'q' }, { d: '8' }],
  '.xx': [{ d: '8', r: true }, { d: '8' }, { d: '8' }],
  xxx: [{ d: '8' }, { d: '8' }, { d: '8' }],
};

/**
 * Writes a placement as rhythm line items (see the rules in the module
 * header).
 *
 * @param {Array.<number>} positions Positions played (0 to number of eighths − 1).
 * @param {Meter} [m] Time signature (4/4 by default).
 * @returns {module:model~StaffItem[]}
 * @example
 * placementItems([4]) // note on 3: half rest, quarter note, quarter rest
 * // → [{d:'h', r:true}, {d:'q'}, {d:'q', r:true}]
 * placementItems([1], meterOf('6/8')) // → eighth rest, eighth note, eighth rest, dotted quarter rest
 */
export function placementItems(positions, m = METERS[0]) {
  const on = new Set(positions);
  /** One array of items per group, `null` for an empty group. */
  const cells = [];
  let off = 0;
  m.groups.forEach((g) => {
    let key = '';
    for (let k = 0; k < g; k++) key += on.has(off + k) ? 'x' : '.';
    const table = g === 3 ? TRIPLE : PAIR;
    cells.push(table[key] ? table[key].map((it) => ({ ...it })) : null);
    off += g;
  });
  const dot = m.kind === 'compound';
  const rest = (g) => (g === 3 ? { d: 'q', dot: true, r: true } : { d: 'q', r: true });
  const merged = dot ? { d: 'h', dot: true, r: true } : { d: 'h', r: true };
  const anyPair = cells.length === 3; // 3/4, 9/8
  const items = [];
  for (let ci = 0; ci < cells.length; ci++) {
    if (cells[ci]) {
      items.push(...cells[ci]);
    } else if (m.kind !== 'odd' && ci + 1 < cells.length && !cells[ci + 1] && (anyPair || ci % 2 === 0)) {
      items.push({ ...merged }); // two empty beats merged
      ci++;
    } else {
      items.push(rest(m.groups[ci]));
    }
  }
  return items;
}

/**
 * Groups placements into **series**: a series gathers the placements whose
 * first note is at the same position (they are already consecutive in
 * {@link combinations} order). Special case: with a single note, each
 * placement would be alone in its series; they are all gathered into one.
 *
 * @param {Array.<Array.<number>>} placements
 * @returns {Array.<Array.<Array.<number>>>} List of series, each a list of placements.
 */
function groupSeries(placements) {
  if (placements.length && placements[0].length === 1) return [placements];
  const series = [];
  placements.forEach((pos) => {
    const last = series[series.length - 1];
    if (last && last[0][0] === pos[0]) last.push(pos);
    else series.push([pos]);
  });
  return series;
}

/**
 * Exercise series for `notes` notes per measure.
 * @param {number} notes
 * @param {Meter} [m] Time signature (4/4 by default).
 * @returns {Array.<Array.<Array.<number>>>}
 */
export function placementSeries(notes, m = METERS[0]) {
  return groupSeries(combinations(slotsOf(m), notes));
}

/**
 * Rhythm line block (ready to draw and play): placements one after another,
 * one measure each. Used by series and random exercises. Swing is kept only
 * in simple time.
 * @param {Array.<Array.<number>>} placements
 * @param {{tempo: number, swing: boolean}} play Playback settings.
 * @param {string} id
 * @param {Meter} [m] Time signature (4/4 by default).
 * @returns {module:model~StaffBlock}
 */
export function seriesBlock(placements, play, id, m = METERS[0]) {
  return {
    id,
    type: 'staff',
    clef: 'rhythm',
    time: m.time,
    groups: m.groups.slice(),
    tempo: play.tempo,
    swing: play.swing && m.kind === 'simple',
    justify: true, // last line stretched like the others (even reading)
    items: placements.flatMap((pos) => placementItems(pos, m)),
  };
}

/** Glyphs (Unicode, music font) of rests, by duration. */
const REST_GLYPH = { h: '\u{1D13C}', q: '\u{1D13D}', 8: '\u{1D13E}' };

/** Eighth note glyph. */
export const EIGHTH_GLYPH = '\u{1D160}';

/**
 * Start of a note in notation: the rests before it, then an eighth note.
 * Used as the title of series and for the generator's position choices.
 *
 * @example
 * startGlyphs(3) // 2 &, in 4/4: quarter rest, eighth rest, eighth note
 * @param {number} pos
 * @param {Meter} [m]
 * @returns {string}
 */
export function startGlyphs(pos, m = METERS[0]) {
  const items = placementItems([pos], m);
  let out = '';
  for (const it of items) {
    if (!it.r) break;
    out += REST_GLYPH[it.d] + (it.dot ? '.' : '');
  }
  return out + EIGHTH_GLYPH;
}

/**
 * Position said in words (screen readers): "2 and" in simple time,
 * "beat 2, 3rd eighth" otherwise.
 * @param {number} pos
 * @param {Meter} [m]
 * @returns {string}
 */
export function startLabel(pos, m = METERS[0]) {
  let off = 0;
  for (let g = 0; g < m.groups.length; g++) {
    const k = pos - off;
    if (k < m.groups[g]) {
      if (m.kind === 'simple') return k ? t('count.and', { n: g + 1 }) : `${g + 1}`;
      return k ? t('count.beatEighth', { n: g + 1, k: k + 1 }) : t('count.beat', { n: g + 1 });
    }
    off += m.groups[g];
  }
  return String(pos + 1);
}
