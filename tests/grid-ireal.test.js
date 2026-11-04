// Tests des grilles d'accords et du format iReal Pro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordTones, chordOk } from '../js/chords.js';
import { gridTokens, slotDurations, gridPlayOrder } from '../js/grid.js';
import { scramble, chordToIReal, qualityFromIReal, toIRealLink, toIRealMusic, parseIRealAll } from '../js/ireal.js';
import { CHORD_RE } from '../js/chords.js';

const blues = {
  id: 'g', type: 'grid', time: '4/4', key: 'F', style: 'Medium Swing', tempo: 160,
  measures: [
    { ch: ['F7'], sec: 'A', rs: true }, { ch: ['Bb7'] }, { ch: ['F7'] }, { ch: ['Cm7', 'F7'] },
    { ch: ['Bbmaj7'] }, { ch: ['Bdim7'] }, { ch: ['Am7b5', 'D7alt'], ending: 1 }, { ch: ['Gm7', 'C7'], re: true },
    { ch: ['F6'], ending: 2, sec: 'B' }, { ch: ['%'] }, { ch: ['Ebm7', 'Ab7', 'Dbmaj7', 'n'] }, { ch: ['C7sus', '', 'C7b9/E'], fin: true },
  ],
};

test('gridTokens : saisie rapide', () => {
  assert.deepEqual(gridTokens('cm7 / f7 NC'), ['Cm7', '', 'F7', 'n']);
  assert.ok(chordOk('Bb13#11') && !chordOk('H7'));
});

test('slotDurations : répartition à la iReal', () => {
  assert.deepEqual(slotDurations(3, '4/4'), [2, 1, 1]);
  assert.deepEqual(slotDurations(2, '3/4'), [2, 1]);
  assert.deepEqual(slotDurations(2, '6/8'), [1.5, 1.5]);
});

test('gridPlayOrder : reprise avec 1re et 2e fins', () => {
  assert.deepEqual(gridPlayOrder(blues.measures), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 8, 9, 10, 11]);
});

test('chordTones : D7alt et Cm7b5', () => {
  assert.deepEqual(chordTones('D7alt').notes, [54, 60, 63, 65]);
  assert.deepEqual(chordTones('Cm7b5').notes, [63, 58, 54]);
});

test('scramble est une involution', () => {
  const s = 'abcdefghijklmnopqrstuvwxyz'.repeat(9);
  assert.equal(scramble(scramble(s)), s);
});

test('qualités : texte → iReal → texte', () => {
  const back = (c) => { const m = CHORD_RE.exec(chordToIReal(c)); return m[1] + m[2] + qualityFromIReal(m[3]) + (m[4] ? '/' + m[4] : ''); };
  assert.equal(chordToIReal('Cmaj7'), 'C^7');
  assert.equal(chordToIReal('Cø'), 'Ch7');
  assert.equal(back('C-7'), 'Cm7');
  assert.equal(back('CmMaj7'), 'CmMaj7');
  assert.equal(back('Ab7b9/G'), 'Ab7b9/G');
});

test('iReal : aller-retour export → import sans perte', () => {
  const link = toIRealLink('Test Blues', blues);
  assert.match(link, /^irealb:\/\/Test%20Blues=/);
  const [song] = parseIRealAll(link);
  assert.equal(song.title, 'Test Blues');
  assert.equal(song.key, 'F');
  assert.equal(song.tempo, 160);
  assert.equal(song.measures.length, 12);
  song.measures.forEach((m, i) => assert.deepEqual(m.ch, blues.measures[i].ch, `mesure ${i + 1}`));
  assert.equal(song.measures[0].rs, true);
  assert.equal(song.measures[6].ending, 1);
  assert.equal(song.measures[7].re, true);
  assert.equal(song.measures[11].fin, true);
});

test('iReal : playlist et fichier HTML', () => {
  const link = toIRealLink('A', blues);
  const html = `<a href="${link}===${link.slice(9)}===Ma playlist">x</a>`;
  assert.equal(parseIRealAll(html).length, 2);
  assert.match(toIRealMusic(blues), /^T44\*A\{F7/);
});
