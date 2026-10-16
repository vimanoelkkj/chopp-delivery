// Verificação estrutural do bundle PÚBLICO. Três camadas independentes:
//   1. grafo de módulos de um build temporário (fonte da verdade: quais arquivos entraram);
//   2. manifest desse build (entradas e imports dinâmicos);
//   3. texto do dist real, com literais derivados de fixtures/laboratório (sobrevivem à minificação).
// Nomes de identificadores NÃO servem de prova: o minificador os troca.
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

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

// Release admite o painel HTTP, mas nunca suas implementações simuladas ou o gate desligado.
export const RELEASE_FORBIDDEN_MODULES = [
  ...FORBIDDEN_MODULES.filter((pattern) => !pattern.source.includes('AdminDisabled')),
  /\/src\/features\/admin\/catalog\/mock(Gateway|Data)/,
  /\/src\/features\/admin\/AdminDisabled/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\/server\//,
  /\/node_modules\/(?:@playwright|playwright|vitest|wrangler|miniflare)\//,
]
export const RELEASE_FORBIDDEN_TEXT = FORBIDDEN_TEXT.filter(
  (text) => text !== '/api/admin/catalog/v2' && text !== 'If-Match',
)
const RELEASE_FORBIDDEN_FILE =
  /(^|\/)(\.(env|dev\.vars)([./]|$)|(fixtures?|mocks?|tests?|scripts|scratchpads?)([./-]|$))|\.(sqlite(-(wal|shm))?|db|log|tmp|bak|map)$|\.audit\.json$/i

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
const JSX_TEXT = />\s*([^<>{}\n]+?)\s*</g

/** Literais de texto de um fonte: aspas e texto JSX, só os longos o bastante para serem únicos. */
export function literalsOf(source, minimum = 8, jsx = true) {
  const found = new Set()
  for (const [, , text] of source.matchAll(STRING_LITERAL))
    if (text.length >= minimum && !text.includes('${')) found.add(text)
  if (jsx)
    for (const [, text] of source.matchAll(JSX_TEXT))
      if (text.trim().length >= minimum) found.add(text.trim())
  return found
}

/**
 * Literais exclusivos do laboratório: os dos fontes de laboratório MENOS os que também existem em
 * código público (para não acusar uma frase legítima só porque a fixture a reutiliza).
 */
export async function labLiterals(root, { release = false } = {}) {
  const sources = release
    ? [
        ...LAB_SOURCES,
        'src/features/admin/catalog/mockData.ts',
        'src/features/admin/catalog/mockGateway.ts',
      ]
    : LAB_SOURCES
  const lab = new Set()
  for (const file of sources)
    for (const text of literalsOf(
      await readFile(join(root, file), 'utf8'),
      8,
      file.endsWith('.tsx'),
    ))
      lab.add(text)
  const isLab = (path) => {
    const rel = normalize(relative(root, path))
    return sources.includes(rel) || /\.(test|spec)\.tsx?$/.test(rel)
  }
  for (const path of await walk(join(root, 'src'))) {
    if (!/\.(ts|tsx)$/.test(path) || isLab(path)) continue
    if (
      release
        ? scanModules([path], RELEASE_FORBIDDEN_MODULES).length > 0
        : /\/src\/(pages\/preview|features\/(admin|motion))\//.test(normalize(path))
    )
      continue
    for (const text of literalsOf(await readFile(path, 'utf8'), 8, path.endsWith('.tsx')))
      lab.delete(text)
  }
  return [...lab]
}

/** Procura textos proibidos e literais de laboratório nos arquivos do dist. */
export async function scanDist(dir, { extraText = [], forbiddenText = FORBIDDEN_TEXT } = {}) {
  const files = (await walk(dir)).filter((path) =>
    /\.(js|css|html|map|json|txt|xml|ya?ml|toml|csv)$/.test(path),
  )
  const needles = [...forbiddenText, ...extraText]
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
    await rm(`${directory}.audit.json`, { force: true })
  }
}

/** Camadas 1 e 2 sobre um build temporário. */
export async function auditGraph(options) {
  const { moduleIds, manifestIds } = await collectGraph(options)
  const rooted = (id) => (id.startsWith('/') || /^[A-Za-z]:/.test(id) ? id : `/${id}`)
  const forbidden = options?.mode === 'release' ? RELEASE_FORBIDDEN_MODULES : FORBIDDEN_MODULES
  return {
    modules: moduleIds.length,
    leakedModules: scanModules(moduleIds, forbidden),
    leakedManifest: scanModules(manifestIds.map(rooted), forbidden),
  }
}

async function fingerprints(dir) {
  const files = {}
  for (const file of (await walk(dir)).sort())
    files[normalize(relative(dir, file))] = createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
  return files
}

/** Grafo do MESMO build, vinculado aos bytes emitidos. O relatório fica fora da pasta publicável. */
export function releaseAuditPlugin() {
  let root
  return {
    name: 'delegas-release-audit',
    apply: 'build',
    configResolved(config) {
      root = config.root
      if (!config.isProduction) throw new Error('Release exige NODE_ENV=production')
    },
    async writeBundle(options, bundle) {
      const directory = resolve(root, options.dir)
      const modules = Object.values(bundle).flatMap((item) =>
        item.type === 'chunk'
          ? Object.keys(item.modules).map((id) => normalize(relative(root, id)))
          : [],
      )
      await writeFile(
        `${directory}.audit.json`,
        JSON.stringify(
          {
            mode: 'release',
            modules: [...new Set(modules)].sort(),
            files: await fingerprints(directory),
          },
          null,
          2,
        ),
      )
    },
  }
}

/** Não reconstrói outro grafo: inspeciona exatamente o artefato informado. */
export async function auditRelease({ root, dir = 'dist-release' }) {
  const directory = resolve(root, dir)
  const report = JSON.parse(await readFile(`${directory}.audit.json`, 'utf8'))
  const problems = []
  if (report.mode !== 'release' || !Array.isArray(report.modules))
    throw new Error('Relatório de release inválido')
  const actual = await fingerprints(directory)
  for (const file of Object.keys(actual))
    if (RELEASE_FORBIDDEN_FILE.test(file)) problems.push(`Arquivo proibido: ${file}`)
  if (JSON.stringify(actual) !== JSON.stringify(report.files))
    problems.push('Arquivos divergentes do build auditado')
  const ids = report.modules.map((id) => `/${id}`)
  for (const id of scanModules(ids, RELEASE_FORBIDDEN_MODULES))
    problems.push(`Módulo proibido: ${id}`)
  for (const required of [
    'src/features/admin/AdminApp.tsx',
    'src/features/admin/catalog/httpGateway.ts',
  ])
    if (!report.modules.includes(required)) problems.push(`Módulo obrigatório ausente: ${required}`)
  const literals = await labLiterals(root, { release: true })
  const { files, hits } = await scanDist(directory, {
    extraText: literals,
    forbiddenText: RELEASE_FORBIDDEN_TEXT,
  })
  for (const hit of hits)
    problems.push(`Texto proibido em ${hit.file}: ${JSON.stringify(hit.needle)}`)
  return { problems, files, modules: report.modules.length, literals: literals.length }
}
