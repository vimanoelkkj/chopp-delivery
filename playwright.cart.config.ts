import { defineConfig } from '@playwright/test'
import base from './playwright.config'

/**
 * E2E do carrinho. O WhatsApp só vira link com número configurado; aqui o build de teste recebe um
 * número FICTÍCIO (5531900000000), sem depender do ambiente externo nem tocar o de produção.
 */
const port = process.env.PLAYWRIGHT_CART_PORT || '4292'
const FAKE_WHATSAPP = '5531900000000'

export default defineConfig({
  ...base,
  testDir: 'e2e-cart',
  use: { ...base.use, baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run build -- --mode e2e && npm run db:init -- --persist-to .wrangler/e2e-cart-state && wrangler pages dev dist --ip 127.0.0.1 --port ${port} --persist-to .wrangler/e2e-cart-state`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_WHATSAPP_NUMBER: FAKE_WHATSAPP },
  },
})
