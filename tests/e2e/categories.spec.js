// Folder categories (2.8.6): sections, filters, filing a note, management.
import { test, expect } from '@playwright/test';
import { openApp, collectErrors } from './helpers.js';

/** A Saxophone folder (Technique, Son, Impro) and four notes, shown on home. */
async function seed(page) {
  await page.evaluate(async () => {
    const { state } = await import('/js/ui/state.js');
    const { saveFolders, flushSave, setMeta } = await import('/js/storage.js');
    const now = Date.now();
    state.folders = {
      sax: {
        id: 'sax',
        name: 'Saxophone',
        color: 'orange',
        created: now,
        cats: [
          { id: 'tec', name: 'Technique' },
          { id: 'son', name: 'Son' },
          { id: 'imp', name: 'Impro' },
        ],
      },
    };
    const mk = (id, title, cats, ago) => ({
      id,
      title,
      created: now - ago,
      updated: now - ago,
      folder: 'sax',
      ...(cats ? { cats } : {}),
      blocks: [{ id: 'b' + id, type: 'text', text: '' }],
    });
    state.notes = {};
    [
      mk('n1', 'Gammes', ['tec'], 1000),
      mk('n2', 'Harmoniques', ['tec', 'son'], 2000),
      mk('n3', 'Patterns ii-V-I', ['imp'], 3000),
      mk('n4', 'En vrac', null, 4000),
    ].forEach((n) => (state.notes[n.id] = n));
    await saveFolders(state.folders);
    await flushSave(state.notes);
    setMeta({ folder: 'sax', listView: 'list' });
  });
  await page.reload();
  await page.locator('#catChips').waitFor();
}

const note = (page, id) =>
  page.evaluate(async (id) => {
    const { state } = await import('/js/ui/state.js');
    const n = state.notes[id];
    return { folder: n.folder ?? null, cats: n.cats ?? [] };
  }, id);

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await seed(page);
});

test('sections by category, a note with two categories in each, collapsed state remembered', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await expect(page.locator('.cat-title')).toHaveText(['Technique', 'Son', 'Impro', 'Sans catégorie']);
  await expect(page.locator('.cat-count')).toHaveText(['2', '1', '1', '1']);
  await expect(page.locator('.cat-sec').nth(1)).toContainText('Harmoniques');
  // Collapse "Technique", reload: still collapsed.
  await page.click('.cat-sec >> nth=0 >> .cat-head');
  await expect(page.locator('.cat-sec').nth(0).locator('.cat-body')).toBeHidden();
  await page.reload();
  await expect(page.locator('.cat-sec').nth(0).locator('.cat-body')).toBeHidden();
  await expect(page.locator('.cat-sec').nth(1).locator('.cat-body')).toBeVisible();
  expect(errors).toEqual([]);
});

test('filter by category, new note filed in the chosen category', async ({ page }) => {
  await page.click('[data-cat=son]');
  await expect(page.locator('#listLbl')).toHaveText('Saxophone › Son · 1 note');
  await expect(page.locator('.cat-sec')).toHaveCount(0); // plain list
  await expect(page.locator('#listBody')).toContainText('Harmoniques');
  await page.click('#newNote');
  await expect(page.locator('#folderBtn')).toContainText('Saxophone › Son');
});

test('file a note: several categories, new category, another folder', async ({ page }) => {
  await page.click('text=En vrac');
  await expect(page.locator('#folderBtn')).toHaveText(/Saxophone/);
  await page.click('#folderBtn');
  await page.click('.ar-cats [data-cat=tec]');
  await page.click('.ar-cats [data-cat=imp]');
  expect(await note(page, 'n4')).toEqual({ folder: 'sax', cats: ['tec', 'imp'] });
  await page.fill('#arNew', 'Répertoire');
  await page.press('#arNew', 'Enter');
  const after = await note(page, 'n4');
  expect(after.cats).toHaveLength(3);
  await expect(page.locator('.ar-cats [data-cat]')).toHaveCount(4);
  await page.click('#arDone');
  await expect(page.locator('#folderBtn')).toContainText('Technique, Impro, Répertoire');
  // Unfiled: categories are cleared.
  await page.click('#folderBtn');
  await page.click('[data-folder=""]');
  expect(await note(page, 'n4')).toEqual({ folder: null, cats: [] });
});

test('manage categories: rename, reorder, delete (without deleting a note)', async ({ page }) => {
  await page.click('[data-cat=all]'); // already chosen: opens management
  await expect(page.locator('#csTitle')).toHaveText('Catégories de « Saxophone »');
  await page.locator('.cat-name').nth(1).fill('Sonorité');
  await page.locator('.cat-row').nth(2).locator('[data-move="-1"]').click(); // Impro before Sonorité
  const del = page.locator('.cat-row').nth(0).locator('[data-del]');
  await del.click();
  await expect(del).toHaveText('Retirer de 2 notes');
  await del.click();
  await page.click('#folderSheet [type=submit]');
  await expect(page.locator('.cat-title')).toHaveText(['Impro', 'Sonorité', 'Sans catégorie']);
  expect(await note(page, 'n1')).toEqual({ folder: 'sax', cats: [] });
  expect(await note(page, 'n2')).toEqual({ folder: 'sax', cats: ['son'] });
  expect(
    await page.evaluate(async () => Object.keys((await import('/js/ui/state.js')).state.notes).length),
  ).toBe(4);
});

test('new category: Add button, keyboard ✓ key, and nothing is lost', async ({ page }) => {
  // Categories panel: the keyboard's ✓ adds (without closing).
  await page.click('#addCat');
  await page.fill('#csNew', 'Répertoire');
  await page.press('#csNew', 'Enter');
  await expect(page.locator('#csTitle')).toBeVisible();
  await expect(page.locator('.cat-name')).toHaveCount(4);
  // Name typed then "Save" directly: it is kept.
  await page.fill('#csNew', 'Lecture');
  await page.click('#folderSheet [type=submit]');
  await expect(page.locator('#catChips [data-cat]')).toContainText([
    'Tout',
    'Technique',
    'Son',
    'Impro',
    'Répertoire',
    'Lecture',
  ]);

  // "File note" panel: Add button.
  await page.click('[data-cat=all]');
  await page.locator('#folderSheet [data-del]').first().waitFor(); // management open: close it
  await page.click('#csCancel');
  await page.click('text=En vrac');
  await page.click('#folderBtn');
  await page.fill('#arNew', 'Transcriptions');
  await page.click('#arNewForm [type=submit]');
  await expect(page.locator('.ar-cats [data-cat][aria-pressed=true]')).toHaveText(['Transcriptions']);
  // The keyboard's ✓.
  await page.fill('#arNew', 'Oreille');
  await page.press('#arNew', 'Enter');
  await expect(page.locator('.ar-cats [data-cat][aria-pressed=true]')).toHaveText([
    'Transcriptions',
    'Oreille',
  ]);
  // Typed then "Done": added too.
  await page.fill('#arNew', 'Rythme');
  await page.click('#arDone');
  await expect(page.locator('#folderBtn')).toContainText('Transcriptions, Oreille, Rythme');
});

test('folder without categories: "+ Category" on home and in a note', async ({ page }) => {
  await page.evaluate(async () => {
    const { state } = await import('/js/ui/state.js');
    const { saveFolders, setMeta } = await import('/js/storage.js');
    delete state.folders.sax.cats;
    Object.values(state.notes).forEach((n) => delete n.cats);
    await saveFolders(state.folders);
    setMeta({ folder: 'sax' });
  });
  await page.reload();
  await expect(page.locator('#addCat')).toHaveText('+ Catégorie');
  await page.click('#addCat');
  await expect(page.locator('#csNew')).toBeFocused();
  await page.fill('#csNew', 'Technique');
  await page.click('#csAdd');
  await page.click('#folderSheet [type=submit]');
  await expect(page.locator('#catChips [data-cat]')).toContainText(['Tout', 'Technique']);
  // In a note: the category is added and checked.
  await page.click('text=Gammes');
  await page.click('#folderBtn');
  await page.fill('#arNew', 'Son');
  await page.click('#arNewForm [type=submit]');
  await expect(page.locator('.ar-cats [data-cat]')).toHaveText(['Technique', 'Son']);
  await expect(page.locator('.ar-cats [aria-pressed=true]')).toHaveText(['Son']);
});
