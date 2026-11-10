import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkAccount,
  describeFailure,
  EXPECTED_ACCOUNT_ID,
  HOMOLOGATION_D1_ID,
  PRODUCTION_D1_ID,
  PRODUCTION_D1_NAME,
} from '../../scripts/production-account-guard.mjs'

// Pré-requisitos do bootstrap de produção (H10.9-B): guarda de conta e geração do pepper.
// Tudo local. O guarda só lê (`d1 info`) quando a variável de conta confere; os testes injetam a leitura.

const info =
  (uuid: string, name = PRODUCTION_D1_NAME) =>
  () =>
    JSON.stringify({ uuid, name })
const envOk = { CLOUDFLARE_ACCOUNT_ID: EXPECTED_ACCOUNT_ID }

describe('guarda de conta e D1 de produção', () => {
  it('confirma a conta e o D1 esperados', () => {
    expect(checkAccount({ env: envOk, info: info(PRODUCTION_D1_ID) })).toEqual({ ok: true })
    // A saída do Wrangler pode trazer texto antes do JSON.
    expect(
      checkAccount({
        env: envOk,
        info: () =>
          ` ⛅️ wrangler\n${JSON.stringify({ uuid: PRODUCTION_D1_ID, name: PRODUCTION_D1_NAME })}`,
      }),
    ).toEqual({ ok: true })
  })

  it.each([
    ['sem variável de conta', {}],
    [
      'conta diferente (a outra conta do usuário)',
      { CLOUDFLARE_ACCOUNT_ID: '180b51aa94c17aaf72d0674196933b4e' },
    ],
    ['conta em branco', { CLOUDFLARE_ACCOUNT_ID: '' }],
  ])('bloqueia antes de qualquer consulta: %s', (_name, env) => {
    let called = false
    const result = checkAccount({
      env,
      info: () => {
        called = true
        return '{}'
      },
    })
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  it.each([
    ['D1 de homologação', info(HOMOLOGATION_D1_ID, 'chopp-delivery-homolog-db')],
    ['UUID de outro banco', info('00000000-0000-4000-8000-000000000000')],
    ['nome diferente', info(PRODUCTION_D1_ID, 'outro-banco')],
    [
      'falha na leitura',
      () => {
        throw new Error('token SEGREDO-NAO-VAZAR')
      },
    ],
    ['resposta que não é JSON', () => 'sem json'],
  ])('bloqueia: %s', (_name, reader) => {
    const result = checkAccount({ env: envOk, info: reader, wait: () => {} })
    expect(result.ok).toBe(false)
    // O motivo é fixo: não repete a saída nem a mensagem de erro do Wrangler.
    expect(JSON.stringify(result)).not.toMatch(/SEGREDO|token|Bearer/i)
  })

  it('falha transitória na leitura tem uma nova tentativa; sucesso exige a identidade correta', () => {
    let calls = 0
    const waits: number[] = []
    const flaky = () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('x'), { status: 1, stderr: 'fetch failed' })
      return JSON.stringify({ uuid: PRODUCTION_D1_ID, name: PRODUCTION_D1_NAME })
    }
    expect(checkAccount({ env: envOk, info: flaky, wait: (ms) => waits.push(ms) })).toEqual({
      ok: true,
    })
    expect(calls).toBe(2)
    expect(waits).toEqual([2000])
  })

  it('o banco errado nunca é repetido nem aceito, mesmo após falha transitória', () => {
    let calls = 0
    const wrongAfterFailure = () => {
      calls += 1
      if (calls === 1) throw new Error('x')
      return JSON.stringify({ uuid: HOMOLOGATION_D1_ID, name: 'chopp-delivery-homolog-db' })
    }
    expect(checkAccount({ env: envOk, info: wrongAfterFailure, wait: () => {} }).ok).toBe(false)
    let reads = 0
    checkAccount({
      env: envOk,
      info: () => {
        reads += 1
        return info(HOMOLOGATION_D1_ID)()
      },
    })
    expect(reads).toBe(1)
  })

  it('a falha persistente informa a causa técnica, sem segredos, e continua bloqueando', () => {
    const token = 'A'.repeat(40)
    const timeout = Object.assign(new Error('x'), { code: 'ETIMEDOUT', stderr: '' })
    const exit = Object.assign(new Error('Authorization: Bearer SEGREDO'), {
      status: 1,
      stderr: `
  Authentication error ${token}
segunda linha`,
    })
    const reason = (error: Error) => {
      const result = checkAccount({
        env: envOk,
        info: () => {
          throw error
        },
        wait: () => {},
      })
      return result.ok ? '' : result.reason
    }
    expect(reason(timeout)).toMatch(/tempo esgotado/)
    const withExit = reason(exit)
    expect(withExit).toMatch(/código 1: Authentication error \[omitido\]/)
    expect(withExit).not.toMatch(/SEGREDO|Bearer|AAAA|segunda linha/)
    expect(describeFailure(new SyntaxError('x'))).toMatch(/não é JSON/)
  })

  it('a CLI encerra com código 1 e não consulta a rede quando a conta não confere', () => {
    for (const env of [{}, { CLOUDFLARE_ACCOUNT_ID: '180b51aa94c17aaf72d0674196933b4e' }]) {
      let status = 0
      let stderr = ''
      try {
        execFileSync(process.execPath, ['scripts/production-account-guard.mjs'], {
          env: { PATH: process.env.PATH ?? '', ...env },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30_000,
        })
      } catch (error) {
        const failure = error as { status: number; stderr: string }
        status = failure.status
        stderr = failure.stderr
      }
      expect(status).toBe(1)
      expect(stderr).toContain('BLOQUEADO')
    }
  })
})

describe.skipIf(process.platform !== 'win32')(
  'PowerShell do runbook: pepper e envio de secrets',
  () => {
    const runbook = readFileSync('docs/production-bootstrap-runbook.md', 'utf8')
    const block = (marker: string) => {
      const found = [...runbook.matchAll(/```powershell\r?\n([\s\S]*?)```/g)]
        .map((m) => m[1])
        .find((code) => code.startsWith(marker))
      expect(found, marker).toBeDefined()
      return found as string
    }

    // "Wrangler" de teste: recebe pelo stdin e devolve só hash e metadados, nunca o valor.
    const probe = `
const crypto = require('node:crypto')
const mode = process.argv[2]
const chunks = []
process.stdin.on('data', (c) => chunks.push(c)).on('end', () => {
  const b = Buffer.concat(chunks)
  if (mode === 'prompt') return console.log('Enter a secret value:')
  if (mode === 'fail') { console.error('boom'); process.exit(3) }
  if (mode === 'hang') return setTimeout(() => {}, 30000)
  console.log(JSON.stringify({ tty: Boolean(process.stdin.isTTY), bytes: b.length, sha: crypto.createHash('sha256').update(b).digest('hex'), head: b.subarray(0, 3).toString('hex'), tail: b.subarray(-2).toString('hex'), argv: process.argv.slice(2) }))
})
`
    const harness = (probePath: string) =>
      [
        block('# [pepper-gerar]'),
        block('# [send-secret]'),
        `$Wrangler = '${probePath}'`,
        // Valores só de teste. O hash esperado é calculado aqui; o valor nunca é impresso.
        'function Expected($s) { $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { $t = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }; [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash((New-Object Text.UTF8Encoding $false).GetBytes($t))).Replace("-","").ToLower() }',
        'function Case($name, [scriptblock]$body) { Write-Output "### $name"; try { & $body } catch { Write-Output "THROW: $($_.Exception.Message)" } }',
        '$Accent = ConvertTo-SecureString "sênha-ção-123456" -AsPlainText -Force',
        '$Empty = New-Object Security.SecureString',
        'Case "pepper" { Write-Output "expected=$(Expected $Pepper)"; Send-Secret $Pepper @("echo", "ADMIN_PASSWORD_PEPPER") }',
        'Case "pepper-de-novo" { Send-Secret $Pepper @("echo", "ADMIN_PASSWORD_PEPPER") }',
        'Case "acentos" { Write-Output "expected=$(Expected $Accent)"; Send-Secret $Accent @("echo") }',
        'Case "prompt" { Send-Secret $Pepper @("prompt") }',
        'Case "falha" { Send-Secret $Pepper @("fail") }',
        'Case "tempo" { $t = Get-Date; try { Send-Secret $Pepper @("hang") -TimeoutSeconds 2 } finally { Write-Output ("elapsed=" + [int]((Get-Date) - $t).TotalSeconds) } }',
        'Case "vazio" { Send-Secret $Empty @("echo") }',
        `Case "aspas" { Send-Secret $Pepper @("echo", 'a"b') }`,
        '[pscustomobject]@{ gone = ($null -eq (Get-Variable -Name bytes,hex,rng -ErrorAction SilentlyContinue)); secure = ($Pepper -is [securestring]) } | ConvertTo-Json -Compress',
      ].join('\n')

    const sections = (out: string) => {
      const result = new Map<string, string[]>()
      let current = ''
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('### ')) {
          current = line.slice(4)
          result.set(current, [])
        } else if (current) result.get(current)?.push(line)
      }
      return result
    }
    const json = (lines: string[] | undefined) =>
      JSON.parse(lines?.find((l) => l.startsWith('{')) ?? '{}') as {
        tty: boolean
        bytes: number
        sha: string
        head: string
        tail: string
        argv: string[]
      }

    const run = () => {
      const dir = mkdtempSync(join(tmpdir(), 'chopp-send-secret-'))
      try {
        const probePath = join(dir, 'probe.js')
        writeFileSync(probePath, probe)
        const file = join(dir, 'harness.ps1')
        // BOM UTF-8: sem ele o Windows PowerShell 5.1 lê o .ps1 como ANSI e corrompe os acentos do teste.
        writeFileSync(file, `﻿${harness(probePath)}`)
        // O node do teste precisa estar no PATH do PowerShell filho (Get-Command node).
        const out = execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
          {
            encoding: 'utf8',
            timeout: 120_000,
            env: { ...process.env, PATH: `${dirname(process.execPath)};${process.env.PATH ?? ''}` },
          },
        )
        return out
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    it('entrega bytes exatos pelo stdin (sem BOM, sem CRLF, sem terminal), o mesmo valor duas vezes', () => {
      const out = run()
      const all = sections(out)
      const expected = (name: string) =>
        all
          .get(name)
          ?.find((l) => l.startsWith('expected='))
          ?.slice('expected='.length)

      const first = json(all.get('pepper'))
      expect(first.tty).toBe(false) // stdin redirecionado: o prompt interativo não pode abrir
      expect(first.bytes).toBe(64)
      expect(first.head).not.toBe('efbbbf')
      expect(first.tail).not.toBe('0d0a')
      expect(first.sha).toBe(expected('pepper'))
      expect(first.argv).toEqual(['echo', 'ADMIN_PASSWORD_PEPPER']) // só nomes, nunca o valor
      // O mesmo SecureString chega idêntico a um segundo envio (Worker e Pages).
      expect(json(all.get('pepper-de-novo')).sha).toBe(first.sha)

      const accent = json(all.get('acentos'))
      expect(accent.sha).toBe(expected('acentos'))
      expect(accent.head).not.toBe('efbbbf')
      expect(accent.bytes).toBe(Buffer.byteLength('sênha-ção-123456', 'utf8'))

      // O valor nunca é impresso sozinho em uma linha: só hashes, metadados e mensagens fixas.
      expect(out.split(/\r?\n/).some((line) => /^[a-f0-9]{64}$/.test(line))).toBe(false)
    }, 180_000)

    it('interrompe em prompt inesperado, falha, tempo esgotado, segredo vazio e argumento inválido', () => {
      const all = sections(run())
      expect(all.get('prompt')?.join('\n')).toMatch(/THROW: .*prompt interativo/)
      expect(all.get('falha')?.join('\n')).toMatch(/THROW: .*falhou \(codigo 3\)/)
      const timeout = all.get('tempo')?.join('\n') ?? ''
      expect(timeout).toMatch(/THROW: Tempo esgotado/)
      expect(Number(/elapsed=(\d+)/.exec(timeout)?.[1])).toBeLessThan(20)
      expect(all.get('vazio')?.join('\n')).toMatch(/THROW: Segredo vazio/)
      expect(all.get('aspas')?.join('\n')).toMatch(/THROW: Argumento invalido/)
      // Nenhum erro vaza o valor: só a mensagem fixa e a saída do Wrangler (aqui, "boom").
      expect(all.get('falha')?.join('\n')).toContain('boom')
    }, 180_000)

    it('o pepper é gerado em memória, com 64 hex, e as temporárias são limpas', () => {
      const out = run()
      const state = JSON.parse(
        out
          .split(/\r?\n/)
          .filter((l) => l.startsWith('{"gone"'))
          .pop() ?? '{}',
      )
      expect(state).toEqual({ gone: true, secure: true })
      const code = block('# [pepper-gerar]')
      expect(code).not.toMatch(
        /Out-File|Set-Content|Add-Content|>>|Write-(Host|Output)|Get-Random|Start-Transcript/,
      )
      expect(code).toContain('RandomNumberGenerator')
      expect(code).toContain('Remove-Variable bytes, hex, rng')
    }, 180_000)

    it('o Send-Secret não usa pipeline, arquivo, variável de ambiente nem argumento com o valor', () => {
      const code = block('# [send-secret]')
      expect(code).toContain('RedirectStandardInput = $true')
      expect(code).toContain('UTF8Encoding $false')
      expect(code).toContain('BaseStream.Write')
      expect(code).toContain('Enter a secret value')
      expect(code).toContain('$proc.Kill()')
      expect(code).not.toMatch(
        /\$input|\| *& *\$|Out-File|Set-Content|Add-Content|\$env:|SetEnvironmentVariable|Start-Transcript/,
      )
      // Nenhum envio de secret no runbook usa scriptblock com npx (o padrão que abria o prompt).
      expect(runbook).not.toMatch(/Send-Secret \$\w+ \{/)
    })
  },
)
