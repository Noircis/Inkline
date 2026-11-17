// Chords on a staff and blocks with several staves (2.17).
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, tapStaff, pal, staffState, storedNotes, collectErrors } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'staff');
});

/** The staff block of the stored note. */
async function storedBlock(page) {
  await page.waitForTimeout(700); // the save is debounced
  const { notes } = await storedNotes(page);
  return notes[0].blocks.find((b) => b.type === 'staff');
}

test('chord mode: stack, remove, undo, write on; Edit mode too', async ({ page }) => {
  const errors = collectErrors(page);
  await tapStaff(page, { t: 'append', s: 0 });
  await pal(page, '[data-act=stack]');
  await expect(page.locator('#palette [data-act=stack]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#palInfo')).toContainText('Accord');
  await tapStaff(page, { t: 'append', s: 4 });
  await tapStaff(page, { t: 'append', s: 7 });
  expect((await staffState(page)).chords).toEqual([[0, 4, 7]]);
  await tapStaff(page, { t: 'append', s: 4 }); // already there: removed
  expect((await staffState(page)).chords).toEqual([[0, 7]]);
  await pal(page, '[data-act=undo]');
  expect((await staffState(page)).chords).toEqual([[0, 4, 7]]);

  // Chord mode off: the next tap writes a new note.
  await pal(page, '[data-act=stack]');
  await tapStaff(page, { t: 'append', s: 2 });
  let st = await staffState(page);
  expect(st.items).toBe('q q');
  expect(st.chords).toEqual([[0, 4, 7], null]);

  // Edit mode: the selected note gets the stacked note.
  await pal(page, '[data-mode=edit]'); // selects the note before the cursor
  expect((await staffState(page)).sel).toBe(1);
  await pal(page, '[data-act=stack]');
  await tapStaff(page, { t: 'item', i: 1, s: 6 });
  st = await staffState(page);
  expect(st.chords).toEqual([
    [0, 4, 7],
    [2, 6],
  ]);
  await expect(page.locator('#palInfo')).toContainText('Accord');

  const b = await storedBlock(page);
  expect(b.items[0].x).toEqual([{ s: 4 }, { s: 7 }]);
  await page.click('.block.active [data-play]');
  await page.waitForTimeout(400);
  expect(errors).toEqual([]);
});

test('several staves: add, menu, switch, aligned writing, shared barline, remove', async ({ page }) => {
  const errors = collectErrors(page);
  for (const s of [4, 4, 4, 4]) await tapStaff(page, { t: 'append', s });

  // + Staff: a bass staff under it, edited at once, its menu open.
  await page.click('.block.active [data-staff-tool=add]');
  await expect(page.locator('.part-menu')).toBeVisible();
  await expect(page.locator('.block.active .shead .kind')).toHaveText('Portée 2/2');
  await expect(page.locator('.block.active [data-f=clef]')).toHaveValue('bass');
  await page.click('.part-menu [data-pm-clef=treble]');
  await expect(page.locator('.block.active [data-f=clef]')).toHaveValue('treble');
  await page.click('.part-menu [data-pm-clef=bass]');
  await page.click('.part-menu [data-pm=close]');
  await expect(page.locator('.part-menu')).toHaveCount(0);

  // A half note on the bass, aligned with the first quarter of the treble.
  await page.click('#palette [data-dur="h"]');
  await tapStaff(page, { t: 'append', s: 2 });
  await tapStaff(page, { t: 'append', s: 0 });
  let st = await staffState(page);
  expect(st.part).toBe(1);
  expect(st.items).toBe('h h');
  const xs = await page.evaluate(async () => {
    const { state, blockById } = await import('/js/ui/state.js');
    const { layout } = await import('/js/layout.js');
    const b = blockById(state.activeId);
    const L = layout(b, 360, false, null, 1);
    return [L.parts[0].pos[0].x, L.parts[1].pos[0].x, L.parts[0].pos[2].x, L.parts[1].pos[1].x];
  });
  expect(xs[0]).toBe(xs[1]);
  expect(xs[2]).toBe(xs[3]);

  // A tap on the other staff makes it the staff being edited.
  await tapStaff(page, { t: 'staff', k: 0 });
  st = await staffState(page);
  expect(st.part).toBe(0);
  expect(st.items).toBe('q q q q');

  // A final barline on one staff goes to every staff.
  await pal(page, '[data-act=bar]');
  await page.click('#barBar [data-bar=final]');
  let b = await storedBlock(page);
  expect(b.items[3].bar).toBe('final');
  expect(b.more[0].items[1].bar).toBe('final');

  // The clef of the bass opens its menu; move it up: the block's first staff is the bass.
  await tapStaff(page, { t: 'clef', k: 1 });
  await expect(page.locator('.part-menu')).toBeVisible();
  expect((await staffState(page)).part).toBe(1);
  await page.click('.part-menu [data-pm=up]');
  b = await storedBlock(page);
  expect(b.clef).toBe('bass');
  expect(b.more[0].clef).toBe('treble');
  expect((await staffState(page)).part).toBe(0);

  // Listening plays both staves without error.
  await page.click('.block.active [data-play]');
  await page.waitForTimeout(500);
  await page.click('.block.active [data-play]');

  // Remove the staff being edited: it holds notes, a second tap confirms.
  await page.click('.part-menu [data-pm=del]');
  await page.click('.part-menu [data-pm=del]');
  b = await storedBlock(page);
  expect(b.more).toBeUndefined();
  expect(b.clef).toBe('treble');
  await expect(page.locator('.block.active .shead .kind')).toHaveText('Portée');
  expect(errors).toEqual([]);
});

test('several staves survive a reload; at most four', async ({ page }) => {
  for (let k = 0; k < 3; k++) await page.click('.block.active [data-staff-tool=add]');
  await expect(page.locator('.block.active [data-staff-tool=add]')).toBeDisabled();
  await expect(page.locator('.block.active .shead .kind')).toHaveText('Portée 4/4');
  await page.click('.part-menu [data-pm-clef=rhythm]');
  await expect(page.locator('.block.active [data-f=clef]')).toBeHidden();
  await page.click('#palette [data-act=undo]');
  await page.waitForTimeout(700);
  await page.reload();
  await page.locator('.card').first().click();
  await expect(page.locator('.block.staff svg .brace').first()).toBeVisible();
  const b = await storedBlock(page);
  expect(b.more.map((p) => p.clef)).toEqual(['bass', 'bass', 'bass']);
});
