// Metronome (2.11, sub-pages 2.13): sheet from any screen, mini-bar, level bars, time
// signatures, subdivisions, jazz modes, tap, presets; notes, blocks, polyrhythm (2.15).
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, collectErrors, storedNotes } from './helpers.js';

test.beforeEach(async ({ context }) => {
  // Spy: length (s) of each cycle rendered offline.
  await context.addInitScript(() => {
    window.__renders = [];
    const render = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function () {
      window.__renders.push(this.length / this.sampleRate);
      return render.call(this);
    };
    // Spy: media elements played (the lock-screen loop).
    window.__mediaPlays = 0;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__mediaPlays++;
      return play.call(this);
    };
  });
});

const sheet = (page) => page.locator('#metroSheet');
const mini = (page) => page.locator('#metroMini');
const row = (page, p) => page.locator(`[data-page="${p}"] .mitem-val`);

/** Opens a sub-page from the main page of the sheet. */
async function goPage(page, p) {
  await page.click(`[data-page="${p}"]`);
  await expect(sheet(page).locator('h2')).not.toHaveText('Métronome');
}

/** Taps a step button `n` times. */
async function steps(page, dir, n) {
  for (let i = 0; i < n; i++) await page.click(`[data-step="${dir}"]`);
}

test('from a note: bars, tempo, start, mini-bar, back closes the sheet', async ({ page }) => {
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
  await expect(row(page, 'meter')).toHaveText('4/4');
  await expect(row(page, 'jazz')).toHaveText('Aucun');

  // Tap a bar: off, then on again at the same level.
  await page.click('[data-mbar="1"]');
  await expect(page.locator('[data-mbar="1"]')).toHaveClass(/off/);
  await page.click('[data-mbar="1"]');
  await expect(page.locator('[data-mbar="1"]')).toHaveAttribute('aria-label', 'Pulsation 2, niveau 3');
  await steps(page, 1, 5);
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

  // Android back: from a sub-page to the main page, then the sheet closes.
  await page.click('[data-m="open"]');
  await goPage(page, 'sound');
  await page.goBack();
  await expect(sheet(page).locator('h2')).toHaveText('Métronome');
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

test('time signature page: menus, groups, shortcuts, tempo unit', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await goPage(page, 'meter');
  await page.selectOption('[data-k="num"]', '15');
  await page.selectOption('[data-k="den"]', '16');
  await expect(page.locator('[data-mbar]')).toHaveCount(15);
  await expect(page.locator('[data-k="groups"]')).toHaveValue('4+4+4+3');
  await expect(page.locator('.mgap.cut')).toHaveCount(3);
  await expect(page.locator('[data-k="shortcut"]')).toHaveValue('');
  // Tap between pulses 2 and 3: the first group is split, then joined again.
  await page.click('[data-mcut="2"]');
  await expect(page.locator('[data-k="groups"]')).toHaveValue('2+2+4+4+3');
  await page.click('[data-mcut="2"]');
  await expect(page.locator('[data-k="groups"]')).toHaveValue('4+4+4+3');

  // Shortcut 6/8: two groups of 3, the tempo counts dotted quarters.
  await page.selectOption('[data-k="shortcut"]', { label: '6/8' });
  await expect(page.locator('[data-mbar]')).toHaveCount(6);
  await expect(page.locator('input[data-k="unit"][value="group"]')).toBeChecked();
  await page.click('[data-m="back"]');
  await expect(row(page, 'meter')).toHaveText('6/8');
  await expect(page.locator('.mt-unit')).toHaveText('♩. =');
  // The main page draws the group limits, without the split buttons.
  await expect(page.locator('[data-mcut]')).toHaveCount(0);
  await expect(page.locator('.mgap.cut')).toHaveCount(1);
  await goPage(page, 'subdiv');
  await expect(page.locator('[data-msub]')).toHaveCount(0); // no subdivision in /8
});

test('subdivision page: per-click bars and swing; jazz once per bar with silences 1 + 1', async ({
  page,
}) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await goPage(page, 'subdiv');
  await expect(page.locator('[data-msub]')).toHaveCount(5);
  await expect(page.locator('[data-k="swing"]')).toHaveCount(0);
  await page.click('[data-msub="16"]');
  await expect(page.locator('[data-msubbar]')).toHaveCount(12);
  await page.click('[data-msub="8"]');
  await page.locator('[data-k="swing"]').fill('67');
  await expect(page.locator('#mSwingVal')).toHaveText('ternaire');
  await page.click('[data-m="back"]');
  await expect(row(page, 'subdiv')).toHaveText('Croches · Swing ternaire');

  await goPage(page, 'jazz');
  await page.check('input[data-k="jazz"][value="once"]');
  await expect(page.locator('[data-k="twoBars"]')).toHaveCount(0); // now in Silences
  await page.click('[data-m="back"]');
  await expect(row(page, 'jazz')).toHaveText('1 fois par mesure');
  await goPage(page, 'gap');
  await page.check('input[data-k="gapMode"][value="bars"]');
  await page.selectOption('[data-k="gap.on"]', '1');
  await page.selectOption('[data-k="gap.off"]', '1');
  await page.click('[data-m="back"]');
  await expect(row(page, 'gap')).toHaveText('1 + 1');
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

test('jazz 2 and 4 only in even x/4; sound and options; settings survive a reload', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await goPage(page, 'jazz');
  await page.check('input[data-k="jazz"][value="24"]');
  await page.click('[data-m="back"]');
  await expect(page.locator('[data-mbar].off')).toHaveCount(2);
  await goPage(page, 'meter');
  await page.selectOption('[data-k="num"]', '3');
  await page.click('[data-m="back"]');
  await goPage(page, 'jazz');
  await expect(page.locator('input[data-k="jazz"][value="24"]')).toHaveCount(0);
  await page.click('[data-m="back"]');
  await goPage(page, 'meter');
  await page.selectOption('[data-k="num"]', '4');
  await page.click('[data-m="back"]');
  await goPage(page, 'jazz');
  await page.check('input[data-k="jazz"][value="24"]');
  await page.click('[data-m="back"]');
  await goPage(page, 'sound');
  await page.check('input[data-k="sound"][value="wood"]');
  await page.click('[data-m="back"]');
  await goPage(page, 'options');
  await page.check('input[data-k="flash"]');
  await page.click('[data-m="back"]');
  await expect(row(page, 'options')).toHaveText('Flash, Écran allumé');
  await steps(page, -1, 5);
  await page.reload();
  await page.click('[data-metro-open]');
  await expect(page.locator('#mTempoVal')).toHaveText('115');
  await expect(row(page, 'jazz')).toHaveText('2 et 4');
  await expect(row(page, 'sound')).toHaveText('Bois');
});

test('TAP button, tap on the number, drag on the number, hold +', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  const tap = page.locator('[data-m="tap"]');
  for (let i = 0; i < 4; i++) {
    await tap.dispatchEvent('pointerdown');
    if (i < 3) await page.waitForTimeout(500);
  }
  let bpm = Number(await page.locator('#mTempoVal').textContent());
  expect(bpm).toBeGreaterThan(105);
  expect(bpm).toBeLessThan(125);

  const box = await page.locator('#mTempo').boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Taps on the number: tap tempo (here about 75 BPM).
  await page.waitForTimeout(2100);
  for (let i = 0; i < 4; i++) {
    await page.mouse.click(x, y);
    if (i < 3) await page.waitForTimeout(800);
  }
  bpm = Number(await page.locator('#mTempoVal').textContent());
  expect(bpm).toBeGreaterThan(65);
  expect(bpm).toBeLessThan(80);
  // Drag up: faster.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#mTempoVal')).toHaveText(String(bpm + 10));
  // Hold +: one step, then steps of 5.
  const plus = page.locator('[data-step="1"]');
  const pb = await plus.boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  const after = Number(await page.locator('#mTempoVal').textContent());
  expect(after - (bpm + 10)).toBeGreaterThanOrEqual(6);
});

test('presets: save, load, rename, delete', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await steps(page, -1, 5);
  await goPage(page, 'jazz');
  await page.check('input[data-k="jazz"][value="24"]');
  await page.click('[data-m="back"]');
  await page.click('[data-m="presets"]');
  await expect(page.locator('.mpreset')).toHaveCount(0);
  await page.fill('#mpSave input', 'Donna Lee');
  await page.press('#mpSave input', 'Enter');
  await expect(page.locator('.mp-load span')).toHaveText('Donna Lee');
  await expect(page.locator('.mp-load small')).toHaveText('♩ 115 · 4/4 · 2 et 4');

  await page.click('[data-m="back"]');
  await steps(page, 1, 3);
  await page.click('[data-m="presets"]');
  await page.click('.mp-load');
  // Loading goes back to the main page.
  await expect(sheet(page).locator('h2')).toHaveText('Métronome');
  await expect(page.locator('#mTempoVal')).toHaveText('115');

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
    await expect(page.locator('[data-page="meter"] .mitem-lbl')).toHaveText('Time signature');
    await expect(page.locator('.metro-play')).toHaveText('▶ Start');
    await expect(page.locator('[data-m="tap"]')).toHaveText('TAP');
    await page.click('[data-m="presets"]');
    await expect(page.locator('#mpSave button')).toHaveText('Save');
  });
});

test('random silences: bars rendered ahead, chunk after chunk; lights in grey', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await steps(page, 1, 5); // 125
  await goPage(page, 'gap');
  await page.check('input[data-k="gapMode"][value="random"]');
  await page.selectOption('[data-k="gap.pct"]', '90');
  await page.click('[data-m="back"]');
  await expect(row(page, 'gap')).toHaveText('Hasard 90 %');
  await page.click('.metro-play');
  // 12 s ahead in chunks of about 4 s: several renders, none of them a loop.
  await expect.poll(() => page.evaluate(() => window.__renders.length)).toBeGreaterThan(2);
  await expect(page.locator('#mBeats.silent-bar')).toHaveCount(1, { timeout: 5000 });
  // A change while streaming: playback goes on (from the next bar line).
  await page.click('[data-mbar="0"]');
  await expect(page.locator('[data-mbar].on')).toHaveCount(1, { timeout: 4000 });
  await page.click('.metro-play');
  await expect(page.locator('.metro-play')).not.toHaveClass(/on/);
});

test('tempo ramp: the number follows, then the metronome stops at the end', async ({ page }) => {
  await openApp(page);
  await page.click('[data-metro-open]');
  await goPage(page, 'meter');
  await page.selectOption('[data-k="shortcut"]', { label: '2/4' });
  await page.click('[data-m="back"]');
  // 300 BPM: drag the number up.
  const box = await page.locator('#mTempo').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 6 * 180, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('#mTempoVal')).toHaveText('300');
  await goPage(page, 'ramp');
  await page.check('[data-k="rampOn"]');
  await page.selectOption('[data-k="ramp.to"]', '320');
  await page.selectOption('[data-k="ramp.step"]', '10');
  await page.selectOption('[data-k="ramp.every"]', '1');
  await page.selectOption('[data-k="ramp.end"]', 'stop');
  await expect(page.locator('.mhint').last()).toHaveText('300 → 320 en 3 mesures');
  await page.click('[data-m="back"]');
  await expect(row(page, 'ramp')).toHaveText('300 → 320');
  await expect(page.locator('.mramp')).toBeVisible();
  await page.click('.metro-play');
  await expect(page.locator('#mTempoVal')).toHaveText('320', { timeout: 4000 });
  // Three bars of 2/4 (about 1.2 s), then it stops; the tempo is back at the start.
  await expect(page.locator('.metro-play')).not.toHaveClass(/on/, { timeout: 5000 });
  await expect(page.locator('#mTempoVal')).toHaveText('300');
});

test('block button: tempo, time signature and swing of the block; Undo', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await newNoteWith(page, 'staff');
  await page.selectOption('.block.active [data-f="time"]', '6/8');
  await page.fill('.block.active [data-f="tempo"]', '90');
  await page.locator('.block.active [data-f="tempo"]').blur();
  await page.click('.block.active [data-metro-block]');
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('.mbanner span')).toHaveText('Réglé d’après le bloc');
  // 6/8 at ♩ = 90: ♩. = 60.
  await expect(page.locator('#mTempoVal')).toHaveText('60');
  await expect(row(page, 'meter')).toHaveText('6/8');
  await page.click('[data-m="undo"]');
  await expect(page.locator('.mbanner')).toHaveCount(0);
  await expect(page.locator('#mTempoVal')).toHaveText('120');
  await expect(row(page, 'meter')).toHaveText('4/4');
  await page.click('[data-m="close"]');

  // A Medium Swing chart: eighths at 67 %.
  await page.click('[data-add=grid]');
  await page.locator('.block.active [data-metro-block]').click();
  await expect(page.locator('#mTempoVal')).toHaveText('120');
  await expect(row(page, 'subdiv')).toHaveText('Croches · Swing ternaire');
  expect(errors).toEqual([]);
});

test('save to the note, loaded when opened from that note again', async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'text');
  await page.fill('#titleIn', 'Gammes');
  await page.click('[data-metro-open]');
  await expect(page.locator('[data-m="noteSave"]')).toHaveText('Enregistrer dans la note');
  await steps(page, 1, 5); // 125
  await page.click('[data-m="noteSave"]');
  await expect(page.locator('.mnote-ok')).toHaveText('✓ Enregistré dans la note');
  await steps(page, 1, 1);
  await expect(page.locator('[data-m="noteSave"]')).toHaveText('Mettre à jour la note');
  await steps(page, -1, 1);
  await expect(page.locator('.mnote-ok')).toBeVisible();
  await page.click('[data-m="close"]');
  await page.goBack(); // home
  await page.locator('#newNote').waitFor();
  // Elsewhere, another tempo; no note, no save button.
  await page.click('[data-metro-open]');
  await expect(page.locator('.mnote')).toHaveCount(0);
  await steps(page, -1, 35); // 90
  await page.click('[data-m="close"]');
  // Back in the note: its settings come back.
  await page.locator('.card', { hasText: 'Gammes' }).click();
  await page.click('[data-metro-open]');
  await expect(page.locator('.mbanner span')).toHaveText('Réglé d’après la note');
  await expect(page.locator('#mTempoVal')).toHaveText('125');
  await page.click('[data-m="undo"]');
  await expect(page.locator('#mTempoVal')).toHaveText('90');
  await expect
    .poll(async () => (await storedNotes(page)).notes.find((n) => n.title === 'Gammes').metro.tempo)
    .toBe(125);
  // Remove it from the note.
  await page.click('[data-m="noteForget"]');
  await page.click('[data-m="noteForget"]'); // confirm
  await expect(page.locator('[data-m="noteSave"]')).toHaveText('Enregistrer dans la note');
});

test('polyrhythm: 3 over 2 bars, its lights, a longer cycle; lock-screen loop', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await page.click('[data-metro-open]');
  await expect(row(page, 'poly')).toHaveText('Aucun');
  await goPage(page, 'poly');
  await page.check('[data-k="polyOn"]');
  await page.selectOption('[data-k="poly.bars"]', '2');
  await expect(page.locator('[data-mpolybar]')).toHaveCount(3);
  await page.selectOption('[data-k="poly.n"]', '5');
  await expect(page.locator('[data-mpolybar]')).toHaveCount(5);
  await page.click('[data-mpolybar="1"]');
  await expect(page.locator('[data-mpolybar="1"]')).toHaveClass(/off/);
  await expect(page.locator('.mhint').last()).toContainText('5:8');
  await page.click('[data-m="back"]');
  await expect(row(page, 'poly')).toHaveText('5:8');
  await expect(page.locator('#mPoly .mpoly-dot')).toHaveCount(5);
  await page.click('.metro-play');
  await expect(page.locator('#mPoly .mpoly-dot.on')).toHaveCount(1, { timeout: 3000 });
  // Two bars of 4/4 at 120 (4 s), plus the tail.
  await expect
    .poll(() => page.evaluate(() => window.__renders.some((d) => Math.abs(d - 4.4) < 0.01)))
    .toBe(true);
  expect(await page.evaluate(() => window.__mediaPlays)).toBeGreaterThan(0);
  await page.click('.metro-play');
  expect(errors).toEqual([]);
});
