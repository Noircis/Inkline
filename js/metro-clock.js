/**
 * @module metro-clock
 * @description
 * Timing math of the metronome engine: where the beats of a pre-rendered
 * cycle sit, which beat is sounding, and when to swap in a newly rendered
 * cycle. Pure: no DOM, no Web Audio, tested under Node.
 *
 * ## Model
 *
 * One **cycle** (one bar, or two) is rendered into an audio buffer of `len`
 * samples and played in a loop. Its beats start at the sample positions
 * `marks` (ascending, `marks[0] = 0`); beats may be uneven (7/8 "2+2+3").
 * Positions are whole samples, so the loop never drifts against the audio
 * clock: each pass lasts exactly `len` samples.
 *
 * A playing loop is described by a {@link Timeline}: the audio time `t0` at
 * which sample 0 of the cycle played (or would have played). Global beat `k`
 * (counted from `t0`, any integer) is beat `k mod n` of pass `floor(k / n)`,
 * with `n = marks.length`.
 *
 * ## Swapping a cycle
 *
 * A settings change renders a new cycle; the old loop is stopped and the new
 * one started **at the same audio time**, as soon as possible (a short lead
 * to schedule safely), even in the middle of a beat: at a slow tempo waiting
 * for the next beat would feel broken. Both calls use the audio clock, so
 * there is no gap and no double click. If the beat structure changed (time
 * signature, two-bar mode), the new cycle starts from its first beat.
 */

/**
 * A looping cycle on the audio clock.
 * @typedef {Object} Timeline
 * @property {number} t0 Audio time (s) of sample 0 of the current pass origin.
 * @property {number} len Cycle length (samples).
 * @property {Array.<number>} marks Sample position of each beat in the cycle.
 * @property {number} sr Sample rate (Hz).
 */

/**
 * Audio time at which global beat `k` of a timeline starts.
 * @param {Timeline} tl
 * @param {number} k Any integer (negative before `t0`).
 * @returns {number}
 */
export function beatTime(tl, k) {
  const n = tl.marks.length;
  const pass = Math.floor(k / n);
  const i = k - pass * n;
  return tl.t0 + (pass * tl.len + tl.marks[i]) / tl.sr;
}

/**
 * Global beat sounding at audio time `now` (the last beat that started).
 * @param {Timeline} tl
 * @param {number} now Audio time (s).
 * @returns {number} Global beat index; beat in the cycle = `mod(k, n)`.
 */
export function beatAt(tl, now) {
  const n = tl.marks.length;
  // First estimate (start of the pass), then walk to the right beat.
  let k = Math.floor(((now - tl.t0) * tl.sr) / tl.len) * n;
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
 * its start. The new buffer is entered at the same place: beat `j`, `elapsed`
 * seconds in. Cutting into a click that is still ringing continues it; the
 * next click then comes at the new tempo, counted from the last one.
 *
 * If the new beat is shorter than `elapsed` (the new tempo is faster and its
 * next click is already overdue), the new buffer is entered at the start of
 * the next beat: that click sounds right at the swap. If the number of beats
 * differs, the new cycle starts from its first beat.
 *
 * @param {Timeline} tl Playing timeline.
 * @param {number} now Audio time (s).
 * @param {number} lead Minimum delay (s) before the swap.
 * @param {number} newLen Length of the new cycle (samples).
 * @param {Array.<number>} newMarks Beat positions of the new cycle (samples).
 * @param {number} [notBefore=-Infinity] Earliest allowed swap time (s).
 * @returns {{at: number, beat: number, offset: number, timeline: Timeline}}
 *   `at`: audio time of the swap; `beat`: beat of the cycle entered;
 *   `offset`: start offset (s) in the new buffer; `timeline`: the new loop.
 */
export function swapPoint(tl, now, lead, newLen, newMarks, notBefore = -Infinity) {
  const at = Math.max(now + lead, notBefore);
  const n = newMarks.length;
  const done = (beat, offset) => ({
    at,
    beat,
    offset,
    timeline: { t0: at - offset, len: newLen, marks: newMarks, sr: tl.sr },
  });
  if (n !== tl.marks.length) return done(0, 0);
  const k = beatAt(tl, at);
  const elapsed = at - beatTime(tl, k);
  const j = ((k % n) + n) % n;
  const start = newMarks[j] / tl.sr;
  const next = (j + 1 < n ? newMarks[j + 1] : newLen) / tl.sr;
  if (start + elapsed < next) return done(j, start + elapsed);
  const b = (j + 1) % n;
  return done(b, newMarks[b] / tl.sr);
}
