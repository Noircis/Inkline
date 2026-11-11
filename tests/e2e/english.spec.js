// English interface (2.9): browser language, manual choice in settings.
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, tapStaff, dragStaff, collectErrors } from './helpers.js';

test.use({ locale: 'en-US' });

test('English browser: home, note, palettes and chart in English', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // First launch: home screen.
  await expect(page.locator('.empty h2')).toHaveText('Jot down an idea in three taps');
  await expect(page.locator('#tryEx')).toHaveText('Open the example');
  await page.click('#tryEx'); // the example note is in English too
  await expect(page.locator('#titleIn')).toHaveValue('Example · Bb blues lick');
  await page.click('#back');
  await expect(page.locator('#q')).toHaveAttribute('placeholder', 'Search titles, text, chords');
  await expect(page.locator('.chip[data-sel=all] .chip-name')).toHaveText('All');
  await expect(page.locator('#listLbl')).toHaveText('1 note');

  await newNoteWith(page, 'staff');
  await expect(page.locator('#folderBtn')).toContainText('Unfiled');
  await expect(page.locator('#titleIn')).toHaveAttribute('placeholder', 'Note title');
  await expect(page.locator('#palette [data-mode=write]')).toHaveText('Write');
  await expect(page.locator('#palette [data-dur=q]')).toHaveAttribute('aria-label', 'Quarter note');
  await expect(page.locator('.block.active .kind')).toHaveText('Staff');
  await expect(page.locator('.block.active [data-f=clef] option')).toHaveText(['Treble', 'Bass']);
  await expect(page.locator('.block.active [data-f=tr] option').nth(2)).toHaveText('B♭ tenor');
  await expect(page.locator('.block.active [data-f=ks] option').nth(1)).toHaveText('1♯ · G / Em');
  await expect(page.locator('.block.active .playbtn')).toHaveText('▶ Play');
  // Drag bubble: English note name.
  await dragStaff(page, { t: 'append', s: 4 }, [11], async () => {
    await expect(page.locator('.pitch-tip')).toHaveText('B5');
  });
  await tapStaff(page, { t: 'append', s: 2 });
  await expect(page.locator('#palInfo')).toContainText('blue area');
  expect(errors).toEqual([]);
});

test('chart and chord keyboard in English', async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'grid');
  await expect(page.locator('#gInfo')).toHaveText('Bar 1');
  await expect(page.locator('#gTabChords')).toHaveText('Chords');
  await expect(page.locator('#gKeys [data-ck=next]')).toHaveText('Next →');
  await expect(page.locator('#gKeys [data-ck=nc]')).toHaveAttribute('aria-label', 'No chord');
  await expect(page.locator('.block.active [data-f=key] option').first()).toHaveText('C major');
});

test('settings: manual language choice, kept after restart', async ({ page }) => {
  await openApp(page);
  await page.click('#optBtn');
  await expect(page.locator('.top-title')).toHaveText('Settings');
  await expect(page.locator('[data-lang=auto]')).toHaveAttribute('aria-checked', 'true');
  await page.click('[data-lang=fr]');
  await page.waitForLoadState('load');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.goto('./');
  await expect(page.locator('.empty h2')).toHaveText('Notez une idée en trois touchers');
  await page.click('#optBtn');
  await expect(page.locator('[data-lang=fr]')).toHaveAttribute('aria-checked', 'true');
  // Back to automatic: the browser is in English.
  await page.click('[data-lang=auto]');
  await page.waitForLoadState('load');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('practice in English', async ({ page }) => {
  await openApp(page);
  await page.click('#trainBtn');
  await expect(page.locator('#goExercises')).toContainText('Random exercises');
  await page.click('#goPlacements');
  await page.click('[data-n="2"]');
  await expect(page.locator('#drillCount')).toHaveText('28 bars · 7 starts');
  await expect(page.locator('.drill .sr').nth(3)).toHaveText('Starting on 2 and');
});
