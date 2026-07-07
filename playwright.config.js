import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5179',
    headless: true,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-component-cloud-policy', '--disable-features=PolicyEventLogging,ChromeLabs'] },
  },
  webServer: {
    command: 'APP_MODE=mock PORT=5179 npm start',
    url: 'http://localhost:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
