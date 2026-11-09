// Saisie sur une portée : modes Écrire / Modifier, insertion, mise en mesure, armure.
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

test('glisser en mode Écrire : la note suit le doigt, nom affiché, une seule annulation', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await dragStaff(page, { t: 'append', s: 4 }, [6, 9, 11], async () => {
    await expect(page.locator('.pitch-tip')).toBeVisible();
    await expect(page.locator('.pitch-tip')).toHaveText('Si 5'); // s = 11 en clé de sol
  });
  await expect(page.locator('.pitch-tip')).toBeHidden();
  let st = await staffState(page);
  expect(st.items).toBe('q');
  expect(st.steps).toEqual([11]);
  // Un simple toucher pose toujours une note (sans glisser).
  await tapStaff(page, { t: 'append', s: 2 });
  expect((await staffState(page)).steps).toEqual([11, 2]);
  await pal(page, '[data-act=undo]');
  await pal(page, '[data-act=undo]'); // tout le premier geste ne compte qu'une fois
  st = await staffState(page);
  expect(st.items).toBe('');
  expect(errors).toEqual([]);
});

test('glisser en mode Modifier : seulement la note sélectionnée ; plus haut que le mi aigu', async ({
  page,
}) => {
  for (const s of [4, 5]) await tapStaff(page, { t: 'append', s });
  await page.click('[data-mode=edit]');
  // Glisser sur une note non sélectionnée : rien ne bouge, elle est juste sélectionnée.
  await dragStaff(page, { t: 'item', i: 0, s: 4 }, [8]);
  let st = await staffState(page);
  expect(st.steps).toEqual([4, 5]);
  expect(st.sel).toBe(0);
  const h0 = await page
    .locator('.block.active .staff-wrap svg')
    .evaluate((e) => e.getBoundingClientRect().height);
  // Sélectionnée : elle suit le doigt, jusqu'au ré 7 (s = 20), et la portée s'agrandit.
  await dragStaff(page, { t: 'item', i: 0, s: 4 }, [10, 16, 19, 30]);
  st = await staffState(page);
  expect(st.steps).toEqual([20, 5]);
  const h1 = await page
    .locator('.block.active .staff-wrap svg')
    .evaluate((e) => e.getBoundingClientRect().height);
  expect(h1).toBeGreaterThan(h0 + 25);
  // Redescendre : la portée reprend sa hauteur.
  await dragStaff(page, { t: 'item', i: 0, s: 20 }, [7]);
  expect((await staffState(page)).steps).toEqual([7, 5]);
  await expect
    .poll(() =>
      page.locator('.block.active .staff-wrap svg').evaluate((e) => e.getBoundingClientRect().height),
    )
    .toBe(h0);
});

test('au doigt : le glisser ne fait pas défiler la page, le reste de la portée si', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  // Une page plus haute que l'écran, pour qu'elle puisse défiler.
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

  // Ailleurs sur la portée (sur une note, en mode Écrire), la page défile toujours.
  const n = await staffPoint(page, { t: 'item', i: 0, s: 4 });
  await touch('touchStart', n);
  for (let k = 1; k <= 8; k++) await touch('touchMove', { x: n.x, y: n.y - 25 * k });
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
  expect((await staffState(page)).steps).toEqual([12]);
});

test('instrument transpositeur : portée vide, puis transposer ou garder, annuler', async ({ page }) => {
  const errors = collectErrors(page);
  const tag = page.locator('.block.active svg .trtag');
  const block = () =>
    page.evaluate(async () => {
      const { state, blockById } = await import('/js/ui/state.js');
      const { resolveMidis } = await import('/js/pitch.js');
      const b = blockById(state.activeId);
      return { tr: b.tr, ks: b.ks, steps: b.items.map((i) => i.s), midis: resolveMidis(b) };
    });
  // Portée vide : on change d'instrument sans question, l'armure ne bouge pas.
  await page.selectOption('[data-f=tr]', 'Bb');
  await expect(page.locator('.tr-ask')).toHaveCount(0);
  await expect(tag).toHaveText('B♭');
  expect(await block()).toMatchObject({ tr: 'Bb', ks: undefined });
  await page.selectOption('[data-f=tr]', 'C');
  await expect(tag).toHaveCount(0);

  for (const s of [-2, 0, 2]) await tapStaff(page, { t: 'append', s }); // do mi sol
  const concert = await block();
  // Avec des notes : question. Annuler remet le menu.
  await page.selectOption('[data-f=tr]', 'Eb');
  await expect(page.locator('.tr-ask')).toBeVisible();
  await page.click('[data-tr=cancel]');
  await expect(page.locator('[data-f=tr]')).toHaveValue('C');
  expect(await block()).toEqual(concert);
  // Transposer : même son, la majeur, étiquette E♭.
  await page.selectOption('[data-f=tr]', 'Eb');
  await page.click('[data-tr=move]');
  let st = await block();
  expect(st).toMatchObject({ tr: 'Eb', ks: 3, steps: [3, 5, 7] });
  expect(st.midis).toEqual(concert.midis);
  await expect(page.locator('[data-f=ks]')).toHaveValue('3');
  await expect(tag).toHaveText('E♭');
  // Annuler (palette) : retour en ut.
  await pal(page, '[data-act=undo]');
  expect(await block()).toEqual(concert);
  // Garder l'écriture : les notes ne bougent pas, le son descend d'une neuvième.
  await page.selectOption('[data-f=tr]', 'Bb8');
  await page.click('[data-tr=keep]');
  st = await block();
  expect(st.steps).toEqual(concert.steps);
  expect(st.midis).toEqual(concert.midis.map((m) => m - 14));
  // Rechargé : l'instrument est enregistré.
  await page.waitForTimeout(400); // écriture différée
  await page.reload();
  await page.locator('.card').first().click();
  await expect(page.locator('.block svg .trtag').first()).toHaveText('B♭');
  expect(errors).toEqual([]);
});
