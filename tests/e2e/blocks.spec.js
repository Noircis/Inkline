// Collapsed long blocks, PNG / PDF / .inkline sharing, text blocks.
import { test, expect } from '@playwright/test';
import { seedStorage, openApp, storedNotes } from './helpers.js';

const now = Date.now();
const items = [];
for (let k = 0; k < 40; k++)
  items.push({ d: '8', s: (k % 9) + 1 }, { d: '8', s: 5 }, { d: 'q', s: 4 }, { d: 'h', s: 5 });
const LONG = {
  n: {
    id: 'n',
    title: 'Longue',
    created: now,
    updated: now,
    blocks: [
      { id: 's', type: 'staff', clef: 'treble', time: '4/4', tempo: 120, items },
      { id: 'r', type: 'staff', clef: 'rhythm', time: '4/4', tempo: 100, items: [{ d: 'q' }, { d: 'q' }] },
    ],
  },
};

test.beforeEach(async ({ context, page }) => {
  await seedStorage(context, { 'carnet-portees-v1': LONG });
  await openApp(page);
  await page.locator('.card').first().click();
});

test('collapse a long block, open it by tapping, without placing a note', async ({ page }) => {
  await expect(page.locator('[data-block=r] .foldbtn')).toHaveCount(0); // too short
  await page.locator('[data-block=s] .foldbtn').click();
  await expect(page.locator('[data-block=s].folded')).toHaveCount(1);
  await page.waitForTimeout(300);
  expect((await storedNotes(page)).notes[0].blocks[0].fold).toBe('closed');

  await page.locator('[data-staff=s]').click({ position: { x: 150, y: 40 } });
  await expect(page.locator('[data-block=s].active')).toHaveCount(1);
  await expect(page.locator('[data-block=s].folded')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect((await storedNotes(page)).notes[0].blocks[0].items).toHaveLength(items.length);

  await page.click('#palDone');
  await expect(page.locator('[data-block=s].folded')).toHaveCount(1);
});

test('share: non-empty Inkline, PNG and PDF files', async ({ page }) => {
  await page.click('#shareBtn');
  for (const [kind, ext] of [
    ['inkline', '.inkline'],
    ['png', '.png'],
    ['pdf', '.pdf'],
  ]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click(`[data-share=${kind}]`)]);
    expect(download.suggestedFilename()).toContain(ext);
    const size = (await (await import('node:fs/promises')).stat(await download.path())).size;
    expect(size).toBeGreaterThan(500);
  }
});

test.describe('phone', () => {
  test.use({ isMobile: true, hasTouch: true });

  test('typing in the middle of a long text does not jump to the top of the note', async ({ page }) => {
    await openApp(page);
    await page.click('#newNote');
    const ta = page.locator('.block.text textarea').first();
    await ta.fill(Array.from({ length: 80 }, (_, i) => 'Line ' + i).join('\n'));
    await ta.evaluate((el) => el.setSelectionRange(400, 400));
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.keyboard.type('x');
    expect(await page.evaluate(() => window.scrollY)).toBe(900);
  });
});
