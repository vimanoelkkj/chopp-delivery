import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXPECTED_ACCOUNT_ID,
  HOMOLOGATION_D1_ID,
  PRODUCTION_D1_ID,
  PRODUCTION_D1_NAME,
} from '../../scripts/production-account-guard.mjs'
import {
  BUILD_DIR,
  COMMERCIAL_COMMIT,
  checkDeployCommand,
  checkDeployDir,
  checkReleaseCommit,
  checkSnapshot,
  deployArgs,
  PRODUCTION_CONFIG_SHA256,
  preflight,
  ROOT,
} from '../../scripts/production-pages-deploy.mjs'

// Guardas do deploy de produção do Pages. Nada é publicado: o Wrangler nunca é chamado com `deploy`
// e a consulta remota é substituída por leituras injetadas.

const reviewed = readFileSync('wrangler.production.jsonc', 'utf8')
const okInfo = () => JSON.stringify({ uuid: PRODUCTION_D1_ID, name: PRODUCTION_D1_NAME })
const projects = (names: string[]) => () =>
  JSON.stringify(names.map((name) => ({ 'Project Name': name })))
const okEnv = { CLOUDFLARE_ACCOUNT_ID: EXPECTED_ACCOUNT_ID }

describe('comando fixo do deploy', () => {
  it('é exatamente o comando aprovado, sem --config e com branch main', () => {
    expect(deployArgs()).toEqual([
      'pages',
      'deploy',
      './dist-commercial',
      '--project-name',
      'chopp-delivery-prod',
      '--branch',
      'main',
      '--commit-hash',
      '7a71df863c87b4913c29dde93edcf7e29e35a3dd',
      '--commit-dirty=false',
    ])
    // Último release publicado em produção (deployment 9e876c4d, 7a71df8).
    expect(COMMERCIAL_COMMIT).toBe('7a71df863c87b4913c29dde93edcf7e29e35a3dd')
    expect(checkDeployCommand(deployArgs())).toEqual([])
  })

  it.each([
    ['--config', [...deployArgs(), '--config', 'wrangler.production.jsonc']],
    ['-c', [...deployArgs(), '-c', 'wrangler.production.jsonc']],
    ['--env', [...deployArgs(), '--env', 'production']],
    ['--cwd', [...deployArgs(), '--cwd', '.']],
    ['--force', [...deployArgs(), '--force']],
    ['flag desconhecida', [...deployArgs(), '--no-bundle']],
  ])('recusa flag proibida: %s', (_name, argv) => {
    expect(checkDeployCommand(argv).length).toBeGreaterThan(0)
  })

  it.each([
    [
      'branch integration',
      (a: string[]) => a.map((t) => (t === 'main' ? 'integration/immersive-cms-f4a' : t)),
    ],
    ['branch homologation', (a: string[]) => a.map((t) => (t === 'main' ? 'homologation' : t))],
    [
      'projeto da homologação',
      (a: string[]) => a.map((t) => (t === 'chopp-delivery-prod' ? 'chopp-delivery-homolog' : t)),
    ],
    ['outro commit', (a: string[]) => a.map((t) => (t === COMMERCIAL_COMMIT ? 'a'.repeat(40) : t))],
    [
      'sem --branch',
      (a: string[]) => a.filter((t, i) => t !== '--branch' && a[i - 1] !== '--branch'),
    ],
    ['sem --commit-dirty=false', (a: string[]) => a.filter((t) => t !== '--commit-dirty=false')],
    ['sem diretório', (a: string[]) => a.filter((t) => t !== './dist-commercial')],
    [
      'diretório do repositório',
      (a: string[]) => a.map((t) => (t === './dist-commercial' ? '.' : t)),
    ],
  ])('recusa: %s', (_name, change) => {
    expect(checkDeployCommand(change(deployArgs())).length).toBeGreaterThan(0)
  })

  it('não é um pages deploy', () => {
    expect(checkDeployCommand(['deploy', '--config', 'x'])).toHaveLength(1)
  })
})

describe('diretório de deploy', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chopp-deploy-'))
    writeFileSync(join(dir, 'wrangler.jsonc'), reviewed)
    mkdirSync(join(dir, BUILD_DIR, 'assets'), { recursive: true })
    writeFileSync(join(dir, BUILD_DIR, 'index.html'), '<!doctype html>')
    writeFileSync(join(dir, BUILD_DIR, 'assets', 'app.js'), 'console.log("ok")')
    mkdirSync(join(dir, 'functions', 'api'), { recursive: true })
    writeFileSync(join(dir, 'functions', 'api', 'products.ts'), 'export {}')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const set = (config: unknown) =>
    writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify(config))
  const base = () => JSON.parse(reviewed)

  it('aprova a configuração de produção revisada', () => {
    expect(checkDeployDir(dir)).toEqual([])
  })

  it('recusa a raiz do repositório e qualquer pasta dentro dela', () => {
    expect(checkDeployDir(ROOT).join()).toMatch(/raiz do repositório/)
    const inside = join(ROOT, 'node_modules')
    expect(checkDeployDir(inside).join()).toMatch(/raiz do repositório/)
    expect(checkDeployDir(join(ROOT, '..')).join()).toMatch(/contém o repositório/)
  })

  it('recusa diretório inexistente e configuração ausente', () => {
    expect(checkDeployDir(join(dir, 'nao-existe'))).toEqual(['o diretório de deploy não existe'])
    rmSync(join(dir, 'wrangler.jsonc'))
    expect(checkDeployDir(dir).join()).toMatch(/wrangler\.jsonc ausente/)
    expect(checkDeployDir(undefined)).toEqual(['--dir obrigatório'])
  })

  it('recusa arquivos de configuração com precedência sobre wrangler.jsonc', () => {
    writeFileSync(join(dir, 'wrangler.toml'), 'name = "x"')
    expect(checkDeployDir(dir).join()).toMatch(/wrangler\.toml teria precedência/)
    rmSync(join(dir, 'wrangler.toml'))
    writeFileSync(join(dir, 'wrangler.json'), '{}')
    expect(checkDeployDir(dir).join()).toMatch(/wrangler\.json teria precedência/)
  })

  it('recusa a configuração de laboratório (delegas-local-only)', () => {
    copyFileSync('wrangler.jsonc', join(dir, 'wrangler.jsonc'))
    const problems = checkDeployDir(dir).join()
    expect(problems).toMatch(/laboratório/)
    expect(problems).toMatch(/binding DELEGAS_DB/)
  })

  it('recusa D1 de homologação, variáveis, R2, serviços e preview com bindings', () => {
    const cases: [string, (c: ReturnType<typeof base>) => void, RegExp][] = [
      [
        'D1 de homologação',
        (c) => (c.d1_databases[0].database_id = HOMOLOGATION_D1_ID),
        /homologação/,
      ],
      [
        'D1 diferente',
        (c) => (c.d1_databases[0].database_id = '00000000-0000-4000-8000-000000000000'),
        /binding DELEGAS_DB/,
      ],
      [
        'ADMIN_ORIGIN diferente',
        (c) => (c.vars.ADMIN_ORIGIN = 'https://outra.pages.dev'),
        /ADMIN_ORIGIN/,
      ],
      ['variável extra', (c) => (c.vars.CMS_MEDIA_ENABLED = 'enabled'), /ADMIN_ORIGIN/],
      ['R2', (c) => (c.r2_buckets = [{ binding: 'CMS_MEDIA_BUCKET', bucket_name: 'x' }]), /R2/],
      ['serviço', (c) => (c.services = [{ binding: 'CMS_MEDIA_PROCESSOR', service: 'x' }]), /R2/],
      ['saída errada', (c) => (c.pages_build_output_dir = './dist'), /pages_build_output_dir/],
      [
        'conta errada',
        (c) => Object.assign(c, { account_id: '180b51aa94c17aaf72d0674196933b4e' }),
        /account_id/,
      ],
      ['preview com D1', (c) => (c.env.preview.d1_databases = c.d1_databases), /env\.preview/],
    ]
    for (const [name, change, expected] of cases) {
      const config = base()
      change(config)
      set(config)
      expect(checkDeployDir(dir).join(), name).toMatch(expected)
    }
  })

  it('recusa wrangler.jsonc que difere do arquivo revisado, mesmo que válido', () => {
    writeFileSync(join(dir, 'wrangler.jsonc'), `${reviewed}\n`)
    expect(checkDeployDir(dir).join()).toMatch(/difere do wrangler\.production\.jsonc/)
  })

  it('recusa build ausente, _worker.js e referências de laboratório ou homologação no build', () => {
    writeFileSync(join(dir, BUILD_DIR, '_worker.js'), '')
    expect(checkDeployDir(dir).join()).toMatch(/_worker\.js inesperado/)
    rmSync(join(dir, BUILD_DIR, '_worker.js'))
    for (const leak of [
      'delegas-local-only',
      HOMOLOGATION_D1_ID,
      'chopp-delivery-homolog.pages.dev',
    ]) {
      writeFileSync(join(dir, BUILD_DIR, 'assets', 'app.js'), `const x = "${leak}"`)
      expect(checkDeployDir(dir).join(), leak).toMatch(/referência de laboratório\/homologação/)
    }
    rmSync(join(dir, BUILD_DIR), { recursive: true })
    expect(checkDeployDir(dir).join()).toMatch(/dist-commercial \(com index\.html\) ausente/)
  })

  it('o hash fixo cobre a configuração revisada e recusa qualquer outra, mesmo válida', () => {
    expect(PRODUCTION_CONFIG_SHA256).toBe(createHash('sha256').update(reviewed).digest('hex'))
    const changed = base()
    changed.vars.ADMIN_ORIGIN = 'https://chopp-delivery-prod.pages.dev'
    writeFileSync(
      join(dir, 'wrangler.jsonc'),
      `${JSON.stringify(changed)}
`,
    )
    expect(checkDeployDir(dir).join()).toMatch(/hash fixo/)
  })

  it('recusa diretório sem functions (as APIs não seriam publicadas)', () => {
    rmSync(join(dir, 'functions'), { recursive: true })
    expect(checkDeployDir(dir).join()).toMatch(/functions\/ ausente/)
  })

  it('segue o procedimento do runbook com git archive do commit exato e é aprovado', () => {
    let hasCommit = true
    try {
      execFileSync('git', ['rev-parse', '--verify', `${COMMERCIAL_COMMIT}^{commit}`], {
        stdio: 'ignore',
      })
    } catch {
      hasCommit = false
    }
    if (!hasCommit) return
    const target = mkdtempSync(join(tmpdir(), 'chopp-deploy-archive-'))
    try {
      const tar = join(target, 'src.tar')
      const work = join(target, 'work')
      mkdirSync(work)
      execFileSync('git', ['archive', '--format=tar', '-o', tar, COMMERCIAL_COMMIT])
      // O runbook usa o bsdtar do Windows por caminho absoluto: o `tar` do Git trata `C:` como host remoto.
      const bsdtar =
        process.platform === 'win32'
          ? join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'tar.exe')
          : 'tar'
      execFileSync(bsdtar, ['-xf', tar, '-C', work])
      // A árvore extraída traz o wrangler.jsonc de laboratório: o guarda a recusa.
      mkdirSync(join(work, BUILD_DIR))
      writeFileSync(join(work, BUILD_DIR, 'index.html'), '<!doctype html>')
      expect(checkDeployDir(work).join()).toMatch(/laboratório/)
      // Depois da substituição prevista no runbook, passa.
      copyFileSync('wrangler.production.jsonc', join(work, 'wrangler.jsonc'))
      expect(checkDeployDir(work)).toEqual([])
      // Snapshot idêntico ao commit (salvo o wrangler.jsonc trocado de propósito): aprovado.
      expect(checkDeployDir(work, { verifySnapshot: true })).toEqual([])
      expect(checkSnapshot(work)).toEqual([])
      // Qualquer desvio em relação ao commit é recusado.
      writeFileSync(join(work, 'functions', 'api', 'products.ts'), '// adulterado')
      expect(checkSnapshot(work).join()).toMatch(
        /diferente do commit comercial: functions\/api\/products\.ts/,
      )
      rmSync(join(work, 'package.json'))
      expect(checkSnapshot(work).join()).toMatch(/ausente no snapshot: package.json/)
      writeFileSync(join(work, '.env.production'), 'X=1')
      expect(checkSnapshot(work).join()).toMatch(/proibido no snapshot: .env.production/)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('preflight completo (leituras injetadas)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chopp-deploy-pre-'))
    writeFileSync(join(dir, 'wrangler.jsonc'), reviewed)
    mkdirSync(join(dir, BUILD_DIR), { recursive: true })
    writeFileSync(join(dir, BUILD_DIR, 'index.html'), '<!doctype html>')
    mkdirSync(join(dir, 'functions', 'api'), { recursive: true })
    writeFileSync(join(dir, 'functions', 'api', 'products.ts'), 'export {}')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('aprova com conta, D1, projeto existente e diretório corretos', () => {
    const result = preflight({
      dir,
      env: okEnv,
      info: okInfo,
      run: projects(['rp-doces', 'chopp-delivery-prod']),
    })
    expect(result).toEqual({ ok: true, problems: [] })
  })

  it('bloqueia projeto inexistente (evita criar ou delegar para Workers por engano)', () => {
    const result = preflight({ dir, env: okEnv, info: okInfo, run: projects(['rp-doces']) })
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toMatch(/não existe na conta/)
  })

  it('não consulta o Pages quando a conta não confere', () => {
    let called = false
    const result = preflight({
      dir,
      env: { CLOUDFLARE_ACCOUNT_ID: '180b51aa94c17aaf72d0674196933b4e' },
      info: okInfo,
      run: () => {
        called = true
        return '[]'
      },
    })
    expect(called).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toMatch(/CLOUDFLARE_ACCOUNT_ID/)
  })

  it('bloqueia quando o D1 resolvido é o de homologação', () => {
    const result = preflight({
      dir,
      env: okEnv,
      info: () => JSON.stringify({ uuid: HOMOLOGATION_D1_ID, name: 'chopp-delivery-homolog-db' }),
      run: projects(['chopp-delivery-prod']),
    })
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toMatch(/homologação/)
  })

  it('bloqueia a raiz do repositório mesmo com conta e projeto corretos', () => {
    const result = preflight({
      dir: ROOT,
      env: okEnv,
      info: okInfo,
      run: projects(['chopp-delivery-prod']),
    })
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toMatch(/raiz do repositório/)
  })

  it('a falha ao listar projetos bloqueia', () => {
    const result = preflight({
      dir,
      env: okEnv,
      info: okInfo,
      run: () => {
        throw new Error('rede')
      },
    })
    expect(result.ok).toBe(false)
  })
})

describe('CLI', () => {
  const cli = (args: string[], env: Record<string, string> = {}) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        ['scripts/production-pages-deploy.mjs', ...args],
        {
          env: { PATH: process.env.PATH ?? '', ...env },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30_000,
        },
      )
      return { status: 0, stdout, stderr: '' }
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string }
      return { status: failure.status, stdout: failure.stdout, stderr: failure.stderr }
    }
  }

  it('imprime o comando fixo sem executar nada', () => {
    const result = cli(['command'])
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(`npx wrangler ${deployArgs().join(' ')}`)
    expect(result.stdout).not.toContain('--config')
  })

  it('o preflight e o deploy bloqueiam sem a conta, sem consultar nem publicar', () => {
    for (const mode of ['preflight', 'deploy']) {
      const result = cli([mode, '--dir', ROOT])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('BLOQUEADO')
      expect(result.stdout).not.toContain('executando')
    }
  })

  it('o deploy executado vem sempre de deployArgs(), o comando fixo validado', () => {
    const source = readFileSync('scripts/production-pages-deploy.mjs', 'utf8')
    expect(source).toContain('[WRANGLER, ...args]')
    expect(source).toContain('const args = deployArgs(commit)')
    expect(source).toContain('checkDeployCommand(args, { commit })')
  })
})

describe('commit de release explícito', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const next = 'b'.repeat(40)
  const cli = (args: string[]) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        ['scripts/production-pages-deploy.mjs', ...args],
        {
          env: { PATH: process.env.PATH ?? '' },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30_000,
        },
      )
      return { status: 0, stdout, stderr: '' }
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string }
      return { status: failure.status, stdout: failure.stdout, stderr: failure.stderr }
    }
  }

  it('o comando do novo release troca só o --commit-hash e continua validado', () => {
    const args = deployArgs(next)
    expect(args).toEqual(deployArgs().map((t) => (t === COMMERCIAL_COMMIT ? next : t)))
    expect(checkDeployCommand(args, { commit: next })).toEqual([])
    // O commit antigo não passa quando o release esperado é outro, e vice-versa.
    expect(checkDeployCommand(deployArgs(), { commit: next }).length).toBeGreaterThan(0)
    expect(checkDeployCommand(args).length).toBeGreaterThan(0)
  })

  it.each([
    ['SHA abreviado', 'bead9d9'],
    ['maiúsculas', 'A'.repeat(40)],
    ['ramo', 'main'],
    ['ausente', undefined],
    ['inexistente', 'c'.repeat(40)],
  ])('recusa %s', (_name, commit) => {
    expect(checkReleaseCommit(commit).length).toBeGreaterThan(0)
  })

  it('recusa o commit já publicado (nada a publicar)', () => {
    expect(checkReleaseCommit(COMMERCIAL_COMMIT).join()).toMatch(/já publicado/)
  })

  it('aceita HEAD quando ele descende do último release publicado', () => {
    if (head === COMMERCIAL_COMMIT) return
    expect(checkReleaseCommit(head)).toEqual([])
  })

  it('a CLI exige --commit válido antes de qualquer consulta ou publicação', () => {
    for (const mode of ['preflight', 'deploy']) {
      const result = cli([mode, '--dir', ROOT, '--commit', 'bead9d9'])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('SHA-1 completo')
      expect(result.stdout).not.toContain('executando')
    }
  })
})
