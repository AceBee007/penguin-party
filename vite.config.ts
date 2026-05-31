import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const DEFAULT_APP_PORT = 15200;
const appPort = readPort([process.env.APP_PORT, process.env.PORT], DEFAULT_APP_PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: appPort,
  },
  test: {
    css: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 10000,
  },
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
