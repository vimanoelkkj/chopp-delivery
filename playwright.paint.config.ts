import { defineConfig } from '@playwright/test'

// Primeira pintura precisa do build de produção (no servidor de desenvolvimento o CSS entra por JS).
const port = process.env.PLAYWRIGHT_PAINT_PORT || '4395'

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['storefront-first-paint.spec.ts'],
  outputDir: 'test-results/first-paint',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    command: `npx vite build --mode e2e && npx vite preview --mode e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
