import { defineConfig, devices } from '@playwright/test';

import { e2eEnv } from './src/helpers/env';

// ВНИМАНИЕ: userDataDir в use ниже — не поддерживаемая Playwright Test опция
// для обычного page-fixture, она молча игнорируется. Реальный флоу с
// плагином КриптоПро (tests/login.spec.ts, tests/zus.spec.ts) сам поднимает
// launchPersistentContext через tests/chromiumGost.ts, в обход page-фикстуры
// отсюда. Здесь executablePath оставлен для остальных spec-файлов — нужен
// именно GOST-сборки Chromium, чтобы вообще открыть портал.
export default defineConfig({
  timeout: 1000000,
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'html',
  use: {
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-gost',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: e2eEnv.chromiumGostExecutablePath,
          headless: false,
          args: [
            '--enable-extensions',
            '--disable-extensions-http-throttling',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--disable-gpu',
          ],
        },
        userDataDir: e2eEnv.chromiumGostProfileDir,
      },
    },
  ],
});
