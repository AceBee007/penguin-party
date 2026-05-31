import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 90000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: 'http://127.0.0.1:15200',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 15200',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      url: 'http://127.0.0.1:15200',
    },
    {
      command: 'npm run signaling',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      url: 'http://127.0.0.1:15201/health',
    },
  ],
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
