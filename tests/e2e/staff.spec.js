// Input on a staff: Write / Edit modes, insertion, fitting into measures, key signature.
import { test, expect } from '@playwright/test';
import {
  openApp,
  newNoteWith,
  tapStaff,
  dragStaff,
  staffPoint,
  pal,
  staffState,
  collectErrors,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'staff');
});

test('Write mode: append, cursor, insertion in the middle, backspace', async ({ page }) => {
  const errors = collectErrors(page);
  for (const s of [4, 5, 6, 7]) await tapStaff(page, { t: 'append', s });
  expect((await staffState(page)).items).toBe('q q q q');

  await tapStaff(page, { t: 'item', i: 1 }); // places the cursor, changes nothing
  let st = await staffState(page);
  expect(st.cursor).toBe(1);
  expect(st.info).toContain('Insertion avant la note 2');

  await pal(page, '[data-dur="8"]'); // sets the input, changes no note
  expect((await staffState(page)).items).toBe('q q q q');

  await tapStaff(page, { t: 'insert', s: 2 });
  st = await staffState(page);
  expect(st.items).toBe('q 8 q q 8~+ 8'); // the last quarter overflows: split at the barline
  expect(st.cursor).toBe(2);

  await pal(page, '[data-act=del]'); // erases the note before the cursor
  expect((await staffState(page)).items).toBe('q q q q');
  expect(errors).toEqual([]);
});

test('Edit mode: compensation with rests, round trip', async ({ page }) => {
  for (const s of [4, 5, 6]) await tapStaff(page, { t: 'append', s });
  await page.click('[data-mode=edit]');
  await tapStaff(page, { t: 'item', i: 0 });
  await pal(page, '[data-dur="8"]');
  expect((await staffState(page)).items).toBe('8 r8 q q');
  await pal(page, '[data-dur="q"]');
  expect((await staffState(page)).items).toBe('q q q');
});

test('automatic tie at barlines: quarter, quarter, whole', async ({ page }) => {
  await tapStaff(page, { t: 'append', s: 4 });
  await tapStaff(page, { t: 'append', s: 5 });
  await pal(page, '[data-dur="w"]');
  await tapStaff(page, { t: 'append', s: 6 });
  expect((await staffState(page)).items).toBe('q q h~+ h');

  // A split note is selected and changed as a whole.
  await page.click('[data-mode=edit]');
  await tapStaff(page, { t: 'item', i: 3, s: 6 });
  expect((await staffState(page)).sel).toBe(2);
  await pal(page, '[data-dur="h"]');
  expect((await staffState(page)).items).toBe('q q h rh');

  // Changing the time signature re-splits everything.
  await page.selectOption('[data-f=time]', '3/4');
  expect((await staffState(page)).items).toBe('q q q~+ q rh');
});

test('bug 2.6.0: toggling the dot repeatedly does not grow the duration', async ({ page }) => {
  await pal(page, '[data-dur="16"]');
  await tapStaff(page, { t: 'append', s: 4 });
  await pal(page, '[data-dur="q"]');
  await tapStaff(page, { t: 'append', s: 5 });
  await page.click('[data-mode=edit]');
  await tapStaff(page, { t: 'item', i: 0 });
  const totals = new Set();
  for (let k = 0; k < 10; k++) {
    await pal(page, '[data-act=dot]');
    totals.add((await staffState(page)).total);
  }
  expect([...totals].sort()).toEqual([1.25, 1.375]);
});

test('a triplet cannot cross the barline', async ({ page }) => {
  await pal(page, '[data-dur="h"]');
  await tapStaff(page, { t: 'append', s: 4 });
  await pal(page, '[data-dur="8"]');
  await tapStaff(page, { t: 'append', s: 4 }); // 2.5 beats: the triplets no longer fit
  await pal(page, '[data-act=tup]');
  for (let k = 0; k < 5; k++) await tapStaff(page, { t: 'append', s: 4 });
  const st = await staffState(page);
  expect(st.items).toBe('h 8 8³ 8³ 8³ 8³'); // the 5th (from 3.83 to 4.17) is refused
  expect(st.info).toContain('triolet ne peut pas passer la barre');
});

test('key signature: drawn, and the selected note takes it into account', async ({ page }) => {
  await tapStaff(page, { t: 'append', s: 1 }); // F4
  await page.selectOption('[data-f=ks]', '1');
  await expect(page.locator('[data-staff] svg path')).not.toHaveCount(0);
  await page.click('[data-mode=edit]');
  await tapStaff(page, { t: 'item', i: 0, s: 1 });
  expect((await staffState(page)).info).toContain('Fa♯ 4');
});

test('data survives a reload (automatic ties included)', async ({ page }) => {
  await tapStaff(page, { t: 'append', s: 4 });
  await tapStaff(page, { t: 'append', s: 5 });
  await pal(page, '[data-dur="w"]');
  await tapStaff(page, { t: 'append', s: 6 });
  await page.waitForTimeout(400); // deferred write
  await page.reload();
  await page.locator('.card').first().click();
  await page.locator('.block.staff .staff-wrap').click({ position: { x: 5, y: 5 } });
  expect((await staffState(page)).items).toBe('q q h~+ h');
});

test('drag in Write mode: the note follows the finger, name shown, a single undo', async ({ page }) => {
  const errors = collectErrors(page);
  await dragStaff(page, { t: 'append', s: 4 }, [6, 9, 11], async () => {
    await expect(page.locator('.pitch-tip')).toBeVisible();
    await expect(page.locator('.pitch-tip')).toHaveText('Si 5'); // s = 11 in treble clef
  });
  await expect(page.locator('.pitch-tip')).toBeHidden();
  let st = await staffState(page);
  expect(st.items).toBe('q');
  expect(st.steps).toEqual([11]);
  // A simple tap still places a note (no drag).
  await tapStaff(page, { t: 'append', s: 2 });
  expect((await staffState(page)).steps).toEqual([11, 2]);
  await pal(page, '[data-act=undo]');
  await pal(page, '[data-act=undo]'); // the whole first gesture counts only once
  st = await staffState(page);
  expect(st.items).toBe('');
  expect(errors).toEqual([]);
});

test('drag in Edit mode: only the selected note; higher than the high E', async ({ page }) => {
  for (const s of [4, 5]) await tapStaff(page, { t: 'append', s });
  await page.click('[data-mode=edit]');
  // Dragging on an unselected note: nothing moves, it is just selected.
  await dragStaff(page, { t: 'item', i: 0, s: 4 }, [8]);
  let st = await staffState(page);
  expect(st.steps).toEqual([4, 5]);
  expect(st.sel).toBe(0);
  const h0 = await page
    .locator('.block.active .staff-wrap svg')
    .evaluate((e) => e.getBoundingClientRect().height);
  // Selected: it follows the finger, up to D7 (s = 20), and the staff grows.
  await dragStaff(page, { t: 'item', i: 0, s: 4 }, [10, 16, 19, 30]);
  st = await staffState(page);
  expect(st.steps).toEqual([20, 5]);
  const h1 = await page
    .locator('.block.active .staff-wrap svg')
    .evaluate((e) => e.getBoundingClientRect().height);
  expect(h1).toBeGreaterThan(h0 + 25);
  // Going back down: the staff returns to its height.
  await dragStaff(page, { t: 'item', i: 0, s: 20 }, [7]);
  expect((await staffState(page)).steps).toEqual([7, 5]);
  await expect
    .poll(() =>
      page.locator('.block.active .staff-wrap svg').evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBe(h0);
});

test('by finger: dragging does not scroll the page, the rest of the staff does', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  // A page taller than the screen, so that it can scroll.
  await page.evaluate(() => (document.body.style.paddingBottom = '2000px'));
  await page.evaluate(() => window.scrollTo(0, 0));
  const a = await staffPoint(page, { t: 'append', s: 4 });
  const b = await staffPoint(page, { t: 'append', s: 12 });
  const touch = (type, p) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await touch('touchStart', a);
  for (let k = 1; k <= 8; k++) await touch('touchMove', { x: a.x, y: a.y + ((b.y - a.y) * k) / 8 });
  await touch('touchEnd');
  expect((await staffState(page)).steps).toEqual([12]);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Elsewhere on the staff (on a note, in Write mode), the page still scrolls.
  const n = await staffPoint(page, { t: 'item', i: 0, s: 4 });
  await touch('touchStart', n);
  for (let k = 1; k <= 8; k++) await touch('touchMove', { x: n.x, y: n.y - 25 * k });
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  expect((await staffState(page)).steps).toEqual([12]);
});

test('transposing instrument: empty staff, then transpose or keep, undo', async ({ page }) => {
  const errors = collectErrors(page);
  const tag = page.locator('.block.active svg .trtag');
  const block = () =>
    page.evaluate(async () => {
      const { state, blockById } = await import('/js/ui/state.js');
      const { resolveMidis } = await import('/js/pitch.js');
      const b = blockById(state.activeId);
      return { tr: b.tr, ks: b.ks, steps: b.items.map((i) => i.s), midis: resolveMidis(b) };
    });
  // Empty staff: the instrument changes without a question, the key signature does not move.
  await page.selectOption('[data-f=tr]', 'Bb');
  await expect(page.locator('.tr-ask')).toHaveCount(0);
  await expect(tag).toHaveText('B♭');
  expect(await block()).toMatchObject({ tr: 'Bb', ks: undefined });
  await page.selectOption('[data-f=tr]', 'C');
  await expect(tag).toHaveCount(0);

  for (const s of [-2, 0, 2]) await tapStaff(page, { t: 'append', s }); // C E G
  const concert = await block();
  // With notes: question. Cancel restores the menu.
  await page.selectOption('[data-f=tr]', 'Eb');
  await expect(page.locator('.tr-ask')).toBeVisible();
  await page.click('[data-tr=cancel]');
  await expect(page.locator('[data-f=tr]')).toHaveValue('C');
  expect(await block()).toEqual(concert);
  // Transpose: same sound, A major, E♭ tag.
  await page.selectOption('[data-f=tr]', 'Eb');
  await page.click('[data-tr=move]');
  let st = await block();
  expect(st).toMatchObject({ tr: 'Eb', ks: 3, steps: [3, 5, 7] });
  expect(st.midis).toEqual(concert.midis);
  await expect(page.locator('[data-f=ks]')).toHaveValue('3');
  await expect(tag).toHaveText('E♭');
  // Undo (palette): back to C.
  await pal(page, '[data-act=undo]');
  expect(await block()).toEqual(concert);
  // Keep the writing: the notes do not move, the sound drops a ninth.
  await page.selectOption('[data-f=tr]', 'Bb8');
  await page.click('[data-tr=keep]');
  st = await block();
  expect(st.steps).toEqual(concert.steps);
  expect(st.midis).toEqual(concert.midis.map((m) => m - 14));
  // Reloaded: the instrument is saved.
  await page.waitForTimeout(400); // deferred write
  await page.reload();
  await page.locator('.card').first().click();
  await expect(page.locator('.block svg .trtag').first()).toHaveText('B♭');
  expect(errors).toEqual([]);
});
