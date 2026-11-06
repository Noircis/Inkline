// Tests de l'entraînement rythmique (2.3) : génération et écriture des placements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinations, placementItems, SLOTS } from '../js/placements.js';
import { qlen } from '../js/model.js';

const write = (pos) =>
  placementItems(pos)
    .map((it) => (it.r ? 'r' : '') + it.d)
    .join(' ');

test('combinations : nombre de placements = coefficient binomial', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 8].map((k) => combinations(SLOTS, k).length),
    [1, 8, 28, 56, 70, 56, 1],
  );
  assert.deepEqual(combinations(4, 2), [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ]);
  assert.deepEqual(combinations(3, 4), []);
});

test('une note : les 8 mesures de l’exemple', () => {
  assert.deepEqual(combinations(SLOTS, 1).map(write), [
    'q rq rh',
    'r8 8 rq rh',
    'rq q rh',
    'rq r8 8 rh',
    'rh q rq',
    'rh r8 8 rq',
    'rh rq q',
    'rh rq r8 8',
  ]);
});

test('règles : croches ligaturées sur un temps, pas de demi-pause sur 2-3', () => {
  assert.equal(write([0, 1]), '8 8 rq rh');
  assert.equal(write([0, 6]), 'q rq rq q'); // temps 2-3 vides : deux soupirs
  assert.equal(write([1, 7]), 'r8 8 rq rq r8 8');
  assert.equal(write([0, 1, 2, 3, 4, 5, 6, 7]), '8 8 8 8 8 8 8 8');
});

test('chaque mesure générée dure exactement 4 noires', () => {
  for (let k = 1; k <= SLOTS; k++)
    combinations(SLOTS, k).forEach((pos) => {
      const total = placementItems(pos).reduce((s, it) => s + qlen(it), 0);
      assert.equal(total, 4, `positions ${pos}`);
    });
});
