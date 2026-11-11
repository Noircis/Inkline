/**
 * @module exercise
 * @description
 * **Random rhythm exercises** (2.8). Pure functions.
 *
 * An exercise is a series of measures drawn at random from settings
 * ({@link ExerciseSettings}): number of measures, number of notes per measure
 * (a range), allowed positions for the first note. Each measure is then
 * written with the same rules as Placements
 * ({@link module:placements.placementItems|placementItems}).
 *
 * The randomness is **reproducible**: an exercise is entirely determined by
 * its settings and a number (the *seed*). The same number gives the same
 * exercise back, so it can be found again or shared ("do number 4821").
 *
 * ## Drawing a measure
 *
 * 1. number of notes `n` at random between min and max;
 * 2. first note `p` among the allowed positions, keeping enough room after it
 *    for the `n − 1` others (`p ≤ positions − n`). If no allowed position
 *    leaves enough room, `n` is reduced;
 * 3. the `n − 1` other notes at random after `p`;
 * 4. never the same measure twice in an exercise (2.8.1): the draw is made
 *    among the measures not drawn yet.
 */

import { slotsOf, combinations } from './placements.js';

/**
 * Exercise settings.
 * @typedef {Object} ExerciseSettings
 * @property {module:placements~Meter} meter
 * @property {number} measures Number of measures (1, 2 or 4).
 * @property {number} min Notes per measure, at least.
 * @property {number} max Notes per measure, at most.
 * @property {Array.<number>} starts Allowed positions for the first note of
 *   each measure (empty: all).
 * @property {number} seed Exercise number.
 */

/**
 * *mulberry32* pseudo-random generator: fast, 32-bit, and above all
 * deterministic (same seed, same sequence). `Math.random` does not let you
 * choose the seed, hence this small classic algorithm.
 *
 * @param {number} seed
 * @returns {function(): number} Draw in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * New exercise number (1 to 9999).
 * @param {function(): number} [rnd=Math.random]
 * @returns {number}
 */
export function newSeed(rnd = Math.random) {
  return 1 + Math.floor(rnd() * 9999);
}

/**
 * Every distinct measure the settings allow, ordered by number of notes then
 * by first note. When no allowed position leaves room for `n` notes, the
 * measure shrinks (from the first allowed position to the end).
 *
 * At most a few thousand measures (12/8: 2^12), enumerated once per
 * exercise: it is instantaneous.
 *
 * @param {ExerciseSettings} s
 * @returns {Array.<Array.<number>>}
 */
export function candidates(s) {
  const slots = slotsOf(s.meter);
  const lo = Math.max(1, Math.min(slots, s.min));
  const hi = Math.max(lo, Math.min(slots, s.max));
  let allowed = [...new Set(s.starts)].filter((p) => p >= 0 && p < slots).sort((a, b) => a - b);
  if (!allowed.length) allowed = Array.from({ length: slots }, (_, i) => i);
  const out = [];
  const seen = new Set();
  const add = (pos) => {
    const key = pos.join();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(pos);
    }
  };
  for (let n = lo; n <= hi; n++) {
    const fit = allowed.filter((p) => p <= slots - n);
    if (!fit.length) {
      add(Array.from({ length: slots - allowed[0] }, (_, i) => allowed[0] + i));
      continue;
    }
    fit.forEach((p) =>
      combinations(slots - p - 1, n - 1).forEach((rest) => add([p, ...rest.map((x) => x + p + 1)])),
    );
  }
  return out;
}

/**
 * Draws the placements of an exercise. **No measure appears twice** in one
 * exercise, as long as the settings allow it (see {@link candidates}: with a
 * single note and a single allowed position, only one measure exists).
 *
 * Rather than drawing at random and starting over when the measure was
 * already drawn (which can run for a long time when few choices remain), the
 * draw is made directly among the measures **not drawn yet**: same result,
 * but the number of operations is bounded.
 *
 * For each measure: a number of notes at random, then a first note at random
 * (every start has the same chance; otherwise early starts, which offer more
 * combinations, would come up much more often), then a measure at random
 * among those left.
 *
 * @param {ExerciseSettings} s
 * @returns {Array.<Array.<number>>} One list of positions per measure.
 */
export function generateExercise(s) {
  const rnd = mulberry32(s.seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const all = candidates(s);
  const used = new Set();
  const out = [];
  for (let m = 0; m < s.measures; m++) {
    let pool = all.filter((pos) => !used.has(pos.join()));
    if (!pool.length) pool = all; // nothing new left: repetition is unavoidable
    const n = pick([...new Set(pool.map((pos) => pos.length))].sort((a, b) => a - b));
    pool = pool.filter((pos) => pos.length === n);
    const p = pick([...new Set(pool.map((pos) => pos[0]))].sort((a, b) => a - b));
    const pos = pick(pool.filter((x) => x[0] === p));
    used.add(pos.join());
    out.push(pos);
  }
  return out;
}
