import { defineConfig } from '@playwright/test'

/**
 * Configuração isolada do servidor de DESENVOLVIMENTO (`vite`), onde o StrictMode do React
 * executa e descarta cada efeito antes do definitivo. O build de produção não faz isso, então
 * só aqui dá para provar que a vitrine ainda faz UMA leitura de /api/catalog por carga.
 * Não usa D1: a rede é interceptada nos testes.
 */
const port = process.env.PLAYWRIGHT_DEV_PORT || '4196'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: 'e2e-dev',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
