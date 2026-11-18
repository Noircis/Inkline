// Random chord charts (2.18): settings, chart, playback, "Add to…" a note and a program.
import { test, expect } from '@playwright/test';
import { openApp, collectErrors, storedNotes, storedPractice } from './helpers.js';

test('random chart: settings kept, chart drawn, played, added to a note and a program', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await page.click('#trainBtn');
  await page.click('#goRgrid');
  await page.fill('#rgCount', '12');
  await page.click('[data-rg=perBar][data-v="2"]');
  await page.click('[data-rg=acc][data-v="#"]');
  await page.click('#rgGo');

  await expect(page.locator('.rg-grid .gm')).toHaveCount(12);
  await expect(page.locator('.rg-grid .gm').first().locator('.gc')).toHaveCount(2);
  await expect(page.locator('.rg-grid .gm.rb-fin')).toHaveCount(1);
  await expect(page.locator('.rg-grid .cr', { hasText: '♭' })).toHaveCount(0);
  await expect(page.locator('.gen-info')).toHaveText('4/4 · 12 mesures');
  const title = await page.locator('.top-title').textContent();
  const chords = await page.locator('.rg-grid').textContent();

  // ↻: another chart, another number.
  await page.click('#reroll');
  await expect(page.locator('.top-title')).not.toHaveText(title);
  expect(await page.locator('.rg-grid').textContent()).not.toBe(chords);

  // Playback highlights the measures.
  await page.click('[data-play=rgrid]');
  await expect(page.locator('.rg-grid .gm.play')).toHaveCount(1);
  await page.click('[data-play=rgrid]');

  // Into a new note, then into a new program.
  await page.click('#addTo');
  await page.click('[data-a=newNote]');
  await expect(page.locator('.ptoast')).toContainText('Grille n°');
  await page.click('#addTo');
  await page.click('[data-a=newProgram]');
  const { notes } = await storedNotes(page);
  const grid = notes[0].blocks.find((b) => b.type === 'grid');
  expect(grid.measures).toHaveLength(12);
  expect(grid.measures[11].fin).toBe(true);
  await expect
    .poll(async () => (await storedPractice(page)).programs[0]?.items[0]?.grid?.measures.length)
    .toBe(12);

  // Back to the settings: they were kept.
  await page.click('#back');
  await expect(page.locator('#rgCount')).toHaveValue('12');
  await expect(page.locator('[data-rg=perBar][data-v="2"]')).toHaveAttribute('aria-checked', 'true');

  // The program plays the same chart in a session.
  await page.click('#back');
  await page.locator('[data-start]').first().click();
  await expect(page.locator('.pv-grid svg')).toBeVisible();
  expect(errors).toEqual([]);
});
