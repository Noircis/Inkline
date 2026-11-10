// Entraînement › Placements et exercices aléatoires : sections, mesures, métronome, navigation.
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

test('sections : une par départ, seule la première est dépliée', async ({ page }) => {
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
  await expect(page.locator('.drill-staff svg')).toHaveCount(1); // les autres ne sont pas dessinées
  await page.click('[data-tog=drill2]');
  await expect(page.locator('.drill-staff:visible')).toHaveCount(2);
  await page.click('#foldAll');
  await expect(page.locator('.drill-staff:visible')).toHaveCount(7);
  await expect(page.locator('#foldAll')).toHaveText('Tout replier');
  await page.click('#foldAll');
  await expect(page.locator('.drill-staff:visible')).toHaveCount(0);
});

test('mesures : 7/8 en 2+2+3, trois temps au métronome, mémorisé', async ({ page }) => {
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

test('métronome : temps choisis, décompte, rythme coupé', async ({ page }) => {
  await page.click('[data-n="2"]');
  await page.click('[data-beat="0"]'); // il reste 2 et 4
  await page.click('[data-beat="2"]');
  await page.fill('#drillTempo', '300');
  await page.locator('#drillTempo').blur();
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill0]');
  await expect(page.locator('[data-play=drill0].on')).toHaveCount(1);
  await expect(page.locator('[data-play=drill0].on')).toHaveCount(0, { timeout: 10_000 });
  let osc = await page.evaluate(() => window.__osc);
  // Série de 7 mesures à 2 notes : 4 clics de décompte + 7 × 2 clics ; 14 notes.
  expect(osc.filter((t) => t === 'triangle')).toHaveLength(18);
  expect(osc.filter((t) => t === 'sine')).toHaveLength(14);

  await page.click('[data-opt=mute]');
  await page.click('[data-opt=countIn]');
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill6]'); // repliée : la lecture la déplie
  await expect(page.locator('[data-drill=drill6]')).toBeVisible();
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

test('6/8 : deux clics par mesure', async ({ page }) => {
  await page.click('[data-meter="6/8"]');
  await page.click('[data-n="6"]'); // une seule mesure : 6 croches
  await page.fill('#drillTempo', '300');
  await page.locator('#drillTempo').blur();
  await page.evaluate(() => (window.__osc = []));
  await page.click('[data-play=drill0]');
  await expect(page.locator('[data-play=drill0].on')).toHaveCount(0, { timeout: 10_000 });
  const osc = await page.evaluate(() => window.__osc);
  // Décompte 2 clics + 2 clics ; 6 notes.
  expect(osc.filter((t) => t === 'triangle')).toHaveLength(4);
  expect(osc.filter((t) => t === 'sine')).toHaveLength(6);
});

test.describe('exercices aléatoires', () => {
  test.beforeEach(async ({ page }) => {
    await page.goBack();
    await page.click('#goExercises');
  });

  test('réglages, génération, même numéro après retour, nouveau tirage', async ({ page }) => {
    await page.click('[data-meter="5/8:3+2"]');
    await page.click('[data-len="2"]');
    await page.click('[data-step=max][data-d="1"]'); // 2 à 4
    await expect(page.locator('#v_max')).toHaveText('4');
    await expect(page.locator('[data-start]')).toHaveCount(5);
    // Décocher toutes les positions : la dernière reste, avec un message.
    for (const p of [0, 1, 2, 3, 4]) await page.click(`[data-start="${p}"]`);
    await expect(page.locator('#startsHint')).toBeVisible();
    await expect(page.locator('[data-start="4"]')).toHaveAttribute('aria-pressed', 'true');
    // Départ sur la dernière croche seulement : une seule mesure possible, le message le dit.
    await expect(page.locator('#fewHint')).toContainText('une seule mesure');
    await page.click('#genGo');
    await expect(page.locator('.gen-info')).toHaveText('5/8 (3+2) · 2 mesures · 2 à 4 notes par mesure');
    const title = await page.locator('.top-title').textContent();
    expect(title).toMatch(/^Exercice n° \d+$/);
    const staff = () => page.locator('#genStaff').innerHTML();
    await expect(page.locator('#genStaff svg')).toHaveCount(1); // dessinée après la mise en page
    const svg = await staff();
    // Retour aux réglages puis de nouveau en avant : le même exercice.
    await page.goBack();
    await expect(page.locator('#genGo')).toBeVisible();
    await page.goForward();
    await expect(page.locator('.top-title')).toHaveText(title);
    await expect.poll(staff).toBe(svg);
    // ↻ : un autre numéro.
    await page.click('#reroll');
    await expect(page.locator('.top-title')).not.toHaveText(title);
    // (Ici une seule mesure est possible : la portée peut rester identique.)
  });

  test('lecture en boucle : le métronome continue après la fin', async ({ page }) => {
    await page.click('[data-len="4"]');
    await page.click('#genGo');
    await page.fill('#drillTempo', '300');
    await page.locator('#drillTempo').blur();
    await page.click('[data-opt=loop]');
    await page.click('#metroBtn');
    await page.click('[data-opt=countIn]'); // pas de décompte
    await page.evaluate(() => (window.__osc = []));
    await page.click('[data-play=gen]');
    // 4 mesures à 300 = 3,2 s ; on attend un peu plus d'un passage.
    await expect(page.locator('#genStaff g.it.play')).toHaveCount(1); // surlignage de la note jouée
    await page.waitForTimeout(4500);
    await expect(page.locator('[data-play=gen].on')).toHaveCount(1);
    const clicks = (await page.evaluate(() => window.__osc)).filter((t) => t === 'triangle').length;
    expect(clicks).toBeGreaterThan(16);
    await page.click('[data-play=gen]');
    await expect(page.locator('[data-play=gen].on')).toHaveCount(0);
  });

  test('réglages trop serrés : un message prévient', async ({ page }) => {
    await page.click('[data-meter="4/4"]');
    await page.click('[data-len="4"]');
    await page.click('[data-step=min][data-d="-1"]');
    await page.click('[data-step=min][data-d="-1"]');
    await page.click('[data-step=max][data-d="-1"]');
    await page.click('[data-step=max][data-d="-1"]'); // 1 note
    for (const p of [1, 2, 3, 4, 5, 6, 7]) await page.click(`[data-start="${p}"]`); // départ sur 1 seulement
    await expect(page.locator('#fewHint')).toHaveText(
      'Ces réglages ne donnent qu’une seule mesure possible : elle sera répétée.',
    );
    await page.click('[data-len="1"]');
    await expect(page.locator('#fewHint')).toBeHidden();
  });
});
