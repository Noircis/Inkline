// Tests for random exercises (2.8): reproducible draw and respect of the settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, newSeed, generateExercise, candidates } from '../js/exercise.js';
import { meterOf, slotsOf, METERS } from '../js/placements.js';

const base = { meter: meterOf('4/4'), measures: 4, min: 2, max: 3, starts: [], seed: 42 };

test('mulberry32: same seed, same sequence; values in [0, 1)', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(
    xs,
    Array.from({ length: 50 }, () => b()),
  );
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, mulberry32(8)));
  const s = newSeed(() => 0.5);
  assert.ok(Number.isInteger(s) && s >= 1 && s <= 9999);
});

test('same number, same exercise', () => {
  assert.deepEqual(generateExercise(base), generateExercise({ ...base }));
  assert.notDeepEqual(generateExercise(base), generateExercise({ ...base, seed: 43 }));
});

test('settings respected, on every time signature and many numbers', () => {
  METERS.forEach((m) => {
    const n = slotsOf(m);
    for (let seed = 1; seed <= 60; seed++) {
      const min = 1 + (seed % n);
      const max = Math.min(n, min + (seed % 3));
      const starts = [0, 1, 3].filter((p) => p < n);
      const ex = generateExercise({ meter: m, measures: 4, min, max, starts, seed });
      assert.equal(ex.length, 4);
      ex.forEach((pos) => {
        assert.ok(pos.length <= max, `${m.key} trop de notes`);
        assert.ok(new Set(pos).size === pos.length && pos.every((p) => p >= 0 && p < n));
        assert.deepEqual(
          pos,
          pos.slice().sort((a, b) => a - b),
        );
        assert.ok(starts.includes(pos[0]), `${m.key} départ ${pos[0]}`);
        // Fewer notes than the minimum only if room runs out.
        if (pos.length < min) assert.equal(pos.length, n - pos[0]);
      });
    }
  });
});

test('note range: every requested note count is drawn', () => {
  const ex = generateExercise({ ...base, measures: 4, min: 1, max: 4, seed: 3 });
  const counts = new Set();
  for (let seed = 1; seed < 40; seed++)
    generateExercise({ ...base, measures: 4, min: 1, max: 4, seed }).forEach((p) => counts.add(p.length));
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4]);
  assert.ok(ex.every((p) => p.length >= 1 && p.length <= 4));
});

test('never the same measure twice in an exercise (2.8.1)', () => {
  METERS.forEach((m) => {
    const n = slotsOf(m);
    for (let seed = 1; seed <= 300; seed++) {
      const min = 1 + (seed % Math.min(3, n));
      const s = { meter: m, measures: 4, min, max: Math.min(n, min + 1), starts: [], seed };
      const keys = generateExercise(s).map((p) => p.join());
      // All different, unless the settings do not offer 4 measures (3/8 with 3 notes: only one).
      const expected = Math.min(keys.length, candidates(s).length);
      assert.equal(new Set(keys).size, expected, `${m.key} n° ${seed} : ${keys.join(' | ')}`);
    }
  });
});

test('settings too narrow: repetition only when no new measure is left', () => {
  // One note, start on 1 or 2: only 2 possible measures.
  const s = { ...base, min: 1, max: 1, starts: [0, 2], measures: 4, seed: 9 };
  assert.deepEqual(candidates(s), [[0], [2]]);
  const ex = generateExercise(s);
  assert.equal(ex.length, 4);
  assert.equal(new Set(ex.slice(0, 2).map((p) => p.join())).size, 2); // both of them first
});

test('candidates: every allowed measure, no duplicate', () => {
  assert.equal(candidates({ ...base, min: 2, max: 2 }).length, 28); // C(8, 2)
  assert.equal(candidates({ ...base, min: 1, max: 8 }).length, 255); // all except the empty measure
  assert.equal(candidates({ ...base, meter: meterOf('12/8'), min: 6, max: 6 }).length, 924);
  // Start on the last eighth, 3 notes requested: the measure shrinks.
  assert.deepEqual(candidates({ ...base, min: 3, max: 3, starts: [7] }), [[7]]);
});
