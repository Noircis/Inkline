// Tests des exercices aléatoires (2.8) : tirage reproductible et respect des réglages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, newSeed, generateExercise } from '../js/exercise.js';
import { meterOf, slotsOf, METERS } from '../js/placements.js';

const base = { meter: meterOf('4/4'), measures: 8, min: 2, max: 3, starts: [], seed: 42 };

test('mulberry32 : même graine, même suite ; valeurs dans [0, 1)', () => {
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

test('même numéro, même exercice', () => {
  assert.deepEqual(generateExercise(base), generateExercise({ ...base }));
  assert.notDeepEqual(generateExercise(base), generateExercise({ ...base, seed: 43 }));
});

test('réglages respectés, sur toutes les mesures et beaucoup de numéros', () => {
  METERS.forEach((m) => {
    const n = slotsOf(m);
    for (let seed = 1; seed <= 60; seed++) {
      const min = 1 + (seed % n);
      const max = Math.min(n, min + (seed % 3));
      const starts = [0, 1, 3].filter((p) => p < n);
      const ex = generateExercise({ meter: m, measures: 12, min, max, starts, seed });
      assert.equal(ex.length, 12);
      ex.forEach((pos) => {
        assert.ok(pos.length <= max, `${m.key} trop de notes`);
        assert.ok(new Set(pos).size === pos.length && pos.every((p) => p >= 0 && p < n));
        assert.deepEqual(
          pos,
          pos.slice().sort((a, b) => a - b),
        );
        assert.ok(starts.includes(pos[0]), `${m.key} départ ${pos[0]}`);
        // Moins de notes que le minimum seulement si la place manque.
        if (pos.length < min) assert.equal(pos.length, n - pos[0]);
      });
    }
  });
});

test('fourchette de notes : tout le nombre de notes demandé est tiré', () => {
  const ex = generateExercise({ ...base, measures: 12, min: 1, max: 4, seed: 3 });
  const counts = new Set();
  for (let seed = 1; seed < 40; seed++)
    generateExercise({ ...base, measures: 12, min: 1, max: 4, seed }).forEach((p) => counts.add(p.length));
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4]);
  assert.ok(ex.every((p) => p.length >= 1 && p.length <= 4));
});

test('pas deux mesures identiques de suite quand c’est possible', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const ex = generateExercise({ ...base, measures: 12, seed });
    for (let i = 1; i < ex.length; i++) assert.notDeepEqual(ex[i], ex[i - 1], `n° ${seed}, mesure ${i + 1}`);
  }
});
