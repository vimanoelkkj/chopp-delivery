import { defineConfig } from '@playwright/test'
import realConfig from './playwright.real.config'

// Mesmos handlers e D1 descartável da integração, compilando agora o modo publicável.
export default defineConfig<{ runtimeMode: 'release' }>(realConfig, {
  use: { runtimeMode: 'release' },
})
