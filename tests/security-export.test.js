// Tests for validation of imported data and for the PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNote, sanitizeNotes, sanitizeBlock } from '../js/sanitize.js';
import { importFile, noteFileJson } from '../js/storage.js';
import { buildPdf } from '../js/pdf.js';
import { paginate, parseFontFaces } from '../js/export.js';
import { readFileSync } from 'node:fs';
import { gridHtml } from '../js/grid.js';
import { staffSvg } from '../js/render-staff.js';

const EVIL = '"><img src=x onerror=alert(1)>';

/** Booby-trapped note: each field attempts an injection. */
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

test('sanitizeNote: a trapped file is neutralized', () => {
  const n = sanitizeNote(evilNote);
  assert.match(n.id, /^[a-z0-9]+$/);
  const [st, gr] = n.blocks;
  assert.equal(n.blocks.length, 2); // the unknown type is removed
  assert.match(st.id, /^[a-z0-9]+$/);
  assert.equal(st.clef, 'treble');
  assert.equal(st.time, '4/4');
  assert.equal(st.tempo, 300);
  assert.equal(st.swing, false);
  assert.equal(st.items.length, 1); // the invalid duration is removed
  assert.deepEqual(Object.keys(st.items[0]).sort(), ['c', 'd', 's']);
  assert.equal(st.items[0].s, 4);
  assert.equal(gr.key, 'C');
  assert.equal(gr.measures[0].sec, undefined);
  assert.equal(gr.measures[0].ending, undefined);
  assert.deepEqual(gr.measures[0].ch.length, 2); // 42 is not a string
});

test('rendering: no injected tag survives (defense in depth)', () => {
  const n = sanitizeNote(evilNote);
  const html = gridHtml(n.blocks[1], null, null);
  const svg = staffSvg(n.blocks[0], 360).svg;
  assert.ok(!/<img/i.test(html) && !/<img/i.test(svg));
});

test('importFile: a received note is added with new ids, without overwriting', () => {
  const notes = sanitizeNotes({
    a: { id: 'note1', title: 'Moi', updated: 5, blocks: [{ id: 'b1', type: 'text', text: 'x' }] },
  });
  const shared = JSON.parse(noteFileJson(notes.note1));
  const r = importFile(notes, JSON.stringify(shared));
  assert.equal(r.kind, 'note');
  assert.notEqual(r.firstId, 'note1');
  assert.equal(Object.keys(notes).length, 2);
});

test('importFile: backup merged by date, foreign file refused', () => {
  const notes = {};
  const backup = { app: 'carnet-portees', notes: { x: { id: 'n1', title: 'A', updated: 10, blocks: [] } } };
  assert.equal(importFile(notes, JSON.stringify(backup)).count, 1);
  assert.equal(importFile(notes, JSON.stringify(backup)).count, 1); // same date: rewritten, no duplicate
  assert.equal(Object.keys(notes).length, 1);
  assert.throws(() => importFile(notes, '{"hello": 1}'));
  assert.throws(() => importFile(notes, 'pas du json'));
});

test('buildPdf: consistent structure and xref table', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG (start/end)
  const pdf = buildPdf([
    { jpeg, width: 10, height: 20 },
    { jpeg, width: 10, height: 5 },
  ]);
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Count 2/);
  // Each entry of the xref table must point exactly at "N 0 obj".
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.slice(xrefAt).startsWith('xref'));
  const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(entries.length, 8); // catalog + pages + 3 objects × 2 pages
  entries.forEach((off, k) => assert.ok(text.slice(off).startsWith(`${k + 1} 0 obj`), `objet ${k + 1}`));
});

test('paginate: cuts between two blocks when possible, otherwise mid-page', () => {
  assert.deepEqual(paginate([100, 400, 700, 900], 500), [400, 900]);
  assert.deepEqual(paginate([100, 1200], 500), [500, 1000, 1200]); // block taller than a page
  assert.deepEqual(paginate([300], 500), [300]);
});

test('parseFontFaces: the real fonts.css gives its 7 fonts (image export)', () => {
  const faces = parseFontFaces(readFileSync(new URL('../css/fonts.css', import.meta.url), 'utf8'));
  assert.equal(faces.length, 7);
  faces.forEach((f) => {
    assert.match(f.url, /^\.\.\/fonts\/.+\.woff2$/);
    assert.ok(!/unicode-range/.test(f.rule));
  });
  // Alternative syntaxes: compact, quotes, spaces.
  assert.equal(
    parseFontFaces('@font-face{src:url(\'a.woff2\')}@font-face {\n src: url( "b.woff2" ) }').length,
    2,
  );
});

test('sanitize: integer key signature from -7 to 7, ignored on a rhythm line', () => {
  const blk = (extra) => sanitizeBlock({ type: 'staff', clef: 'treble', time: '4/4', items: [], ...extra });
  assert.equal(blk({ ks: 3 }).ks, 3);
  assert.equal(blk({ ks: -7 }).ks, -7);
  assert.ok(!('ks' in blk({ ks: 8 })));
  assert.ok(!('ks' in blk({ ks: 1.5 })));
  assert.ok(!('ks' in blk({ ks: '2' })));
  assert.ok(!('ks' in blk({ ks: 0 })));
  assert.ok(!('ks' in blk({ ks: 2, clef: 'rhythm' })));
});

test('note metronome (2.15): validated, display options dropped, kept on a received note', () => {
  const raw = {
    id: 'a1',
    title: 'x',
    blocks: [],
    metro: { tempo: 9999, num: 7, den: 8, flash: true, x: '<b>' },
  };
  const n = sanitizeNote(raw);
  assert.equal(n.metro.tempo, 400);
  assert.equal(n.metro.num, 7);
  assert.equal('flash' in n.metro, false);
  assert.equal('x' in n.metro, false);
  assert.equal(sanitizeNote(raw, { freshIds: true }).metro.num, 7);
  assert.equal('metro' in sanitizeNote({ id: 'a2', blocks: [], metro: 'fast' }), false);
});
