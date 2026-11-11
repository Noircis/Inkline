// Practice › Placements and random exercises: sections, time signatures, metronome, navigation.
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test.beforeEach(async ({ context, page }) => {
  // Spy: counts the scheduled sounds (triangle = metronome, sine = rhythm).
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

test('sections: one per start, only the first is expanded', async ({ page }) => {
  await expect(page.locator('#drillCount')).toHaveText('8 mesures');
  await expect(page.locator('.drill')).toHaveCount(1);
  await expect(page.locator('.drill-all')).toHaveText('Toutes les positions');
  await page.click('[data-n="2"]');
  await expect(page.locator('#drillCount')).toHaveText('28 mesures · 7 départs');
  await expect(page.locator('.drill-sub')).toHaveText([
    '7 mesures',
    '6 mesures',
    '5 mesures',
    '4 mesures',
    '3 mesures',
    '2 mesures',
    '1 mesure',
  ]);
  await expect(page.locator('.drill .sr').nth(3)).toHaveText('Départ sur 2 et');
  await expect(page.locator('.drill-staff:visible')).toHaveCount(1);
  await expect(page.locator('.drill-staff svg')).toHaveCount(1); // the others are not drawn
  await page.click('[data-tog=drill2]');
  await expect(page.locator('.drill-staff:visible')).toHaveCount(2);
  await page.click('#foldAll');
  await expect(page.locator('.drill-staff:visible')).toHaveCount(7);
  await expect(page.locator('#foldAll')).toHaveText('Tout replier');
  await page.click('#foldAll');
  await expect(page.locator('.drill-staff:visible')).toHaveCount(0);
});

test('time signatures: 7/8 as 2+2+3, three metronome beats, remembered', async ({ page }) => {
  await page.click('[data-meter="7/8:2+2+3"]');
  await expect(page.locator('[data-meter="7/8:2+2+3"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-n]')).toHaveCount(7);
  await expect(page.locator('[data-beat]')).toHaveCount(3);
  await expect(page.locator('[data-opt=swing]')).toBeDisabled();
  await expect(page.locator('#drillCount')).toHaveText('7 mesures');
  await page.reload();
  await page.click('#trainBtn');
  await page.click('#goPlacements');
  await expect(page.locator('[data-beat]')).toHaveCount(3);
});

test('metronome: chosen beats, count-in, muted rhythm', async ({ page }) => {
  await page.click('[data-n="2"]');
  await page.click('[data-beat="0"]'); // 2 and 4 remain
  await page.click('[data-beat="2"]');
  await page.fill('#drillTempo', '300');
  await page.locator('#drillTempo').blur();
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill0]');
  await expect(page.locator('[data-play=drill0].on')).toHaveCount(1);
  await expect(page.locator('[data-play=drill0].on')).toHaveCount(0, { timeout: 10_000 });
  let osc = await page.evaluate(() => window.__osc);
  // Series of 7 measures with 2 notes: 4 count-in clicks + 7 × 2 clicks; 14 notes.
  expect(osc.filter((t) => t === 'triangle')).toHaveLength(18);
  expect(osc.filter((t) => t === 'sine')).toHaveLength(14);

  await page.click('[data-opt=mute]');
  await page.click('[data-opt=countIn]');
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill6]'); // collapsed: playback expands it
  await expect(page.locator('[data-drill=drill6]')).toBeVisible();
  await expect(page.locator('[data-play=drill6].on')).toHaveCount(0, { timeout: 10_000 });
  osc = await page.evaluate(() => window.__osc);
  expect(osc.filter((t) => t === 'triangle')).toHaveLength(2);
  expect(osc.filter((t) => t === 'sine')).toHaveLength(0);
});

test('back button: Placements → Practice → home', async ({ page }) => {
  await page.goBack();
  await expect(page.locator('#goPlacements')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#newNote')).toBeVisible();
});

test('6/8: two clicks per measure', async ({ page }) => {
  await page.click('[data-meter="6/8"]');
  await page.click('[data-n="6"]'); // a single measure: 6 eighths
  await page.fill('#drillTempo', '300');
  await page.locator('#drillTempo').blur();
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill0]');
  await expect(page.locator('[data-play=drill0].on')).toHaveCount(0, { timeout: 10_000 });
  const osc = await page.evaluate(() => window.__osc);
  // Count-in 2 clicks + 2 clicks; 6 notes.
  expect(osc.filter((t) => t === 'triangle')).toHaveLength(4);
  expect(osc.filter((t) => t === 'sine')).toHaveLength(6);
});

test.describe('random exercises', () => {
  test.beforeEach(async ({ page }) => {
    await page.goBack();
    await page.click('#goExercises');
  });

  test('settings, generation, same number after going back, new draw', async ({ page }) => {
    await page.click('[data-meter="5/8:3+2"]');
    await page.click('[data-len="2"]');
    await page.click('[data-step=max][data-d="1"]'); // 2 to 4
    await expect(page.locator('#v_max')).toHaveText('4');
    await expect(page.locator('[data-start]')).toHaveCount(5);
    // Unchecking every position: the last one stays, with a message.
    for (const p of [0, 1, 2, 3, 4]) await page.click(`[data-start="${p}"]`);
    await expect(page.locator('#startsHint')).toBeVisible();
    await expect(page.locator('[data-start="4"]')).toHaveAttribute('aria-pressed', 'true');
    // Start on the last eighth only: a single possible measure, the message says so.
    await expect(page.locator('#fewHint')).toContainText('une seule mesure');
    await page.click('#genGo');
    await expect(page.locator('.gen-info')).toHaveText('5/8 (3+2) · 2 mesures · 2 à 4 notes par mesure');
    const title = await page.locator('.top-title').textContent();
    expect(title).toMatch(/^Exercice n° \d+$/);
    const staff = () => page.locator('#genStaff').innerHTML();
    await expect(page.locator('#genStaff svg')).toHaveCount(1); // drawn after layout
    const svg = await staff();
    // Back to the settings then forward again: the same exercise.
    await page.goBack();
    await expect(page.locator('#genGo')).toBeVisible();
    await page.goForward();
    await expect(page.locator('.top-title')).toHaveText(title);
    await expect.poll(staff).toBe(svg);
    // ↻: another number.
    await page.click('#reroll');
    await expect(page.locator('.top-title')).not.toHaveText(title);
    // (Here only one measure is possible: the staff may stay identical.)
  });

  test('loop playback: the metronome keeps going after the end', async ({ page }) => {
    await page.click('[data-len="4"]');
    await page.click('#genGo');
    await page.fill('#drillTempo', '300');
    await page.locator('#drillTempo').blur();
    await page.click('[data-opt=loop]');
    await page.click('#metroBtn');
    await page.click('[data-opt=countIn]'); // no count-in
    await page.evaluate(() => (window.__osc = []));
    await page.click('[data-play=gen]');
    // 4 measures at 300 = 3.2 s; wait a little more than one pass.
    await expect(page.locator('#genStaff g.it.play')).toHaveCount(1); // highlight of the played note
    await page.waitForTimeout(4500);
    await expect(page.locator('[data-play=gen].on')).toHaveCount(1);
    const clicks = (await page.evaluate(() => window.__osc)).filter((t) => t === 'triangle').length;
    expect(clicks).toBeGreaterThan(16);
    await page.click('[data-play=gen]');
    await expect(page.locator('[data-play=gen].on')).toHaveCount(0);
  });

  test('settings too narrow: a message warns', async ({ page }) => {
    await page.click('[data-meter="4/4"]');
    await page.click('[data-len="4"]');
    await page.click('[data-step=min][data-d="-1"]');
    await page.click('[data-step=min][data-d="-1"]');
    await page.click('[data-step=max][data-d="-1"]');
    await page.click('[data-step=max][data-d="-1"]'); // 1 note
    for (const p of [1, 2, 3, 4, 5, 6, 7]) await page.click(`[data-start="${p}"]`); // start on 1 only
    await expect(page.locator('#fewHint')).toHaveText(
      'Ces réglages ne donnent qu’une seule mesure possible : elle sera répétée.',
    );
    await page.click('[data-len="1"]');
    await expect(page.locator('#fewHint')).toBeHidden();
  });
});
