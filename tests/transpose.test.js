// Tests des instruments transpositeurs (2.8.3).
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

test('son réel : une note écrite pour un instrument sonne plus bas', () => {
  // Do 5 écrit : en ut 72 ; au sax alto (mi♭), mi♭ 4 = 63 ; au ténor, si♭ 3 = 58.
  assert.deepEqual(resolveMidis(staff([5])), [72]);
  assert.deepEqual(resolveMidis(staff([5], 0, 'Eb')), [63]);
  assert.deepEqual(resolveMidis(staff([5], 0, 'Bb8')), [58]);
  assert.deepEqual(resolveMidis(staff([5], 0, 'Bb')), [70]);
  assert.equal(instrumentOf('nimporte').key, 'C');
});

test('armure : déplacement dans le cycle des quintes', () => {
  assert.equal(fifthsOf(2), 2); // seconde majeure : +2 dièses
  assert.equal(fifthsOf(9), 3); // sixte majeure
  assert.equal(fifthsOf(14), 2); // neuvième = seconde
  assert.equal(fifthsOf(7), 1); // quinte
  assert.equal(fifthsOf(5), -1); // quarte
  assert.equal(fifthsOf(-9), -3);
});

test('transposer : gamme de do en ut → la majeur au sax alto, même son', () => {
  const b = staff([-2, -1, 0, 1, 2, 3, 4, 5]);
  const before = resolveMidis(b);
  changeInstrument(b, 'Eb');
  assert.equal(b.tr, 'Eb');
  assert.equal(b.ks, 3);
  assert.equal(names(b), 'La 4 Si 4 Do♯ 5 Ré 5 Mi 5 Fa♯ 5 Sol♯ 5 La 5');
  assert.ok(b.items.every((it) => it.a == null)); // l'armure suffit
  assert.deepEqual(resolveMidis(b), before);
});

test('transposer : altérations accidentelles, report dans la mesure, liaisons', () => {
  // Fa majeur : mi♭, mi♭ (reporté), la♯, la♯ (reporté) | si lié à la mesure suivante
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
  assert.equal(b.items[0].a, 0); // fa bécarre en sol majeur
  assert.equal(b.items[1].a, undefined); // reporté dans la mesure
  assert.equal(b.items[4].s, b.items[3].s); // note liée : même position
});

test('armure de plus de 7 altérations : réécrite à l’enharmonique', () => {
  // Fa♯ majeur (6♯) + sixte majeure = ré♯ majeur (9♯) → mi♭ majeur (3♭).
  const b = staff([1, 2, 4, 6], 6);
  const before = resolveMidis(b);
  changeInstrument(b, 'Eb');
  assert.equal(b.ks, -3);
  assert.equal(names(b), 'Mi♭ 5 Fa 5 La♭ 5 Do 6');
  assert.deepEqual(resolveMidis(b), before);
});

test('aller-retour et tous les instruments : le son ne change jamais', () => {
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

test('note qui sortirait de la portée : ramenée d’une octave, et signalée', () => {
  const b = staff([18]);
  const { octaves } = changeInstrument(b, 'Bb8'); // +8 degrés : 26 > 20
  assert.equal(octaves, 1);
  assert.equal(b.items[0].s, 19);
});

test('garder l’écriture : les notes et l’armure ne bougent pas, le son change', () => {
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

test('accords chiffrés transposés avec la bonne orthographe', () => {
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

test('étiquette sur la portée et import', () => {
  assert.match(staffSvg(staff([4], 0, 'Eb'), 360).svg, /class="t trtag"[^>]*>E♭</);
  assert.doesNotMatch(staffSvg(staff([4]), 360).svg, /trtag/);
  assert.equal(sanitizeBlock(staff([4], 0, 'Bb8')).tr, 'Bb8');
  assert.equal(sanitizeBlock(staff([4], 0, 'C')).tr, undefined);
  assert.equal(sanitizeBlock(staff([4], 0, '<script>')).tr, undefined);
});
