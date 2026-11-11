// Tests for transposing instruments (2.8.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeInstrument, fifthsOf } from '../js/transpose.js';
import { resolveMidis, pitchName } from '../js/pitch.js';
import { INSTRUMENTS, instrumentOf, STEP_MAX } from '../js/model.js';
import { transposeChord } from '../js/chords.js';
import { sanitizeBlock } from '../js/sanitize.js';
import { staffSvg } from '../js/render-staff.js';

const staff = (items, ks, tr) => ({
  id: 'x',
  type: 'staff',
  clef: 'treble',
  time: '4/4',
  tempo: 100,
  items: items.map((s) => (typeof s === 'object' ? s : { d: 'q', s })),
  ...(ks ? { ks } : {}),
  ...(tr ? { tr } : {}),
});
const names = (b) => b.items.map((it) => (it.r ? 'r' : pitchName(b.clef, it.s, it.a, b.ks))).join(' ');

test('concert pitch: a note written for an instrument sounds lower', () => {
  // Written C5: in C 72; on alto sax (E♭), E♭4 = 63; on tenor, B♭3 = 58.
  assert.deepEqual(resolveMidis(staff([5])), [72]);
  assert.deepEqual(resolveMidis(staff([5], 0, 'Eb')), [63]);
  assert.deepEqual(resolveMidis(staff([5], 0, 'Bb8')), [58]);
  assert.deepEqual(resolveMidis(staff([5], 0, 'Bb')), [70]);
  assert.equal(instrumentOf('nimporte').key, 'C');
});

test('key signature: moving around the circle of fifths', () => {
  assert.equal(fifthsOf(2), 2); // major second: +2 sharps
  assert.equal(fifthsOf(9), 3); // major sixth
  assert.equal(fifthsOf(14), 2); // ninth = second
  assert.equal(fifthsOf(7), 1); // fifth
  assert.equal(fifthsOf(5), -1); // fourth
  assert.equal(fifthsOf(-9), -3);
});

test('transpose: C scale in C → A major on alto sax, same sound', () => {
  const b = staff([-2, -1, 0, 1, 2, 3, 4, 5]);
  const before = resolveMidis(b);
  changeInstrument(b, 'Eb');
  assert.equal(b.tr, 'Eb');
  assert.equal(b.ks, 3);
  assert.equal(names(b), 'La 4 Si 4 Do♯ 5 Ré 5 Mi 5 Fa♯ 5 Sol♯ 5 La 5');
  assert.ok(b.items.every((it) => it.a == null)); // the key signature is enough
  assert.deepEqual(resolveMidis(b), before);
});

test('transpose: accidentals, carried within the measure, ties', () => {
  // F major: E♭, E♭ (carried), A♯, A♯ (carried) | B tied to the next measure
  const b = staff(
    [
      { d: 'q', s: 0, a: -1 },
      { d: 'q', s: 0 },
      { d: 'q', s: 3, a: 1 },
      { d: 'q', s: 3, tie: true },
      { d: 'q', s: 3 },
    ],
    -1,
  );
  const before = resolveMidis(b);
  changeInstrument(b, 'Bb8');
  assert.equal(b.ks, 1);
  assert.deepEqual(resolveMidis(b), before);
  assert.equal(b.items[0].a, 0); // F natural in G major
  assert.equal(b.items[1].a, undefined); // carried within the measure
  assert.equal(b.items[4].s, b.items[3].s); // tied note: same position
});

test('key signature with more than 7 accidentals: rewritten enharmonically', () => {
  // F♯ major (6♯) + major sixth = D♯ major (9♯) → E♭ major (3♭).
  const b = staff([1, 2, 4, 6], 6);
  const before = resolveMidis(b);
  changeInstrument(b, 'Eb');
  assert.equal(b.ks, -3);
  assert.equal(names(b), 'Mi♭ 5 Fa 5 La♭ 5 Do 6');
  assert.deepEqual(resolveMidis(b), before);
});

test('round trip and every instrument: the sound never changes', () => {
  const items = [-6, -3, 0, { d: 'q', s: 2, a: 1 }, { d: 'q', r: true }, 4, { d: 'h', s: 7, a: -1 }, 9, 11];
  for (const ks of [-4, -1, 0, 2, 5])
    for (const a of INSTRUMENTS)
      for (const c of INSTRUMENTS) {
        const b = staff(JSON.parse(JSON.stringify(items)), ks, a.key);
        const before = resolveMidis(b);
        const { octaves } = changeInstrument(b, c.key);
        if (!octaves) assert.deepEqual(resolveMidis(b), before, `${ks} ${a.key} → ${c.key}`);
        assert.ok(b.items.every((it) => it.r || (it.s <= STEP_MAX && Math.abs(it.a ?? 0) <= 1)));
        assert.ok(Math.abs(b.ks || 0) <= 7);
      }
});

test('note that would leave the staff: brought back an octave, and reported', () => {
  const b = staff([18]);
  const { octaves } = changeInstrument(b, 'Bb8'); // +8 degrees: 26 > 20
  assert.equal(octaves, 1);
  assert.equal(b.items[0].s, 19);
});

test('keep the writing: notes and key signature do not move, the sound changes', () => {
  const b = staff([4, 5], 2);
  const before = resolveMidis(b);
  changeInstrument(b, 'Eb', { keep: true });
  assert.deepEqual(
    b.items.map((i) => i.s),
    [4, 5],
  );
  assert.equal(b.ks, 2);
  assert.deepEqual(
    resolveMidis(b),
    before.map((m) => m - 9),
  );
  changeInstrument(b, 'C', { keep: true });
  assert.equal(b.tr, undefined);
});

test('chord symbols transposed with the right spelling', () => {
  assert.equal(transposeChord('F', 5, 9), 'D');
  assert.equal(transposeChord('Bb7', 5, 9), 'G7');
  assert.equal(transposeChord('Ebmaj7/G', 1, 2), 'Fmaj7/A');
  assert.equal(transposeChord('C#m7', 5, 9), 'A#m7');
  assert.equal(transposeChord('%', 5, 9), '%');
  assert.equal(transposeChord('pas un accord', 5, 9), 'pas un accord');
  const b = staff([{ d: 'q', s: 3, c: 'Bb7' }]);
  changeInstrument(b, 'Eb');
  assert.equal(b.items[0].c, 'G7');
});

test('tag on the staff and import', () => {
  assert.match(staffSvg(staff([4], 0, 'Eb'), 360).svg, /class="t trtag"[^>]*>E♭</);
  assert.doesNotMatch(staffSvg(staff([4]), 360).svg, /trtag/);
  assert.equal(sanitizeBlock(staff([4], 0, 'Bb8')).tr, 'Bb8');
  assert.equal(sanitizeBlock(staff([4], 0, 'C')).tr, undefined);
  assert.equal(sanitizeBlock(staff([4], 0, '<script>')).tr, undefined);
});
