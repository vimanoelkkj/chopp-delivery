// Falha se o build publicável (dist/) contiver painel mockado, cenários de teste ou fixtures.
// Uso: npm run build && npm run verify:dist   (NÃO rode sobre um build `--mode e2e`.)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const forbidden = [
  'lost-response',
  'save-error',
  'createMockGateway',
  'Dronken', // fixture do catálogo mockado
  'senha local',
  'owner-id',
  '/api/admin/catalog/v2', // gateway HTTP continua desligado
  'If-Match',
  'MotionPreviewPage',
  'simulatedViewport',
  'EXPANDED_CATALOG_FIXTURE',
  'chope-imperial-stout-oculto',
  'cachaca-safra-antiga-oculta',
]

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const files = walk('dist').filter((path) => /\.(js|css|html|map)$/.test(path))
const hits = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const word of forbidden) if (text.includes(word)) hits.push(`${file}: ${word}`)
}

if (hits.length) {
  console.error(`dist contém código/dados de teste:\n${hits.join('\n')}`)
  process.exit(1)
}
console.log(`dist limpo (${files.length} arquivos verificados)`)
