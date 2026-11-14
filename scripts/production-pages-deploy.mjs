// Deploy de PRODUÇÃO do Pages com o comando fixo e guardas. O `wrangler pages deploy` não aceita
// --config: lê o wrangler.jsonc do diretório atual. Por isso o deploy sai de um diretório temporário,
// FORA do repositório, criado por `git archive` do commit comercial, com wrangler.production.jsonc
// copiado como wrangler.jsonc. Este script recusa qualquer desvio e nunca imprime credenciais.
//
//   node scripts/production-pages-deploy.mjs preflight --dir <dir>   (somente leitura)
//   node scripts/production-pages-deploy.mjs command                  (imprime o comando fixo)
//   node scripts/production-pages-deploy.mjs deploy --dir <dir> --confirm chopp-delivery-prod
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  checkAccount,
  EXPECTED_ACCOUNT_ID,
  HOMOLOGATION_D1_ID,
  PRODUCTION_D1_ID,
  PRODUCTION_D1_NAME,
} from './production-account-guard.mjs'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PROJECT_NAME = 'chopp-delivery-prod'
export const PRODUCTION_BRANCH = 'main'
// BASE INCLUSIVA de ancestralidade, ancorada em um release publicado e verificado em produção.
// Todo preflight/deploy exige `--commit <sha1>` explícito, validado por `checkReleaseCommit`
// (esta base ou descendente dela, e ancestral de HEAD). O mesmo SHA pode usar perfis diferentes.
// Publicação reconfirmada: deployment 458da44b-6657-4086-9fe5-d16f8436c75a (Production, main).
// Só atualizar esta constante DEPOIS de o novo release estar publicado e verificado em produção.
export const COMMERCIAL_COMMIT = 'e105fc8c1f7fed5665f3d69f05676d21ebc3e47f'
export const BUILD_DIR = 'dist-commercial'
// Hash fixo do wrangler.production.jsonc revisado (arquivo ainda fora do Git). Mudar a configuração
// de produção exige revisar e atualizar este valor: o deploy nunca usa um arquivo não revisado.
export const PRODUCTION_CONFIG_SHA256 =
  '183cf75a1498991773298837d419288a581300fb831c74f20f844aeed8aaa453'
export const ADMIN_ORIGIN = 'https://chopp-delivery-prod.pages.dev'
// Infraestrutura de mídia de produção: nomes EXATOS (nunca os da homologação). Nada disso existe até a
// janela de release (docs/production-media-enablement.md); os perfis abaixo só passam no guard com esses nomes.
export const PRODUCTION_MEDIA_BUCKET = 'chopp-cms-media-production'
export const PRODUCTION_MEDIA_PROCESSOR = 'chopp-cms-image-processor-production'
/**
 * Perfis de configuração de produção. Cada um tem um arquivo revisado no Git e um hash fixo:
 * - base: sem R2/serviços (mídia inexistente); é o padrão e o único antes da infraestrutura de mídia.
 * - media-closed: bindings de mídia presentes e o gate do Pages FECHADO (CMS_MEDIA_ENABLED=disabled).
 * - media-open: idêntico ao anterior, exceto CMS_MEDIA_ENABLED=enabled (só após o gate do Worker aberto).
 */
export const PROFILES = {
  base: { file: 'wrangler.production.jsonc', sha256: PRODUCTION_CONFIG_SHA256, gate: null },
  'media-closed': {
    file: 'wrangler.production.media.jsonc',
    sha256: 'a67f53b0a67804742f382fffc434e67f9d575e56ea3ae2c2f8f1c56a2637a7d7',
    gate: 'disabled',
  },
  'media-open': {
    file: 'wrangler.production.media-open.jsonc',
    sha256: 'd72be49dcb1f632163e2db55a9dfa936f931929a811ea6db123bdc2f238130cd',
    gate: 'enabled',
  },
}
const LOCAL_ONLY_ID = 'delegas-local-only'
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js')

/** Argumentos fixos do `wrangler pages deploy`. Sem --config: o Pages o rejeita. */
export function deployArgs(commit = COMMERCIAL_COMMIT) {
  return [
    'pages',
    'deploy',
    `./${BUILD_DIR}`,
    '--project-name',
    PROJECT_NAME,
    '--branch',
    PRODUCTION_BRANCH,
    '--commit-hash',
    commit,
    '--commit-dirty=false',
  ]
}

/** Valida uma linha de comando de deploy (tokens após `wrangler`). Devolve a lista de problemas. */
export function checkDeployCommand(argv, { commit = COMMERCIAL_COMMIT } = {}) {
  const problems = []
  const [group, action, ...rest] = argv
  if (group !== 'pages' || action !== 'deploy') return ['não é um `wrangler pages deploy`']
  const allowed = new Set(['--project-name', '--branch', '--commit-hash', '--commit-dirty=false'])
  const values = new Map()
  const positional = []
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (!token.startsWith('-')) {
      positional.push(token)
      continue
    }
    const name = token.split('=')[0]
    if (/^(--config|-c|--env|-e|--cwd|--force)$/.test(name)) {
      problems.push(`flag proibida no deploy de produção: ${name}`)
      continue
    }
    if (!allowed.has(token) && !allowed.has(name)) {
      problems.push(`flag não prevista: ${name}`)
      continue
    }
    if (token === '--commit-dirty=false') values.set('--commit-dirty', 'false')
    else {
      values.set(name, rest[i + 1])
      i += 1
    }
  }
  if (positional.length !== 1 || !/^\.?\/?dist-commercial\/?$/.test(positional[0] ?? ''))
    problems.push(`o diretório de build deve ser ./${BUILD_DIR}`)
  if (values.get('--project-name') !== PROJECT_NAME)
    problems.push(`--project-name deve ser ${PROJECT_NAME}`)
  if (values.get('--branch') !== PRODUCTION_BRANCH)
    problems.push(`--branch deve ser ${PRODUCTION_BRANCH} (outra branch vira preview)`)
  if (!/^[0-9a-f]{40}$/.test(commit) || values.get('--commit-hash') !== commit)
    problems.push('--commit-hash deve ser o do commit comercial (SHA-1 completo)')
  if (values.get('--commit-dirty') !== 'false')
    problems.push('--commit-dirty=false é obrigatório (diretório de git archive)')
  return problems
}

const stripJsonc = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

function textFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) textFiles(path, found)
    else if (['.js', '.css', '.html', '.json', '.map', '.txt'].includes(extname(path)))
      found.push(path)
  }
  return found
}

const NUL = String.fromCharCode(0) // separador do git ls-tree -z
const TAB = String.fromCharCode(9)
const gitBlobSha1 = (buffer) =>
  createHash('sha1').update(`blob ${buffer.length}${NUL}`).update(buffer).digest('hex')

/**
 * Valida o commit de release informado em `--commit`: SHA-1 completo em minúsculas, existente no
 * repositório, igual à base de ancestralidade (COMMERCIAL_COMMIT) ou descendente dela, e ancestral de HEAD
 * (ou o próprio HEAD). Impede publicar um commit arbitrário, anterior ou fora da linha de release.
 */
export function checkReleaseCommit(commit, { root = ROOT } = {}) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit))
    return ['--commit deve ser um SHA-1 completo (40 caracteres hexadecimais minúsculos)']
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (git(['cat-file', '-e', `${commit}^{commit}`]).status !== 0)
    return ['o commit de release não existe no repositório']
  const problems = []
  if (git(['merge-base', '--is-ancestor', COMMERCIAL_COMMIT, commit]).status !== 0)
    problems.push('o commit de release não descende do último release publicado')
  if (git(['merge-base', '--is-ancestor', commit, 'HEAD']).status !== 0)
    problems.push('o commit de release não é HEAD nem ancestral de HEAD')
  return problems
}

/**
 * Compara o diretório de deploy com o commit comercial: todo arquivo versionado deve existir e ter
 * o mesmo conteúdo (hash de blob do Git), salvo o wrangler.jsonc, que é substituído de propósito.
 * Também recusa arquivos de segredo ou de configuração concorrente na raiz do diretório.
 */
export function checkSnapshot(dir, { root = ROOT, commit = COMMERCIAL_COMMIT } = {}) {
  const listed = spawnSync('git', ['ls-tree', '-r', '-z', commit], {
    cwd: root,
    maxBuffer: 64 << 20,
  })
  if (listed.status !== 0) return ['não foi possível listar o commit comercial no Git']
  const problems = []
  let checked = 0
  for (const entry of listed.stdout.toString('utf8').split(NUL).filter(Boolean)) {
    const [meta, path] = entry.split(TAB)
    const [mode, , sha] = meta.split(' ')
    if (path === 'wrangler.jsonc' || !mode.startsWith('100')) continue
    const file = join(dir, ...path.split('/'))
    checked += 1
    if (!existsSync(file)) problems.push(`arquivo do commit ausente no snapshot: ${path}`)
    else if (gitBlobSha1(readFileSync(file)) !== sha)
      problems.push(`arquivo diferente do commit comercial: ${path}`)
    if (problems.length >= 5) break
  }
  if (checked === 0) problems.push('o commit comercial não listou arquivos')
  for (const name of readdirSync(dir))
    if (
      /^(\.env|\.dev\.vars|graphify-out$|wrangler\.(json|toml)$)/.test(name) &&
      !/\.example$/.test(name)
    )
      problems.push(`arquivo proibido no snapshot: ${name}`)
  return problems
}

/** Valida o diretório de deploy. Devolve a lista de problemas (vazia = aprovado). */
export function checkDeployDir(
  dir,
  { root = ROOT, verifySnapshot = false, commit = COMMERCIAL_COMMIT, profile = 'base' } = {},
) {
  const problems = []
  const spec = PROFILES[profile]
  if (!spec) return [`perfil desconhecido: ${profile}`]
  if (!dir) return ['--dir obrigatório']
  const target = resolve(dir)
  if (!existsSync(target)) return ['o diretório de deploy não existe']
  const fromRoot = relative(root, target)
  if (fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot)))
    problems.push('o diretório de deploy é a raiz do repositório ou está dentro dela')
  const toRoot = relative(target, root)
  if (toRoot !== '' && !toRoot.startsWith('..') && !isAbsolute(toRoot))
    problems.push('o diretório de deploy contém o repositório')

  // O Pages procura wrangler.json, depois wrangler.jsonc, depois wrangler.toml, só no diretório atual.
  for (const other of ['wrangler.json', 'wrangler.toml'])
    if (existsSync(join(target, other)))
      problems.push(`${other} teria precedência sobre wrangler.jsonc`)
  const configPath = join(target, 'wrangler.jsonc')
  if (!existsSync(configPath)) problems.push('wrangler.jsonc ausente no diretório de deploy')
  else {
    const raw = readFileSync(configPath, 'utf8')
    let config
    try {
      config = JSON.parse(stripJsonc(raw))
    } catch {
      problems.push('wrangler.jsonc inválido')
    }
    if (raw.includes(LOCAL_ONLY_ID))
      problems.push('a configuração aponta para o D1 de laboratório (delegas-local-only)')
    if (raw.includes(HOMOLOGATION_D1_ID) || /homolog/i.test(raw))
      problems.push('a configuração referencia a homologação')
    if (config) {
      const d1 = config.d1_databases
      if (
        config.name !== PROJECT_NAME ||
        !Array.isArray(d1) ||
        d1.length !== 1 ||
        d1[0].binding !== 'DELEGAS_DB' ||
        d1[0].database_name !== PRODUCTION_D1_NAME ||
        d1[0].database_id !== PRODUCTION_D1_ID
      )
        problems.push('o binding DELEGAS_DB não é o D1 de produção')
      if (config.pages_build_output_dir !== `./${BUILD_DIR}`)
        problems.push(`pages_build_output_dir deve ser ./${BUILD_DIR}`)
      if (spec.gate === null) {
        if (JSON.stringify(config.vars) !== JSON.stringify({ ADMIN_ORIGIN }))
          problems.push('vars deve conter somente ADMIN_ORIGIN de produção')
        if ((config.r2_buckets ?? []).length || (config.services ?? []).length)
          problems.push('a configuração não pode ter R2 nem serviços (CMS Media desativado)')
      } else {
        // Perfil de mídia: bindings e variáveis EXATOS; qualquer extra, falta ou nome diferente é recusado.
        const vars = {
          ADMIN_ORIGIN,
          CMS_MEDIA_ENVIRONMENT: 'production',
          CMS_MEDIA_ENABLED: spec.gate,
        }
        if (JSON.stringify(config.vars) !== JSON.stringify(vars))
          problems.push(`vars do perfil ${profile} deve ser exatamente ${JSON.stringify(vars)}`)
        const buckets = [{ binding: 'CMS_MEDIA_BUCKET', bucket_name: PRODUCTION_MEDIA_BUCKET }]
        if (JSON.stringify(config.r2_buckets) !== JSON.stringify(buckets))
          problems.push(
            `r2_buckets deve ser exatamente CMS_MEDIA_BUCKET -> ${PRODUCTION_MEDIA_BUCKET}`,
          )
        const services = [{ binding: 'CMS_MEDIA_PROCESSOR', service: PRODUCTION_MEDIA_PROCESSOR }]
        if (JSON.stringify(config.services) !== JSON.stringify(services))
          problems.push(
            `services deve ser exatamente CMS_MEDIA_PROCESSOR -> ${PRODUCTION_MEDIA_PROCESSOR}`,
          )
      }
      if (config.account_id !== undefined && config.account_id !== EXPECTED_ACCOUNT_ID)
        problems.push('account_id diferente da conta esperada')
      const preview = config.env?.preview
      if (
        preview &&
        ((preview.d1_databases ?? []).length ||
          Object.keys(preview.vars ?? {}).length ||
          (preview.r2_buckets ?? []).length ||
          (preview.services ?? []).length)
      )
        problems.push('env.preview deve ficar sem bindings nem variáveis')
    }
    const reviewed = join(root, spec.file)
    if (existsSync(reviewed) && sha256(readFileSync(reviewed)) !== sha256(readFileSync(configPath)))
      problems.push(`wrangler.jsonc difere do ${spec.file} revisado`)
    if (sha256(readFileSync(configPath)) !== spec.sha256)
      problems.push('wrangler.jsonc não tem o hash fixo da configuração de produção revisada')
  }

  const build = join(target, BUILD_DIR)
  if (!existsSync(build) || !existsSync(join(build, 'index.html')))
    problems.push(
      `${BUILD_DIR} (com index.html) ausente: rode npm run build:commercial no diretório`,
    )
  else {
    if (existsSync(join(build, '_worker.js'))) problems.push('_worker.js inesperado no build')
    for (const file of textFiles(build)) {
      const content = readFileSync(file, 'utf8')
      if (
        content.includes(LOCAL_ONLY_ID) ||
        content.includes(HOMOLOGATION_D1_ID) ||
        /chopp-delivery-homolog/.test(content)
      ) {
        problems.push(
          `o build contém referência de laboratório/homologação (${relative(build, file)})`,
        )
        break
      }
    }
  }
  if (!existsSync(join(target, 'functions', 'api', 'products.ts')))
    problems.push('functions/ ausente no diretório de deploy (as APIs não seriam publicadas)')
  if (verifySnapshot) problems.push(...checkSnapshot(target, { root, commit }))
  return problems
}

function wranglerRun(args, env) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  })
  if (result.status !== 0) throw new Error('wrangler falhou')
  return result.stdout
}

/** Gate do Worker processador: lê a versão ativa e a variável CMS_MEDIA_PROCESSOR_ENABLED. */
export function processorGate(run, env) {
  const status = run(['deployments', 'status', '--name', PRODUCTION_MEDIA_PROCESSOR], env)
  const version = /\(100%\)\s+([0-9a-f-]{36})/.exec(status)?.[1]
  if (!version) throw new Error('versão ativa do processador não encontrada')
  const view = run(['versions', 'view', version, '--name', PRODUCTION_MEDIA_PROCESSOR], env)
  return /CMS_MEDIA_PROCESSOR_ENABLED \("(\w+)"\)/.exec(view)?.[1] ?? null
}

/** Leituras remotas do perfil de mídia: bucket e Worker precisam existir; para abrir o Pages, o Worker já aberto. */
function mediaProblems(profile, { run, env }) {
  const problems = []
  try {
    const buckets = run(['r2', 'bucket', 'list'], env)
    if (!new RegExp(`^name:\\s+${PRODUCTION_MEDIA_BUCKET}\\s*$`, 'm').test(buckets))
      problems.push(`o bucket R2 ${PRODUCTION_MEDIA_BUCKET} não existe na conta`)
  } catch {
    problems.push('não foi possível listar os buckets R2 da conta')
  }
  try {
    const gate = processorGate(run, env)
    if (gate === null) problems.push('não foi possível ler CMS_MEDIA_PROCESSOR_ENABLED do Worker')
    else if (PROFILES[profile].gate === 'enabled' && gate !== 'enabled')
      problems.push('abrir o Pages exige o gate do Worker processador já aberto (enabled)')
  } catch {
    problems.push(`o Worker ${PRODUCTION_MEDIA_PROCESSOR} não existe ou não pôde ser lido`)
  }
  return problems
}

/** Guardas prévios: conta, D1, projeto existente e diretório isolado. Somente leitura. */
export function preflight({
  dir,
  env = process.env,
  run = wranglerRun,
  info,
  verifySnapshot = false,
  commit = COMMERCIAL_COMMIT,
  profile = 'base',
} = {}) {
  const problems = []
  const account = checkAccount({ env, ...(info ? { info } : {}) })
  if (!account.ok) problems.push(account.reason)
  // Sem a conta confirmada nenhuma consulta é feita: o Wrangler poderia usar outra conta.
  if (account.ok) {
    try {
      const raw = run(['pages', 'project', 'list', '--json'], env)
      const projects = JSON.parse(raw.slice(raw.indexOf('[')))
      if (!projects.some((project) => project['Project Name'] === PROJECT_NAME))
        problems.push(`o projeto Pages ${PROJECT_NAME} não existe na conta`)
    } catch {
      problems.push('não foi possível listar os projetos Pages da conta')
    }
  }
  problems.push(...checkDeployDir(dir, { verifySnapshot, commit, profile }))
  if (account.ok && PROFILES[profile]?.gate) problems.push(...mediaProblems(profile, { run, env }))
  return { ok: problems.length === 0, problems }
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode] = process.argv.slice(2)
  const requested = option('--commit')
  const profile = option('--profile') ?? 'base'
  if (!PROFILES[profile]) {
    console.error(`BLOQUEADO: perfil desconhecido (${Object.keys(PROFILES).join(', ')})`)
    process.exit(1)
  }
  // `command` sem --commit imprime o comando da base de ancestralidade (referência); preflight e
  // deploy exigem o commit do release explicitamente e o validam.
  const commit = requested ?? COMMERCIAL_COMMIT
  const printed = `npx wrangler ${deployArgs(commit).join(' ')}`
  if (mode === 'command') {
    const bad = requested ? checkReleaseCommit(requested) : []
    if (bad.length) {
      for (const problem of bad) console.error(`BLOQUEADO: ${problem}`)
      process.exitCode = 1
    } else console.log(printed)
  } else if (mode === 'preflight' || mode === 'deploy') {
    const bad = checkReleaseCommit(requested)
    const result = bad.length
      ? { ok: false, problems: bad }
      : preflight({ dir: option('--dir'), verifySnapshot: true, commit, profile })
    if (!result.ok) {
      for (const problem of result.problems) console.error(`BLOQUEADO: ${problem}`)
      process.exitCode = 1
    } else if (mode === 'preflight') console.log('guardas aprovados; nada foi publicado')
    else if (option('--confirm') !== PROJECT_NAME) {
      console.error(`BLOQUEADO: confirme com --confirm ${PROJECT_NAME}`)
      process.exitCode = 1
    } else {
      const args = deployArgs(commit)
      const guard = checkDeployCommand(args, { commit })
      if (guard.length) throw new Error(guard.join('; '))
      console.log(`executando em ${resolve(option('--dir'))}: ${printed}`)
      const done = spawnSync(process.execPath, [WRANGLER, ...args], {
        cwd: resolve(option('--dir')),
        stdio: 'inherit',
        env: process.env,
      })
      process.exitCode = done.status ?? 1
    }
  } else {
    console.error(
      'uso: preflight --dir <dir> --commit <sha> [--profile base|media-closed|media-open] | command [--commit <sha>] | deploy --dir <dir> --commit <sha> [--profile ...] --confirm chopp-delivery-prod',
    )
    process.exitCode = 1
  }
}
