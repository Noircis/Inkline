// Accueil : migration d'un ancien carnet, dossiers, recherche, tri, sauvegarde.
import { test, expect } from '@playwright/test';
import { seedStorage, openApp, storedNotes, collectErrors } from './helpers.js';

const now = Date.now();
const DAY = 86_400_000;
const OLD = {
  a: {
    id: 'a',
    title: 'Blues en F',
    created: now - 3 * DAY,
    updated: now - DAY,
    blocks: [{ id: 'g', type: 'grid', time: '4/4', key: 'F', measures: [{ ch: ['F7'] }, { ch: ['Bb7'] }] }],
  },
  b: {
    id: 'b',
    title: 'Réponse',
    updated: now - 2 * DAY, // note d'avant la 1.7 : sans date de création
    blocks: [{ id: 't', type: 'text', text: 'Idée de réponse' }],
  },
};

test.beforeEach(async ({ context }) => {
  await seedStorage(context, { 'carnet-portees-v1': OLD });
});

test('migration : le carnet de localStorage passe dans IndexedDB', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await expect(page.locator('.card')).toHaveCount(2);
  const { notes } = await storedNotes(page);
  expect(notes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  expect(notes.find((n) => n.id === 'b').created).toBe(OLD.b.updated);
  expect(await page.evaluate(() => localStorage.getItem('carnet-portees-v1'))).not.toBeNull();
  await page.click('#optBtn');
  await expect(page.locator('.opt-row.static small')).toContainText('IndexedDB');
  expect(errors).toEqual([]);
});

test('dossiers : créer, ranger une note, filtrer, supprimer', async ({ page }) => {
  await openApp(page);
  await page.click('#addFolder');
  await page.fill('#fsName', 'Harmonie');
  await page.click('[data-color=green]');
  await page.click('#fsSave');
  await expect(page.locator('#listLbl')).toHaveText('Harmonie · 0 note');

  await page.click('.chip[data-sel=all]');
  await page.locator('.card', { hasText: 'Blues en F' }).click();
  const fid = (await storedNotes(page)).folders[0].id;
  await page.selectOption('#folderSel', fid);
  await page.click('#pinBtn');
  await page.click('#back');
  await page.waitForTimeout(300);
  const blues = (await storedNotes(page)).notes.find((n) => n.id === 'a');
  expect(blues.folder).toBe(fid);
  expect(blues.pinned).toBe(true);
  expect(blues.updated).toBe(OLD.a.updated); // ranger n'est pas modifier

  await page.click(`.chip[data-sel="${fid}"]`);
  await expect(page.locator('.card')).toHaveCount(1);

  await page.click('#editFolder');
  await page.click('#fsDel');
  await page.click('#fsDel');
  await page.waitForTimeout(300);
  const after = await storedNotes(page);
  expect(after.folders).toEqual([]);
  expect(after.notes).toHaveLength(2); // aucune note supprimée
});

test('recherche (accents, accords) et tri', async ({ page }) => {
  await openApp(page);
  await page.fill('#q', 'reponse');
  await expect(page.locator('.card h3')).toHaveText(['Réponse']);
  await page.fill('#q', 'b♭7');
  await expect(page.locator('.card h3')).toHaveText(['Blues en F']);
  await page.fill('#q', '');
  await page.selectOption('#sortSel', 'title');
  await expect(page.locator('.card h3')).toHaveText(['Blues en F', 'Réponse']);
});

test('sauvegarde : export puis réimport (notes et dossiers)', async ({ page }) => {
  await openApp(page);
  await page.click('#addFolder');
  await page.fill('#fsName', 'Cours');
  await page.click('#fsSave');
  await page.click('#optBtn');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#optExport')]);
  const file = await download.path();
  const backup = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  expect(backup.version).toBe(2);
  expect(Object.keys(backup.notes)).toHaveLength(2);
  expect(Object.values(backup.folders).map((f) => f.name)).toEqual(['Cours']);

  await page.locator('[data-folder]').click();
  await page.click('#fsDel');
  await page.click('#fsDel');
  await page.setInputFiles('#optImport', file);
  await expect(page.locator('#optMsg')).toContainText('1 dossier ajouté');
});
