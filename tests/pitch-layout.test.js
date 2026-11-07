// Tests des hauteurs, de la mise en page et du rendu SVG.
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

test("layout : barre de fin, plus de zone d'ajout, dernière ligne justifiée au-delà de 50 %", () => {
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

test('keyAcc : armures en dièses et en bémols, toutes octaves, clé de fa décalée', () => {
  // Sol majeur (1♯) : fa dièse, sur toutes les octaves.
  assert.equal(keyAcc('treble', 8, 1), 1); // fa 5
  assert.equal(keyAcc('treble', 1, 1), 1); // fa 4
  assert.equal(keyAcc('treble', 5, 1), 0); // do 5 : pas encore (2♯)
  assert.equal(keyAcc('treble', 5, 2), 1);
  // Si♭ majeur (2♭) : si et mi bémols.
  assert.equal(keyAcc('treble', 4, -2), -1); // si 4
  assert.equal(keyAcc('treble', 7, -2), -1); // mi 5
  assert.equal(keyAcc('treble', 3, -2), 0); // la 4
  // Clé de fa : la 1re ligne est sol 2, fa est juste dessous.
  assert.equal(keyAcc('bass', -1, 1), 1);
  assert.equal(keyAcc('treble', 4, 0), 0);
});

test('resolveMidis : l’armure s’applique, une altération écrite la remplace jusqu’à la barre', () => {
  const b = {
    clef: 'treble',
    time: '4/4',
    ks: 1, // sol majeur
    items: [
      { d: 'q', s: 1 }, // fa 4 → fa♯ (66)
      { d: 'q', s: 1, a: 0 }, // fa♮ (65)
      { d: 'q', s: 1 }, // encore fa♮ (même mesure)
      { d: 'q', s: 8 }, // fa 5 : autre position, armure (78)
      { d: 'q', s: 1 }, // mesure suivante : fa♯ de nouveau
    ],
  };
  assert.deepEqual(resolveMidis(b), [66, 65, 65, 78, 66]);
  assert.equal(pitchName('treble', 1, undefined, 1), 'Fa♯ 4');
  assert.equal(pitchName('treble', 1, 0, 1), 'Fa♮ 4');
});

test('layout : l’armure décale le début de chaque ligne', () => {
  const items = Array.from({ length: 24 }, () => ({ d: 'q', s: 4 }));
  const plain = layout({ clef: 'treble', time: '4/4', items }, 358);
  const three = layout({ clef: 'treble', time: '4/4', ks: -3, items }, 358);
  assert.equal(three.ksw, 3 * 9 + 4);
  assert.equal(three.systems[0].start - plain.systems[0].start, three.ksw);
  assert.equal(three.systems[1].start - plain.systems[1].start, three.ksw);
  assert.equal(layout({ clef: 'rhythm', time: '4/4', ks: 2, items: [] }, 358).ksw, 0);
});

test('layout : le curseur d’insertion ouvre un trou devant la note visée', () => {
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
  assert.ok(L1.insertX > L1.pos[0].x1 - 1 && L1.insertX < L1.pos[1].x0); // dans le trou
  assert.ok(L1.pos[1].x0 - L0.pos[1].x0 >= 30); // la note visée est décalée
  assert.equal(layout(b, 700, true, 3).insertX, null); // à la fin : zone d'ajout habituelle
});

test('staffSvg : l’armure est dessinée sur chaque ligne, le chiffrage décalé', () => {
  const items = Array.from({ length: 24 }, () => ({ d: 'q', s: 4 }));
  const svg = (ks) => staffSvg({ id: 'k', type: 'staff', clef: 'treble', time: '4/4', ks, items }, 358).svg;
  const plain = svg(undefined);
  const flats = svg(-3);
  assert.ok(!flats.includes('NaN'));
  // Un bémol = 2 tracés ; 3 bémols par ligne en plus.
  const paths = (x) => (x.match(/<path/g) || []).length;
  const lines = layout({ clef: 'treble', time: '4/4', ks: -3, items }, 358).systems.length;
  assert.equal(paths(flats) - paths(plain), 3 * 2 * lines);
  assert.ok(flats.includes('x="77"')); // chiffrage : 46 + 3×9 + 4
});
