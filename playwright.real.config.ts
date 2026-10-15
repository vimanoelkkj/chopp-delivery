import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e-real',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${process.env.DELEGAS_INTEGRATION_PORT || '4185'}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
})
