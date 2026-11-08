// Saisie sur une portée : modes Écrire / Modifier, insertion, mise en mesure, armure.
import { test, expect } from '@playwright/test';
import { openApp, newNoteWith, tapStaff, pal, staffState, collectErrors } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await newNoteWith(page, 'staff');
});

test('mode Écrire : ajout, curseur, insertion au milieu, retour arrière', async ({ page }) => {
  const errors = collectErrors(page);
  for (const s of [4, 5, 6, 7]) await tapStaff(page, { t: 'append', s });
  expect((await staffState(page)).items).toBe('q q q q');

  await tapStaff(page, { t: 'item', i: 1 }); // place le curseur, ne modifie rien
  let st = await staffState(page);
  expect(st.cursor).toBe(1);
  expect(st.info).toContain('Insertion avant la note 2');

  await pal(page, '[data-dur="8"]'); // règle la saisie, ne modifie aucune note
  expect((await staffState(page)).items).toBe('q q q q');

  await tapStaff(page, { t: 'insert', s: 2 });
  st = await staffState(page);
  expect(st.items).toBe('q 8 q q 8~+ 8'); // la dernière noire déborde : coupée à la barre
  expect(st.cursor).toBe(2);

  await pal(page, '[data-act=del]'); // efface la note avant le curseur
  expect((await staffState(page)).items).toBe('q q q q');
  expect(errors).toEqual([]);
});

test('mode Modifier : compensation par des silences, aller-retour', async ({ page }) => {
  for (const s of [4, 5, 6]) await tapStaff(page, { t: 'append', s });
  await page.click('[data-mode=edit]');
  await tapStaff(page, { t: 'item', i: 0 });
  await pal(page, '[data-dur="8"]');
  expect((await staffState(page)).items).toBe('8 r8 q q');
  await pal(page, '[data-dur="q"]');
  expect((await staffState(page)).items).toBe('q q q');
});

test('liaison automatique aux barres : noire, noire, ronde', async ({ page }) => {
  await tapStaff(page, { t: 'append', s: 4 });
  await tapStaff(page, { t: 'append', s: 5 });
  await pal(page, '[data-dur="w"]');
  await tapStaff(page, { t: 'append', s: 6 });
  expect((await staffState(page)).items).toBe('q q h~+ h');

  // Une note coupée se sélectionne et se modifie en entier.
  await page.click('[data-mode=edit]');
  await tapStaff(page, { t: 'item', i: 3, s: 6 });
  expect((await staffState(page)).sel).toBe(2);
  await pal(page, '[data-dur="h"]');
  expect((await staffState(page)).items).toBe('q q h rh');

  // Changer la mesure recoupe tout.
  await page.selectOption('[data-f=time]', '3/4');
  expect((await staffState(page)).items).toBe('q q q~+ q rh');
});

test('bug 2.6.0 : basculer le point en boucle ne fait pas grossir la durée', async ({ page }) => {
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

test('un triolet ne peut pas passer la barre', async ({ page }) => {
  await pal(page, '[data-dur="h"]');
  await tapStaff(page, { t: 'append', s: 4 });
  await pal(page, '[data-dur="8"]');
  await tapStaff(page, { t: 'append', s: 4 }); // 2,5 temps : les triolets ne tombent plus juste
  await pal(page, '[data-act=tup]');
  for (let k = 0; k < 5; k++) await tapStaff(page, { t: 'append', s: 4 });
  const st = await staffState(page);
  expect(st.items).toBe('h 8 8³ 8³ 8³ 8³'); // le 5e (de 3,83 à 4,17) est refusé
  expect(st.info).toContain('triolet ne peut pas passer la barre');
});

test('armure : dessinée, et la note sélectionnée la prend en compte', async ({ page }) => {
  await tapStaff(page, { t: 'append', s: 1 }); // fa 4
  await page.selectOption('[data-f=ks]', '1');
  await expect(page.locator('[data-staff] svg path')).not.toHaveCount(0);
  await page.click('[data-mode=edit]');
  await tapStaff(page, { t: 'item', i: 0, s: 1 });
  expect((await staffState(page)).info).toContain('Fa♯ 4');
});

test('les données survivent au rechargement (liaisons automatiques comprises)', async ({ page }) => {
  await tapStaff(page, { t: 'append', s: 4 });
  await tapStaff(page, { t: 'append', s: 5 });
  await pal(page, '[data-dur="w"]');
  await tapStaff(page, { t: 'append', s: 6 });
  await page.waitForTimeout(400); // écriture différée
  await page.reload();
  await page.locator('.card').first().click();
  await page.locator('.block.staff .staff-wrap').click({ position: { x: 5, y: 5 } });
  expect((await staffState(page)).items).toBe('q q h~+ h');
});
