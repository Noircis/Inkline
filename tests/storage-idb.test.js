// Tests for IndexedDB storage (2.1): migration, targeted writes, localStorage fallback.
//
/* global localStorage */
// Node has neither IndexedDB nor localStorage: we use fake-indexeddb (a
// complete in-memory implementation) and a small localStorage imitation.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/** Minimal imitation of localStorage (a dictionary of strings). */
class MemoryStorage {
  constructor() {
    this.m = new Map();
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}

let fresh = 0;
/**
 * Loads a FRESH instance of the storage module: its internal state
 * (connection, last written versions) starts from scratch, as when the app
 * launches. A different URL (?n=…) = a different module for Node.
 */
const freshStorage = () => import(`../js/storage.js?n=${++fresh}`);

const note = (id, title, extra = {}) => ({
  id,
  title,
  created: 1000,
  updated: 1000,
  blocks: [{ id: 'b' + id, type: 'text', text: '' }],
  ...extra,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // empty database for each test
  globalThis.localStorage = new MemoryStorage();
});

test('migration: the localStorage notebook is copied into IndexedDB, the original is kept', async () => {
  const old = { a: note('a', 'Blues', { folder: 'f1' }), b: note('b', 'Samba') };
  localStorage.setItem('carnet-portees-v1', JSON.stringify(old));
  localStorage.setItem(
    'inkline-folders',
    JSON.stringify({ f1: { id: 'f1', name: 'Jazz', color: 'red', created: 1 } }),
  );

  const s1 = await freshStorage();
  const r1 = await s1.loadAll();
  assert.equal(r1.backend, 'idb');
  assert.equal(r1.migrated, true);
  assert.deepEqual(Object.keys(r1.notes).sort(), ['a', 'b']);
  assert.equal(r1.folders.f1.name, 'Jazz');
  assert.equal(s1.getMeta().storage, 'idb');
  assert.ok(localStorage.getItem('carnet-portees-v1')); // safety net intact

  // Next launch: no new migration, same data.
  const r2 = await (await freshStorage()).loadAll();
  assert.equal(r2.migrated, false);
  assert.equal(r2.notes.a.title, 'Blues');
  assert.equal(r2.notes.a.folder, 'f1');
});

test('migration: an already filled database is never overwritten by the old copy', async () => {
  const s1 = await freshStorage();
  await s1.loadAll();
  const notes = { recent: note('recent', 'Version récente') };
  await s1.flushSave(notes);

  // Lost metadata + old copy in localStorage.
  localStorage.removeItem('inkline-meta');
  localStorage.setItem('carnet-portees-v1', JSON.stringify({ old: note('old', 'Vieille') }));
  const r = await (await freshStorage()).loadAll();
  assert.equal(r.migrated, false);
  assert.deepEqual(Object.keys(r.notes), ['recent']);
});

test('scheduleSave: only the reported note is written', async () => {
  const s = await freshStorage();
  await s.loadAll();
  const notes = { a: note('a', 'A'), b: note('b', 'B') };
  await s.flushSave(notes);

  notes.a.title = 'A modifiée';
  notes.b.title = 'B modifiée'; // changed in memory but not reported
  s.scheduleSave(notes, 'a');
  await wait(250); // 150 ms debounce + write

  const r = await (await freshStorage()).loadAll();
  assert.equal(r.notes.a.title, 'A modifiée');
  assert.equal(r.notes.b.title, 'B'); // proof that the write is targeted
});

test('flushSave: compares everything, deletions included', async () => {
  const s = await freshStorage();
  await s.loadAll();
  const notes = { a: note('a', 'A'), b: note('b', 'B'), c: note('c', 'C') };
  await s.flushSave(notes);

  delete notes.b;
  notes.c.pinned = true;
  notes.d = note('d', 'D');
  await s.flushSave(notes);

  const r = await (await freshStorage()).loadAll();
  assert.deepEqual(Object.keys(r.notes).sort(), ['a', 'c', 'd']);
  assert.equal(r.notes.c.pinned, true);
});

test('folders: saved in IndexedDB, deletion included', async () => {
  const s = await freshStorage();
  await s.loadAll();
  const folders = {
    f1: { id: 'f1', name: 'Jazz', color: 'red', created: 1 },
    f2: { id: 'f2', name: 'Cours', color: 'blue', created: 2 },
  };
  await s.saveFolders(folders);
  delete folders.f1;
  await s.saveFolders(folders);
  const r = await (await freshStorage()).loadAll();
  assert.deepEqual(Object.keys(r.folders), ['f2']);
});

test('fallback: without IndexedDB, the notebook stays in localStorage', async () => {
  delete globalThis.indexedDB;
  localStorage.setItem('carnet-portees-v1', JSON.stringify({ a: note('a', 'A') }));
  const s = await freshStorage();
  const r = await s.loadAll();
  assert.equal(r.backend, 'local');
  assert.equal(r.notes.a.title, 'A');
  r.notes.a.title = 'A2';
  await s.flushSave(r.notes);
  assert.equal(JSON.parse(localStorage.getItem('carnet-portees-v1')).a.title, 'A2');
});

test('practice settings: old format (2.3) carried over, invalid values fixed', async () => {
  localStorage.setItem(
    'inkline-meta',
    JSON.stringify({
      drill: { notes: 3, tempo: 100, beats: [false, true, false, true], swing: true },
      gen: { meter: '7/8:2+3+2', measures: 8, min: 9, max: 2, starts: { '6/8': [5, 1, 1, 9] }, seed: 12 },
    }),
  );
  const s = await freshStorage();
  const m = s.getMeta();
  assert.deepEqual(m.drill.beats, { '4/4': [false, true, false, true] });
  assert.equal(m.drill.meter, '4/4');
  assert.equal(m.drill.notes, 3);
  assert.equal(m.drill.loop, false);
  assert.equal(m.gen.meter, '7/8:2+3+2');
  assert.equal(m.gen.measures, 4); // 8 is no longer offered (2.8.1)
  assert.equal(m.gen.min, 2); // 9 > 7 eighths: default value
  assert.equal(m.gen.max, 2);
  assert.deepEqual(m.gen.starts, {}); // 9 outside 6/8: list rejected
  assert.equal(m.gen.seed, 12);
});
