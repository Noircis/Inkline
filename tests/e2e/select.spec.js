// Measure selection by long press (2.8.4): staves, charts, practice.
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, collectErrors } from './helpers.js';

/** Fills the active staff: 4 measures of whole notes, fast tempo. */
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

/** Screen center of measure `k` of the active staff (app layout). */
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

/** Long press (mouse) at `a`, then optionally drag to `b`. */
async function longPress(page, a, b) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  if (b) await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

/** Playback running for this id? */
const playing = (page, id) => page.evaluate(async (id) => (await import('/js/audio.js')).isPlaying(id), id);
const activeId = (page) => page.evaluate(async () => (await import('/js/ui/state.js')).state.activeId);

/** Records the indices played (highlight) during playback. */
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

test('staff: long press → frame and "Play from here", without writing a note', async ({ page }) => {
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
  expect(st).toEqual({ n: 4, cursor: null }); // the long press wrote nothing
  await spySteps(page);
  await page.click('.msel-bar [data-msel=go]');
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('■ Stop');
  expect(await playing(page, id)).toBe(true);
  // Count-in (0.8 s) then measures 2 to 4 (2.4 s).
  await expect.poll(() => playing(page, id), { timeout: 8000 }).toBe(false);
  expect(await page.evaluate(() => window.__steps)).toEqual([1, 2, 3]);
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('▶ Jouer d’ici');
  expect(errors).toEqual([]);
});

test('staff: dragging extends the selection, "Loop" replays the passage', async ({ page }) => {
  await newNoteWith(page, 'staff');
  await fillStaff(page);
  const id = await activeId(page);
  // From measure 3 to 2 (reverse direction): selection 2 to 3.
  await longPress(page, await measurePoint(page, 2), await measurePoint(page, 1));
  await expect(page.locator('.msel-bar [data-msel=go]')).toHaveText('🔁 Boucle');
  await spySteps(page);
  await page.click('.msel-bar [data-msel=go]');
  // Count-in + 2 passes of 1.6 s: the loop is still running.
  await page.waitForTimeout(4600);
  expect(await playing(page, id)).toBe(true);
  const steps = await page.evaluate(() => window.__steps);
  expect(steps.slice(0, 4)).toEqual([1, 2, 1, 2]);
  // Tap elsewhere: selection cleared, playback stopped.
  await page.mouse.click(5, 5);
  await expect(page.locator('.msel-box')).toHaveCount(0);
  await expect(page.locator('.msel-bar')).toBeHidden();
  expect(await playing(page, id)).toBe(false);
});

test('staff: ✕ clears; a simple tap works as before', async ({ page }) => {
  await newNoteWith(page, 'staff');
  await fillStaff(page);
  await longPress(page, await measurePoint(page, 0));
  await page.click('.msel-bar [data-msel=close]');
  await expect(page.locator('.msel-box')).toHaveCount(0);
  // Simple tap on a note: the cursor goes there (2.8 behavior).
  const p = await measurePoint(page, 2);
  await page.mouse.click(p.x, p.y);
  expect(await page.evaluate(async () => (await import('/js/ui/state.js')).state.cursor)).toBe(2);
  await expect(page.locator('.msel-box')).toHaveCount(0);
});

test('chart: long press without opening input, loop over 3 measures', async ({ page }) => {
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
  // The cell was not selected for input.
  expect(await page.evaluate(async () => (await import('/js/ui/state.js')).state.sel)).toBe(null);
  await spySteps(page);
  await page.click('.msel-bar [data-msel=go]');
  await page.waitForTimeout(3800); // count-in 0.8 s + pass 2.4 s
  expect(await playing(page, id)).toBe(true);
  expect((await page.evaluate(() => window.__steps)).slice(0, 4)).toEqual([1, 2, 3, 1]);
  await page.click('.msel-bar [data-msel=go]'); // Stop
  expect(await playing(page, id)).toBe(false);
});

test('practice: long press on a measure of a series', async ({ page }) => {
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

test('by finger: long press then drag selects without scrolling the page', async ({ page }) => {
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
  // A quick drag (no long press) still scrolls the page.
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
