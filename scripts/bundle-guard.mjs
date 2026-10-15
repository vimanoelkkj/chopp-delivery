// Verificação estrutural do bundle PÚBLICO. Três camadas independentes:
//   1. grafo de módulos de um build temporário (fonte da verdade: quais arquivos entraram);
//   2. manifest desse build (entradas e imports dinâmicos);
//   3. texto do dist real, com literais derivados de fixtures/laboratório (sobrevivem à minificação).
// Nomes de identificadores NÃO servem de prova: o minificador os troca.
import { mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

/** Módulos que nunca podem estar no bundle público (caminhos normalizados com `/`). */
export const FORBIDDEN_MODULES = [
  /\/src\/pages\/preview\//,
  /\/src\/features\/catalog-expansion\/fixtures/,
  /\/src\/features\/motion\/TickerMarquee/,
  /\/src\/pages\/landing\/sections\/HeroRefined/,
  // Em produção /admin é só AdminDisabled; qualquer outro módulo do painel é vazamento.
  /\/src\/features\/admin\/(?!AdminDisabled)/,
  /\/(scripts|tests|e2e|e2e-dev)\//,
]

/** Textos que nunca podem aparecer no dist (cenários de mock, credenciais e rotas desligadas). */
export const FORBIDDEN_TEXT = [
  'lost-response',
  'save-error',
  'createMockGateway',
  'senha local',
  'owner-id',
  '/api/admin/catalog/v2', // gateway HTTP continua desligado
  'If-Match',
]

/** Arquivos que existem só para laboratório/demonstração: seus literais não podem ir ao dist. */
export const LAB_SOURCES = [
  'src/features/catalog-expansion/fixtures.ts',
  'src/pages/preview/MotionPreviewPage.tsx',
]

const normalize = (id) =>
  id.replace(/^\0/, '').replace(/\?.*$/, '').split(sep).join('/').replaceAll('\\', '/')

/** Devolve os módulos proibidos presentes (sem repetição). */
export function scanModules(moduleIds, forbidden = FORBIDDEN_MODULES) {
  return [...new Set(moduleIds.map(normalize))].filter((id) =>
    forbidden.some((pattern) => pattern.test(id)),
  )
}

const walk = async (dir) => {
  const out = []
  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    if ((await stat(path)).isDirectory()) out.push(...(await walk(path)))
    else out.push(path)
  }
  return out
}

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
const JSX_TEXT = />\s*([^<>{}\n]{20,}?)\s*</g

/** Literais de texto de um fonte: aspas e texto JSX, só os longos o bastante para serem únicos. */
export function literalsOf(source, minimum = 8) {
  const found = new Set()
  for (const [, , text] of source.matchAll(STRING_LITERAL))
    if (text.length >= minimum && !text.includes('${')) found.add(text)
  for (const [, text] of source.matchAll(JSX_TEXT)) found.add(text.trim())
  return found
}

/**
 * Literais exclusivos do laboratório: os dos fontes de laboratório MENOS os que também existem em
 * código público (para não acusar uma frase legítima só porque a fixture a reutiliza).
 */
export async function labLiterals(root) {
  const lab = new Set()
  for (const file of LAB_SOURCES)
    for (const text of literalsOf(await readFile(join(root, file), 'utf8'))) lab.add(text)
  const isLab = (path) => {
    const rel = normalize(relative(root, path))
    return LAB_SOURCES.includes(rel) || /\.(test|spec)\.tsx?$/.test(rel)
  }
  for (const path of await walk(join(root, 'src'))) {
    if (!/\.(ts|tsx)$/.test(path) || isLab(path)) continue
    if (/\/src\/(pages\/preview|features\/(admin|motion))\//.test(normalize(path))) continue
    for (const text of literalsOf(await readFile(path, 'utf8'))) lab.delete(text)
  }
  return [...lab]
}

/** Procura textos proibidos e literais de laboratório nos arquivos do dist. */
export async function scanDist(dir, { extraText = [] } = {}) {
  const files = (await walk(dir)).filter((path) => /\.(js|css|html|map)$/.test(path))
  const needles = [...FORBIDDEN_TEXT, ...extraText]
  const hits = []
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const needle of needles) if (text.includes(needle)) hits.push({ file, needle })
  }
  return { files: files.length, hits }
}

/**
 * Build temporário (fora do repositório) com um coletor de módulos e manifest. `define` permite
 * provocar de propósito um vazamento nos testes do próprio verificador.
 */
export async function collectGraph({ root, mode = 'production', define } = {}) {
  const { build } = await import('vite')
  const base = await realpath(tmpdir())
  const directory = await mkdtemp(join(base, 'delegas-bundle-guard-'))
  const moduleIds = new Set()
  // `import.meta.env.DEV` vem de NODE_ENV: um shell com NODE_ENV=test/development publicaria o
  // laboratório. O auditor sempre mede o build como produção.
  const previousNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const collector = {
    name: 'bundle-guard-collect',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle))
        if (item.type === 'chunk')
          for (const id of item.moduleIds ?? Object.keys(item.modules ?? {})) moduleIds.add(id)
    },
  }
  try {
    await build({
      root,
      mode,
      logLevel: 'silent',
      define,
      plugins: [collector],
      build: { outDir: directory, emptyOutDir: true, manifest: true, reportCompressedSize: false },
    })
    const manifest = JSON.parse(await readFile(join(directory, '.vite', 'manifest.json'), 'utf8'))
    const manifestIds = Object.entries(manifest).flatMap(([key, entry]) => [
      key,
      entry.src ?? key,
      ...(entry.dynamicImports ?? []),
    ])
    return { moduleIds: [...moduleIds], manifestIds }
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
    // Só remove o que ainda é, de fato, a pasta própria dentro do TEMP.
    if ((await realpath(directory)).startsWith(base))
      await rm(directory, { recursive: true, force: true })
  }
}

/** Camadas 1 e 2 sobre um build temporário. */
export async function auditGraph(options) {
  const { moduleIds, manifestIds } = await collectGraph(options)
  const rooted = (id) => (id.startsWith('/') || /^[A-Za-z]:/.test(id) ? id : `/${id}`)
  return {
    modules: moduleIds.length,
    leakedModules: scanModules(moduleIds),
    leakedManifest: scanModules(manifestIds.map(rooted)),
  }
}
