// Tests de la mise en mesure automatique (2.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStaff,
  resizeEvent,
  decompose,
  singleValue,
  chainStart,
  chainEnd,
} from '../js/measure-fit.js';
import { segmentMeasures } from '../js/rhythm.js';
import { qlen } from '../js/model.js';
import { sanitizeBlock } from '../js/sanitize.js';

/** Écriture compacte : « q », « h. », « r8 », « q~ » (liaison), « +» (morceau automatique). */
const show = (items) =>
  items
    .map(
      (it) =>
        (it.r ? 'r' : '') +
        it.d +
        (it.dot ? '.' : '') +
        (it.tup ? '³' : '') +
        (it.tie ? '~' : '') +
        (it.auto ? '+' : ''),
    )
    .join(' ');
const n = (d, extra = {}) => ({ d, s: 4, ...extra });
const r = (d, extra = {}) => ({ d, r: true, ...extra });
const fit = (items, time = '4/4') => normalizeStaff(items, time).items;

test('decompose : valeurs usuelles, alignées sur la mesure', () => {
  const s = (a) => a.map((v) => v.d + (v.dot ? '.' : '')).join(' ');
  assert.equal(s(decompose(0, 4, true)), 'w');
  assert.equal(s(decompose(0, 3, true)), 'h.');
  assert.equal(s(decompose(1, 3, true)), 'h.'); // blanche pointée sur le 2e temps
  assert.equal(s(decompose(1, 3, false, 1, true)), 'q h'); // silences : demi-pause sur le 3
  assert.equal(s(decompose(0.5, 1.5, false)), '8 q'); // compléter le temps d'abord
  assert.equal(s(decompose(0, 2.5, true)), 'h 8');
  assert.equal(s(decompose(1.5, 1.5, true, 1.5)), 'q.'); // 6/8 : noire pointée sur le 2e temps
  assert.equal(s(decompose(0.25, 1.75, true)), '16 8 q');
  assert.equal(decompose(0, 1 / 3, true), null);
  assert.deepEqual(singleValue(3, true), { d: 'h', dot: true });
  assert.equal(singleValue(3, false), null);
});

test('noire, noire, ronde en 4/4 → noire noire blanche⁀ | blanche', () => {
  const out = fit([n('q'), n('q'), n('w')]);
  assert.equal(show(out), 'q q h~+ h');
  const m = segmentMeasures(out, '4/4');
  assert.equal(m.length, 2);
  assert.ok(m[0].full);
});

test('une ronde sur le 4e temps : noire⁀ | blanche pointée ; et sur plusieurs mesures', () => {
  assert.equal(show(fit([n('h.'.replace('.', ''), { dot: true }), n('w')])), 'h. q~+ h.');
  assert.equal(show(fit([n('q'), n('w', { dot: true })], '3/4')), 'q h~+ h.~+ q');
});

test('les silences sont coupés sans liaison', () => {
  assert.equal(show(fit([n('h', { dot: true }), r('h')])), 'h. rq+ rq');
});

test('identité : une portée sans débordement est rendue telle quelle (syncopes comprises)', () => {
  const items = [n('8'), n('q'), n('8'), n('h', { tie: true }), n('q'), n('q', { dot: true }), n('8')];
  assert.deepEqual(fit(items), items);
});

test('recollage : après une suppression, la note coupée redevient entière', () => {
  const cut = fit([n('q'), n('q'), n('w')]); // q q h~+ h
  const removed = cut.slice(1); // on enlève la 1re noire
  assert.equal(show(fit(removed)), 'q h.~+ q');
  const removed2 = cut.slice(2); // on enlève les deux noires
  assert.equal(show(fit(removed2)), 'w');
});

test('les liaisons de l’utilisateur et les propriétés suivent les bons morceaux', () => {
  const out = fit([n('h', { dot: true }), n('h', { c: 'F7', a: -1, tie: true, bar: 'final' })]);
  // L'accord et l'altération restent sur le 1er morceau ; la liaison utilisateur et la barre sur le dernier.
  assert.equal(out[1].c, 'F7');
  assert.equal(out[1].a, -1);
  assert.ok(out[1].auto && !out[2].auto);
  assert.equal(out[2].bar, 'final');
  assert.ok(out[2].tie);
  assert.ok(!('a' in out[2]) && !('c' in out[2]));
});

test('les triolets ne sont jamais coupés ; le débordement est signalé', () => {
  const items = [n('h', { dot: true }), n('8'), n('8', { tup: 3 }), n('8', { tup: 3 })];
  const res = normalizeStaff(items, '4/4');
  assert.equal(show(res.items), 'h. 8 8³ 8³');
  assert.ok(res.tupCross.has(3));
});

test('startOf : correspondance des index après remise en mesure', () => {
  const res = normalizeStaff([n('q'), n('q'), n('w'), n('q')], '4/4');
  assert.deepEqual(res.startOf, [0, 1, 2, 4, 5]);
  assert.equal(chainStart(res.items, 3), 2);
  assert.equal(chainEnd(res.items, 2), 3);
});

test('resizeEvent : raccourcir ajoute un silence, la suite ne bouge pas', () => {
  const items = [n('q'), n('q'), n('q'), n('q'), n('h')];
  const res = resizeEvent(items, '4/4', 0, { d: '8' });
  assert.equal(show(res.items), '8 r8 q q q h');
  assert.equal(res.index, 0);
  // Blanche → croche pointée : silences écrits proprement.
  const res2 = resizeEvent([n('h'), n('h')], '4/4', 0, { d: '8', dot: true });
  assert.equal(show(res2.items), '8. r16+ rq h'); // un seul silence logique, écrit en deux
});

test('resizeEvent : allonger mange les silences, sinon décale (et recoupe)', () => {
  const short = resizeEvent([n('q'), n('q'), n('h')], '4/4', 0, { d: '8' }).items; // 8 r8 q h
  const back = resizeEvent(short, '4/4', 0, { d: 'q' });
  assert.equal(show(back.items), 'q q h'); // aller-retour
  const res = resizeEvent([n('q'), n('q'), n('h')], '4/4', 1, { d: 'h' }); // pas de silence : décalage
  assert.equal(show(res.items), 'q h q~+ q');
  // Silence partiellement mangé.
  const res3 = resizeEvent([n('q'), r('h', { dot: true })], '4/4', 0, { d: 'h' });
  assert.equal(show(res3.items), 'h rh');
});

test('resizeEvent : une note coupée est modifiée en entier ; la mesure reste pleine', () => {
  const cut = fit([n('q'), n('q'), n('w')]); // q q h~+ h
  const res = resizeEvent(cut, '4/4', 3, { d: 'h' }); // on touche le 2e morceau
  assert.equal(show(res.items), 'q q h rh');
  assert.equal(res.index, 2);
  res.items.forEach((it) => assert.ok(qlen(it) > 0));
});

test('changement de mesure : tout est recoupé', () => {
  const in44 = [n('h'), n('h'), n('h'), n('h')];
  assert.equal(show(fit(in44, '3/4')), 'h q~+ q h h');
});

test('sanitize : les morceaux automatiques sont conservés au rechargement', () => {
  const b = sanitizeBlock({
    type: 'staff',
    clef: 'treble',
    time: '4/4',
    items: fit([n('q'), n('q'), n('w')]),
  });
  assert.equal(show(b.items), 'q q h~+ h');
  assert.ok(!sanitizeBlock({ type: 'staff', items: [n('8', { tup: 3, auto: true })] }).items[0].auto);
});
