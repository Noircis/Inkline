// Offline: once the app is loaded, the service worker serves it with no network.
import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('the app reloads offline', async ({ page, context }) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // the service worker now controls the page
  await page.locator('#newNote').waitFor();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#newNote')).toBeVisible();
  await page.click('#optBtn');
  await expect(page.locator('.opt-row.static small')).toContainText('Version');
  await context.setOffline(false);
});
