import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildConfig,
  FILE_NAME,
  HOMOLOGATION_D1_ID,
  MODES,
  ROOT,
  writeConfig,
} from '../../scripts/production-bootstrap-config.mjs'
import { checkDeployCommand, deployArgs } from '../../scripts/production-pages-deploy.mjs'
import { handleLogin } from '../../server/auth/handlers'
import worker, {
  ARMED,
  MAX_WINDOW_MS,
  type ProductionBootstrapEnv,
} from '../../server/auth/production-bootstrap-worker'
import { authFixture } from './auth-fixture'

// Procedimento completo, só local: gerador de configuração -> Worker -> D1 Miniflare -> login real.
// Nada remoto. O Wrangler é usado apenas com --dry-run e --help (sem credenciais nem rede).
const origin = 'https://chopp-prod.example'
const d1Id = '11111111-2222-4333-8444-555555555555'
const pepper = 'ef'.repeat(32)
const password = 'Frase longa exclusiva do procedimento'
const event = () => ({ noRetry: vi.fn() })
const logged = () =>
  JSON.stringify([...vi.mocked(console.info).mock.calls, ...vi.mocked(console.error).mock.calls])
const wrangler = (args: string[], cwd = ROOT) =>
  execFileSync(process.execPath, [join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
  })

describe('configuração externa gerada', () => {
  let out: string
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'chopp-pb-'))
  })
  afterEach(() => rmSync(out, { recursive: true, force: true }))
  const base = { origin, d1Id, username: 'dono-teste' }

  it('cada modo tem o armamento, o cron e o comando esperados', () => {
    const now = new Date('2026-11-07T17:50:00Z')
    const prepare = buildConfig({ ...base, mode: 'prepare' }, now).config
    expect(prepare.triggers.crons).toEqual([])
    expect(prepare.vars.PRODUCTION_BOOTSTRAP_ENABLED).toBe('disabled')
    expect(prepare.vars.PRODUCTION_BOOTSTRAP_COMMAND).toBeUndefined()

    const inspect = buildConfig({ ...base, mode: 'inspect' }, now)
    expect(inspect.config.vars.PRODUCTION_BOOTSTRAP_ENABLED).toBe(ARMED)
    expect(inspect.cron).toBe('53 17 7 11 *')
    expect(inspect.config.triggers.crons).toEqual([inspect.cron])
    const command = JSON.parse(inspect.config.vars.PRODUCTION_BOOTSTRAP_COMMAND)
    expect(command).toMatchObject({ action: 'inspect', origin, environment: 'production' })
    expect(command.commandId).toMatch(/^[0-9a-f-]{36}$/)
    expect(command.username).toBeUndefined()

    const check = buildConfig({ ...base, mode: 'disarm-check' }, now).config
    expect(check.vars.PRODUCTION_BOOTSTRAP_ENABLED).toBe('disabled')
    expect(check.vars.PRODUCTION_BOOTSTRAP_COMMAND).toBeUndefined()
    expect(check.triggers.crons).toHaveLength(1)

    // Comandos distintos a cada geração; a janela não passa do limite do Worker.
    const a = buildConfig({ ...base, mode: 'bootstrap' }, now)
    const b = buildConfig({ ...base, mode: 'bootstrap' }, now)
    expect(JSON.parse(a.config.vars.PRODUCTION_BOOTSTRAP_COMMAND).commandId).not.toBe(
      JSON.parse(b.config.vars.PRODUCTION_BOOTSTRAP_COMMAND).commandId,
    )
    expect(a.expiresAt - now.getTime()).toBeLessThanOrEqual(MAX_WINDOW_MS)
  })

  it('fixa a conta de produção em todos os modos', () => {
    for (const mode of MODES)
      expect(buildConfig({ ...base, mode }).config.account_id).toBe(
        '7d8a62a0e64b693184975560c7cb788d',
      )
  })

  it.each([
    ['modo', { mode: 'recover' }],
    ['origem http', { mode: 'prepare', origin: 'http://chopp-prod.example' }],
    [
      'origem de homologação',
      { mode: 'prepare', origin: 'https://chopp-delivery-homolog.pages.dev' },
    ],
    ['origem com caminho', { mode: 'prepare', origin: `${origin}/admin` }],
    ['D1 da homologação', { mode: 'prepare', d1Id: HOMOLOGATION_D1_ID }],
    ['D1 que não é UUID', { mode: 'prepare', d1Id: 'meu-banco' }],
    ['janela acima do limite', { mode: 'inspect', windowMinutes: 61 }],
    ['janela menor que o atraso', { mode: 'inspect', windowMinutes: 4, delayMinutes: 3 }],
    ['usuário inválido no bootstrap', { mode: 'bootstrap', username: 'Dono Teste' }],
  ])('recusa: %s', (_name, change) => {
    expect(() => buildConfig({ ...base, ...change })).toThrow()
  })

  it('só escreve fora do repositório e não toca o modelo versionado', () => {
    const template = readFileSync('config/cloudflare/production-bootstrap-worker.jsonc', 'utf8')
    expect(() => writeConfig({ ...base, mode: 'prepare', out: join(ROOT, 'tmp-pb') })).toThrow()
    expect(() => writeConfig({ ...base, mode: 'prepare', out: ROOT })).toThrow()
    const { file } = writeConfig({ ...base, mode: 'prepare', out })
    expect(file).toBe(join(out, FILE_NAME))
    expect(readFileSync('config/cloudflare/production-bootstrap-worker.jsonc', 'utf8')).toBe(
      template,
    )
    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(existsSync(written.main)).toBe(true)
    expect(JSON.stringify(written)).not.toMatch(/PASSWORD=|PEPPER=|\b[a-f0-9]{64}\b/)
  })

  it('o Wrangler instalado resolve main e valida os bindings da cópia externa', () => {
    for (const mode of ['prepare', 'bootstrap']) {
      const dir = join(out, mode)
      const { file } = writeConfig({ ...base, mode, out: dir })
      wrangler(['deploy', '--dry-run', '--outdir', join(dir, 'bundle'), '--config', file])
      expect(readFileSync(join(dir, 'bundle', 'production-bootstrap-worker.js'), 'utf8')).toContain(
        'PRODUCTION_BOOTSTRAP',
      )
    }
  }, 120_000)

  it('o modelo copiado sem o gerador NÃO resolve main (por isso o gerador é obrigatório)', () => {
    const copy = join(out, 'modelo')
    writeConfig({ ...base, mode: 'prepare', out: copy })
    const raw = readFileSync('config/cloudflare/production-bootstrap-worker.jsonc', 'utf8')
    const file = join(copy, 'modelo.jsonc')
    // Cópia literal do modelo (main relativo) fora do repositório.
    writeFileSync(file, raw)
    expect(() =>
      wrangler(['deploy', '--dry-run', '--outdir', join(copy, 'b'), '--config', file]),
    ).toThrow()
  }, 120_000)
})

describe('runbook executável e verificável', () => {
  const runbook = readFileSync('docs/production-bootstrap-runbook.md', 'utf8')
  // Só os comandos dentro de blocos de código: a prosa pode citar o Wrangler sem ser comando.
  const blocks = [...runbook.matchAll(/```powershell\r?\n([\s\S]*?)```/g)].map((m) => m[1])
  // Os envios de secret (`Send-Secret $X @('secret', 'put', ...)`) executam o Wrangler por .NET:
  // são tratados como a linha `npx wrangler ...` equivalente para validar subcomando e flags.
  const sendSecret = /^Send-Secret \$\w+ @\((.+)\)\s*$/
  const lines = blocks
    .join('\n')
    .split(/\r?\n/)
    .map((line) => {
      const match = sendSecret.exec(line)
      return match
        ? `npx wrangler ${match[1]
            .split(',')
            .map((token) => token.trim().replace(/^'|'$/g, ''))
            .join(' ')}`
        : line
    })
    .filter((line) => line.includes('npx wrangler '))
  const KNOWN = [
    'pages secret put',
    'pages secret list',
    'pages deployment list',
    'pages deploy',
    'secret put',
    'secret delete',
    'secret list',
    'deployments list',
    'd1 execute',
    'd1 info',
    'deploy',
    'delete',
    'tail',
    '--version',
  ]
  const parse = (line: string) => {
    const tail = line.slice(line.indexOf('npx wrangler ') + 'npx wrangler '.length)
    const words = tail.split(/\s+/)
    const command = KNOWN.find((c) => tail.startsWith(`${c} `) || tail === c)
    return { command, flags: words.filter((w) => /^--[a-z-]+$/.test(w)) }
  }

  it('toda linha do Wrangler usa um subcomando e flags que existem na versão instalada', () => {
    expect(lines.length).toBeGreaterThan(10)
    const help = new Map<string, string>()
    for (const line of lines) {
      const { command, flags } = parse(line)
      expect(command, line).toBeDefined()
      if (command === '--version') continue
      if (!help.has(command as string))
        help.set(command as string, wrangler([...(command as string).split(' '), '--help']))
      for (const flag of flags)
        expect(help.get(command as string), `${flag} em: ${line}`).toContain(flag)
    }
  }, 240_000)

  it('o Wrangler instalado é o 4.151.0 citado', () => {
    expect(wrangler(['--version']).trim()).toContain('4.151.0')
    expect(runbook).toContain('4.151.0')
  }, 60_000)

  it('nenhum segredo vai por argumento, variável de linha de comando ou arquivo', () => {
    for (const line of lines) {
      expect(line).not.toMatch(/--var\b/)
      expect(line).not.toMatch(/(PASSWORD|PEPPER)\s*[=:]\s*\S/)
      if (/secret put/.test(line)) expect(line).not.toMatch(/secret put \S+ (?!--)\S/)
    }
    expect(runbook).toContain('Read-Host')
    expect(runbook).toContain('-AsSecureString')
    expect(runbook).not.toMatch(/[a-f0-9]{64}/)
  })

  it('toda operação que altera algo é precedida por Assert-Prod no mesmo bloco', () => {
    expect(runbook).toContain('function Assert-Prod')
    expect(runbook).toContain("$env:CLOUDFLARE_ACCOUNT_ID = '7d8a62a0e64b693184975560c7cb788d'")
    const mutating =
      /(npx wrangler (deploy(?! --dry-run)|secret (put|delete)|pages secret put|pages deploy|delete)\b|production-pages-deploy\.mjs deploy|Send-Secret \$\w+ @\()/
    let checked = 0
    for (const block of blocks.filter((b) => mutating.test(b))) {
      const rows = block.split(/\r?\n/)
      rows.forEach((row, index) => {
        if (!mutating.test(row) || row.includes('function ')) return
        expect(
          rows.slice(0, index).some((r) => r.trim() === 'Assert-Prod'),
          row,
        ).toBe(true)
        checked += 1
      })
    }
    expect(checked).toBeGreaterThanOrEqual(8)
  })

  it('o backup, o alvo e a branch de produção estão registrados sem presunções', () => {
    expect(runbook).toContain(String.raw`C:\Users\zzzzz\chopp-delivery-prod-h10.8.sql`)
    expect(runbook).toContain('fe4492e3-94a4-4f9a-b44c-10a39fe21bd1')
    // A branch de produção é `main` (confirmada no painel) e nenhuma outra aparece em --branch.
    expect(runbook).toContain('--branch main')
    expect(runbook).not.toMatch(/--branch (?!main\b)\S+/)
    expect(runbook).not.toContain('$ProdBranch')
    expect(runbook).toContain('**Production**')
  })

  it('pages deploy nunca recebe --config e sai de um diretório isolado a partir de git archive', () => {
    // Em qualquer linha do runbook que cite `pages deploy`, `--config` não pode aparecer.
    for (const line of runbook.split(/\r?\n/).filter((l) => /pages deploy\b/.test(l)))
      if (!line.includes('não aceita `--config`') && !line.includes('`--config` não existe'))
        expect(line, line).not.toMatch(/--config|\s-c\s/)
    // O comando fixo documentado passa pelo validador e tem flags que existem no Wrangler instalado.
    const fixed = /```text\r?\n(npx wrangler pages deploy [^\r\n]+)\r?\n```/.exec(runbook)?.[1]
    expect(fixed).toBeDefined()
    // O runbook documenta o comando com um marcador para o SHA do release (que é informado em
    // `--commit`); com qualquer SHA completo no lugar, o validador e o comando fixo coincidem.
    const release = 'a'.repeat(40)
    expect(fixed).toContain('--commit-hash <SHA-1-do-release>')
    const tokens = (fixed as string)
      .replace('npx wrangler ', '')
      .replace('<SHA-1-do-release>', release)
      .split(/\s+/)
    expect(checkDeployCommand(tokens, { commit: release })).toEqual([])
    expect(tokens).toEqual(deployArgs(release))
    const help = wrangler(['pages', 'deploy', '--help'])
    for (const flag of tokens.filter((t) => t.startsWith('--')).map((t) => t.split('=')[0]))
      expect(help, flag).toContain(flag)
    expect(help).not.toMatch(/^\s+--config\s/m)
    // Procedimento do diretório isolado.
    expect(runbook).toContain('git archive --format=tar -o $Tar $Commit')
    // O `tar` do Git trata `C:` como host remoto: o runbook usa o do Windows por caminho absoluto.
    expect(runbook).toContain(String.raw`& "$env:SystemRoot\System32\tar.exe" -xf $Tar -C $Deploy`)
    expect(runbook).not.toMatch(/^tar -/m)
    // O commit do Pages vem de `--commit` (nunca fixo no runbook) e é validado contra o último release.
    expect(runbook).not.toContain('bead9d9c66be74b48604a045b25ae81f64ae2630')
    expect(runbook).toContain('preflight --dir $Deploy --commit $Commit')
    expect(runbook).toContain('deploy --dir $Deploy --commit $Commit --confirm chopp-delivery-prod')
    expect(runbook).toContain('COMMERCIAL_COMMIT')
    expect(runbook).toContain(
      "Copy-Item wrangler.production.jsonc (Join-Path $Deploy 'wrangler.jsonc') -Force",
    )
    expect(runbook).toContain("$env:VITE_WHATSAPP_NUMBER = '5531984400001'")
    expect(runbook).toContain('npm run build:commercial')
    expect(runbook).toContain('node scripts/production-pages-deploy.mjs preflight --dir $Deploy')
    expect(runbook).toContain('--confirm chopp-delivery-prod')
    // A junção do node_modules é removida antes de apagar o diretório.
    expect(runbook.indexOf("cmd /c rmdir (Join-Path $Deploy 'node_modules')")).toBeLessThan(
      runbook.indexOf('Remove-Item -Recurse -Force $Deploy'),
    )
  }, 90_000)

  it('documenta as verificações pós-deploy e a identidade do D1 sem escrita nossa', () => {
    for (const expected of [
      '/api/products',
      '/api/site',
      'CMS_NOT_PUBLISHED',
      '/api/auth/me',
      'HTTP **401**',
      'HTTP **404**',
      'HTTP **200**',
      'ambiente **Production** e branch `main`',
      'admin_login_limits',
      'idênticos',
    ])
      expect(runbook, expected).toContain(expected)
  })

  it('o fluxo cita as fases exigidas, em ordem', () => {
    const order = [
      '### 1. Preparação desarmada',
      '### 2. Deploy desarmado e secrets',
      '### 2b. Deploy de produção do Pages',
      '### 3. Inspeção armada',
      '### 4. Bootstrap supervisionado',
      '### 5. Reconciliação',
      '### 6. Desarmamento e remoção',
    ].map((heading) => runbook.indexOf(heading))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})

describe('fluxo completo local: gerador, Worker, D1 e login real', () => {
  let fixture: Awaited<ReturnType<typeof authFixture>>
  let out: string
  const env = (generated: ReturnType<typeof buildConfig>): ProductionBootstrapEnv => ({
    DELEGAS_DB: fixture.db,
    PRODUCTION_BOOTSTRAP_PASSWORD: password,
    ADMIN_PASSWORD_PEPPER: pepper,
    ...(generated.config.vars as ProductionBootstrapEnv),
  })
  const counts = async () =>
    Promise.all(
      ['admin_users', 'admin_sessions', 'admin_login_limits'].map((table) =>
        fixture.db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>('n'),
      ),
    )
  const login = (username: string, secret: string) =>
    handleLogin(
      new Request(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
          'cf-connecting-ip': '203.0.113.9',
        },
        body: JSON.stringify({ username, password: secret }),
      }),
      { DELEGAS_DB: fixture.db, ADMIN_ORIGIN: origin, ADMIN_PASSWORD_PEPPER: pepper },
    )
  const generate = (mode: string, now = new Date()) =>
    buildConfig({ mode, origin, d1Id, username: 'dono-teste' }, now)

  beforeEach(async () => {
    fixture = await authFixture()
    await fixture.db.batch([
      fixture.db.prepare(
        'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)',
      ),
      fixture.db
        .prepare('INSERT INTO d1_migrations (name) VALUES (?), (?)')
        .bind('0003_admin_auth.sql', '0012_cms_publication.sql'),
    ])
    out = mkdtempSync(join(tmpdir(), 'chopp-pb-flow-'))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(async () => {
    await fixture?.runtime.dispose()
    rmSync(out, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('inspect → bootstrap → inspect → login → desarmado, sem vazar segredos', async () => {
    const before = await counts()
    await worker.scheduled(event(), env(generate('inspect')))
    expect(await counts()).toEqual(before) // inspeção não muta nada
    expect(console.info).toHaveBeenLastCalledWith(
      'PRODUCTION_BOOTSTRAP',
      expect.objectContaining({ result: 'INSPECTED', owner: null }),
    )

    await worker.scheduled(event(), env(generate('bootstrap')))
    expect((await counts())[0]).toBe(1)
    expect(console.info).toHaveBeenLastCalledWith(
      'PRODUCTION_BOOTSTRAP',
      expect.objectContaining({ result: 'APPLIED' }),
    )

    const afterBootstrap = await counts()
    await worker.scheduled(event(), env(generate('inspect')))
    expect(await counts()).toEqual(afterBootstrap)
    expect(console.info).toHaveBeenLastCalledWith(
      'PRODUCTION_BOOTSTRAP',
      expect.objectContaining({
        owner: { username: 'dono-teste', active: true, authVersion: 1 },
      }),
    )

    // Login real do Pages com a conta criada pelo Worker (mesmo pepper e mesma senha).
    expect((await login('dono-teste', password)).status).toBe(200)
    expect((await login('dono-teste', `${password}x`)).status).toBe(401)

    // Desarmado (também com secrets removidos): só DISARMED, sem tocar o banco.
    const sealed = new Proxy(fixture.db, {
      get: (target, key) => {
        if (key === 'prepare') throw new Error('banco não deve ser tocado')
        return Reflect.get(target, key)
      },
    })
    const check = generate('disarm-check')
    await worker.scheduled(event(), {
      ...(check.config.vars as ProductionBootstrapEnv),
      DELEGAS_DB: sealed,
    })
    expect(console.info).toHaveBeenLastCalledWith('PRODUCTION_BOOTSTRAP', { result: 'DISARMED' })

    const output = logged()
    for (const secret of [password, pepper]) expect(output).not.toContain(secret)
    expect(output).not.toMatch(/pbkdf2/)
  })

  it('UUID do comando em maiúsculas é recusado; o gerador sempre produz minúsculas', async () => {
    const generated = generate('bootstrap')
    const command = JSON.parse(generated.config.vars.PRODUCTION_BOOTSTRAP_COMMAND)
    expect(command.commandId).toBe(command.commandId.toLowerCase())
    const upper = {
      ...env(generated),
      PRODUCTION_BOOTSTRAP_COMMAND: JSON.stringify({
        ...command,
        commandId: command.commandId.toUpperCase(),
      }),
    }
    await worker.scheduled(event(), upper)
    expect((await counts())[0]).toBe(0)
    expect(logged()).not.toContain(password)
  })

  it('expiração: recusa em expiresAt <= agora e depois da janela, aceita dentro do limite', async () => {
    const NOW = Date.now()
    const spy = vi.spyOn(Date, 'now')
    const generated = generate('bootstrap')
    const command = JSON.parse(generated.config.vars.PRODUCTION_BOOTSTRAP_COMMAND)
    const run = (expiresAt: number) =>
      worker.scheduled(event(), {
        ...env(generated),
        PRODUCTION_BOOTSTRAP_COMMAND: JSON.stringify({ ...command, expiresAt }),
      })
    spy.mockReturnValue(NOW)
    await run(NOW) // exatamente agora: expirado
    await run(NOW + MAX_WINDOW_MS + 1) // janela maior que o limite
    expect((await counts())[0]).toBe(0)
    // Comando válido hoje, vencido depois: o mesmo comando deixa de funcionar com o tempo.
    spy.mockReturnValue(NOW + 10 * 60_000)
    await run(NOW + 9 * 60_000)
    expect((await counts())[0]).toBe(0)
    spy.mockReturnValue(NOW)
    await run(NOW + MAX_WINDOW_MS) // exatamente o limite: aceito
    expect((await counts())[0]).toBe(1)
  })

  it('d1_migrations ausente fecha sem criar conta', async () => {
    await fixture.db.prepare('DROP TABLE d1_migrations').run()
    await worker.scheduled(event(), env(generate('bootstrap')))
    expect((await counts())[0]).toBe(0)
    expect(console.error).toHaveBeenCalledWith(
      'PRODUCTION_BOOTSTRAP',
      expect.objectContaining({ result: 'REFUSED_OR_UNCONFIRMED', stage: 'database' }),
    )
  })

  const flaky = (mode: 'before' | 'after') =>
    new Proxy(fixture.db, {
      get(target, key) {
        if (key !== 'prepare') return Reflect.get(target, key)
        return (sql: string) => {
          const statement = target.prepare(sql)
          if (!sql.includes('INSERT INTO admin_users')) return statement
          return {
            bind: (...values: unknown[]) => {
              const bound = statement.bind(...values)
              return {
                run: async () => {
                  if (mode === 'before') throw new Error(`${password} D1_BEFORE_SENTINEL`)
                  await bound.run()
                  throw new Error(`${pepper} D1_AFTER_SENTINEL`)
                },
              }
            },
          }
        }
      },
    }) as D1Database

  it('falha do D1 antes da escrita: nada é gravado e a repetição funciona', async () => {
    const generated = generate('bootstrap')
    await worker.scheduled(event(), { ...env(generated), DELEGAS_DB: flaky('before') })
    expect((await counts())[0]).toBe(0)
    expect(console.error).toHaveBeenCalledWith(
      'PRODUCTION_BOOTSTRAP',
      expect.objectContaining({ result: 'REFUSED_OR_UNCONFIRMED', stage: 'd1_write' }),
    )
    expect(logged()).not.toMatch(/SENTINEL|Frase longa/)
    await worker.scheduled(event(), env(generated))
    expect((await counts())[0]).toBe(1)
  })

  it('falha do D1 depois da escrita (resposta perdida): UNCONFIRMED, uma conta e repetição NOT_APPLIED', async () => {
    const generated = generate('bootstrap')
    await worker.scheduled(event(), { ...env(generated), DELEGAS_DB: flaky('after') })
    expect((await counts())[0]).toBe(1)
    expect(console.error).toHaveBeenCalledWith(
      'PRODUCTION_BOOTSTRAP',
      expect.objectContaining({ result: 'REFUSED_OR_UNCONFIRMED', stage: 'd1_write' }),
    )
    expect(logged()).not.toMatch(/SENTINEL/)
    const [owner] = (await fixture.db.prepare('SELECT password_hash FROM admin_users').all())
      .results
    await worker.scheduled(event(), env(generated))
    expect(console.info).toHaveBeenLastCalledWith('PRODUCTION_BOOTSTRAP', {
      commandId: expect.any(String),
      result: 'NOT_APPLIED',
    })
    expect(
      (await fixture.db.prepare('SELECT password_hash FROM admin_users').all()).results,
    ).toEqual([owner])
    expect((await login('dono-teste', password)).status).toBe(200)
  })

  it('várias execuções simultâneas criam uma só conta e as demais não aplicam', async () => {
    const generated = generate('bootstrap')
    await Promise.all(Array.from({ length: 5 }, () => worker.scheduled(event(), env(generated))))
    expect((await counts())[0]).toBe(1)
    const results = vi
      .mocked(console.info)
      .mock.calls.map((call) => (call[1] as { result: string }).result)
    expect(results.filter((r) => r === 'APPLIED')).toHaveLength(1)
  })

  it('o módulo não expõe HTTP e a configuração gerada não tem rota nem preview', () => {
    expect(Object.keys(worker)).toEqual(['scheduled'])
    const config = writeConfig({
      mode: 'bootstrap',
      origin,
      d1Id,
      username: 'dono-teste',
      out,
    }).config
    expect(config.routes).toEqual([])
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.r2_buckets).toBeUndefined()
    expect(config.services).toBeUndefined()
  })
})
