import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

it('App só alcança o painel por import dinâmico atrás do gate ADMIN_ENABLED', () => {
  const app = source('src/app/App.tsx')
  expect(app).not.toMatch(/^import .*AdminApp/m) // nada estático
  expect(app).toMatch(/ADMIN_ENABLED\s*\?\s*\(\)\s*=>\s*import\('@\/features\/admin\/AdminApp'\)/)
  expect(app).toMatch(/:\s*\(\)\s*=>\s*import\('@\/features\/admin\/AdminDisabled'\)/)
})

it('real integration and mock modes are explicit; normal dev/production stay disabled', () => {
  const app = source('src/app/App.tsx')
  expect(app).toContain("import.meta.env.MODE === 'admin-integration'")
  expect(app).toContain("(import.meta.env.DEV && import.meta.env.MODE === 'admin-mock')")
  expect(app).toContain("import.meta.env.MODE === 'e2e'")
  expect(app).not.toMatch(/const ADMIN_ENABLED\s*=\s*import.meta.env.DEV\s*\|\|/)
  const entry = source('src/features/admin/AdminApp.tsx')
  expect(entry).toMatch(/import.meta.env.MODE === 'admin-integration'\s*\? createHttpGateway\(\)/)
  expect(entry).toContain(': createMockGateway(readMockMode(window.location.search))')
  expect(source('src/features/admin/catalog/mockGateway.ts')).toContain(
    "const SCENARIOS = import.meta.env.DEV || import.meta.env.MODE === 'e2e'",
  )
})

it('AdminDisabled não importa nada do painel, do mock nem do gateway', () => {
  const disabled = source('src/features/admin/AdminDisabled.tsx')
  const imports = disabled.match(/^import .*$/gm) ?? []
  expect(imports.join(' ')).not.toMatch(/mock|gateway|AdminApp|catalog\/|login|session/i)
})
