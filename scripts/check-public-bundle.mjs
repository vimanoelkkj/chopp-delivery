// Falha se o build publicável (dist/) contiver painel mockado, cenários de teste, fixtures ou o
// laboratório DEV. Uso: npm run build && npm run verify:dist  (NÃO rode sobre um build `--mode e2e`.)
// Camadas (ver bundle-guard.mjs): grafo de módulos + manifest de um build temporário, e texto do dist.
import { auditGraph, labLiterals, scanDist } from './bundle-guard.mjs'

const root = process.cwd()
const problems = []

const literals = await labLiterals(root)
const { files, hits } = await scanDist('dist', { extraText: literals })
for (const { file, needle } of hits) problems.push(`texto em ${file}: ${JSON.stringify(needle)}`)

const graph = await auditGraph({ root })
for (const id of graph.leakedModules) problems.push(`módulo no bundle: ${id}`)
for (const id of graph.leakedManifest) problems.push(`entrada no manifest: ${id}`)

if (problems.length) {
  console.error(`bundle público contém código/dados de teste:\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(
  `dist limpo (${files} arquivos, ${literals.length} literais de laboratório, ${graph.modules} módulos verificados)`,
)
