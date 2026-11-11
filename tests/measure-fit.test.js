// Tests for automatic fitting into measures (2.6).
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

/** Compact notation: "q", "h.", "r8", "q~" (tie), "+" (automatic piece). */
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

test('decompose: usual values, aligned with the measure', () => {
  const s = (a) => a.map((v) => v.d + (v.dot ? '.' : '')).join(' ');
  assert.equal(s(decompose(0, 4, true)), 'w');
  assert.equal(s(decompose(0, 3, true)), 'h.');
  assert.equal(s(decompose(1, 3, true)), 'h.'); // dotted half on the 2nd beat
  assert.equal(s(decompose(1, 3, false, 1, true)), 'q h'); // rests: half rest on 3
  assert.equal(s(decompose(0.5, 1.5, false)), '8 q'); // complete the beat first
  assert.equal(s(decompose(0, 2.5, true)), 'h 8');
  assert.equal(s(decompose(1.5, 1.5, true, 1.5)), 'q.'); // 6/8: dotted quarter on the 2nd beat
  assert.equal(s(decompose(0.25, 1.75, true)), '16 8 q');
  assert.equal(decompose(0, 1 / 3, true), null);
  assert.deepEqual(singleValue(3, true), { d: 'h', dot: true });
  assert.equal(singleValue(3, false), null);
});

test('quarter, quarter, whole in 4/4 → quarter quarter half⁀ | half', () => {
  const out = fit([n('q'), n('q'), n('w')]);
  assert.equal(show(out), 'q q h~+ h');
  const m = segmentMeasures(out, '4/4');
  assert.equal(m.length, 2);
  assert.ok(m[0].full);
});

test('a whole note on beat 4: quarter⁀ | dotted half; and across several measures', () => {
  assert.equal(show(fit([n('h.'.replace('.', ''), { dot: true }), n('w')])), 'h. q~+ h.');
  assert.equal(show(fit([n('q'), n('w', { dot: true })], '3/4')), 'q h~+ h.~+ q');
});

test('rests are split without a tie', () => {
  assert.equal(show(fit([n('h', { dot: true }), r('h')])), 'h. rq+ rq');
});

test('identity: a staff without overflow is returned as is (syncopations included)', () => {
  const items = [n('8'), n('q'), n('8'), n('h', { tie: true }), n('q'), n('q', { dot: true }), n('8')];
  assert.deepEqual(fit(items), items);
});

test('gluing: after a deletion, the split note becomes whole again', () => {
  const cut = fit([n('q'), n('q'), n('w')]); // q q h~+ h
  const removed = cut.slice(1); // remove the 1st quarter
  assert.equal(show(fit(removed)), 'q h.~+ q');
  const removed2 = cut.slice(2); // remove both quarters
  assert.equal(show(fit(removed2)), 'w');
});

test('user ties and properties follow the right pieces', () => {
  const out = fit([n('h', { dot: true }), n('h', { c: 'F7', a: -1, tie: true, bar: 'final' })]);
  // The chord and the accidental stay on the 1st piece; the user's tie and the barline on the last.
  assert.equal(out[1].c, 'F7');
  assert.equal(out[1].a, -1);
  assert.ok(out[1].auto && !out[2].auto);
  assert.equal(out[2].bar, 'final');
  assert.ok(out[2].tie);
  assert.ok(!('a' in out[2]) && !('c' in out[2]));
});

test('triplets are never split; the overflow is reported', () => {
  const items = [n('h', { dot: true }), n('8'), n('8', { tup: 3 }), n('8', { tup: 3 })];
  const res = normalizeStaff(items, '4/4');
  assert.equal(show(res.items), 'h. 8 8³ 8³');
  assert.ok(res.tupCross.has(3));
});

test('startOf: index mapping after refitting', () => {
  const res = normalizeStaff([n('q'), n('q'), n('w'), n('q')], '4/4');
  assert.deepEqual(res.startOf, [0, 1, 2, 4, 5]);
  assert.equal(chainStart(res.items, 3), 2);
  assert.equal(chainEnd(res.items, 2), 3);
});

test('resizeEvent: shortening adds a rest, what follows does not move', () => {
  const items = [n('q'), n('q'), n('q'), n('q'), n('h')];
  const res = resizeEvent(items, '4/4', 0, { d: '8' });
  assert.equal(show(res.items), '8 r8 q q q h');
  assert.equal(res.index, 0);
  // Half → dotted eighth: rests written cleanly.
  const res2 = resizeEvent([n('h'), n('h')], '4/4', 0, { d: '8', dot: true });
  assert.equal(show(res2.items), '8. r16+ rq h'); // a single logical rest, written in two
});

test('resizeEvent: lengthening eats rests, otherwise shifts (and re-splits)', () => {
  const short = resizeEvent([n('q'), n('q'), n('h')], '4/4', 0, { d: '8' }).items; // 8 r8 q h
  const back = resizeEvent(short, '4/4', 0, { d: 'q' });
  assert.equal(show(back.items), 'q q h'); // round trip
  const res = resizeEvent([n('q'), n('q'), n('h')], '4/4', 1, { d: 'h' }); // no rest: shift
  assert.equal(show(res.items), 'q h q~+ q');
  // Rest partly eaten.
  const res3 = resizeEvent([n('q'), r('h', { dot: true })], '4/4', 0, { d: 'h' });
  assert.equal(show(res3.items), 'h rh');
});

test('resizeEvent: a split note is changed as a whole; the measure stays full', () => {
  const cut = fit([n('q'), n('q'), n('w')]); // q q h~+ h
  const res = resizeEvent(cut, '4/4', 3, { d: 'h' }); // touching the 2nd piece
  assert.equal(show(res.items), 'q q h rh');
  assert.equal(res.index, 2);
  res.items.forEach((it) => assert.ok(qlen(it) > 0));
});

test('time signature change: everything is re-split', () => {
  const in44 = [n('h'), n('h'), n('h'), n('h')];
  assert.equal(show(fit(in44, '3/4')), 'h q~+ q h h');
});

test('sanitize: automatic pieces are kept on reload', () => {
  const b = sanitizeBlock({
    type: 'staff',
    clef: 'treble',
    time: '4/4',
    items: fit([n('q'), n('q'), n('w')]),
  });
  assert.equal(show(b.items), 'q q h~+ h');
  assert.ok(!sanitizeBlock({ type: 'staff', items: [n('8', { tup: 3, auto: true })] }).items[0].auto);
});

/** Total duration of a staff, in quarter notes. */
const total = (items) => Math.round(items.reduce((t, it) => t + qlen(it), 0) * 1e6) / 1e6;

test('bug 2.6.0: toggling the dot repeatedly does not add time (every value)', () => {
  const contexts = {
    seule: (x) => [x],
    'avant des notes': (x) => [x, n('q'), n('q'), n('h')],
    'avant des silences': (x) => [x, r('q'), r('h')],
    'sur un contretemps': (x) => [n('8'), x, n('q'), r('h')],
  };
  ['w', 'h', 'q', '8', '16'].forEach((d) =>
    Object.entries(contexts).forEach(([ctx, make]) => {
      const i = ctx === 'sur un contretemps' ? 1 : 0;
      let items = fit(make(n(d)));
      const start = total(items);
      let afterTwo = null;
      for (let k = 0; k < 12; k++) {
        const cur = items[i];
        const res = resizeEvent(items, '4/4', i, { d: cur.d, dot: !cur.dot });
        items = res.items;
        // Never more than the requested duration difference (here, half a value).
        assert.ok(Math.abs(total(items) - start) <= qlen({ d }) / 2 + 1e-9, `${d} ${ctx} étape ${k}`);
        if (k === 1) afterTwo = total(items);
        // Stable cycle: after one round trip, every round trip gives the same duration back.
        if (k % 2 === 1) assert.equal(total(items), afterTwo, `${d} ${ctx} : cycle stable (étape ${k})`);
      }
    }),
  );
});

test('resizeEvent (fuzz): the total duration never changes more than the changed note', () => {
  const vals = ['w', 'h', 'q', '8', '16'];
  let seed = 7;
  const rnd = (k) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % k;
  };
  for (let trial = 0; trial < 300; trial++) {
    let items = fit(
      Array.from({ length: 1 + rnd(6) }, () => {
        const it = { d: vals[rnd(5)] };
        if (rnd(3) === 0) it.r = true;
        else it.s = 4;
        if (rnd(4) === 0) it.dot = true;
        return it;
      }),
    );
    for (let step = 0; step < 6; step++) {
      const i = rnd(items.length);
      const before = total(items);
      const start = chainStart(items, i);
      let oldLen = 0;
      for (let k = start; k <= chainEnd(items, i); k++) oldLen += qlen(items[k]);
      const value = { d: vals[rnd(5)], dot: rnd(3) === 0 };
      const res = resizeEvent(items, '4/4', i, value);
      const delta = Math.abs(qlen(value) - oldLen);
      assert.ok(
        Math.abs(total(res.items) - before) <= delta + 1e-9,
        `essai ${trial}.${step} : ${show(items)} → ${show(res.items)}`,
      );
      res.items.forEach((it) => assert.ok(!(it.r && it.tie)));
      items = res.items;
    }
  }
});
