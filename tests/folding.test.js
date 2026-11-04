// Tests de la 2.2 : blocs longs réduits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFold, FOLD_MIN_LINES } from '../js/folding.js';
import { gridHtml } from '../js/grid.js';
import { sanitizeNote } from '../js/sanitize.js';
import { noteFileJson } from '../js/storage.js';

test('shouldFold : édition > longueur > choix manuel > option', () => {
  const long = FOLD_MIN_LINES;
  assert.equal(shouldFold({}, long, false, true), true); // option automatique
  assert.equal(shouldFold({}, long, false, false), false);
  assert.equal(shouldFold({}, long - 1, false, true), false); // trop court
  assert.equal(shouldFold({ fold: 'closed' }, long - 1, false, false), false); // trop court, même réduit à la main
  assert.equal(shouldFold({ fold: 'closed' }, long, false, false), true); // choix manuel > option
  assert.equal(shouldFold({ fold: 'open' }, long, false, true), false);
  assert.equal(shouldFold({ fold: 'closed' }, long, true, true), false); // en édition : toujours en entier
});

test('gridHtml : une grille réduite montre ses premières mesures, sans cellule +', () => {
  const b = { measures: Array.from({ length: 20 }, () => ({ ch: ['C7'] })) };
  const full = gridHtml(b, null, null);
  const cut = gridHtml(b, null, null, 12);
  assert.equal((full.match(/data-gm="\d+"/g) || []).length, 20);
  assert.equal((cut.match(/data-gm="\d+"/g) || []).length, 12);
  assert.ok(full.includes('data-gm="add"'));
  assert.ok(!cut.includes('data-gm="add"'));
});

test('fold : conservé dans le carnet, retiré d’une note partagée', () => {
  const raw = {
    id: 'a',
    title: 'X',
    created: 1,
    updated: 1,
    blocks: [
      { id: 's', type: 'staff', clef: 'treble', time: '4/4', tempo: 100, items: [], fold: 'closed' },
      { id: 'g', type: 'grid', time: '4/4', key: 'C', measures: [{ ch: [] }], fold: 'open' },
      { id: 'h', type: 'grid', time: '4/4', key: 'C', measures: [{ ch: [] }], fold: '<script>' },
    ],
  };
  const n = sanitizeNote(raw);
  assert.deepEqual(
    n.blocks.map((b) => b.fold),
    ['closed', 'open', undefined],
  );
  assert.ok(sanitizeNote(raw, { freshIds: true }).blocks.every((b) => !('fold' in b)));
  const shared = JSON.parse(noteFileJson(n)).note;
  assert.ok(shared.blocks.every((b) => !('fold' in b)));
  assert.equal(n.blocks[0].fold, 'closed'); // l'original n'est pas modifié
});
