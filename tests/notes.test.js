// Tests de la date de création et des helpers d'affichage de la liste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newNote } from '../js/model.js';
import { sanitizeNote } from '../js/sanitize.js';
import { importFile, noteFileJson } from '../js/storage.js';
import { relativeDate, noteSummary } from '../js/ui/list-view.js';

test('newNote : date de création remplie automatiquement', () => {
  const n = newNote();
  assert.equal(typeof n.created, 'number');
  assert.equal(n.created, n.updated);
});

test("migration : une note d'avant la 1.7 reçoit sa date de modification comme date de création", () => {
  const old = { id: 'abc', title: 'Ancienne', updated: 1700000000000, blocks: [] };
  assert.equal(sanitizeNote(old).created, 1700000000000);
  const recent = { ...old, created: 1600000000000 };
  assert.equal(sanitizeNote(recent).created, 1600000000000); // une vraie date n'est jamais écrasée
});

test('note reçue : garde sa date de création, devient « modifiée maintenant »', () => {
  const src = sanitizeNote({ id: 'n1', title: 'X', created: 1600000000000, updated: 1650000000000, blocks: [] });
  const notes = {};
  const r = importFile(notes, noteFileJson(src));
  assert.equal(notes[r.firstId].created, 1600000000000);
  assert.ok(notes[r.firstId].updated > 1650000000000);
});

test('relativeDate : aujourd’hui, hier, puis date courte', () => {
  const now = new Date(2026, 10, 4, 15, 0).getTime();
  assert.equal(relativeDate(new Date(2026, 10, 4, 1, 0).getTime(), now), 'aujourd’hui');
  assert.equal(relativeDate(new Date(2026, 10, 3, 23, 0).getTime(), now), 'hier');
  assert.match(relativeDate(new Date(2026, 9, 20).getTime(), now), /20 oct/);
});

test('noteSummary : décompte par type de bloc', () => {
  const n = { blocks: [{ type: 'staff', clef: 'treble' }, { type: 'staff', clef: 'rhythm' }, { type: 'grid' }, { type: 'grid' }, { type: 'text' }] };
  assert.equal(noteSummary(n), '1 portée · 1 rythme · 2 grilles');
});
