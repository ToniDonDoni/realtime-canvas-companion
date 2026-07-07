import { defineConfig } from '@playwright/test';

const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : process.platform === 'linux'
    ? '/usr/bin/chromium'
    : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5179',
    headless: true,
    launchOptions: {
      ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-component-cloud-policy', '--disable-features=PolicyEventLogging,ChromeLabs'],
    },
  },
  webServer: {
    command: 'APP_MODE=mock PORT=5179 npm start',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
