// Tests for musical time: measures, triplets, beams, playback.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qlen } from '../js/model.js';
import {
  segmentMeasures,
  tupletGroups,
  beamGroups,
  staffPlayOrder,
  staffEvents,
  swingWarp,
} from '../js/rhythm.js';

const n = (d, extra = {}) => ({ d, s: 4, ...extra });
const staff = (items, extra = {}) => ({
  id: 't',
  type: 'staff',
  clef: 'treble',
  time: '4/4',
  tempo: 120,
  swing: false,
  items,
  ...extra,
});

test('qlen: dot and triplet', () => {
  assert.equal(qlen(n('q')), 1);
  assert.equal(qlen(n('q', { dot: true })), 1.5);
  assert.ok(Math.abs(qlen(n('8', { tup: 3 })) - 1 / 3) < 1e-12);
});

test('segmentMeasures: full measure, forced barline, start repeat', () => {
  const items = [n('h'), n('h'), n('q', { bar: 'double' }), n('q', { rs: true }), n('q')];
  const m = segmentMeasures(items, '4/4');
  assert.deepEqual(
    m.map((x) => x.idx),
    [[0, 1], [2], [3, 4]],
  );
  assert.equal(m[1].type, 'double');
  assert.equal(m[2].rs, true);
  assert.equal(m[2].full, false);
});

test('segmentMeasures: three triplet eighths fill exactly one beat', () => {
  const items = [n('q'), n('q'), n('q'), n('8', { tup: 3 }), n('8', { tup: 3 }), n('8', { tup: 3 }), n('q')];
  const m = segmentMeasures(items, '4/4');
  assert.deepEqual(
    m.map((x) => x.idx),
    [[0, 1, 2, 3, 4, 5], [6]],
  );
});

test('tupletGroups: eighths, quarter-eighth, incomplete group', () => {
  const t = (d) => n(d, { tup: 3 });
  const g = tupletGroups([t('8'), t('8'), t('8'), t('q'), t('8'), t('8'), n('q')], '4/4');
  assert.deepEqual(
    g.map((x) => [x.idx, x.complete]),
    [
      [[0, 1, 2], true],
      [[3, 4], true],
      [[5], false],
    ],
  );
});

test('beamGroups: by beat, triplet beamed separately', () => {
  const t = (d) => n(d, { tup: 3 });
  const items = [n('8'), n('8'), t('8'), t('8'), t('8'), n('8'), n('16'), n('16'), n('q', { r: true })];
  assert.deepEqual(beamGroups(items, '4/4'), [
    [0, 1],
    [2, 3, 4],
    [5, 6, 7],
  ]);
});

test('beamGroups: in 6/8, grouping by dotted quarter', () => {
  const items = Array.from({ length: 6 }, () => n('8'));
  assert.deepEqual(beamGroups(items, '6/8'), [
    [0, 1, 2],
    [3, 4, 5],
  ]);
});

test('staffPlayOrder: the repeat is played twice', () => {
  const items = [n('q'), n('q', { rs: true }), n('q', { bar: 'rep' }), n('q')];
  assert.deepEqual(staffPlayOrder(items), [0, 1, 2, 1, 2, 3]);
});

test('swingWarp: the offbeat eighth falls at 2/3 of the beat', () => {
  assert.equal(swingWarp(0), 0);
  assert.ok(Math.abs(swingWarp(0.5) - 2 / 3) < 1e-9);
  assert.equal(swingWarp(1), 1);
});

test('staffEvents: a tie extends the note without replaying it', () => {
  const { events, total } = staffEvents(staff([n('8', { tie: true }), n('8'), n('h')]));
  assert.equal(events[0].end, 1); // 0.5 + 0.5
  assert.equal(events[1].held, true);
  assert.equal(events[2].start, 1);
  assert.equal(total, 3);
});

test('staffEvents: swing does not warp triplets', () => {
  const t = (d) => n(d, { tup: 3 });
  const { events } = staffEvents(staff([n('8'), n('8'), t('8'), t('8'), t('8')], { swing: true }));
  assert.ok(Math.abs(events[1].start - 2 / 3) < 1e-9); // swung eighth
  assert.ok(Math.abs(events[3].start - (1 + 1 / 3)) < 1e-9); // triplet untouched
});

test('staffEvents: with swing, sixteenths stay even (beat played straight)', () => {
  const starts = (items) =>
    staffEvents(staff(items, { swing: true })).events.map((e) => Math.round(e.start * 1000) / 1000);
  // Beat 1: four sixteenths (straight); beat 2: two eighths (swing).
  assert.deepEqual(
    starts([n('16'), n('16'), n('16'), n('16'), n('8'), n('8')]),
    [0, 0.25, 0.5, 0.75, 1, 1.667],
  );
  // Eighth + two sixteenths: the beat contains sixteenths, it is played straight.
  assert.deepEqual(starts([n('8'), n('16'), n('16'), n('8'), n('8')]), [0, 0.5, 0.75, 1, 1.667]);
  // Dotted eighth + sixteenth: the sixteenth falls at 3/4 of the beat, straight too.
  assert.deepEqual(starts([n('8', { dot: true }), n('16'), n('q')]), [0, 0.75, 1]);
  // Syncopation in eighths (eighth, quarter, eighth): normal swing.
  assert.deepEqual(starts([n('8'), n('q'), n('8')]), [0, 0.667, 1.667]);
});

// --- 2.8.4: playing part of the staff -------------------------------------
import { staffSegment } from '../js/rhythm.js';
import { layout } from '../js/layout.js';

/** Four measures of whole notes: s = 0, 1, 2, 3 (to recognize them). */
const four = (extra = []) => staff([0, 1, 2, 3].map((s, k) => ({ d: 'w', s, ...(extra[k] || {}) })));

test('staffSegment: from one measure to another, times shifted to the start', () => {
  const seg = staffSegment(four(), 1, 2);
  assert.deepEqual(
    seg.events.map((e) => [e.i, e.start, e.end]),
    [
      [1, 0, 4],
      [2, 4, 8],
    ],
  );
  assert.equal(seg.total, 8);
  assert.equal(seg.measures, 2);
  // To the end.
  assert.deepEqual(
    staffSegment(four(), 2, Infinity).events.map((e) => e.i),
    [2, 3],
  );
  assert.equal(staffSegment(four(), 9, 9), null); // measure that does not exist
});

test('staffSegment: repeat unrolled inside, first pass', () => {
  // ‖: m0 m1 :‖ m2 m3 → playback m0 m1 m0 m1 m2 m3
  const b = four([{ rs: true }, { bar: 'rep' }]);
  assert.deepEqual(
    staffSegment(b, 1, 2).events.map((e) => e.i),
    [1, 0, 1, 2], // from the 1st pass through m1 up to m2: the repeat is played
  );
  assert.deepEqual(
    staffSegment(b, 0, 0).events.map((e) => e.i),
    [0], // m0 alone: its first pass
  );
});

test('staffSegment: a tied note arriving from before is attacked', () => {
  // Half note tied over the barline: h h~ | h h
  const b = staff([n('h'), n('h', { tie: true }), n('h'), n('h')]);
  const full = staffEvents(b).events;
  assert.equal(full[2].held, true);
  const seg = staffSegment(b, 1, 1).events;
  assert.equal(seg[0].held, false); // attacked at the start of the segment
  assert.equal(seg[0].end, 2);
});

test('layout: place of each measure', () => {
  const L = layout(four(), 360);
  assert.equal(L.mrects.length, 4);
  L.mrects.forEach((m, k) => {
    assert.ok(m.x1 > m.x0);
    if (k && L.mrects[k - 1].sys === m.sys) assert.ok(Math.abs(m.x0 - L.mrects[k - 1].x1) < 1e-6);
  });
});
