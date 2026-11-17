// Practice notebook (2.16): programs, sessions, history, "Add to…".
import { test, expect } from '@playwright/test';
import { openApp, collectErrors, storedNotes, storedPractice } from './helpers.js';

/** Creates a program named `name` from the practice home, with a free text item. */
async function newProgram(page, name, text) {
  await page.click('#newProgram');
  await page.fill('#pName', name);
  await page.click('#pAdd');
  await page.click('[data-a=text]');
  await page.fill('[data-text]', text);
  await page.click('.ptext button');
  await expect(page.locator('.pitem')).toHaveCount(1);
}

test('program: name, items of every kind, duration, order, delete', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await page.click('#newNote');
  await page.fill('#titleIn', 'Blues en F');
  await page.click('[data-add=grid]');
  await page.goBack();
  await page.click('#trainBtn');
  await expect(page.locator('.prog-empty')).toBeVisible();
  await newProgram(page, 'Routine sax', 'Gammes 12 tons');

  await page.click('#pAdd');
  await page.click('[data-a=pickNote]');
  await page.fill('[data-q]', 'blues');
  await page.click('[data-a=note]');
  await page.click('#pAdd');
  await page.click('[data-a=pickBlock]');
  await page.click('[data-a=note]');
  await page.locator('[data-a=block]', { hasText: 'Grille' }).click();
  await expect(page.locator('.pitem-name')).toHaveText([
    'Gammes 12 tons',
    'Blues en F',
    'Blues en F · Grille',
  ]);

  // Duration of the first item; then it moves down.
  await page.locator('[data-item]').first().click();
  await page.click('[data-a=minutes][data-m="5"]');
  await page.click('[data-a=down]');
  await expect(page.locator('.pitem-name')).toHaveText([
    'Blues en F',
    'Gammes 12 tons',
    'Blues en F · Grille',
  ]);
  await expect(page.locator('.pitem').nth(1).locator('small')).toHaveText('Texte · 5 min');

  // Delete the last one (two taps).
  await page.locator('[data-item]').last().click();
  await page.click('[data-a=delete]');
  await page.click('[data-a=delete]');
  await expect(page.locator('.pitem')).toHaveCount(2);

  await expect
    .poll(async () => (await storedPractice(page)).programs.map((p) => [p.name, p.items.length]))
    .toEqual([['Routine sax', 2]]);
  // Back to the practice home: the program is listed.
  await page.click('#back');
  await expect(page.locator('.prog-open')).toContainText('Routine sax');
  await expect(page.locator('.prog-open small')).toHaveText('2 éléments');
  expect(errors).toEqual([]);
});

test('session: items in turn, countdown, metronome tempo, history and curve', async ({ page }) => {
  const errors = collectErrors(page);
  await page.clock.install();
  await openApp(page);
  await page.click('#trainBtn');
  await newProgram(page, 'Sax', 'Gammes');
  await page.locator('[data-item]').first().click();
  await page.click('[data-a=minutes][data-m="1"]');
  await page.click('[data-a=close]');
  await page.click('#pAdd');
  await page.click('[data-a=text]');
  await page.fill('[data-text]', 'Impro libre');
  await page.click('.ptext button');

  await page.click('#pStart');
  await expect(page.locator('.pv-free')).toHaveText('Gammes');
  await expect(page.locator('#sList')).toHaveText('1 / 2');
  // Metronome at 132 while practising.
  for (let i = 0; i < 12; i++) await page.click('[data-s=plus]');
  await page.click('[data-s=toggle]');
  await page.clock.fastForward('01:05');
  await expect(page.locator('.s-clock.done')).toBeVisible();
  await expect(page.locator('#sTime')).toHaveText('0:00');
  await expect(page.locator('#sTimeNote')).toHaveText('Temps écoulé');
  // Save the metronome for this item.
  await page.click('[data-s=open]');
  await page.click('[data-m=targetSave]');
  await expect(page.locator('.mnote-ok')).toHaveText('✓ Enregistré pour cet élément');
  await page.click('[data-m=close]');
  await page.click('[data-s=toggle]'); // stop
  await page.click('#sNext');
  await expect(page.locator('.pv-free')).toHaveText('Impro libre');
  await page.clock.fastForward('00:20');
  await page.click('#sNext'); // Finish
  await expect(page.locator('.s-summary h2')).toHaveText('Séance finie');
  await expect(page.locator('.sum-list li')).toHaveCount(2);
  await expect(page.locator('.sum-tempo').first()).toHaveText('♩ 132');
  await page.click('#sDone');

  const stored = await storedPractice(page);
  expect(stored.sessions).toHaveLength(1);
  expect(stored.sessions[0].items.map((e) => e.tempo)).toEqual([132, undefined]);
  expect(stored.programs[0].items[0].metro.tempo).toBe(132);

  // History: correct a tempo, then the curve of the item.
  await page.click('#back');
  await page.click('#goHistory');
  await expect(page.locator('.hcard')).toHaveCount(1);
  await expect(page.locator('.h-total')).toHaveText('1 min');
  await page.locator('.h-tempo').first().click();
  await page.fill('.h-tempo-in', '128');
  await page.keyboard.press('Enter');
  await expect(page.locator('.h-tempo').first()).toHaveText('♩ 128');
  await page.locator('.h-name').first().click();
  await expect(page.locator('.c-title')).toHaveText('Gammes');
  await expect(page.locator('.c-one')).toHaveText('♩ 128');
  expect(errors).toEqual([]);
});

test('add a generated exercise to a new note, to a program; 7/8 kept in the note', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await page.click('#trainBtn');
  await page.click('#newProgram');
  await page.fill('#pName', 'Lecture');
  await page.click('#back');
  await page.click('#goExercises');
  await page.click('[data-meter="7/8:2+2+3"]');
  await page.click('#genGo');
  await page.click('#addTo');
  await page.click('[data-a=newNote]');
  await expect(page.locator('.ptoast')).toContainText('Exercice n°');
  await page.click('#addTo');
  await page.locator('[data-a=program]', { hasText: 'Lecture' }).click();
  await expect(page.locator('.ptoast')).toContainText('Lecture');

  const { notes } = await storedNotes(page);
  expect(notes).toHaveLength(1);
  const [cap, line] = notes[0].blocks;
  expect(cap.type).toBe('text');
  expect(line.time).toBe('7/8');
  expect(line.groups).toEqual([2, 2, 3]);
  await expect
    .poll(async () => (await storedPractice(page)).programs[0].items.map((i) => i.kind))
    .toEqual(['exercise']);

  // Open the note from the message: the 7/8 block is there, its menu says 7/8.
  await page.click('#addTo');
  await page.click('[data-a=note]');
  await page.click('.ptoast button');
  await expect(page.locator('.block [data-f="time"]').first()).toHaveValue('7/8');
  expect(errors).toEqual([]);
});

test('▶ on an item starts the session right there (2.17.1)', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await page.click('#trainBtn');
  await newProgram(page, 'Sax', 'Gammes');
  for (const text of ['Arpèges', 'Impro libre']) {
    await page.click('#pAdd');
    await page.click('[data-a=text]');
    await page.fill('[data-text]', text);
    await page.click('.ptext button');
  }
  await page.locator('[data-play-item]').nth(2).click();
  await expect(page.locator('.pv-free')).toHaveText('Impro libre');
  await expect(page.locator('#sList')).toHaveText('3 / 3');
  // Back to the program: its own ▶ still starts at the first item.
  await page.goBack();
  await page.click('#pStart');
  await expect(page.locator('#sList')).toHaveText('1 / 3');
  expect(errors).toEqual([]);
});
