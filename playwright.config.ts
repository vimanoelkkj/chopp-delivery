import { defineConfig } from '@playwright/test'

const port = process.env.PLAYWRIGHT_PORT || '4173'
const baseURL = `http://localhost:${port}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL,
    // PLAYWRIGHT_CHANNEL=chrome usa o Chrome instalado; sem a variável, usa Chromium.
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: {
      // Permite usar um Chromium já instalado (ex.: CI ou sandbox) sem baixar outro.
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
