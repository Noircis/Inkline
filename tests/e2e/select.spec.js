// Sélection de mesures à l'appui long (2.8.4) : portées, grilles, entraînement.
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, collectErrors } from './helpers.js';

/** Remplit la portée active : 4 mesures de rondes, tempo rapide. */
async function fillStaff(page) {
  await page.evaluate(async () => {
    const { state, blockById } = await import('/js/ui/state.js');
    const { hooks } = await import('/js/ui/staff/shared.js');
    const b = blockById(state.activeId);
    b.tempo = 300;
    b.items = [0, 1, 2, 3].map((s) => ({ d: 'w', s }));
    hooks.redraw(b.id);
  });
}

/** Centre écran de la mesure `k` de la portée active (mise en page de l'appli). */
async function measurePoint(page, k) {
  return page.evaluate(async (k) => {
    const { state, blockById } = await import('/js/ui/state.js');
    const { layout, geom } = await import('/js/layout.js');
    const b = blockById(state.activeId);
    const wrap = document.querySelector(`[data-staff="${b.id}"]`);
    const r = wrap.querySelector('svg').getBoundingClientRect();
    const write = state.mode === 'write';
    const L = layout(b, wrap._W, write, write ? state.cursor : null);
    const m = L.mrects[k];
    return { x: r.left + (m.x0 + m.x1) / 2, y: r.top + geom(L, m.sys).staffTop + 20 };
  }, k);
}

/** Appui long (souris) en `a`, puis glisser jusqu'à `b` éventuellement. */
async function longPress(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  if (b) await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

/** Lecture en cours pour cet identifiant ? */
const playing = (page, id) => page.evaluate(async (id) => (await import('/js/audio.js')).isPlaying(id), id);
const activeId = (page) => page.evaluate(async () => (await import('/js/ui/state.js')).state.activeId);

/** Enregistre les index joués (surlignage) pendant la lecture. */
const spySteps = (page) =>
  page.evaluate(async () => {
    const { state } = await import('/js/ui/state.js');
    window.__steps = [];
    clearInterval(window.__spy);
    window.__spy = setInterval(() => {
      const i = state.playIdx;
      if (i != null && window.__steps[window.__steps.length - 1] !== i) window.__steps.push(i);
    }, 20);
  });

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('portée : appui long → cadre et « Jouer d’ici », sans écrire de note', async ({ page }) => {
  const errors = collectErrors(page);
  await newNoteWith(page, 'staff');
  await fillStaff(page);
  const id = await activeId(page);
  await longPress(page, await measurePoint(page, 1));
  await expect(page.locator('.msel-box')).toHaveCount(1);
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('▶ Jouer d’ici');
  const st = await page.evaluate(async () => {
    const { state, blockById } = await import('/js/ui/state.js');
    return { n: blockById(state.activeId).items.length, cursor: state.cursor };
  });
  expect(st).toEqual({ n: 4, cursor: null }); // l'appui long n'a rien écrit
  await spySteps(page);
  await page.click('.msel-bar [data-msel=go]');
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('■ Stop');
  expect(await playing(page, id)).toBe(true);
  // Décompte (0,8 s) puis mesures 2 à 4 (2,4 s).
  await expect.poll(() => playing(page, id), { timeout: 8000 }).toBe(false);
  expect(await page.evaluate(() => window.__steps)).toEqual([1, 2, 3]);
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('▶ Jouer d’ici');
  expect(errors).toEqual([]);
});

test('portée : glisser étend la sélection, « Boucle » rejoue le passage', async ({ page }) => {
  await newNoteWith(page, 'staff');
  await fillStaff(page);
  const id = await activeId(page);
  // De la mesure 3 vers la 2 (sens inverse) : sélection 2 à 3.
  await longPress(page, await measurePoint(page, 2), await measurePoint(page, 1));
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('🔁 Boucle');
  await spySteps(page);
  await page.click('.msel-bar [data-msel=go]');
  // Décompte + 2 passages de 1,6 s : la boucle tourne toujours.
  await page.waitForTimeout(4600);
  expect(await playing(page, id)).toBe(true);
  const steps = await page.evaluate(() => window.__steps);
  expect(steps.slice(0, 4)).toEqual([1, 2, 1, 2]);
  // Toucher ailleurs : sélection effacée, lecture arrêtée.
  await page.mouse.click(5, 5);
  await expect(page.locator('.msel-box')).toHaveCount(0);
  await expect(page.locator('.msel-bar')).toBeHidden();
  expect(await playing(page, id)).toBe(false);
});

test('portée : ✕ efface ; un toucher simple marche comme avant', async ({ page }) => {
  await newNoteWith(page, 'staff');
  await fillStaff(page);
  await longPress(page, await measurePoint(page, 0));
  await page.click('.msel-bar [data-msel=close]');
  await expect(page.locator('.msel-box')).toHaveCount(0);
  // Toucher simple sur une note : le curseur s'y place (comportement 2.8).
  const p = await measurePoint(page, 2);
  await page.mouse.click(p.x, p.y);
  expect(await page.evaluate(async () => (await import('/js/ui/state.js')).state.cursor)).toBe(2);
  await expect(page.locator('.msel-box')).toHaveCount(0);
});

test('grille : appui long sans ouvrir la saisie, boucle sur 3 mesures', async ({ page }) => {
  await newNoteWith(page, 'grid');
  const id = await page.evaluate(async () => {
    const { state, blockById } = await import('/js/ui/state.js');
    const { redrawGrid } = await import('/js/ui/grid-ui.js');
    const b = blockById(state.activeId);
    b.tempo = 300;
    b.measures = ['C', 'F', 'G', 'C'].map((c) => ({ ch: [c] }));
    state.sel = null;
    redrawGrid(b.id);
    return b.id;
  });
  const center = async (k) => {
    const r = await page.locator(`[data-grid] [data-gm="${k}"]`).boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  await longPress(page, await center(1), await center(3));
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('🔁 Boucle');
  // La case n'a pas été sélectionnée pour la saisie.
  expect(await page.evaluate(async () => (await import('/js/ui/state.js')).state.sel)).toBe(null);
  await spySteps(page);
  await page.click('.msel-bar [data-msel=go]');
  await page.waitForTimeout(3800); // décompte 0,8 s + passage 2,4 s
  expect(await playing(page, id)).toBe(true);
  expect((await page.evaluate(() => window.__steps)).slice(0, 4)).toEqual([1, 2, 3, 1]);
  await page.click('.msel-bar [data-msel=go]'); // Stop
  expect(await playing(page, id)).toBe(false);
});

test('entraînement : appui long sur une mesure d’une série', async ({ page }) => {
  await page.click('#trainBtn');
  await page.click('#goPlacements');
  await page.locator('[data-drill=drill0] svg').waitFor();
  const p = await page.evaluate(async () => {
    const el = document.querySelector('[data-drill=drill0]');
    const { layout, geom } = await import('/js/layout.js');
    const { placementSeries, seriesBlock } = await import('/js/placements.js');
    const b = seriesBlock(placementSeries(1)[0], { tempo: 80, swing: false }, 'x');
    const L = layout(b, el._W, false, null);
    const r = el.querySelector('svg').getBoundingClientRect();
    const m = L.mrects[2];
    return { x: r.left + (m.x0 + m.x1) / 2, y: r.top + geom(L, m.sys).staffTop };
  });
  await longPress(page, p);
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('▶ Jouer d’ici');
  await page.click('.msel-bar [data-msel=go]');
  expect(await playing(page, 'drill0')).toBe(true);
  await page.click('.msel-bar [data-msel=go]');
  expect(await playing(page, 'drill0')).toBe(false);
});

test('au doigt : appui long puis glisser sélectionne sans faire défiler la page', async ({ page }) => {
  await newNoteWith(page, 'staff');
  await fillStaff(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await page.evaluate(() => {
    document.body.style.paddingBottom = '2000px';
    window.scrollTo(0, 0);
  });
  const a = await measurePoint(page, 0);
  const b = await measurePoint(page, 2);
  const touch = (type, p) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await touch('touchStart', a);
  await page.waitForTimeout(600);
  for (let k = 1; k <= 8; k++)
    await touch('touchMove', { x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 });
  await touch('touchEnd');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.evaluate(async () => (await import('/js/ui/measure-select.js')).measureSelection()),
  ).toEqual({ a: 0, b: 2 });
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('🔁 Boucle');
  // Un glisser rapide (sans appui long) fait toujours défiler la page.
  const x = await page.locator('.msel-bar [data-msel=close]').boundingBox();
  await touch('touchStart', { x: x.x + 10, y: x.y + 10 });
  await touch('touchEnd');
  await expect(page.locator('.msel-box')).toHaveCount(0);
  await touch('touchStart', b);
  for (let k = 1; k <= 8; k++) await touch('touchMove', { x: b.x, y: b.y - 25 * k });
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  expect(await page.evaluate(async () => (await import('/js/ui/measure-select.js')).measureSelection())).toBe(
    null,
  );
});
