// Tests du stockage IndexedDB (2.1) : migration, écritures ciblées, repli sur localStorage.
//
/* global localStorage */
// Node n'a ni IndexedDB ni localStorage : on utilise fake-indexeddb (une
// implémentation complète, en mémoire) et une petite imitation de localStorage.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/** Imitation minimale de localStorage (un dictionnaire de chaînes). */
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
 * Charge une instance NEUVE du module storage : son état interne (connexion,
 * dernières versions écrites) repart de zéro, comme au lancement de l'app.
 * Une URL différente (?n=…) = un module différent pour Node.
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
  globalThis.indexedDB = new IDBFactory(); // base vide à chaque test
  globalThis.localStorage = new MemoryStorage();
});

test('migration : le carnet de localStorage est copié dans IndexedDB, l’original est conservé', async () => {
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
  assert.ok(localStorage.getItem('carnet-portees-v1')); // filet de sécurité intact

  // Lancement suivant : pas de nouvelle migration, mêmes données.
  const r2 = await (await freshStorage()).loadAll();
  assert.equal(r2.migrated, false);
  assert.equal(r2.notes.a.title, 'Blues');
  assert.equal(r2.notes.a.folder, 'f1');
});

test('migration : une base déjà remplie n’est jamais écrasée par l’ancienne copie', async () => {
  const s1 = await freshStorage();
  await s1.loadAll();
  const notes = { recent: note('recent', 'Version récente') };
  await s1.flushSave(notes);

  // Métadonnées perdues + vieille copie dans localStorage.
  localStorage.removeItem('inkline-meta');
  localStorage.setItem('carnet-portees-v1', JSON.stringify({ old: note('old', 'Vieille') }));
  const r = await (await freshStorage()).loadAll();
  assert.equal(r.migrated, false);
  assert.deepEqual(Object.keys(r.notes), ['recent']);
});

test('scheduleSave : seule la note signalée est écrite', async () => {
  const s = await freshStorage();
  await s.loadAll();
  const notes = { a: note('a', 'A'), b: note('b', 'B') };
  await s.flushSave(notes);

  notes.a.title = 'A modifiée';
  notes.b.title = 'B modifiée'; // modifiée en mémoire mais pas signalée
  s.scheduleSave(notes, 'a');
  await wait(250); // debounce de 150 ms + écriture

  const r = await (await freshStorage()).loadAll();
  assert.equal(r.notes.a.title, 'A modifiée');
  assert.equal(r.notes.b.title, 'B'); // preuve que l'écriture est ciblée
});

test('flushSave : compare tout, y compris les suppressions', async () => {
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

test('dossiers : enregistrés dans IndexedDB, suppression comprise', async () => {
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

test('repli : sans IndexedDB, le carnet reste dans localStorage', async () => {
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

test('réglages de l’entraînement : ancien format (2.3) repris, valeurs invalides corrigées', async () => {
  localStorage.setItem(
    'inkline-meta',
    JSON.stringify({
      drill: { notes: 3, tempo: 100, beats: [false, true, false, true], swing: true },
      gen: { meter: '7/8:2+3+2', measures: 7, min: 9, max: 2, starts: { '6/8': [5, 1, 1, 9] }, seed: 12 },
    }),
  );
  const s = await freshStorage();
  const m = s.getMeta();
  assert.deepEqual(m.drill.beats, { '4/4': [false, true, false, true] });
  assert.equal(m.drill.meter, '4/4');
  assert.equal(m.drill.notes, 3);
  assert.equal(m.drill.loop, false);
  assert.equal(m.gen.meter, '7/8:2+3+2');
  assert.equal(m.gen.measures, 4); // 7 n'est pas proposé
  assert.equal(m.gen.min, 2); // 9 > 7 croches : valeur par défaut
  assert.equal(m.gen.max, 2);
  assert.deepEqual(m.gen.starts, {}); // 9 hors du 6/8 : liste rejetée
  assert.equal(m.gen.seed, 12);
});
