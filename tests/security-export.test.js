// Tests de la validation des données importées et du PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNote, sanitizeNotes } from '../js/sanitize.js';
import { importFile, noteFileJson } from '../js/storage.js';
import { buildPdf } from '../js/pdf.js';
import { paginate, parseFontFaces } from '../js/export.js';
import { readFileSync } from 'node:fs';
import { gridHtml } from '../js/grid.js';
import { staffSvg } from '../js/render-staff.js';

const EVIL = '"><img src=x onerror=alert(1)>';

/** Note piégée : chaque champ tente une injection. */
const evilNote = {
  id: EVIL,
  title: 'ok',
  updated: 1,
  blocks: [
    {
      id: EVIL,
      type: 'staff',
      clef: EVIL,
      time: EVIL,
      tempo: 9999,
      swing: 'yes',
      items: [{ d: EVIL }, { d: 'q', s: EVIL, a: 7, c: 'C7' + EVIL, bar: EVIL, tie: 'oui' }],
    },
    {
      id: 'abc',
      type: 'grid',
      key: EVIL,
      style: 'x',
      time: '4/4',
      tempo: 120,
      measures: [{ ch: ['C7', 42, EVIL], sec: EVIL, ending: EVIL }],
    },
    { id: 'zz', type: 'script', src: EVIL },
  ],
};

test('sanitizeNote : un fichier piégé est neutralisé', () => {
  const n = sanitizeNote(evilNote);
  assert.match(n.id, /^[a-z0-9]+$/);
  const [st, gr] = n.blocks;
  assert.equal(n.blocks.length, 2); // le type inconnu est supprimé
  assert.match(st.id, /^[a-z0-9]+$/);
  assert.equal(st.clef, 'treble');
  assert.equal(st.time, '4/4');
  assert.equal(st.tempo, 300);
  assert.equal(st.swing, false);
  assert.equal(st.items.length, 1); // la durée invalide est retirée
  assert.deepEqual(Object.keys(st.items[0]).sort(), ['c', 'd', 's']);
  assert.equal(st.items[0].s, 4);
  assert.equal(gr.key, 'C');
  assert.equal(gr.measures[0].sec, undefined);
  assert.equal(gr.measures[0].ending, undefined);
  assert.deepEqual(gr.measures[0].ch.length, 2); // 42 n'est pas une chaîne
});

test('rendu : aucune balise injectée ne survit (défense en profondeur)', () => {
  const n = sanitizeNote(evilNote);
  const html = gridHtml(n.blocks[1], null, null);
  const svg = staffSvg(n.blocks[0], 360).svg;
  assert.ok(!/<img/i.test(html) && !/<img/i.test(svg));
});

test('importFile : une note reçue est ajoutée avec de nouveaux ids, sans écraser', () => {
  const notes = sanitizeNotes({
    a: { id: 'note1', title: 'Moi', updated: 5, blocks: [{ id: 'b1', type: 'text', text: 'x' }] },
  });
  const shared = JSON.parse(noteFileJson(notes.note1));
  const r = importFile(notes, JSON.stringify(shared));
  assert.equal(r.kind, 'note');
  assert.notEqual(r.firstId, 'note1');
  assert.equal(Object.keys(notes).length, 2);
});

test('importFile : sauvegarde fusionnée par date, fichier étranger refusé', () => {
  const notes = {};
  const backup = { app: 'carnet-portees', notes: { x: { id: 'n1', title: 'A', updated: 10, blocks: [] } } };
  assert.equal(importFile(notes, JSON.stringify(backup)).count, 1);
  assert.equal(importFile(notes, JSON.stringify(backup)).count, 1); // même date : réécrit, sans doublon
  assert.equal(Object.keys(notes).length, 1);
  assert.throws(() => importFile(notes, '{"hello": 1}'));
  assert.throws(() => importFile(notes, 'pas du json'));
});

test('buildPdf : structure et table xref cohérentes', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // JPEG minimal (début/fin)
  const pdf = buildPdf([
    { jpeg, width: 10, height: 20 },
    { jpeg, width: 10, height: 5 },
  ]);
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Count 2/);
  // Chaque entrée de la table xref doit pointer exactement sur « N 0 obj ».
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xrefAt).startsWith('xref'));
  const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(entries.length, 8); // catalogue + pages + 3 objets × 2 pages
  entries.forEach((off, k) => assert.ok(text.slice(off).startsWith(`${k + 1} 0 obj`), `objet ${k + 1}`));
});

test('paginate : coupe entre deux blocs quand possible, sinon en pleine page', () => {
  assert.deepEqual(paginate([100, 400, 700, 900], 500), [400, 900]);
  assert.deepEqual(paginate([100, 1200], 500), [500, 1000, 1200]); // bloc plus haut qu'une page
  assert.deepEqual(paginate([300], 500), [300]);
});

test('parseFontFaces : le vrai fonts.css donne ses 7 polices (export des images)', () => {
  const faces = parseFontFaces(readFileSync(new URL('../css/fonts.css', import.meta.url), 'utf8'));
  assert.equal(faces.length, 7);
  faces.forEach((f) => {
    assert.match(f.url, /^\.\.\/fonts\/.+\.woff2$/);
    assert.ok(!/unicode-range/.test(f.rule));
  });
  // Syntaxes alternatives : compacte, guillemets, espaces.
  assert.equal(
    parseFontFaces('@font-face{src:url(\'a.woff2\')}@font-face {\n src: url( "b.woff2" ) }').length,
    2,
  );
});
