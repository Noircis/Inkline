// Clavier d'accords (2.8.5) : grille, accord d'une note, onglet Structure, champ texte.
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, collectErrors } from './helpers.js';

/** Tape une suite de touches sur le clavier `root` (« B », « ♭ », « q:-7 », « ␣ », « next »…). */
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

test('grille : accords au clavier, mesure suivante, affichage iReal, pas de clavier du téléphone', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openApp(page);
  await newNoteWith(page, 'grid');
  await keys(page, '#gKeys', ['D', 'q:-7', '␣', 'G', 'q:7', 'next', 'C', 'q:^7', 'next', 'F', '♯', 'q:h7']);
  expect(await grid(page)).toEqual([['D-7', 'G7'], ['C^7'], ['F#h7'], []]);
  // Affichage dans la grille : −7, Δ7, ø7.
  const cells = page.locator('[data-grid] [data-gm]');
  await expect(cells.nth(0).locator('sup').first()).toHaveText('−7');
  await expect(cells.nth(1).locator('sup')).toHaveText('Δ7');
  await expect(cells.nth(2).locator('sup')).toHaveText('ø7');
  // Aperçu de la mesure en cours, touche de couleur active.
  await expect(page.locator('#gKeys .ck-field')).toContainText('F♯');
  await expect(page.locator('#gKeys [data-ck=qual][data-v=h7]')).toHaveAttribute('aria-pressed', 'true');
  // Aucun champ texte n'a le focus : le clavier du téléphone reste fermé.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  // Pavé détaillé.
  await keys(page, '#gKeys', ['⌫', '⌫', 'q:7', '⋯', '+:#9', '+:b13']);
  expect((await grid(page))[2]).toEqual(['F#7#9b13']);
  await expect(cells.nth(2).locator('sup')).toHaveText('7♯9♭13');
  expect(errors).toEqual([]);
});

test('grille : une annulation par mesure saisie ; onglet Structure', async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'grid');
  await keys(page, '#gKeys', ['B', '♭', 'q:7', '␣', 'E', '♭', 'q:7']);
  expect((await grid(page))[0]).toEqual(['Bb7', 'Eb7']);
  await page.click('#gKeys [data-ck=undo]');
  expect((await grid(page))[0]).toEqual([]); // toute la mesure tapée
  // Structure : reprises, barres… dans l'autre onglet.
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

test('grille : ⌨ repasse au champ texte, ♫ revient au clavier d’accords', async ({ page }) => {
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

test('portée : accord d’une note au clavier, appliqué à OK, affiché façon iReal', async ({ page }) => {
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
  // Pendant la saisie, le clavier remplace la palette de notes.
  await expect(page.locator('#chordKeys')).toBeVisible();
  await expect(page.locator('#palette [data-dur=q]')).toBeHidden();
  await keys(page, '#chordKeys', ['A', '♭', 'q:-7', '/', 'G', '♭']);
  // Annuler : rien n'est appliqué.
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
