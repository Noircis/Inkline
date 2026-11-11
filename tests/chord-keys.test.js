// Tests for the chord keyboard (2.8.5): effect of the keys, iReal-style display.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChordKey, splitChord, MAX_SLOTS } from '../js/chord-keys.js';
import { chordParts, chordTones, chordOk } from '../js/chords.js';
import { toIRealMusic } from '../js/ireal.js';

/** Types a sequence of keys ("C", "b", "q:-7", "/", "␣", "⌫"…). */
const type = (keys, start = []) =>
  keys.reduce((s, k) => {
    if (/^[A-G]$/.test(k)) return applyChordKey(s, { t: 'root', v: k });
    if (k === '♭') return applyChordKey(s, { t: 'acc', v: 'b' });
    if (k === '♯') return applyChordKey(s, { t: 'acc', v: '#' });
    if (k.startsWith('q:')) return applyChordKey(s, { t: 'qual', v: k.slice(2) });
    if (k.startsWith('+:')) return applyChordKey(s, { t: 'add', v: k.slice(2) });
    const t = { '/': 'slash', '␣': 'space', '⌫': 'back', NC: 'nc', '%': 'sim' }[k];
    return applyChordKey(s, { t });
  }, start);

test('root, accidental, quality: two or three taps', () => {
  assert.deepEqual(type(['F', 'q:7']), ['F7']);
  assert.deepEqual(type(['B', '♭', 'q:-7']), ['Bb-7']);
  assert.deepEqual(type(['F', '♯', 'q:h7']), ['F#h7']);
  // Same quality twice: removed; another quality: replaced.
  assert.deepEqual(type(['C', 'q:^7', 'q:^7']), ['C']);
  assert.deepEqual(type(['C', 'q:^7', 'q:-7']), ['C-7']);
  // ♭ twice: removed; then ♯: replaces.
  assert.deepEqual(type(['E', '♭', '♭']), ['E']);
  assert.deepEqual(type(['E', '♭', '♯']), ['E#']);
  // Accidental after the quality: always applies to the root.
  assert.deepEqual(type(['E', 'q:7', '♭']), ['Eb7']);
});

test('bass, detailed pad, two chords per measure', () => {
  assert.deepEqual(type(['A', '♭', 'q:^7', '/', 'C']), ['Ab^7/C']);
  assert.deepEqual(type(['D', 'q:7', '/', 'F', '♯']), ['D7/F#']); // ♯ goes to the bass
  assert.deepEqual(type(['C', 'q:7', '+:#9', '+:b13']), ['C7#9b13']);
  assert.deepEqual(type(['D', 'q:-7', '␣', 'G', 'q:7']), ['D-7', 'G7']);
  assert.deepEqual(type(['C', '␣']), ['C', '']); // next slot pending
  // No more than 4 slots; ␣ on an empty slot does nothing.
  assert.equal(type(['C', '␣', 'D', '␣', 'E', '␣', 'F', '␣', 'G']).length, MAX_SLOTS);
  assert.deepEqual(type(['␣']), []);
});

test('N.C., measure repeat; a letter before the root does nothing else', () => {
  assert.deepEqual(type(['NC']), ['n']);
  assert.deepEqual(type(['NC', 'C']), ['C']);
  assert.deepEqual(type(['C', 'q:7', '%']), ['%']);
  assert.deepEqual(type(['%', 'F']), ['F']); // typing over it
  assert.deepEqual(type(['q:7']), []); // quality without a root: ignored
  assert.deepEqual(type(['/']), []);
});

test('erase: piece by piece, then the slot, then the measure', () => {
  const steps = [];
  let s = type(['B', '♭', 'q:7', '+:#11', '/', 'D', '♭']);
  assert.deepEqual(s, ['Bb7#11/Db']);
  while (s.length) {
    s = applyChordKey(s, { t: 'back' });
    steps.push(s.join(' '));
  }
  assert.deepEqual(steps, ['Bb7#11/D', 'Bb7#11/', 'Bb7#11', 'Bb7', 'Bb', 'B', '']);
  assert.deepEqual(type(['C', '␣', 'D', '⌫', '⌫']), ['C']);
});

test('splitChord', () => {
  assert.deepEqual(splitChord('Bb-7/F'), { root: 'Bb', q: '-7', slash: true, bass: 'F' });
  assert.deepEqual(splitChord('C/'), { root: 'C', q: '', slash: true, bass: '' });
  assert.equal(splitChord('n'), null);
});

test('iReal-style display, however it is typed', () => {
  const q = (c) => chordParts(c).quality;
  for (const c of ['Cm7', 'C-7', 'Cmin7', 'Cmi7']) assert.equal(q(c), '−7');
  for (const c of ['Cmaj7', 'C^7', 'C^', 'CΔ', 'CM7']) assert.equal(q(c), 'Δ7');
  assert.equal(q('C^9'), 'Δ9');
  for (const c of ['CmMaj7', 'C-^7']) assert.equal(q(c), '−Δ7');
  for (const c of ['Cm7b5', 'C-7b5', 'Ch7', 'Ch', 'Cø']) assert.equal(q(c), 'ø7');
  for (const c of ['Cdim7', 'Co7', 'C°7']) assert.equal(q(c), '°7');
  assert.equal(q('C7b9'), '7♭9');
  assert.equal(chordParts('Bb-7/F').root, 'B♭');
});

test('keyboard chords play and export like the others', () => {
  const same = (a, b) => assert.deepEqual(chordTones(a), chordTones(b), `${a} = ${b}`);
  same('C-7', 'Cm7');
  same('C^7', 'Cmaj7');
  same('Ch7', 'Cm7b5');
  same('Co7', 'Cdim7');
  same('C-^7', 'CmMaj7');
  same('C-6', 'Cm6');
  for (const c of ['C-7', 'C^7', 'Ch7', 'Co7', 'C7alt', 'C7sus4', 'C^9', 'C-9', 'C7#9', 'C+', 'Ab^7/C'])
    assert.ok(chordOk(c), c);
  const b = {
    type: 'grid',
    time: '4/4',
    measures: [{ ch: ['C-7', 'F7'] }, { ch: ['Bb^7'] }, { ch: ['Eh7'] }],
  };
  assert.match(toIRealMusic(b), /C-7 F7/);
  assert.match(toIRealMusic(b), /Bb\^7/);
  assert.match(toIRealMusic(b), /Eh7/);
});
