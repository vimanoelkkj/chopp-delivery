import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: [
    'admin-dark-theme.spec.ts',
    'admin-theme-switch.spec.ts',
    'storefront-dark-theme.spec.ts',
    'storefront-theme-switch.spec.ts',
  ],
  outputDir: 'test-results/admin-theme',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4321', channel: 'chrome', reducedMotion: 'reduce' },
  webServer: {
    command: 'npm run preview:admin:theme',
    url: 'http://127.0.0.1:4321/admin',
    reuseExistingServer: !process.env.CI,
  },
})
