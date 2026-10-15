import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

it('App só alcança o painel mockado por import dinâmico atrás do gate ADMIN_MOCK_ENABLED', () => {
  const app = source('src/app/App.tsx')
  expect(app).not.toMatch(/^import .*AdminApp/m) // nada estático
  expect(app).toMatch(
    /ADMIN_MOCK_ENABLED\s*\?\s*\(\)\s*=>\s*import\('@\/features\/admin\/AdminApp'\)/,
  )
  expect(app).toMatch(/:\s*\(\)\s*=>\s*import\('@\/features\/admin\/AdminDisabled'\)/)
})

it('o gate é só dev ou build de E2E, literal em App.tsx e no leitor do mock', () => {
  const gate = "import.meta.env.DEV || import.meta.env.MODE === 'e2e'"
  expect(source('src/app/App.tsx')).toContain(`const ADMIN_MOCK_ENABLED = ${gate}`)
  expect(source('src/features/admin/catalog/mockGateway.ts')).toContain(`const SCENARIOS = ${gate}`)
})

it('AdminDisabled não importa nada do painel, do mock nem do gateway', () => {
  const disabled = source('src/features/admin/AdminDisabled.tsx')
  const imports = disabled.match(/^import .*$/gm) ?? []
  expect(imports.join(' ')).not.toMatch(/mock|gateway|AdminApp|catalog\/|login|session/i)
})
