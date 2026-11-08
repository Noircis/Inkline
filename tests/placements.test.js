// Tests de l'entraînement rythmique (2.3) : génération et écriture des placements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combinations, placementItems, placementSeries, seriesBlock, SLOTS } from '../js/placements.js';
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

test('séries : regroupées par position de la première note ; une seule série pour une note', () => {
  assert.equal(placementSeries(1).length, 1);
  assert.equal(placementSeries(1)[0].length, 8);
  const two = placementSeries(2);
  assert.deepEqual(
    two.map((s) => s.length),
    [7, 6, 5, 4, 3, 2, 1],
  );
  two.forEach((s) => assert.ok(s.every((pos) => pos[0] === s[0][0])));
  assert.equal(placementSeries(8).length, 1);
});

test('seriesBlock : une mesure par placement, réglages de lecture repris', () => {
  const s = placementSeries(2)[0];
  const b = seriesBlock(s, { tempo: 90, swing: true }, 'x');
  assert.equal(
    b.items.reduce((t, it) => t + qlen(it), 0),
    4 * s.length,
  );
  assert.equal(b.tempo, 90);
  assert.equal(b.swing, true);
});

// --- 2.8 : toutes les mesures ---------------------------------------------
import { METERS, meterOf, slotsOf, startGlyphs, startLabel } from '../js/placements.js';
import { mlen, defaultGroups, meterGroups, groupStarts } from '../js/model.js';
import { beamGroups } from '../js/rhythm.js';

const w = (pos, key) =>
  placementItems(pos, meterOf(key))
    .map((it) => (it.r ? 'r' : '') + it.d + (it.dot ? '.' : ''))
    .join(' ');

test('mesure composée : les 8 écritures d’un temps de 3 croches', () => {
  const beat = (pos) => w(pos, '6/8').replace(/ rq\.$/, '');
  assert.equal(beat([0]), 'q.');
  assert.equal(beat([1]), 'r8 8 r8');
  assert.equal(beat([2]), 'rq 8');
  assert.equal(beat([0, 1]), '8 q');
  assert.equal(beat([0, 2]), 'q 8');
  assert.equal(beat([1, 2]), 'r8 8 8');
  assert.equal(beat([0, 1, 2]), '8 8 8');
  assert.equal(w([3], '6/8'), 'rq. q.');
});

test('regroupement des silences selon la mesure', () => {
  assert.equal(w([4], '3/4'), 'rh q'); // 3/4 : temps 1-2
  assert.equal(w([0], '3/4'), 'q rh'); // 3/4 : temps 2-3 aussi
  assert.equal(w([0], '5/4'), 'q rq rh rq'); // 5/4 : 3-4 seulement
  assert.equal(w([0], '9/8'), 'q. rh.');
  assert.equal(w([3], '12/8'), 'rq. q. rh.'); // 12/8 : jamais 2-3
  assert.equal(w([9], '12/8'), 'rh. rq. q.');
  assert.equal(w([0], '7/8:2+2+3'), 'q rq rq.'); // asymétrique : jamais
  assert.equal(w([4], '5/8:3+2'), 'rq. r8 8');
});

test('toutes les mesures : chaque placement remplit exactement la mesure', () => {
  METERS.forEach((m) => {
    const n = slotsOf(m);
    assert.equal(n, mlen(m.time) * 2, m.key);
    for (let k = 1; k <= n; k++)
      combinations(n, k).forEach((pos) => {
        const total = placementItems(pos, m).reduce((s, it) => s + qlen(it), 0);
        assert.equal(total, mlen(m.time), `${m.key} ${pos}`);
      });
  });
});

test('séries et titres en notation', () => {
  const m = meterOf('6/8');
  assert.equal(placementSeries(2, m).length, 5);
  assert.equal(
    placementSeries(6, meterOf('12/8')).reduce((t, s) => t + s.length, 0),
    924,
  );
  assert.equal(startGlyphs(0), '\u{1D160}');
  assert.equal(startGlyphs(5), '\u{1D13C}\u{1D13E}\u{1D160}'); // 3 et : demi-pause, demi-soupir
  assert.equal(startGlyphs(4, m), '\u{1D13D}.\u{1D13E}\u{1D160}'); // soupir pointé, demi-soupir
  assert.equal(startLabel(3), '2 et');
  assert.equal(startLabel(6, meterOf('7/8:2+3+2')), 'temps 3, 2e croche');
});

test('groupement : valeurs par défaut, blocs et ligatures', () => {
  assert.deepEqual(defaultGroups('4/4'), [2, 2, 2, 2]);
  assert.deepEqual(defaultGroups('12/8'), [3, 3, 3, 3]);
  assert.deepEqual(defaultGroups('7/8'), [2, 2, 3]);
  assert.deepEqual(defaultGroups('5/8'), [2, 3]);
  assert.deepEqual(meterGroups({ time: '7/8', groups: [3, 2, 2] }), [3, 2, 2]);
  assert.deepEqual(meterGroups({ time: '7/8', groups: [3, 3] }), [2, 2, 3]); // incohérent : ignoré
  assert.deepEqual(groupStarts({ time: '7/8', groups: [2, 3, 2] }), [0, 1, 2.5]);
  // 7 croches en 7/8 : ligatures 2+3+2 ou 3+2+2 selon le groupement.
  const items = Array.from({ length: 7 }, () => ({ d: '8' }));
  assert.deepEqual(
    beamGroups(items, '7/8', [2, 3, 2]).map((g) => g.length),
    [2, 3, 2],
  );
  assert.deepEqual(
    beamGroups(items, '7/8', [3, 2, 2]).map((g) => g.length),
    [3, 2, 2],
  );
  const b = seriesBlock([[0, 1, 2, 3, 4, 5, 6]], { tempo: 80, swing: true }, 'x', meterOf('7/8:2+3+2'));
  assert.deepEqual(b.groups, [2, 3, 2]);
  assert.equal(b.swing, false); // pas de swing hors mesure simple
});
