// Chord keyboard (2.8.5): chart, note chord, Structure tab, text field.
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, collectErrors } from './helpers.js';

/** Types a sequence of keys on the `root` keyboard ("B", "♭", "q:-7", "␣", "next"…). */
async function keys(page, root, list) {
  for (const k of list) {
    let sel;
    if (/^[A-G]$/.test(k)) sel = `[data-ck=root][data-v=${k}]`;
    else if (k === '♭') sel = '[data-ck=acc][data-v=b]';
    else if (k === '♯') sel = '[data-ck=acc][data-v="#"]';
    else if (k.startsWith('q:')) sel = `[data-ck=qual][data-v="${k.slice(2)}"]`;
    else if (k.startsWith('+:')) sel = `[data-ck=add][data-v="${k.slice(2)}"]`;
    else sel = `[data-ck=${{ '/': 'slash', '␣': 'space', '⌫': 'back', '⋯': 'more' }[k] || k}]`;
    await page.click(`${root} ${sel}`);
  }
}

const grid = (page) =>
  page.evaluate(async () => {
    const { state, blockById } = await import('/js/ui/state.js');
    return blockById(state.activeId).measures.map((m) => m.ch);
  });

test('chart: chords on the keyboard, next measure, iReal display, no phone keyboard', async ({ page }) => {
  const errors = collectErrors(page);
  await openApp(page);
  await newNoteWith(page, 'grid');
  await keys(page, '#gKeys', ['D', 'q:-7', '␣', 'G', 'q:7', 'next', 'C', 'q:^7', 'next', 'F', '♯', 'q:h7']);
  expect(await grid(page)).toEqual([['D-7', 'G7'], ['C^7'], ['F#h7'], []]);
  // Display in the chart: −7, Δ7, ø7.
  const cells = page.locator('[data-grid] [data-gm]');
  await expect(cells.nth(0).locator('sup').first()).toHaveText('−7');
  await expect(cells.nth(1).locator('sup')).toHaveText('Δ7');
  await expect(cells.nth(2).locator('sup')).toHaveText('ø7');
  // Preview of the current measure, active quality key.
  await expect(page.locator('#gKeys .ck-field')).toContainText('F♯');
  await expect(page.locator('#gKeys [data-ck=qual][data-v=h7]')).toHaveAttribute('aria-pressed', 'true');
  // No text field has the focus: the phone keyboard stays closed.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  // Detailed pad.
  await keys(page, '#gKeys', ['⌫', '⌫', 'q:7', '⋯', '+:#9', '+:b13']);
  expect((await grid(page))[2]).toEqual(['F#7#9b13']);
  await expect(cells.nth(2).locator('sup')).toHaveText('7♯9♭13');
  expect(errors).toEqual([]);
});

test('chart: one undo per typed measure; Structure tab', async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'grid');
  await keys(page, '#gKeys', ['B', '♭', 'q:7', '␣', 'E', '♭', 'q:7']);
  expect((await grid(page))[0]).toEqual(['Bb7', 'Eb7']);
  await page.click('#gKeys [data-ck=undo]');
  expect((await grid(page))[0]).toEqual([]); // the whole typed measure
  // Structure: repeats, barlines… in the other tab.
  await expect(page.locator('#gStruct')).toBeHidden();
  await page.click('#gTabStruct');
  await expect(page.locator('#gStruct')).toBeVisible();
  await expect(page.locator('#gKeys')).toBeHidden();
  await page.click('#gStruct [data-g=rs]');
  expect(
    await page.evaluate(async () => {
      const { state, blockById } = await import('/js/ui/state.js');
      return blockById(state.activeId).measures[0].rs;
    }),
  ).toBe(true);
  await page.click('#gTabChords');
  await expect(page.locator('#gKeys')).toBeVisible();
});

test('chart: ⌨ switches to the text field, ♫ back to the chord keyboard', async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'grid');
  await keys(page, '#gKeys', ['C', 'q:7']);
  await page.click('#gKeys [data-ck=text]');
  await expect(page.locator('#gIn')).toBeFocused();
  await expect(page.locator('#gIn')).toHaveValue('C7');
  await page.fill('#gIn', 'Bb7 Eb7');
  await page.click('#gKb');
  await expect(page.locator('#gKeys')).toBeVisible();
  expect((await grid(page))[0]).toEqual(['Bb7', 'Eb7']);
});

test("staff: a note's chord on the keyboard, applied on OK, shown iReal-style", async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'staff');
  await page.evaluate(async () => {
    const { state, blockById } = await import('/js/ui/state.js');
    const { hooks } = await import('/js/ui/staff/shared.js');
    const b = blockById(state.activeId);
    b.items = [
      { d: 'h', s: 4 },
      { d: 'h', s: 5 },
    ];
    hooks.redraw(b.id);
  });
  await page.click('[data-act=chord]');
  // While typing, the keyboard replaces the note palette.
  await expect(page.locator('#chordKeys')).toBeVisible();
  await expect(page.locator('#palette [data-dur=q]')).toBeHidden();
  await keys(page, '#chordKeys', ['A', '♭', 'q:-7', '/', 'G', '♭']);
  // Cancel: nothing is applied.
  await page.click('#chordCancel');
  const items = () =>
    page.evaluate(async () => {
      const { state, blockById } = await import('/js/ui/state.js');
      return blockById(state.activeId).items.map((i) => i.c ?? null);
    });
  expect(await items()).toEqual([null, null]);
  await expect(page.locator('#palette [data-dur=q]')).toBeVisible();
  await page.click('[data-act=chord]');
  await keys(page, '#chordKeys', ['A', '♭', 'q:-7', '/', 'G', '♭', 'next']);
  expect(await items()).toEqual([null, 'Ab-7/Gb']);
  await expect(page.locator('.block.active svg text.chord')).toHaveText('A♭−7/G♭');
});
