// Tests des hauteurs, de la mise en page et du rendu SVG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiOf, resolveMidis, pitchName } from '../js/pitch.js';
import { layout } from '../js/layout.js';
import { staffSvg } from '../js/render-staff.js';

const staff = (items, extra = {}) => ({ id: 't', type: 'staff', clef: 'treble', time: '4/4', tempo: 120, swing: false, items, ...extra });
const q = (s, extra = {}) => ({ d: 'q', s, ...extra });

test('midiOf : repères des clés', () => {
  assert.equal(midiOf('treble', 0, 0), 64); // mi 4 sur la 1re ligne
  assert.equal(midiOf('treble', -2, 0), 60); // do 4
  assert.equal(midiOf('bass', 0, 0), 43); // sol 2
  assert.equal(pitchName('treble', 4, -1), 'Si♭ 4');
});

test("resolveMidis : l'altération vaut jusqu'à la barre", () => {
  const m = resolveMidis(staff([q(4, { a: -1 }), q(4), q(0), q(0), q(4)]));
  assert.deepEqual(m, [70, 70, 64, 64, 71]); // la 5e note est dans la mesure suivante : si bécarre
});

test('resolveMidis : une note liée garde la hauteur par-dessus la barre', () => {
  const m = resolveMidis(staff([q(0), q(0), q(0), q(4, { a: -1, tie: true }), q(4)]));
  assert.equal(m[4], 70);
});

test('layout : barre de fin, plus de zone d\'ajout, dernière ligne justifiée au-delà de 50 %', () => {
  const items = Array.from({ length: 16 }, (_, i) => q(i % 8));
  items[15].bar = 'final';
  const L = layout(staff(items), 360, true);
  assert.equal(L.appendX, null);
  assert.equal(L.ended, true);
  const last = L.systems[L.systems.length - 1];
  assert.ok(Math.abs(last.end - (360 - 4)) < 1); // étirée jusqu'au bord
});

test('layout : sans barre de fin, la dernière ligne garde sa largeur naturelle', () => {
  const L = layout(staff([q(0), q(2)]), 360, true);
  assert.ok(L.appendX > 0 && L.appendX < 200);
});

test('render-staff : liaison et triolet dessinés', () => {
  const t = (s) => ({ d: '8', s, tup: 3 });
  const { svg } = staffSvg(staff([q(2, { tie: true }), q(2), t(4), t(5), t(6)]), 360);
  assert.match(svg, /<path class="f" d="M[\d.]+ [\d.]+ Q/); // croissant de liaison
  assert.match(svg, /class="tup"[^>]*>3</);
});
