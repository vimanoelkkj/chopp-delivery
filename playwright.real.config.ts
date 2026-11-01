import { defineConfig } from '@playwright/test'
import { integrationPort } from './scripts/integration-port.mts'

export default defineConfig({
  testDir: 'tests/e2e-real',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  use: {
    // A mesma porta (validada) que o runner repassa ao servidor descartável.
    baseURL: `http://127.0.0.1:${integrationPort()}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
})
