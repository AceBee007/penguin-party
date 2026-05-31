import { defineConfig, devices } from '@playwright/test';

const DEFAULT_APP_PORT = 15200;
const DEFAULT_SIGNALING_PORT = 15201;
const appPort = readPort([process.env.APP_PORT, process.env.PORT], DEFAULT_APP_PORT);
const signalingPort = readPort(
  [process.env.SIGNALING_PORT, process.env.VITE_SIGNALING_PORT],
  DEFAULT_SIGNALING_PORT,
);
const appUrl = `http://127.0.0.1:${appPort}`;
const signalingUrl = `http://127.0.0.1:${signalingPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 90000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: appUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `APP_PORT=${appPort} VITE_SIGNALING_PORT=${signalingPort} npm run dev -- --host 127.0.0.1 --port ${appPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      url: appUrl,
    },
    {
      command: `SIGNALING_PORT=${signalingPort} npm run signaling`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      url: `${signalingUrl}/health`,
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

function readPort(candidates: Array<string | undefined>, fallback: number): number {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();

    if (!trimmed) {
      continue;
    }

    const port = Number(trimmed);

    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      return port;
    }
  }

  return fallback;
}
