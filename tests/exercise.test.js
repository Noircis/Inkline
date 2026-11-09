// Tests des exercices aléatoires (2.8) : tirage reproductible et respect des réglages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, newSeed, generateExercise, candidates } from '../js/exercise.js';
import { meterOf, slotsOf, METERS } from '../js/placements.js';

const base = { meter: meterOf('4/4'), measures: 4, min: 2, max: 3, starts: [], seed: 42 };

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
        // Moins de notes que le minimum seulement si la place manque.
        if (pos.length < min) assert.equal(pos.length, n - pos[0]);
      });
    }
  });
});

test('fourchette de notes : tout le nombre de notes demandé est tiré', () => {
  const ex = generateExercise({ ...base, measures: 4, min: 1, max: 4, seed: 3 });
  const counts = new Set();
  for (let seed = 1; seed < 40; seed++)
    generateExercise({ ...base, measures: 4, min: 1, max: 4, seed }).forEach((p) => counts.add(p.length));
  assert.deepEqual([...counts].sort(), [1, 2, 3, 4]);
  assert.ok(ex.every((p) => p.length >= 1 && p.length <= 4));
});

test('jamais deux fois la même mesure dans un exercice (2.8.1)', () => {
  METERS.forEach((m) => {
    const n = slotsOf(m);
    for (let seed = 1; seed <= 300; seed++) {
      const min = 1 + (seed % Math.min(3, n));
      const s = { meter: m, measures: 4, min, max: Math.min(n, min + 1), starts: [], seed };
      const keys = generateExercise(s).map((p) => p.join());
      // Toutes différentes, sauf si les réglages n'offrent pas 4 mesures (3/8 à 3 notes : une seule).
      const expected = Math.min(keys.length, candidates(s).length);
      assert.equal(new Set(keys).size, expected, `${m.key} n° ${seed} : ${keys.join(' | ')}`);
    }
  });
});

test('réglages trop serrés : répétition seulement quand il n’y a plus de mesure neuve', () => {
  // Une note, départ sur 1 ou 2 : seulement 2 mesures possibles.
  const s = { ...base, min: 1, max: 1, starts: [0, 2], measures: 4, seed: 9 };
  assert.deepEqual(candidates(s), [[0], [2]]);
  const ex = generateExercise(s);
  assert.equal(ex.length, 4);
  assert.equal(new Set(ex.slice(0, 2).map((p) => p.join())).size, 2); // les deux d'abord
});

test('candidates : toutes les mesures permises, sans doublon', () => {
  assert.equal(candidates({ ...base, min: 2, max: 2 }).length, 28); // C(8, 2)
  assert.equal(candidates({ ...base, min: 1, max: 8 }).length, 255); // toutes sauf la mesure vide
  assert.equal(candidates({ ...base, meter: meterOf('12/8'), min: 6, max: 6 }).length, 924);
  // Départ sur la dernière croche, 3 notes demandées : la mesure se réduit.
  assert.deepEqual(candidates({ ...base, min: 3, max: 3, starts: [7] }), [[7]]);
});
