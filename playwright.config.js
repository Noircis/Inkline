// Interface test configuration (Playwright).
//   npm run test:e2e
// First time on a computer: npx playwright install chromium
import { defineConfig } from '@playwright/test';

const PORT = 5610;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    // Phone format: that is the app's main use.
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
