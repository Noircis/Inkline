// Tests for the metronome timing math (2.10 spike): cycle length, beat
// positions, beat lookup and cycle swaps.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleSamples, beatSample, beatTime, beatAt, swapPoint } from '../js/metro-clock.js';

const SR = 48000;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('cycle length is a whole number of samples', () => {
  assert.equal(cycleSamples(120, 4, SR), 96000);
  assert.equal(cycleSamples(60, 4, SR), 192000);
  // 7 BPM does not divide evenly: rounded, never fractional.
  assert.ok(Number.isInteger(cycleSamples(137, 4, 44100)));
  assert.equal(cycleSamples(1e9, 4, SR), 1);
});

test('beats sit on whole samples, first beat at 0', () => {
  const len = cycleSamples(137, 4, 44100);
  assert.equal(beatSample(0, len, 4), 0);
  for (let i = 0; i < 4; i++) assert.ok(Number.isInteger(beatSample(i, len, 4)));
  assert.equal(beatSample(4, len, 4), len);
});

test('beat times follow the loop, no drift after many passes', () => {
  const tl = { t0: 2, len: 96000, n: 4, sr: SR };
  close(beatTime(tl, 0), 2);
  close(beatTime(tl, 1), 2.5);
  close(beatTime(tl, 4), 4);
  // 10 minutes at 120 BPM = 1200 beats: exactly 600 s later.
  close(beatTime(tl, 1200), 602, 1e-6);
  close(beatTime(tl, -1), 1.5);
});

test('beatAt finds the last beat that started', () => {
  const tl = { t0: 1, len: cycleSamples(137, 4, 44100), n: 4, sr: 44100 };
  for (const k of [0, 1, 3, 4, 77, 1000]) {
    const at = beatTime(tl, k);
    assert.equal(beatAt(tl, at), k);
    assert.equal(beatAt(tl, at - 1e-6), k - 1);
    assert.equal(beatAt(tl, (at + beatTime(tl, k + 1)) / 2), k);
  }
});

test('swap happens right away, mid-beat, keeping the time since the last click', () => {
  const tl = { t0: 0, len: 96000, n: 4, sr: SR }; // 120 BPM: a beat every 0.5 s
  const sp = swapPoint(tl, 1.2, 0.06, cycleSamples(60, 4, SR)); // to 60 BPM
  close(sp.at, 1.26);
  assert.equal(sp.beat, 2); // the click of beat 2 sounded at 1.0
  close(sp.offset, 2.26); // beat 2 of a 60 BPM bar starts at 2 s, 0.26 s in
  close(sp.timeline.t0, -1);
  // Next click a whole new beat (1 s) after the last one.
  close(beatTime(sp.timeline, 3), 2);
});

test('swap inside a ringing click continues the same click', () => {
  const tl = { t0: 0, len: 96000, n: 4, sr: SR };
  const sp = swapPoint(tl, 0.95, 0.06, cycleSamples(60, 4, SR));
  close(sp.at, 1.01);
  assert.equal(sp.beat, 2);
  close(sp.offset, 2.01); // 10 ms into the same click of the new buffer
});

test('faster tempo with the next click overdue: it sounds at the swap', () => {
  const tl = { t0: 0, len: cycleSamples(60, 4, SR), n: 4, sr: SR }; // a beat every 1 s
  const sp = swapPoint(tl, 1.7, 0.06, 96000); // to 120 BPM: 0.76 s since the click > 0.5 s
  close(sp.at, 1.76);
  assert.equal(sp.beat, 2);
  close(sp.offset, 1); // start of beat 2 at 120 BPM
  close(beatTime(sp.timeline, 2), 1.76);
});

test('last beat of the bar overdue: wraps to the start of the cycle', () => {
  const tl = { t0: 0, len: cycleSamples(60, 4, SR), n: 4, sr: SR };
  const sp = swapPoint(tl, 3.8, 0.06, 96000);
  assert.equal(sp.beat, 0);
  close(sp.offset, 0);
  close(sp.timeline.t0, 3.86);
});

test('a swap never comes before an already scheduled one', () => {
  const tl = { t0: 0, len: 96000, n: 4, sr: SR };
  const sp = swapPoint(tl, 0.1, 0.06, 96000, 1.5);
  close(sp.at, 1.5);
});

test('change takes effect after the lead time only, at any tempo (1 to 400 BPM)', () => {
  for (const bpm of [1, 20, 60, 133, 250, 400]) {
    const tl = { t0: 0.1, len: cycleSamples(bpm, 4, SR), n: 4, sr: SR };
    for (const now of [0.3, 1.234, 7.77, 100]) {
      for (const to of [1, bpm + 5, 400]) {
        const sp = swapPoint(tl, now, 0.06, cycleSamples(to, 4, SR));
        close(sp.at, now + 0.06, 1e-9);
        // The new timeline is consistent: the beat entered contains the swap time.
        const k = beatAt(sp.timeline, sp.at + 1e-9);
        assert.equal(((k % 4) + 4) % 4, sp.beat, `${bpm} -> ${to} at ${now}`);
      }
    }
  }
});
