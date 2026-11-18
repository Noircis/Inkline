// Random chord charts (2.18). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITIES,
  RGRID_DEFAULTS,
  RGRID_MAX,
  generateChords,
  randomGridBlock,
  sanitizeRandomGrid,
} from '../js/random-grid.js';
import { chordTones, chordParts, CHORD_RE } from '../js/chords.js';
import { sanitizeBlock } from '../js/sanitize.js';
import { sanitizeProgram } from '../js/practice.js';

const settings = (patch = {}) => ({ ...RGRID_DEFAULTS, ...patch });
/** Pitch classes of a chord, from its root. */
const classes = (c) => [...new Set(chordTones(c).notes.map((n) => n % 12))].sort((a, b) => a - b);

test('every quality is played and displayed', () => {
  QUALITIES.forEach((q) => {
    assert.ok(chordTones('C' + q), `C${q} played`);
    assert.ok(chordParts('C' + q), `C${q} displayed`);
  });
  assert.equal(new Set(QUALITIES).size, QUALITIES.length);
});

test('chordTones: add9 without seventh, sus2, natural 11', () => {
  assert.deepEqual(classes('Cadd9'), [0, 2, 4, 7]);
  assert.deepEqual(classes('Csus2'), [0, 2, 7]);
  assert.deepEqual(classes('Csus4'), [0, 5, 7]);
  assert.deepEqual(classes('C-11'), [0, 3, 5, 7, 10]);
  assert.deepEqual(classes('C7#11'), [0, 4, 6, 7, 10]); // the sharp 11 stays sharp
});

test('generateChords: same number, same chart; the settings are followed', () => {
  const a = generateChords(settings({ seed: 42, measures: 16 }));
  assert.deepEqual(a, generateChords(settings({ seed: 42, measures: 16 })));
  assert.notDeepEqual(a, generateChords(settings({ seed: 43, measures: 16 })));
  assert.equal(a.length, 16);
  assert.ok(a.every((m) => m.length === 1));
  assert.ok(generateChords(settings({ perBar: 2 })).every((m) => m.length === 2));
  const mixed = generateChords(settings({ perBar: 0, measures: 64, seed: 7 }));
  assert.ok(mixed.some((m) => m.length === 1) && mixed.some((m) => m.length === 2));
  // No inversion, valid chords, spelling as asked.
  const all = (s) => generateChords(settings({ measures: 64, perBar: 2, ...s })).flat();
  all({ acc: 'b' }).forEach((c) => {
    assert.ok(CHORD_RE.test(c) && !c.includes('/'), c);
    assert.ok(!/^[A-G]#/.test(c), c);
  });
  assert.ok(all({ acc: '#' }).every((c) => !/^[A-G]b/.test(c)));
  const both = all({ acc: 'both', seed: 3 });
  assert.ok(both.some((c) => /^[A-G]b/.test(c)) && both.some((c) => /^[A-G]#/.test(c)));
});

test('randomGridBlock: a valid chart ending with a final barline', () => {
  const b = randomGridBlock(settings({ time: '3/4', measures: 5 }), { id: 'x', tempo: 140, swing: false });
  assert.equal(b.measures.length, 5);
  assert.ok(b.measures[4].fin && !b.measures[3].fin);
  assert.equal(b.style, 'Even 8ths');
  assert.deepEqual(sanitizeBlock(b), b);
  assert.equal(randomGridBlock(settings(), { id: 'x', tempo: 140, swing: true }).style, 'Medium Swing');
});

test('sanitizeRandomGrid', () => {
  assert.equal(sanitizeRandomGrid(null), undefined);
  assert.deepEqual(sanitizeRandomGrid({}), RGRID_DEFAULTS);
  assert.deepEqual(sanitizeRandomGrid({ time: '3/4', measures: 64, perBar: 0, acc: '#', seed: 12 }), {
    time: '3/4',
    measures: RGRID_MAX,
    perBar: 0,
    acc: '#',
    seed: 12,
  });
  assert.deepEqual(
    sanitizeRandomGrid({ time: '5/4', measures: 65, perBar: 3, acc: 'x', seed: 0 }),
    RGRID_DEFAULTS,
  );
});

test('a program item can hold a chart', () => {
  const grid = randomGridBlock(settings(), { id: 'g', tempo: 120, swing: true });
  const p = sanitizeProgram({
    id: 'p',
    name: 'Grilles',
    items: [
      { id: 'a', kind: 'exercise', grid, title: 'Grille n° 1 · 8 mesures' },
      { id: 'b', kind: 'exercise', grid: { type: 'text', text: 'x' } },
    ],
  });
  assert.equal(p.items.length, 1);
  assert.deepEqual(p.items[0].grid, grid);
  assert.equal(p.items[0].staff, undefined);
});
