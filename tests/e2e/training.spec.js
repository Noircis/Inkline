// Entraînement › Placements : séries, métronome, navigation.
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test.beforeEach(async ({ context, page }) => {
  // Espion : compte les sons programmés (triangle = métronome, sinus = rythme).
  await context.addInitScript(() => {
    window.__osc = [];
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (t) {
      window.__osc.push(this.type);
      return start.call(this, t);
    };
  });
  await openApp(page);
  await page.click('#trainBtn');
  await page.click('#goPlacements');
});

test('séries : regroupées par première note, une seule série pour une note', async ({ page }) => {
  await expect(page.locator('#drillCount')).toHaveText('8 mesures');
  await expect(page.locator('.drill')).toHaveCount(1);
  await page.click('[data-n="2"]');
  await expect(page.locator('#drillCount')).toHaveText('7 séries · 28 mesures');
  await expect(page.locator('.drill-sub')).toHaveText([
    '7 mesures',
    '6 mesures',
    '5 mesures',
    '4 mesures',
    '3 mesures',
    '2 mesures',
    '1 mesure',
  ]);
});

test('métronome : temps choisis, décompte, rythme coupé', async ({ page }) => {
  await page.click('[data-n="2"]');
  await page.click('[data-beat="0"]'); // il reste 2 et 4
  await page.click('[data-beat="2"]');
  await page.fill('#drillTempo', '300');
  await page.locator('#drillTempo').blur();
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill0]');
  await expect(page.locator('[data-play=drill0].on')).toHaveCount(0, { timeout: 10_000 });
  let osc = await page.evaluate(() => window.__osc);
  // Série de 7 mesures à 2 notes : 4 clics de décompte + 7 × 2 clics ; 14 notes.
  expect(osc.filter((t) => t === 'triangle')).toHaveLength(18);
  expect(osc.filter((t) => t === 'sine')).toHaveLength(14);

  await page.click('[data-opt=mute]');
  await page.click('[data-opt=countIn]');
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill6]');
  await expect(page.locator('[data-play=drill6].on')).toHaveCount(0, { timeout: 10_000 });
  osc = await page.evaluate(() => window.__osc);
  expect(osc.filter((t) => t === 'triangle')).toHaveLength(2);
  expect(osc.filter((t) => t === 'sine')).toHaveLength(0);
});

test('bouton retour : Placements → Entraînement → accueil', async ({ page }) => {
  await page.goBack();
  await expect(page.locator('#goPlacements')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#newNote')).toBeVisible();
});
