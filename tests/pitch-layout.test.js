// Tests for pitches, layout and SVG rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiOf, resolveMidis, pitchName, keyAcc } from '../js/pitch.js';
import { layout } from '../js/layout.js';
import { staffSvg } from '../js/render-staff.js';

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
const q = (s, extra = {}) => ({ d: 'q', s, ...extra });

test('midiOf: clef references', () => {
  assert.equal(midiOf('treble', 0, 0), 64); // E4 on the 1st line
  assert.equal(midiOf('treble', -2, 0), 60); // C4
  assert.equal(midiOf('bass', 0, 0), 43); // G2
  assert.equal(pitchName('treble', 4, -1), 'Si♭ 4');
});

test('resolveMidis: the accidental holds until the barline', () => {
  const m = resolveMidis(staff([q(4, { a: -1 }), q(4), q(0), q(0), q(4)]));
  assert.deepEqual(m, [70, 70, 64, 64, 71]); // the 5th note is in the next measure: B natural
});

test('resolveMidis: a tied note keeps its pitch across the barline', () => {
  const m = resolveMidis(staff([q(0), q(0), q(0), q(4, { a: -1, tie: true }), q(4)]));
  assert.equal(m[4], 70);
});

test('layout: final barline, no more add zone, last line justified beyond 50%', () => {
  const items = Array.from({ length: 16 }, (_, i) => q(i % 8));
  items[15].bar = 'final';
  const L = layout(staff(items), 360, true);
  assert.equal(L.appendX, null);
  assert.equal(L.ended, true);
  const last = L.systems[L.systems.length - 1];
  assert.ok(Math.abs(last.end - (360 - 4)) < 1); // stretched to the edge
});

test('layout: without a final barline, the last line keeps its natural width', () => {
  const L = layout(staff([q(0), q(2)]), 360, true);
  assert.ok(L.appendX > 0 && L.appendX < 200);
});

test('render-staff: tie and triplet drawn', () => {
  const t = (s) => ({ d: '8', s, tup: 3 });
  const { svg } = staffSvg(staff([q(2, { tie: true }), q(2), t(4), t(5), t(6)]), 360);
  assert.match(svg, /<path class="f" d="M[\d.]+ [\d.]+ Q/); // tie crescent
  assert.match(svg, /class="tup"[^>]*>3</);
});

test('keyAcc: sharp and flat key signatures, every octave, bass clef shifted', () => {
  // G major (1♯): F sharp, in every octave.
  assert.equal(keyAcc('treble', 8, 1), 1); // F5
  assert.equal(keyAcc('treble', 1, 1), 1); // F4
  assert.equal(keyAcc('treble', 5, 1), 0); // C5: not yet (2♯)
  assert.equal(keyAcc('treble', 5, 2), 1);
  // B♭ major (2♭): B and E flat.
  assert.equal(keyAcc('treble', 4, -2), -1); // B4
  assert.equal(keyAcc('treble', 7, -2), -1); // E5
  assert.equal(keyAcc('treble', 3, -2), 0); // A4
  // Bass clef: the 1st line is G2, F is just below.
  assert.equal(keyAcc('bass', -1, 1), 1);
  assert.equal(keyAcc('treble', 4, 0), 0);
});

test('resolveMidis: the key signature applies, a written accidental replaces it until the barline', () => {
  const b = {
    clef: 'treble',
    time: '4/4',
    ks: 1, // G major
    items: [
      { d: 'q', s: 1 }, // F4 → F♯ (66)
      { d: 'q', s: 1, a: 0 }, // F♮ (65)
      { d: 'q', s: 1 }, // still F♮ (same measure)
      { d: 'q', s: 8 }, // F5: another position, key signature (78)
      { d: 'q', s: 1 }, // next measure: F♯ again
    ],
  };
  assert.deepEqual(resolveMidis(b), [66, 65, 65, 78, 66]);
  assert.equal(pitchName('treble', 1, undefined, 1), 'Fa♯ 4');
  assert.equal(pitchName('treble', 1, 0, 1), 'Fa♮ 4');
});

test('layout: the key signature shifts the start of each line', () => {
  const items = Array.from({ length: 24 }, () => ({ d: 'q', s: 4 }));
  const plain = layout({ clef: 'treble', time: '4/4', items }, 358);
  const three = layout({ clef: 'treble', time: '4/4', ks: -3, items }, 358);
  assert.equal(three.ksw, 3 * 9 + 4);
  assert.equal(three.systems[0].start - plain.systems[0].start, three.ksw);
  assert.equal(three.systems[1].start - plain.systems[1].start, three.ksw);
  assert.equal(layout({ clef: 'rhythm', time: '4/4', ks: 2, items: [] }, 358).ksw, 0);
});

test('layout: the insertion cursor opens a gap before the target note', () => {
  const items = [
    { d: 'q', s: 4 },
    { d: 'q', s: 4 },
    { d: 'q', s: 4 },
  ];
  const b = { clef: 'treble', time: '4/4', items };
  const L0 = layout(b, 700, true);
  const L1 = layout(b, 700, true, 1);
  assert.equal(L0.insertX, null);
  assert.equal(L1.insertSys, 0);
  assert.ok(L1.insertX > L1.pos[0].x1 - 1 && L1.insertX < L1.pos[1].x0); // in the gap
  assert.ok(L1.pos[1].x0 - L0.pos[1].x0 >= 30); // the target note is shifted
  assert.equal(layout(b, 700, true, 3).insertX, null); // at the end: usual add zone
});

test('staffSvg: the key signature is drawn on each line, the time signature shifted', () => {
  const items = Array.from({ length: 24 }, () => ({ d: 'q', s: 4 }));
  const svg = (ks) => staffSvg({ id: 'k', type: 'staff', clef: 'treble', time: '4/4', ks, items }, 358).svg;
  const plain = svg(undefined);
  const flats = svg(-3);
  assert.ok(!flats.includes('NaN'));
  // A flat = 2 paths; 3 more flats per line.
  const paths = (x) => (x.match(/<path/g) || []).length;
  const lines = layout({ clef: 'treble', time: '4/4', ks: -3, items }, 358).systems.length;
  assert.equal(paths(flats) - paths(plain), 3 * 2 * lines);
  assert.ok(flats.includes('x="77"')); // time signature: 46 + 3×9 + 4
});

// --- 2.8.2: higher notes --------------------------------------------------
import { geom, stepFromY, yOfStep } from '../js/layout.js';
import { sanitizeBlock } from '../js/sanitize.js';
import { STEP_MIN, STEP_MAX } from '../js/model.js';

test('pitch range: from F3 to D7 in treble clef', () => {
  assert.equal(midiOf('treble', STEP_MAX, 0), 98); // D7 (MIDI 98)
  assert.equal(midiOf('treble', STEP_MIN, 0), 53); // F3
  const b = { type: 'staff', clef: 'treble', time: '4/4', items: [{ d: 'q', s: 4 }] };
  const L = layout(b, 360);
  const g = geom(L, 0);
  assert.equal(stepFromY(g, -500), STEP_MAX); // bounded
  assert.equal(stepFromY(g, 5000), STEP_MIN);
  assert.equal(stepFromY(g, yOfStep(L, g, 17)), 17);
});

test('the staff grows upward only for notes above E6', () => {
  const mk = (s) => layout({ type: 'staff', clef: 'treble', time: '4/4', items: [{ d: 'q', s }] }, 360);
  assert.equal(mk(14).padTop, 0);
  assert.equal(mk(14).SH, 124);
  assert.equal(mk(20).padTop, 30);
  assert.equal(mk(20).SH, 154);
  const L = mk(20);
  // The highest note stays at the same place in the band as an E6 did before.
  assert.equal(yOfStep(L, geom(L, 0), 20), yOfStep(mk(14), geom(mk(14), 0), 14));
  // A rest does not count; nor does a rhythm line.
  assert.equal(
    layout({ type: 'staff', clef: 'treble', time: '4/4', items: [{ d: 'q', r: true, s: 20 }] }, 360).padTop,
    0,
  );
});

test('import: pitches bounded to the new range', () => {
  const b = sanitizeBlock({
    type: 'staff',
    clef: 'treble',
    time: '4/4',
    tempo: 100,
    items: [
      { d: 'q', s: 19 },
      { d: 'q', s: 40 },
      { d: 'q', s: -30 },
    ],
  });
  assert.deepEqual(
    b.items.map((i) => i.s),
    [19, STEP_MAX, STEP_MIN],
  );
});
