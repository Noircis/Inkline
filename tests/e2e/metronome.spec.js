// Metronome (2.11): sheet from any screen, mini-bar, accents, jazz modes, tap, presets.
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, collectErrors } from './helpers.js';

test.beforeEach(async ({ context }) => {
  // Spy: hits rendered in the offline context of each cycle.
  await context.addInitScript(() => {
    window.__renders = [];
    const render = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function () {
      window.__renders.push(this.length / this.sampleRate);
      return render.call(this);
    };
  });
});

const sheet = (page) => page.locator('#metroSheet');
const mini = (page) => page.locator('#metroMini');

test('from a note: sheet, accents, start, collapse to the mini-bar, back closes the sheet', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openApp(page);
  await newNoteWith(page, 'text');
  await page.fill('#titleIn', 'Gammes');
  await page.click('[data-metro-open]');
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('h2')).toHaveText('Métronome');
  await expect(page.locator('#mTempoVal')).toHaveText('120');
  await expect(page.locator('#mMark')).toHaveText('Allegro');
  await expect(page.locator('[data-mbar]')).toHaveCount(4);
  await expect(page.locator('[data-mbar="0"]')).toHaveAttribute('aria-label', 'Pulsation 1, niveau 4');

  // Tap a bar: off, then on again at the same level.
  await page.click('[data-mbar="1"]');
  await expect(page.locator('[data-mbar="1"]')).toHaveClass(/off/);
  await expect(page.locator('[data-mbar="1"]')).toHaveAttribute('aria-label', 'Pulsation 2, niveau 0');
  await page.click('[data-mbar="1"]');
  await expect(page.locator('[data-mbar="1"]')).toHaveAttribute('aria-label', 'Pulsation 2, niveau 3');
  await page.click('[data-mbar="1"]');
  await page.click('[data-step="5"]');
  await expect(page.locator('#mTempoVal')).toHaveText('125');

  await page.click('.metro-play');
  await expect(page.locator('.metro-play')).toHaveClass(/on/);
  await expect(page.locator('[data-mbar].on')).toHaveCount(1, { timeout: 3000 });

  // Collapse: the note is still there, the mini-bar plays on.
  await page.click('[data-m="close"]');
  await expect(sheet(page)).toBeHidden();
  await expect(mini(page)).toBeVisible();
  await expect(mini(page).locator('.mm-tempo')).toHaveText('♩ 125');
  await expect(page.locator('#titleIn')).toHaveValue('Gammes');
  await expect(mini(page).locator('.mm-dot.on')).toHaveCount(1, { timeout: 3000 });

  // Android back with the sheet open: only the sheet closes.
  await page.click('[data-m="open"]');
  await expect(sheet(page)).toBeVisible();
  await page.goBack();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#titleIn')).toHaveValue('Gammes');

  // The mini-bar follows the navigation, and stops the metronome.
  await page.click('#back');
  await expect(page.locator('.brand')).toBeVisible();
  await expect(mini(page)).toBeVisible();
  await mini(page).locator('[data-m="plus"]').click();
  await expect(mini(page).locator('.mm-tempo')).toHaveText('♩ 126');
  await mini(page).locator('[data-m="stop"]').click();
  await expect(mini(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('any time signature: menus, groups, shortcuts, subdivisions, swing', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await page.selectOption('[data-k="num"]', '15');
  await page.selectOption('[data-k="den"]', '16');
  await expect(page.locator('[data-mbar]')).toHaveCount(15);
  await expect(page.locator('[data-k="groups"]')).toHaveValue('4+4+4+3');
  await expect(page.locator('.mgap.cut')).toHaveCount(3);
  await expect(page.locator('[data-msub]')).toHaveCount(0); // no subdivision in /16
  await expect(page.locator('[data-k="shortcut"]')).toHaveValue('');
  // Tap between pulses 2 and 3: the first group is split.
  await page.click('[data-mcut="2"]');
  await expect(page.locator('[data-k="groups"]')).toHaveValue('2+2+4+4+3');
  await page.click('[data-mcut="2"]');
  await expect(page.locator('[data-k="groups"]')).toHaveValue('4+4+4+3');

  // Shortcut 6/8: two groups of 3, the tempo counts dotted quarters.
  await page.selectOption('[data-k="shortcut"]', { label: '6/8' });
  await expect(page.locator('[data-mbar]')).toHaveCount(6);
  await expect(page.locator('input[data-k="unit"][value="group"]')).toBeChecked();
  await expect(page.locator('.mt-unit')).toHaveText('♩. =');

  await page.selectOption('[data-k="shortcut"]', { label: '4/4' });
  await expect(page.locator('[data-msub]')).toHaveCount(5);
  await expect(page.locator('[data-k="swing"]')).toHaveCount(0);
  await page.click('[data-msub="16"]');
  await expect(page.locator('[data-msubbar]')).toHaveCount(12);
  await page.click('[data-msub="8"]');
  await page.locator('[data-k="swing"]').fill('67');
  await expect(page.locator('#mSwingVal')).toHaveText('ternaire');

  await page.click('[data-mjazz="once"]');
  await page.check('[data-k="twoBars"]');
  await page.click('.metro-play');
  // Two bars of 4/4 at 120: a 4 s cycle.
  await expect.poll(() => page.evaluate(() => window.__renders.at(-1))).toBeGreaterThan(4);
  await expect(page.locator('#mBeats.silent-bar')).toHaveCount(1, { timeout: 6000 });
  await page.click('.metro-play');
});

test('slide on a bar: the level snaps to the steps 0 to 4', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  const bar = page.locator('[data-mbar="0"]');
  const box = await bar.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 45, { steps: 5 }); // 3 steps down
  await page.mouse.up();
  await expect(bar).toHaveAttribute('aria-label', 'Pulsation 1, niveau 1');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(bar).toHaveAttribute('aria-label', 'Pulsation 1, niveau 0');
  await expect(bar).toHaveClass(/off/);
});

test('jazz 2 and 4 only in even x/4; settings survive a reload', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await page.click('[data-mjazz="24"]');
  await expect(page.locator('[data-mbar].off')).toHaveCount(2);
  await expect(page.locator('[data-mbar="0"]')).toHaveClass(/off/);
  await page.selectOption('[data-k="num"]', '3');
  await expect(page.locator('[data-mjazz="24"]')).toBeDisabled();
  await page.selectOption('[data-k="num"]', '4');
  await page.click('[data-mjazz="24"]');
  await page.selectOption('[data-k="sound"]', 'wood');
  await page.click('[data-step="-5"]');
  await page.reload();
  await page.click('[data-metro-open]');
  await expect(page.locator('#mTempoVal')).toHaveText('115');
  await expect(page.locator('[data-mjazz="24"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-k="sound"]')).toHaveValue('wood');
});

test('tap tempo and drag on the number', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  const tap = page.locator('[data-m="tap"]');
  for (let i = 0; i < 4; i++) {
    await tap.dispatchEvent('pointerdown');
    if (i < 3) await page.waitForTimeout(500);
  }
  const bpm = Number(await page.locator('#mTempoVal').textContent());
  expect(bpm).toBeGreaterThan(105);
  expect(bpm).toBeLessThan(125);

  const box = await page.locator('#mTempo').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#mTempoVal')).toHaveText(String(bpm + 10));
});

test('presets: save, load, rename, delete', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await page.click('[data-step="-5"]');
  await page.click('[data-mjazz="24"]');
  await page.click('[data-m="presets"]');
  await expect(page.locator('.mpreset')).toHaveCount(0);
  await page.fill('#mpSave input', 'Donna Lee');
  await page.press('#mpSave input', 'Enter');
  await expect(page.locator('.mp-load span')).toHaveText('Donna Lee');
  await expect(page.locator('.mp-load small')).toHaveText('♩ 115 · 4/4 · 2 et 4');

  await page.click('[data-m="main"]');
  await page.click('[data-step="5"]');
  await page.click('[data-step="5"]');
  await page.click('[data-mjazz="24"]');
  await page.click('[data-m="presets"]');
  await page.click('.mp-load');
  await expect(page.locator('#mTempoVal')).toHaveText('115');
  await expect(page.locator('[data-mjazz="24"]')).toHaveAttribute('aria-pressed', 'true');

  await page.click('[data-m="presets"]');
  await page.click('[data-edit]');
  await page.fill('[data-rename] input', 'Donna Lee rapide');
  await page.click('[data-rename] button');
  await expect(page.locator('.mp-load span')).toHaveText('Donna Lee rapide');
  await page.reload();
  await page.click('[data-metro-open]');
  await page.click('[data-m="presets"]');
  await expect(page.locator('.mp-load span')).toHaveText('Donna Lee rapide');
  await page.click('[data-del]');
  await expect(page.locator('.mpreset')).toHaveCount(1); // first tap arms the button
  await page.click('[data-del]');
  await expect(page.locator('.mpreset')).toHaveCount(0);
});

test('one tempo at a time: a practice playback stops the metronome', async ({ page }) => {
  await openApp(page);
  await page.click('#trainBtn');
  await page.click('#goPlacements');
  await page.click('[data-metro-open]');
  await page.click('.metro-play');
  await page.click('[data-m="close"]');
  await expect(mini(page)).toBeVisible();
  await page.locator('[data-play]').first().click();
  await expect(mini(page)).toBeHidden();
});

test.describe('English', () => {
  test.use({ locale: 'en-US' });
  test('metronome in English', async ({ page }) => {
    await openApp(page);
    await page.click('[data-metro-open]');
    await expect(sheet(page).locator('h2')).toHaveText('Metronome');
    await expect(page.locator('[data-mjazz="24"]')).toHaveText('2 and 4');
    await expect(page.locator('.metro-play')).toHaveText('▶ Start');
    await page.click('[data-m="presets"]');
    await expect(page.locator('#mpSave button')).toHaveText('Save');
  });
});
