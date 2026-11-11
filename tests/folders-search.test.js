// Tests for 2.0: folders, search, sort, v2 backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL,
  UNFILED,
  newFolder,
  cleanFolderName,
  sortedFolders,
  inSelection,
  countByFolder,
  deleteFolder,
} from '../js/folders.js';
import { normalize, matchNote, sortNotes } from '../js/search.js';
import { sanitizeNote, sanitizeFolders } from '../js/sanitize.js';
import { backupJson, importFile, noteFileJson } from '../js/storage.js';

const note = (id, extra = {}) => ({
  id,
  title: '',
  created: 1000,
  updated: 1000,
  blocks: [{ id: 'b' + id, type: 'text', text: '' }],
  ...extra,
});

test('cleanFolderName: spaces reduced, length bounded', () => {
  assert.equal(cleanFolderName('  Cours   de  piano '), 'Cours de piano');
  assert.equal(cleanFolderName('x'.repeat(100)).length, 40);
  assert.equal(cleanFolderName('   '), '');
  assert.equal(newFolder('  ').name, 'Dossier');
  assert.equal(newFolder('A', 'fuchsia').color, 'blue'); // color outside the palette refused
});

test('sortedFolders: French alphabetical order, ignoring accents', () => {
  const f = {
    a: { id: 'a', name: 'Écoute' },
    b: { id: 'b', name: 'arrangements' },
    c: { id: 'c', name: 'Zz' },
  };
  assert.deepEqual(
    sortedFolders(f).map((x) => x.id),
    ['b', 'a', 'c'],
  );
});

test('selection and counters: a vanished folder counts as "unfiled"', () => {
  const folders = { f1: { id: 'f1', name: 'Jazz', color: 'red', created: 1 } };
  const notes = [note('a', { folder: 'f1' }), note('b'), note('c', { folder: 'ghost' })];
  assert.deepEqual(countByFolder(notes, folders), { all: 3, none: 2, f1: 1 });
  assert.ok(inSelection(notes[0], 'f1', folders));
  assert.ok(!inSelection(notes[1], 'f1', folders));
  assert.ok(inSelection(notes[2], UNFILED, folders));
  assert.ok(notes.every((n) => inSelection(n, ALL, folders)));
});

test('deleteFolder: notes become unfiled again, no note deleted', () => {
  const folders = { f1: { id: 'f1', name: 'Jazz', color: 'red', created: 1 } };
  const notes = { a: note('a', { folder: 'f1' }), b: note('b', { folder: 'f1' }), c: note('c') };
  assert.equal(deleteFolder('f1', notes, folders), 2);
  assert.deepEqual(Object.keys(folders), []);
  assert.equal(Object.keys(notes).length, 3);
  assert.ok(Object.values(notes).every((n) => !('folder' in n)));
});

test('normalize: case, accents, ♭ and ♯', () => {
  assert.equal(normalize('Réponse B♭7 F♯m'), 'reponse bb7 f#m');
});

test('matchNote: title, text, chart and staff chords; every word required', () => {
  const n = {
    title: 'Blues en F',
    blocks: [
      { type: 'text', text: 'Idée de réponse' },
      { type: 'grid', measures: [{ ch: ['F7', 'Bb7'] }, { ch: ['C-7'] }] },
      { type: 'staff', items: [{ d: 'q', c: 'E♭maj7' }] },
    ],
  };
  assert.ok(matchNote(n, ''));
  assert.ok(matchNote(n, 'blues f'));
  assert.ok(matchNote(n, 'REPONSE'));
  assert.ok(matchNote(n, 'B♭7'));
  assert.ok(matchNote(n, 'c-7'));
  assert.ok(matchNote(n, 'ebmaj7'));
  assert.ok(!matchNote(n, 'blues ballad'));
});

test('sortNotes: pinned first, then by mode', () => {
  const a = note('a', { title: 'beta', created: 3, updated: 10 });
  const b = note('b', { title: 'Alpha', created: 2, updated: 30 });
  const c = note('c', { title: '', created: 1, updated: 20, pinned: true });
  const d = note('d', { title: 'élan', created: 4, updated: 5 });
  const ids = (m) => sortNotes([a, b, c, d], m).map((x) => x.id);
  assert.deepEqual(ids('updated'), ['c', 'b', 'a', 'd']);
  assert.deepEqual(ids('created'), ['c', 'd', 'a', 'b']);
  assert.deepEqual(ids('title'), ['c', 'b', 'a', 'd']); // "élan" after "beta", untitled only after the pinned ones
  assert.deepEqual(ids('inconnu'), ids('updated'));
});

test('sanitize: folder and pin kept, but not on a received note', () => {
  const raw = { ...note('a'), folder: 'f1', pinned: true };
  const kept = sanitizeNote(raw);
  assert.equal(kept.folder, 'f1');
  assert.equal(kept.pinned, true);
  const fresh = sanitizeNote(raw, { freshIds: true });
  assert.ok(!('folder' in fresh) && !('pinned' in fresh));
  assert.ok(!('folder' in sanitizeNote({ ...raw, folder: '"><img>' })));
  assert.ok(!('pinned' in sanitizeNote({ ...raw, pinned: 'yes' })));
});

test('sanitizeFolders: name required, color validated, id regenerated, trapped content neutralized', () => {
  const out = sanitizeFolders({
    x: { id: 'f1', name: '  Jazz ', color: 'red', created: 5 },
    y: { id: 'f2', name: '   ' },
    z: { id: '"><script>', name: '<b>Cours</b>', color: 'javascript:' },
  });
  const list = Object.values(out);
  assert.equal(list.length, 2);
  assert.deepEqual(out.f1, { id: 'f1', name: 'Jazz', color: 'red', created: 5 });
  const z = list.find((f) => f.id !== 'f1');
  assert.match(z.id, /^[a-z0-9]+$/);
  assert.equal(z.color, 'blue');
  assert.equal(z.name, '<b>Cours</b>'); // stored as is, escaped on display
});

test('v2 backup: notes + folders round trip', () => {
  const folders = { f1: { id: 'f1', name: 'Jazz', color: 'teal', created: 7 } };
  const notes = { a: note('a', { folder: 'f1', pinned: true, updated: 50 }) };
  const json = backupJson(notes, folders);
  assert.equal(JSON.parse(json).version, 2);

  const n2 = {};
  const f2 = {};
  const r = importFile(n2, json, f2);
  assert.equal(r.kind, 'backup');
  assert.deepEqual(f2, folders);
  assert.equal(n2.a.folder, 'f1');
  assert.equal(n2.a.pinned, true);

  // An existing folder (same id) is not overwritten by the backup.
  const f3 = { f1: { id: 'f1', name: 'Renommé', color: 'red', created: 7 } };
  importFile({}, json, f3);
  assert.equal(f3.f1.name, 'Renommé');
});

test('v1 backup (before 2.0): still importable', () => {
  const v1 = JSON.stringify({ app: 'carnet-portees', version: 1, exported: 1, notes: { a: note('a') } });
  const notes = {};
  const folders = {};
  const r = importFile(notes, v1, folders);
  assert.equal(r.count, 1);
  assert.deepEqual(folders, {});
  assert.ok(!('folder' in notes.a));
});

test('shared note: the .inkline file holds neither folder nor pin', () => {
  const n = note('a', { folder: 'f1', pinned: true, title: 'Perso' });
  const file = JSON.parse(noteFileJson(n));
  assert.ok(!('folder' in file.note) && !('pinned' in file.note));
  assert.equal(file.note.title, 'Perso');
  assert.equal(n.folder, 'f1'); // the original note is not modified
  const notes = {};
  const r = importFile(notes, JSON.stringify(file), {});
  assert.ok(!('folder' in notes[r.firstId]));
});
