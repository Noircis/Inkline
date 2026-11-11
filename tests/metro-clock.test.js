// Tests for the metronome timing math: beat positions, beat lookup and cycle swaps.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatTime, beatAt, swapPoint } from '../js/metro-clock.js';

const SR = 48000;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

/** Even 4-beat cycle at a tempo: length and beat positions, in samples. */
const even = (bpm, sr = SR) => {
  const len = Math.round((4 * 60 * sr) / bpm);
  return { len, marks: [0, 1, 2, 3].map((i) => Math.round((i * len) / 4)) };
};
const timeline = (t0, bpm, sr = SR) => ({ t0, sr, ...even(bpm, sr) });

test('beat times follow the loop, no drift after many passes', () => {
  const tl = timeline(2, 120);
  close(beatTime(tl, 0), 2);
  close(beatTime(tl, 1), 2.5);
  close(beatTime(tl, 4), 4);
  // 10 minutes at 120 BPM = 1200 beats: exactly 600 s later.
  close(beatTime(tl, 1200), 602, 1e-6);
  close(beatTime(tl, -1), 1.5);
});

test('uneven beats (7/8 2+2+3)', () => {
  const tl = { t0: 0, sr: 1000, len: 700, marks: [0, 200, 400] };
  close(beatTime(tl, 2), 0.4);
  close(beatTime(tl, 3), 0.7);
  assert.equal(beatAt(tl, 0.65), 2);
  assert.equal(beatAt(tl, 0.75), 3);
});

test('beatAt finds the last beat that started', () => {
  const tl = timeline(1, 137, 44100);
  for (const k of [0, 1, 3, 4, 77, 1000]) {
    const at = beatTime(tl, k);
    assert.equal(beatAt(tl, at), k);
    assert.equal(beatAt(tl, at - 1e-6), k - 1);
    assert.equal(beatAt(tl, (at + beatTime(tl, k + 1)) / 2), k);
  }
});

test('swap happens right away, mid-beat, keeping the time since the last click', () => {
  const tl = timeline(0, 120); // a beat every 0.5 s
  const to = even(60);
  const sp = swapPoint(tl, 1.2, 0.06, to.len, to.marks);
  close(sp.at, 1.26);
  assert.equal(sp.beat, 2); // the click of beat 2 sounded at 1.0
  close(sp.offset, 2.26); // beat 2 of a 60 BPM bar starts at 2 s, 0.26 s in
  close(sp.timeline.t0, -1);
  close(beatTime(sp.timeline, 3), 2); // next click a whole new beat after the last one
});

test('faster tempo with the next click overdue: it sounds at the swap', () => {
  const tl = timeline(0, 60); // a beat every 1 s
  const to = even(120);
  const sp = swapPoint(tl, 1.7, 0.06, to.len, to.marks); // 0.76 s since the click > 0.5 s
  assert.equal(sp.beat, 2);
  close(sp.offset, 1);
  close(beatTime(sp.timeline, 2), 1.76);
});

test('last beat of the bar overdue: wraps to the start of the cycle', () => {
  const tl = timeline(0, 60);
  const to = even(120);
  const sp = swapPoint(tl, 3.8, 0.06, to.len, to.marks);
  assert.equal(sp.beat, 0);
  close(sp.offset, 0);
  close(sp.timeline.t0, 3.86);
});

test('another beat structure: the new cycle starts from its first beat', () => {
  const tl = timeline(0, 120);
  const sp = swapPoint(tl, 1.2, 0.06, 72000, [0, 24000, 48000]); // to 3/4
  assert.equal(sp.beat, 0);
  close(sp.offset, 0);
  close(sp.timeline.t0, 1.26);
});

test('a swap never comes before an already scheduled one', () => {
  const tl = timeline(0, 120);
  const to = even(120);
  const sp = swapPoint(tl, 0.1, 0.06, to.len, to.marks, 1.5);
  close(sp.at, 1.5);
});

test('change takes effect after the lead time only, at any tempo (20 to 400 BPM)', () => {
  for (const bpm of [20, 60, 133, 250, 400]) {
    const tl = timeline(0.1, bpm);
    for (const now of [0.3, 1.234, 7.77, 100]) {
      for (const bpm2 of [20, bpm + 5, 400]) {
        const to = even(bpm2);
        const sp = swapPoint(tl, now, 0.06, to.len, to.marks);
        close(sp.at, now + 0.06);
        // The new timeline is consistent: the beat entered contains the swap time.
        const k = beatAt(sp.timeline, sp.at + 1e-9);
        assert.equal(((k % 4) + 4) % 4, sp.beat, `${bpm} -> ${bpm2} at ${now}`);
      }
    }
  }
});
