/**
 * @module metro-clock
 * @description
 * Timing math of the metronome engine (2.10 spike): where the beats of a
 * pre-rendered cycle sit, which beat is sounding, and when to swap in a newly
 * rendered cycle. Pure: no DOM, no Web Audio, tested under Node.
 *
 * ## Model
 *
 * One **cycle** (one bar, later possibly two) is rendered into an audio
 * buffer of `len` samples and played in a loop. Beat `i` of the cycle
 * (0 to `n - 1`) starts at sample `round(i * len / n)`: the beats are placed
 * on whole samples, so the loop never drifts against the audio clock (each
 * pass lasts exactly `len` samples).
 *
 * A playing loop is described by a {@link Timeline}: the audio time `t0` at
 * which sample 0 of the cycle played (or would have played). Global beat `k`
 * (counted from `t0`, any integer) is then beat `k mod n` of pass
 * `floor(k / n)`.
 *
 * ## Swapping a cycle
 *
 * A settings change renders a new cycle; the old loop is stopped and the new
 * one started **at the same audio time**, as soon as possible (a short lead
 * to schedule safely), even in the middle of a beat: at 1 BPM a beat lasts a
 * minute, waiting for the next one would feel broken. Both calls use the
 * audio clock, so there is no gap and no double click.
 */

/**
 * A looping cycle on the audio clock.
 * @typedef {Object} Timeline
 * @property {number} t0 Audio time (s) of sample 0 of the current pass origin.
 * @property {number} len Cycle length (samples).
 * @property {number} n Beats per cycle.
 * @property {number} sr Sample rate (Hz).
 */

/**
 * Length of a cycle in samples.
 * @param {number} tempo Beats per minute.
 * @param {number} n Beats per cycle.
 * @param {number} sr Sample rate (Hz).
 * @returns {number} Whole number of samples, at least 1.
 */
export function cycleSamples(tempo, n, sr) {
  return Math.max(1, Math.round((n * 60 * sr) / tempo));
}

/**
 * Sample at which beat `i` of a cycle starts.
 * @param {number} i Beat in the cycle (0 to `n - 1`).
 * @param {number} len Cycle length (samples).
 * @param {number} n Beats per cycle.
 * @returns {number}
 */
export function beatSample(i, len, n) {
  return Math.round((i * len) / n);
}

/**
 * Audio time at which global beat `k` of a timeline starts.
 * @param {Timeline} tl
 * @param {number} k Any integer (negative before `t0`).
 * @returns {number}
 */
export function beatTime(tl, k) {
  const pass = Math.floor(k / tl.n);
  const i = k - pass * tl.n;
  return tl.t0 + (pass * tl.len + beatSample(i, tl.len, tl.n)) / tl.sr;
}

/**
 * Global beat sounding at audio time `now` (the last beat that started).
 * @param {Timeline} tl
 * @param {number} now Audio time (s).
 * @returns {number} Global beat index; beat in the cycle = `mod(k, n)`.
 */
export function beatAt(tl, now) {
  // First estimate, then correct the rounding of beat positions.
  let k = Math.floor(((now - tl.t0) * tl.sr * tl.n) / tl.len);
  while (beatTime(tl, k + 1) <= now) k++;
  while (beatTime(tl, k) > now) k--;
  return k;
}

/**
 * Where to swap in a new cycle.
 *
 * The swap happens at `at = max(now + lead, notBefore)`: `lead` leaves time to
 * schedule safely, `notBefore` lets an already scheduled swap happen first.
 * At that time the old loop is somewhere in beat `j`, `elapsed` seconds after
 * its click. The new buffer is entered at the same place: beat `j`, `elapsed`
 * seconds in. Clicks sound the same at every tempo, so cutting into a click
 * that is still ringing continues it seamlessly; the next click then comes
 * at the new tempo, counted from the last one.
 *
 * If the new beat is shorter than `elapsed` (the new tempo is faster and its
 * next click is already overdue), the new buffer is entered at the start of
 * beat `j + 1`: that click sounds right at the swap.
 *
 * @param {Timeline} tl Playing timeline.
 * @param {number} now Audio time (s).
 * @param {number} lead Minimum delay (s) before the swap.
 * @param {number} newLen Length of the new cycle (samples).
 * @param {number} [notBefore=-Infinity] Earliest allowed swap time (s).
 * @returns {{at: number, beat: number, offset: number, timeline: Timeline}}
 *   `at`: audio time of the swap; `beat`: beat of the cycle entered;
 *   `offset`: start offset (s) in the new buffer; `timeline`: the new loop.
 */
export function swapPoint(tl, now, lead, newLen, notBefore = -Infinity) {
  const n = tl.n;
  const at = Math.max(now + lead, notBefore);
  const k = beatAt(tl, at);
  const elapsed = at - beatTime(tl, k);
  const j = ((k % n) + n) % n;
  const start = beatSample(j, newLen, n) / tl.sr;
  const next = beatSample(j + 1, newLen, n) / tl.sr;
  let beat = j;
  let offset = start + elapsed;
  if (offset >= next) {
    beat = (j + 1) % n;
    offset = beatSample(beat, newLen, n) / tl.sr;
  }
  return { at, beat, offset, timeline: { t0: at - offset, len: newLen, n, sr: tl.sr } };
}
