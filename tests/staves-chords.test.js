// Tests for chords on a staff and blocks with several staves (2.17).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  headsOf,
  toggleHead,
  placeHeads,
  stemUpFor,
  headRoom,
  moveHeads,
  copyHeads,
  HEAD_SHIFT,
  HEADS_MAX,
} from '../js/noteheads.js';
import {
  partsOf,
  partView,
  addPart,
  removePart,
  movePart,
  setPartClef,
  setKey,
  PARTS_MAX,
} from '../js/parts.js';
import {
  scoreMeasures,
  scorePlayOrder,
  scoreEvents,
  scoreSegment,
  partEnd,
  shareBarline,
} from '../js/score.js';
import { resolvePitches, resolveMidis } from '../js/pitch.js';
import { layout, geom, bandAt } from '../js/layout.js';
import { staffSvg } from '../js/render-staff.js';
import { sanitizeBlock } from '../js/sanitize.js';
import { changeInstrument } from '../js/transpose.js';
import { normalizeStaff } from '../js/measure-fit.js';

const block = (items, extra = {}) => ({
  id: 'b',
  type: 'staff',
  clef: 'treble',
  time: '4/4',
  tempo: 120,
  swing: false,
  items,
  ...extra,
});
const q = (s, extra = {}) => ({ d: 'q', s, ...extra });

// --- Chords -------------------------------------------------------------------

test('headsOf: own note and stacked ones, sorted; none for a rest', () => {
  assert.deepEqual(headsOf(q(4, { a: 1, x: [{ s: 0 }, { s: 7, a: -1 }] })), [
    { s: 0 },
    { s: 4, a: 1 },
    { s: 7, a: -1 },
  ]);
  assert.deepEqual(headsOf({ d: 'q', r: true }), []);
  assert.deepEqual(headsOf(q(2)), [{ s: 2 }]);
});

test('toggleHead: add, remove, own note handed over, last note kept, at most six', () => {
  const it = q(4);
  assert.equal(toggleHead(it, 4), null); // the only note stays
  assert.equal(toggleHead(it, 7, 1), 'added');
  assert.equal(toggleHead(it, 0), 'added');
  assert.deepEqual(it.x, [{ s: 0 }, { s: 7, a: 1 }]);
  assert.equal(toggleHead(it, 7), 'removed');
  assert.deepEqual(it.x, [{ s: 0 }]);
  assert.equal(toggleHead(it, 4), 'removed'); // own note: the lowest stacked one takes its place
  assert.deepEqual(it, { d: 'q', s: 0 });
  for (let s = 1; s < HEADS_MAX; s++) toggleHead(it, s * 2);
  assert.equal(headsOf(it).length, HEADS_MAX);
  assert.equal(toggleHead(it, -3), 'full');
  assert.equal(toggleHead({ d: 'q', r: true }, 3), null);
});

test('stem direction of a chord: middle of its outer notes', () => {
  assert.equal(stemUpFor([{ s: 3 }]), true);
  assert.equal(stemUpFor([{ s: 4 }]), false);
  assert.equal(stemUpFor([{ s: 0 }, { s: 6 }]), true); // middle 3
  assert.equal(stemUpFor([{ s: 2 }, { s: 9 }]), false); // middle 5.5
});

test('placeHeads: a second goes to the other side of the stem', () => {
  const up = placeHeads([{ s: 2 }, { s: 3 }, { s: 4 }], true);
  assert.deepEqual(
    up.map((h) => h.dx),
    [0, HEAD_SHIFT, 0],
  );
  const down = placeHeads([{ s: 2 }, { s: 3 }], false);
  assert.deepEqual(
    down.map((h) => h.dx),
    [-HEAD_SHIFT, 0],
  );
});

test('placeHeads: accidentals closer than a sixth take another column', () => {
  const p = placeHeads(
    [
      { s: 0, a: 1 },
      { s: 2, a: -1 },
      { s: 9, a: 0 },
    ],
    true,
  );
  // From the top: s 9 → column 0; s 2 → column 0 (far from 9); s 0 → column 1 (near 2).
  assert.deepEqual(
    p.map((h) => h.col),
    [1, 0, 0],
  );
  assert.deepEqual(headRoom(q(2), false), { left: 0, right: 0 });
  assert.deepEqual(headRoom(q(2, { a: 1 }), false), { left: 12, right: 0 });
  assert.deepEqual(headRoom(q(0, { a: 1, x: [{ s: 2, a: -1 }] }), false), { left: 22, right: 0 });
  assert.deepEqual(headRoom(q(2, { x: [{ s: 3 }] }), false), { left: 0, right: HEAD_SHIFT });
});

test('moveHeads keeps the chord shape, inside the staff; copyHeads for a tied note', () => {
  const it = q(4, { x: [{ s: 8 }] });
  moveHeads(it, 6);
  assert.deepEqual(headsOf(it), [{ s: 6 }, { s: 10 }]);
  moveHeads(it, 30); // the top note stops at the top of the staff
  assert.deepEqual(headsOf(it), [{ s: 16 }, { s: 20 }]);
  const next = q(0, { a: 1 });
  copyHeads(it, next);
  assert.deepEqual(next, { d: 'q', s: 16, x: [{ s: 20 }] });
});

test('resolvePitches: one pitch per note, accidentals held in the measure, ties', () => {
  const b = block([
    q(0, { x: [{ s: 2, a: 1 }, { s: 4 }] }), // E4, G♯4, B4
    q(2), // G♯4: the sharp holds
    q(4, { tie: true, x: [{ s: 1 }] }),
    q(4, { x: [{ s: 1 }] }),
  ]);
  assert.deepEqual(resolvePitches(b), [[64, 68, 71], [68], [71, 65], [71, 65]]);
  assert.deepEqual(resolveMidis(b), [64, 68, 71, 71]);
});

test('measure-fit: a chord split at the barline keeps its notes on every piece', () => {
  const items = [q(4), q(4), q(4), { d: 'h', s: 0, x: [{ s: 4 }] }];
  const out = normalizeStaff(items, '4/4').items;
  assert.equal(out.length, 5);
  assert.deepEqual(out[3].x, [{ s: 4 }]);
  assert.deepEqual(out[4].x, [{ s: 4 }]);
  assert.ok(out[3].tie && out[3].auto);
});

test('transpose: a chord moves as a whole, accidentals rewritten', () => {
  const b = block([q(0, { x: [{ s: 2 }, { s: 4 }] })]); // E G B
  const before = resolvePitches(b)[0];
  changeInstrument(b, 'Bb');
  assert.deepEqual(resolvePitches(b)[0], before);
  assert.deepEqual(
    headsOf(b.items[0]).map((h) => [h.s, h.a]),
    [
      [1, undefined],
      [3, undefined],
      [5, undefined],
    ],
  ); // F♯ A C♯, sharps from the key signature (D major)
  assert.equal(b.ks, 2);
});

// --- Several staves -----------------------------------------------------------

test('partsOf and partView: the first staff is the block, the others are views', () => {
  const b = block([q(4)], { more: [{ clef: 'bass', items: [q(2)], tr: 'Bb', ks: 2 }] });
  const parts = partsOf(b);
  assert.equal(parts.length, 2);
  assert.equal(parts[0], b);
  assert.equal(partView(b, 0), b);
  const v = partView(b, 1);
  assert.equal(v.clef, 'bass');
  assert.equal(v.time, '4/4');
  assert.equal(v.id, 'b');
  v.items = [q(1)];
  assert.deepEqual(b.more[0].items, [q(1)]);
  delete v.tr;
  assert.ok(!('tr' in b.more[0]));
  assert.equal(b.tr, undefined);
  v.ks = -1;
  assert.equal(b.more[0].ks, -1);
  assert.equal(b.ks, undefined);
  assert.deepEqual(resolveMidis(v), [45]); // B2 in bass clef, a flat in the key
});

test('addPart: bass under a treble staff, key of the block, at most four', () => {
  const b = block([q(4)], { ks: 2, tr: 'Bb' });
  assert.equal(addPart(b, 0), 1);
  assert.deepEqual(b.more[0], { clef: 'bass', items: [] }); // B♭ in D = concert C: no accidental
  assert.equal(addPart(b, 1), 2);
  assert.equal(b.more[1].clef, 'bass');
  assert.equal(addPart(b, 0), 1); // inserted under the first staff
  assert.equal(partsOf(b).length, PARTS_MAX);
  assert.equal(addPart(b, 0), -1);
});

test('movePart and removePart: the first staff is rewritten into the block', () => {
  const b = block([q(4)], { ks: 1, more: [{ clef: 'bass', items: [q(2)], ks: 1 }] });
  assert.equal(movePart(b, 1, -1), 0);
  assert.equal(b.clef, 'bass');
  assert.deepEqual(b.items, [q(2)]);
  assert.deepEqual(b.more, [{ clef: 'treble', items: [q(4)], ks: 1 }]);
  assert.equal(movePart(b, 0, -1), 0); // already at the top
  assert.ok(removePart(b, 0));
  assert.equal(b.clef, 'treble');
  assert.equal(b.more, undefined);
  assert.ok(!removePart(b, 0)); // the last staff stays
});

test('setPartClef: rhythm drops pitches; from rhythm, notes on the middle line', () => {
  const p = { clef: 'treble', items: [q(2, { a: 1, x: [{ s: 5 }] }), { d: 'q', r: true }], tr: 'Eb', ks: 3 };
  setPartClef(p, 'rhythm');
  assert.deepEqual(p, { clef: 'rhythm', items: [{ d: 'q' }, { d: 'q', r: true }] });
  setPartClef(p, 'bass');
  assert.deepEqual(p.items[0], { d: 'q', s: 4 });
});

test('setKey: the same concert key on every staff', () => {
  const b = block([], {
    more: [
      { clef: 'treble', items: [], tr: 'Bb' },
      { clef: 'rhythm', items: [] },
    ],
  });
  setKey(b, 0, -3); // E♭ major in C
  assert.equal(b.ks, -3);
  assert.equal(b.more[0].ks, -1); // F major for B♭
  assert.equal(b.more[1].ks, undefined);
  setKey(b, 1, 0); // C for B♭ = B♭ major in C
  assert.equal(b.ks, -2);
  assert.equal(b.more[0].ks, undefined);
});

test('scoreMeasures: measures merged, strongest barline, a staff may stop earlier', () => {
  const b = block([q(4), q(4), q(4), q(4, { bar: 'double' }), { d: 'w', s: 4 }], {
    more: [{ clef: 'bass', items: [{ d: 'w', s: 2, bar: 'final' }] }],
  });
  const ms = scoreMeasures(b);
  assert.equal(ms.length, 2);
  assert.equal(ms[0].type, 'final');
  assert.deepEqual(ms[0].parts[0].on, [0, 1, 2, 3]);
  assert.deepEqual(ms[0].parts[1].on, [0]);
  assert.equal(ms[1].parts[1], null);
  assert.equal(ms[1].full, true);
  assert.deepEqual(partEnd(ms, 1, 4), { m: 1, on: 0 });
  const rep = block([q(4, { rs: true }), q(4), q(4), q(4, { bar: 'rep' }), { d: 'w', s: 4 }]);
  assert.deepEqual(scorePlayOrder(scoreMeasures(rep)), [0, 0, 1]);
});

test('scoreEvents: two staves in time, chords, ties per staff', () => {
  const b = block(
    [
      { d: 'h', s: 0, x: [{ s: 4 }], tie: true },
      { d: 'h', s: 0, x: [{ s: 4 }] },
    ],
    {
      more: [{ clef: 'bass', items: [q(0), q(2), q(4), q(6)] }],
    },
  );
  const { events, total } = scoreEvents(b);
  assert.equal(total, 4);
  const top = events.filter((e) => e.k === 0);
  const low = events.filter((e) => e.k === 1);
  assert.deepEqual(top[0].midis, [64, 71]);
  assert.equal(top[0].end, 4); // tied over the second half note
  assert.ok(top[1].held);
  assert.deepEqual(
    low.map((e) => e.start),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    low.map((e) => e.midi),
    [43, 47, 50, 53],
  );
  // Sorted by time, staves interleaved.
  assert.deepEqual(
    events.map((e) => e.start),
    [0, 0, 1, 2, 2, 3],
  );
});

test('scoreEvents: a staff with an incomplete measure stays in time with the others', () => {
  const b = block([q(4), q(4), q(4), q(4), q(4)], { more: [{ clef: 'bass', items: [{ d: 'h', s: 0 }] }] });
  // The bass has only half a measure: the treble's 5th quarter still starts at 4.
  assert.equal(scoreEvents(b).events.find((e) => e.k === 0 && e.i === 4).start, 4);
  const seg = scoreSegment(b, 1, 1);
  assert.deepEqual(
    seg.events.map((e) => [e.k, e.i, e.start]),
    [[0, 4, 0]],
  );
});

test('shareBarline: a barline changed on one staff is copied to the others', () => {
  const b = block([q(4), q(4), q(4), q(4, { bar: 'final' })], {
    more: [
      {
        clef: 'bass',
        items: [
          { d: 'h', s: 0 },
          { d: 'h', s: 2, bar: 'double' },
        ],
      },
    ],
  });
  shareBarline(b, 0, 2);
  assert.equal(b.more[0].items[1].bar, 'final');
  delete b.items[3].bar;
  shareBarline(b, 0, 3);
  assert.equal(b.more[0].items[1].bar, undefined);
});

test('layout: notes starting together are aligned; bands of every staff', () => {
  const b = block([q(4), q(4), { d: 'h', s: 4, a: 1 }], {
    more: [
      {
        clef: 'bass',
        items: [
          { d: '8', s: 2 },
          { d: '8', s: 2 },
          { d: 'h', dot: true, s: 2 },
        ],
      },
    ],
  });
  const L = layout(b, 600);
  const [top, low] = L.parts;
  assert.equal(L.left, 14);
  assert.equal(top.pos[0].x, low.pos[0].x); // beat 1
  assert.equal(top.pos[1].x, low.pos[2].x); // beat 2
  assert.ok(low.pos[1].x > top.pos[0].x && low.pos[1].x < top.pos[1].x); // the offbeat eighth between
  assert.equal(L.SH, top.H + low.H);
  assert.equal(low.off, top.H);
  assert.equal(geom(L, 0, 1).top, top.H);
  assert.deepEqual(bandAt(L, top.H + 10), { sys: 0, k: 1 });
  assert.deepEqual(bandAt(L, L.SH + 5), { sys: 0, k: 1 }); // below the last line: its last staff
});

test('layout: a shorter staff gets a narrow add zone where its next note goes', () => {
  const b = block([q(4), q(4), q(4), q(4), q(4)], { more: [{ clef: 'bass', items: [{ d: 'h', s: 0 }] }] });
  const L = layout(b, 600, true, null, 1);
  assert.ok(L.appendGap);
  const x3 = L.parts[0].pos[2].x0; // beat 3 of the treble, after the gap
  assert.ok(Math.abs(x3 - 17 - L.appendX) < 1); // middle of the gap opened before it
  assert.ok(L.parts[0].pos[2].x > layout(b, 600, true, null, 0).parts[0].pos[2].x); // the gap pushes beat 3
  assert.ok(!layout(b, 600, true, null, 0).appendGap); // the longer staff: usual zone at the end
});

test('staffSvg: brace and staves drawn, no NaN', () => {
  const b = block([q(2, { x: [{ s: 3 }, { s: 6, a: -1 }] })], {
    more: [
      { clef: 'bass', items: [{ d: 'w', s: 0 }] },
      { clef: 'rhythm', items: [{ d: 'q' }] },
    ],
  });
  const svg = staffSvg(b, 400, { cursor: true, part: 2 }).svg;
  assert.ok(!svg.includes('NaN'));
  assert.ok(svg.includes('class="f brace"'));
  assert.ok(svg.includes('\u{1D122}')); // bass clef
  assert.equal((svg.match(/<ellipse/g) || []).length, 3 + 1 + 1);
  assert.ok(!staffSvg(block([q(4)]), 400).svg.includes('brace'));
});

test('sanitize: stacked notes and staves validated', () => {
  const b = sanitizeBlock({
    type: 'staff',
    clef: 'treble',
    items: [{ d: 'q', s: 4, x: [{ s: 4 }, { s: 99, a: 5 }, { s: 6 }, { s: 6 }, 'x', { s: 2, a: -1 }] }],
    more: [
      { clef: 'bass', items: [{ d: 'q', s: 1, x: [{ s: 3 }] }], tr: 'Eb', ks: 9 },
      { clef: 'rhythm', items: [{ d: 'q', s: 4, x: [{ s: 3 }] }], ks: 2 },
      null,
      { clef: 'treble', items: [] },
      { clef: 'treble', items: [] },
    ],
  });
  assert.deepEqual(b.items[0].x, [{ s: 2, a: -1 }, { s: 6 }, { s: 20 }]);
  assert.equal(b.more.length, PARTS_MAX - 1);
  assert.deepEqual(b.more[0], { clef: 'bass', items: [{ d: 'q', s: 1, x: [{ s: 3 }] }], tr: 'Eb' });
  assert.deepEqual(b.more[1], { clef: 'rhythm', items: [{ d: 'q' }] });
  assert.equal(sanitizeBlock({ type: 'staff', items: [], more: [] }).more, undefined);
});
