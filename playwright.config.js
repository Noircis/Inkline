// Configuration des tests d'interface (Playwright).
//   npm run test:e2e
// La première fois sur un ordinateur : npx playwright install chromium
import { defineConfig } from '@playwright/test';

const PORT = 5610;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // Format téléphone : c'est l'usage principal de l'appli.
    viewport: { width: 390, height: 844 },
    hasTouch: false,
    locale: 'fr-FR',
  },
  webServer: {
    command: `node scripts/dev.mjs --static --port=${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
