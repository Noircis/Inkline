// Hors ligne : une fois l'appli chargée, le service worker la sert sans réseau.
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('l’appli se recharge hors ligne', async ({ page, context }) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // le service worker contrôle maintenant la page
  await page.locator('#newNote').waitFor();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#newNote')).toBeVisible();
  await page.click('#optBtn');
  await expect(page.locator('.opt-row.static small')).toContainText('Version');
  await context.setOffline(false);
});
