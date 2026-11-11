// Tests for folder categories (2.8.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_CATS,
  NO_CAT,
  MAX_CATS,
  addCategory,
  catsOf,
  inCategory,
  countByCategory,
  groupByCategory,
  deleteCategory,
  moveCategory,
  fileNote,
  deleteFolder,
} from '../js/folders.js';
import { sanitizeFolders, sanitizeNote } from '../js/sanitize.js';
import { noteFileJson } from '../js/storage.js';

const setup = () => {
  const sax = { id: 'sax', name: 'Saxophone', color: 'orange', created: 1 };
  const tec = addCategory(sax, 'Technique');
  const son = addCategory(sax, 'Son');
  const imp = addCategory(sax, 'Impro');
  const note = (id, cats) => ({
    id,
    title: id,
    created: 1,
    updated: 1,
    folder: 'sax',
    ...(cats ? { cats } : {}),
    blocks: [],
  });
  const notes = {
    a: note('a', [tec.id]),
    b: note('b', [tec.id, son.id]),
    c: note('c', [imp.id]),
    d: note('d'),
  };
  return { folders: { sax }, sax, tec, son, imp, notes };
};

test('add: name cleaned, duplicate (case, accents) returned as is, limit', () => {
  const f = { id: 'f', name: 'F', color: 'blue', created: 1 };
  const a = addCategory(f, '  Technique  ');
  assert.equal(a.name, 'Technique');
  assert.equal(addCategory(f, 'TECHNIQUE'), a);
  assert.equal(addCategory(f, '   '), null);
  for (let k = 1; k < MAX_CATS; k++) addCategory(f, 'c' + k);
  assert.equal(f.cats.length, MAX_CATS);
  assert.equal(addCategory(f, 'une de trop'), null);
});

test('several categories: filters, counters, sections', () => {
  const { folders, sax, tec, son, imp, notes } = setup();
  const all = Object.values(notes);
  assert.deepEqual(
    catsOf(notes.b, folders).map((c) => c.name),
    ['Technique', 'Son'],
  );
  assert.deepEqual(
    all.filter((n) => inCategory(n, tec.id, folders)).map((n) => n.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    all.filter((n) => inCategory(n, NO_CAT, folders)).map((n) => n.id),
    ['d'],
  );
  assert.equal(all.filter((n) => inCategory(n, ALL_CATS, folders)).length, 4);
  const counts = countByCategory(all, sax);
  assert.deepEqual(
    [counts[tec.id], counts[son.id], counts[imp.id], counts[NO_CAT], counts[ALL_CATS]],
    [2, 1, 1, 1, 4],
  );
  // Sections in folder order; "b" appears twice.
  assert.deepEqual(
    groupByCategory(all, sax).map((g) => [g.cat ? g.cat.name : '—', g.notes.map((n) => n.id).join('')]),
    [
      ['Technique', 'ab'],
      ['Son', 'b'],
      ['Impro', 'c'],
      ['—', 'd'],
    ],
  );
  moveCategory(sax, imp.id, -1);
  assert.deepEqual(
    groupByCategory(all, sax).map((g) => (g.cat ? g.cat.name : '—')),
    ['Technique', 'Impro', 'Son', '—'],
  );
});

test('deleting a category or a folder: no note deleted', () => {
  const { folders, sax, tec, notes } = setup();
  assert.equal(deleteCategory(sax, tec.id, notes), 2);
  assert.equal(notes.a.cats, undefined); // no category left: field removed
  assert.deepEqual(
    catsOf(notes.b, folders).map((c) => c.name),
    ['Son'],
  );
  assert.equal(Object.keys(notes).length, 4);
  deleteFolder('sax', notes, folders);
  assert.equal(notes.b.folder, undefined);
  assert.equal(notes.b.cats, undefined);
});

test('changing folder clears the categories', () => {
  const { notes, son } = setup();
  fileNote(notes.c, 'sax', [son.id, son.id]);
  assert.deepEqual(notes.c.cats, [son.id]);
  fileNote(notes.c, 'pia');
  assert.equal(notes.c.cats, undefined);
  fileNote(notes.c, null, [son.id]);
  assert.equal(notes.c.folder, undefined);
  assert.equal(notes.c.cats, undefined);
});

test('storage and import: categories validated; sharing: filing removed', () => {
  const f = sanitizeFolders({
    sax: {
      id: 'sax',
      name: 'Sax',
      color: 'red',
      cats: [
        { id: 'a1', name: ' Son ' },
        { id: 'a1', name: 'double' },
        { id: 'BAD!', name: 'x' },
        { id: 'b2', name: '' },
      ],
    },
  });
  assert.deepEqual(f.sax.cats, [{ id: 'a1', name: 'Son' }]);
  const n = sanitizeNote({ id: 'n', title: 't', folder: 'sax', cats: ['a1', 'a1', 'BAD!', 3], blocks: [] });
  assert.deepEqual(n.cats, ['a1']);
  assert.equal(sanitizeNote({ id: 'n', title: 't', cats: ['a1'], blocks: [] }).cats, undefined); // no folder
  assert.equal(
    sanitizeNote({ id: 'n', title: 't', folder: 'sax', cats: ['a1'], blocks: [] }, { freshIds: true }).cats,
    undefined,
  );
  const shared = JSON.parse(noteFileJson({ ...n, blocks: [{ id: 'b', type: 'text', text: '' }] })).note;
  assert.equal(shared.cats, undefined);
  assert.equal(shared.folder, undefined);
});

test('restoring a backup: missing categories added to the existing folder', async () => {
  const { importFile, backupJson } = await import('../js/storage.js');
  const folders = {
    sax: { id: 'sax', name: 'Saxophone', color: 'red', created: 1, cats: [{ id: 'tec', name: 'Technique' }] },
  };
  const backup = backupJson(
    {
      n: {
        id: 'n',
        title: 't',
        created: 1,
        updated: 2,
        folder: 'sax',
        cats: ['imp'],
        blocks: [{ id: 'b', type: 'text', text: '' }],
      },
    },
    {
      sax: {
        id: 'sax',
        name: 'Saxophone',
        color: 'red',
        created: 1,
        cats: [
          { id: 'tec', name: 'Technique' },
          { id: 'imp', name: 'Impro' },
        ],
      },
    },
  );
  const notes = {};
  importFile(notes, backup, folders);
  assert.deepEqual(
    folders.sax.cats.map((c) => c.name),
    ['Technique', 'Impro'],
  );
  assert.deepEqual(
    catsOf(notes.n, folders).map((c) => c.name),
    ['Impro'],
  );
});
