import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const root = join(process.cwd(), 'src/features/admin')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })

it('só AdminApp escolhe o mock; componentes e hooks dependem apenas do AdminCatalogGateway', () => {
  const importers = files(root)
    .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.test\.ts$/.test(path))
    .filter((path) => /from '[^']*(mockGateway|mockData)'/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(root.length + 1).replaceAll('\\', '/'))
    .sort()
  // mockGateway importa mockData; AdminApp é o único ponto de troca para a F3A.
  expect(importers).toEqual(['AdminApp.tsx', 'catalog/mockGateway.ts'])
})

it('only AdminApp selects HTTP; components stay transport independent', () => {
  const importers = files(root)
    .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.test\.ts$/.test(path))
    .filter((path) => /from '[^']*(httpGateway|\/wire)'/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(root.length + 1).replaceAll('\\', '/'))
    .sort()
  // AdminApp selects transport; only httpGateway imports the wire decoder.
  expect(importers).toEqual(['AdminApp.tsx', 'catalog/httpGateway.ts'])
})

it('nenhuma credencial ou dado de login de teste no código do painel', () => {
  const offenders = files(root)
    .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.test\.ts$/.test(path))
    .filter((path) => /senha local|password\s*[:=]\s*['"]/i.test(readFileSync(path, 'utf8')))
  expect(offenders).toEqual([])
})
