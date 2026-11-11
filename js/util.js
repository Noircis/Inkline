/**
 * @module util
 * @description
 * Small dependency-free helpers shared by every module.
 *
 * None of them touches the DOM: they can be used as is in Node tests.
 */

/** Tolerance used to compare durations stored as floats (in quarter notes). */
export const EPS = 1e-6;

/**
 * Generates a short id, unique enough for local use (one user's notes and
 * blocks).
 *
 * Format: 8 random base-36 characters, followed by the last 4 base-36
 * characters of the timestamp. No cryptographic guarantee: that is not the goal.
 *
 * @returns {string} Id, e.g. `"k3j9x0aa1b2c"`.
 */
export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Mathematical modulo (always non-negative), unlike JavaScript's `%`
 * operator, which keeps the sign of the dividend.
 *
 * @example
 * mod(-1, 7) // 6  (whereas -1 % 7 === -1)
 *
 * @param {number} a Dividend.
 * @param {number} n Divisor (strictly positive).
 * @returns {number} Remainder in [0, n).
 */
export function mod(a, n) {
  return ((a % n) + n) % n;
}

/**
 * Clamps a value to a closed interval.
 *
 * @param {number} v Value.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @returns {number} `v` brought back into [lo, hi].
 */
export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Rounds a time position to cancel accumulated floating-point error.
 * Without it, three triplet eighths (3 × 1/3) would sometimes add up to
 * 0.9999999999 instead of 1, and the measure would never count as full.
 *
 * @param {number} x Position in quarter notes.
 * @returns {number} Position rounded to 1e-9.
 */
export function snap(x) {
  return Math.round(x * 1e9) / 1e9;
}

/**
 * Escapes a string before inserting it into HTML or SVG built with template
 * strings (protection against tag injection).
 *
 * @param {*} s Value to escape (converted to a string).
 * @returns {string} String safe between tags or inside a double-quoted attribute.
 */
export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
