import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { releaseAuditPlugin } from './scripts/bundle-guard.mjs'

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'release' ? [releaseAuditPlugin()] : [])],
  // Release expõe somente o contato público já existente; novos VITE_* não entram por acidente.
  ...(mode === 'release'
    ? {
        envPrefix: [],
        define: {
          'import.meta.env.VITE_WHATSAPP_NUMBER': JSON.stringify(
            loadEnv(mode, process.cwd(), 'VITE_WHATSAPP_NUMBER').VITE_WHATSAPP_NUMBER ?? '',
          ),
        },
        build: { outDir: 'dist-release' },
      }
    : {}),
  base: mode === 'release' ? '/' : './',
  server: { proxy: { '/api': 'http://127.0.0.1:8788' } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: { include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'tests/**/*.test.ts'] },
}))
