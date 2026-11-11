// Tests for the creation date and the list display helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newNote } from '../js/model.js';
import { sanitizeNote } from '../js/sanitize.js';
import { importFile, noteFileJson } from '../js/storage.js';
import { relativeDate, noteSummary } from '../js/ui/list-view.js';

test('newNote: creation date filled in automatically', () => {
  const n = newNote();
  assert.equal(typeof n.created, 'number');
  assert.equal(n.created, n.updated);
});

test('migration: a note from before 1.7 gets its modification date as creation date', () => {
  const old = { id: 'abc', title: 'Ancienne', updated: 1700000000000, blocks: [] };
  assert.equal(sanitizeNote(old).created, 1700000000000);
  const recent = { ...old, created: 1600000000000 };
  assert.equal(sanitizeNote(recent).created, 1600000000000); // a real date is never overwritten
});

test('received note: keeps its creation date, becomes "modified now"', () => {
  const src = sanitizeNote({
    id: 'n1',
    title: 'X',
    created: 1600000000000,
    updated: 1650000000000,
    blocks: [],
  });
  const notes = {};
  const r = importFile(notes, noteFileJson(src));
  assert.equal(notes[r.firstId].created, 1600000000000);
  assert.ok(notes[r.firstId].updated > 1650000000000);
});

test('relativeDate: today, yesterday, then short date', () => {
  const now = new Date(2026, 10, 4, 15, 0).getTime();
  assert.equal(relativeDate(new Date(2026, 10, 4, 1, 0).getTime(), now), 'aujourd’hui');
  assert.equal(relativeDate(new Date(2026, 10, 3, 23, 0).getTime(), now), 'hier');
  assert.match(relativeDate(new Date(2026, 9, 20).getTime(), now), /20 oct/);
});

test('noteSummary: count by block type', () => {
  const n = {
    blocks: [
      { type: 'staff', clef: 'treble' },
      { type: 'staff', clef: 'rhythm' },
      { type: 'grid' },
      { type: 'grid' },
      { type: 'text' },
    ],
  };
  assert.equal(noteSummary(n), '1 portée · 1 rythme · 2 grilles');
});
