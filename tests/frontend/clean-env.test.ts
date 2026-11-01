import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { childEnv, SENSITIVE_NAME, sanitizeProcessEnv } from '../../scripts/clean-env.mts'

const OPERATOR = {
  Path: 'C:\\Windows\\System32',
  SystemRoot: 'C:\\Windows',
  TEMP: 'C:\\Temp',
  USERPROFILE: 'C:\\Users\\op',
  APPDATA: 'C:\\Users\\op\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\op\\AppData\\Local',
  CLOUDFLARE_API_TOKEN: 'cf-secret',
  CLOUDFLARE_ACCOUNT_ID: 'cf-account',
  CF_API_TOKEN: 'cf-token',
  WRANGLER_API_TOKEN: 'wr-token',
  AWS_ACCESS_KEY_ID: 'aws-id',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AWS_SESSION_TOKEN: 'aws-session',
  GITHUB_TOKEN: 'gh',
  NPM_TOKEN: 'npm',
  ADMIN_PASSWORD_PEPPER: 'pepper',
  DATABASE_URL: 'postgres://user:pw@host/db',
  SSH_AUTH_SOCK: '/tmp/agent',
  NODE_OPTIONS: '--require ./evil.js',
  NODE_ENV: 'development',
  HTTPS_PROXY: 'http://proxy',
}

describe('childEnv: allowlist mínima', () => {
  it('mantém o necessário (case-insensitive, como no Windows) e descarta credenciais', () => {
    const env = childEnv({}, OPERATOR)
    expect(Object.keys(env).sort()).toEqual(
      ['APPDATA', 'LOCALAPPDATA', 'Path', 'SystemRoot', 'TEMP', 'USERPROFILE'].sort(),
    )
    for (const name of Object.keys(OPERATOR)) {
      if (SENSITIVE_NAME.test(name)) expect(env).not.toHaveProperty(name)
    }
    expect(env).not.toHaveProperty('NODE_OPTIONS') // injetaria código no filho
    expect(env).not.toHaveProperty('NODE_ENV') // decidiria DEV/produção do build
    expect(env).not.toHaveProperty('DATABASE_URL')
  })

  it('o que o chamador pede de forma explícita passa; undefined é omitido', () => {
    const env = childEnv({ CI: 'true', VITE_WHATSAPP_NUMBER: '', OMITIDA: undefined }, OPERATOR)
    expect(env.CI).toBe('true')
    expect(env.VITE_WHATSAPP_NUMBER).toBe('')
    expect(env).not.toHaveProperty('OMITIDA')
  })

  it('um processo filho de verdade recebe só o permitido (com o env real + canários)', () => {
    const polluted = { ...process.env, ...OPERATOR }
    const run = spawnSync(
      process.execPath,
      ['-e', 'console.log(JSON.stringify(Object.keys(process.env)))'],
      { env: childEnv({ EXPLICITA: '1' }, polluted), encoding: 'utf8', windowsHide: true },
    )
    expect(run.status).toBe(0)
    const keys: string[] = JSON.parse(run.stdout)
    expect(keys).toContain('EXPLICITA')
    expect(keys.some((name) => name.toUpperCase() === 'PATH')).toBe(true)
    for (const name of Object.keys(OPERATOR)) {
      if (SENSITIVE_NAME.test(name) || name === 'DATABASE_URL' || name === 'NODE_ENV')
        expect(keys).not.toContain(name)
    }
    expect(keys.filter((name) => SENSITIVE_NAME.test(name))).toEqual([])
  })
})

describe('sanitizeProcessEnv', () => {
  it('apaga do alvo tudo que não é permitido nem pedido, e informa o que removeu', () => {
    const target: Record<string, string | undefined> = {
      ...OPERATOR,
      DELEGAS_INTEGRATION_PORT: '4185',
    }
    const removed = sanitizeProcessEnv(['DELEGAS_INTEGRATION_PORT'], target)
    expect(target.DELEGAS_INTEGRATION_PORT).toBe('4185')
    expect(target.CLOUDFLARE_API_TOKEN).toBeUndefined()
    expect(target.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(target.Path).toBe(OPERATOR.Path)
    expect(removed).toContain('CLOUDFLARE_API_TOKEN')
    expect(removed).not.toContain('Path')
  })

  it('não toca no process.env real quando recebe outro alvo', () => {
    const before = Object.keys(process.env).length
    sanitizeProcessEnv([], { CLOUDFLARE_API_TOKEN: 'x' })
    expect(Object.keys(process.env).length).toBe(before)
  })
})
