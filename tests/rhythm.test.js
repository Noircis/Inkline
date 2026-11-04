// Tests du temps musical : mesures, triolets, ligatures, lecture.
// Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qlen } from '../js/model.js';
import { segmentMeasures, tupletGroups, beamGroups, staffPlayOrder, staffEvents, swingWarp } from '../js/rhythm.js';

const n = (d, extra = {}) => ({ d, s: 4, ...extra });
const staff = (items, extra = {}) => ({ id: 't', type: 'staff', clef: 'treble', time: '4/4', tempo: 120, swing: false, items, ...extra });

test('qlen : point et triolet', () => {
  assert.equal(qlen(n('q')), 1);
  assert.equal(qlen(n('q', { dot: true })), 1.5);
  assert.ok(Math.abs(qlen(n('8', { tup: 3 })) - 1 / 3) < 1e-12);
});

test('segmentMeasures : mesure pleine, barre forcée, début de reprise', () => {
  const items = [n('h'), n('h'), n('q', { bar: 'double' }), n('q', { rs: true }), n('q')];
  const m = segmentMeasures(items, '4/4');
  assert.deepEqual(m.map((x) => x.idx), [[0, 1], [2], [3, 4]]);
  assert.equal(m[1].type, 'double');
  assert.equal(m[2].rs, true);
  assert.equal(m[2].full, false);
});

test('segmentMeasures : trois croches de triolet remplissent exactement un temps', () => {
  const items = [n('q'), n('q'), n('q'), n('8', { tup: 3 }), n('8', { tup: 3 }), n('8', { tup: 3 }), n('q')];
  const m = segmentMeasures(items, '4/4');
  assert.deepEqual(m.map((x) => x.idx), [[0, 1, 2, 3, 4, 5], [6]]);
});

test('tupletGroups : croches, noire-croche, groupe incomplet', () => {
  const t = (d) => n(d, { tup: 3 });
  const g = tupletGroups([t('8'), t('8'), t('8'), t('q'), t('8'), t('8'), n('q')], '4/4');
  assert.deepEqual(g.map((x) => [x.idx, x.complete]), [[[0, 1, 2], true], [[3, 4], true], [[5], false]]);
});

test('beamGroups : par temps, triolet ligaturé à part', () => {
  const t = (d) => n(d, { tup: 3 });
  const items = [n('8'), n('8'), t('8'), t('8'), t('8'), n('8'), n('16'), n('16'), n('q', { r: true })];
  assert.deepEqual(beamGroups(items, '4/4'), [[0, 1], [2, 3, 4], [5, 6, 7]]);
});

test('beamGroups : en 6/8 on groupe par noire pointée', () => {
  const items = Array.from({ length: 6 }, () => n('8'));
  assert.deepEqual(beamGroups(items, '6/8'), [[0, 1, 2], [3, 4, 5]]);
});

test('staffPlayOrder : la reprise est jouée deux fois', () => {
  const items = [n('q'), n('q', { rs: true }), n('q', { bar: 'rep' }), n('q')];
  assert.deepEqual(staffPlayOrder(items), [0, 1, 2, 1, 2, 3]);
});

test('swingWarp : la croche du levé tombe aux 2/3 du temps', () => {
  assert.equal(swingWarp(0), 0);
  assert.ok(Math.abs(swingWarp(0.5) - 2 / 3) < 1e-9);
  assert.equal(swingWarp(1), 1);
});

test('staffEvents : une liaison prolonge la note sans la rejouer', () => {
  const { events, total } = staffEvents(staff([n('8', { tie: true }), n('8'), n('h')]));
  assert.equal(events[0].end, 1); // 0.5 + 0.5
  assert.equal(events[1].held, true);
  assert.equal(events[2].start, 1);
  assert.equal(total, 3);
});

test('staffEvents : le swing ne déforme pas les triolets', () => {
  const t = (d) => n(d, { tup: 3 });
  const { events } = staffEvents(staff([n('8'), n('8'), t('8'), t('8'), t('8')], { swing: true }));
  assert.ok(Math.abs(events[1].start - 2 / 3) < 1e-9); // croche swing
  assert.ok(Math.abs(events[3].start - (1 + 1 / 3)) < 1e-9); // triolet intact
});
