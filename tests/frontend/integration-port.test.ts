import { describe, expect, it, vi } from 'vitest'
import { childEnv, sanitizeProcessEnv } from '../../scripts/clean-env.mts'
import { DEFAULT_INTEGRATION_PORT, integrationPort } from '../../scripts/integration-port.mts'

describe('integrationPort: validação antes de repassar', () => {
  it('padrão 4185 quando ausente ou vazia', () => {
    expect(DEFAULT_INTEGRATION_PORT).toBe(4185)
    expect(integrationPort(undefined)).toBe(4185)
    expect(integrationPort('')).toBe(4185)
  })

  it.each(['4265', '1024', '65535', '04265'])('aceita %s', (value) => {
    expect(integrationPort(value)).toBe(Number(value))
  })

  it.each([
    '80', // privilegiada
    '1023',
    '65536',
    '70000',
    '-4265',
    '4265.5',
    '4265;calc',
    '4265 ',
    ' 4265',
    '0x1091',
    '1e4',
    'abc',
    '４２６５', // dígitos de largura total
    '999999',
  ])('recusa %j', (value) => {
    expect(() => integrationPort(value)).toThrow(/DELEGAS_INTEGRATION_PORT inválida/)
  })
})

describe('repasse da porta pela allowlist', () => {
  const operator = {
    Path: 'C:\\Windows',
    DELEGAS_INTEGRATION_PORT: '4265',
    CLOUDFLARE_API_TOKEN: 'segredo',
    AWS_SECRET_ACCESS_KEY: 'segredo',
  }

  it('a allowlist sozinha NÃO repassa a porta (era o defeito): só o pedido explícito', () => {
    expect(childEnv({}, operator)).not.toHaveProperty('DELEGAS_INTEGRATION_PORT')
    const env = childEnv({ DELEGAS_INTEGRATION_PORT: String(integrationPort('4265')) }, operator)
    expect(env.DELEGAS_INTEGRATION_PORT).toBe('4265')
  })

  it('repassar a porta não abre a porta para credenciais', () => {
    const env = childEnv({ DELEGAS_INTEGRATION_PORT: '4265' }, operator)
    expect(Object.keys(env).sort()).toEqual(['DELEGAS_INTEGRATION_PORT', 'Path'])
  })

  it('o servidor filho mantém a porta pedida e descarta o resto', () => {
    const target: Record<string, string | undefined> = { ...operator }
    sanitizeProcessEnv(['DELEGAS_INTEGRATION_PORT'], target)
    expect(target.DELEGAS_INTEGRATION_PORT).toBe('4265')
    expect(target.CLOUDFLARE_API_TOKEN).toBeUndefined()
    expect(integrationPort(target.DELEGAS_INTEGRATION_PORT)).toBe(4265)
  })
})

describe('porta normalizada (zeros à esquerda e config do Playwright)', () => {
  it('"04265" é aceita e normalizada para 4265; o texto cru NÃO é a porta', () => {
    expect(integrationPort('04265')).toBe(4265)
    expect(String(integrationPort('04265'))).toBe('4265')
    expect('04265').not.toBe(String(integrationPort('04265')))
    expect(() => integrationPort('004265')).toThrow() // contrato: no máximo 5 dígitos
    expect(() => integrationPort('0000000')).toThrow() // mais de 5 dígitos
    expect(() => integrationPort('00080')).toThrow() // 80 continua privilegiada
  })

  it.each([
    [undefined, 4185],
    ['', 4185],
    ['4265', 4265],
    ['04265', 4265],
  ])('o baseURL da config do Playwright para %j é a porta %i', async (value, port) => {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('DELEGAS_INTEGRATION_PORT', undefined as unknown as string)
    else vi.stubEnv('DELEGAS_INTEGRATION_PORT', value)
    try {
      const config = (await import('../../playwright.real.config')).default
      expect(config.use?.baseURL).toBe(`http://127.0.0.1:${port}`)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('o valor inválido derruba o carregamento da config, em vez de apontar para outra porta', async () => {
    vi.resetModules()
    vi.stubEnv('DELEGAS_INTEGRATION_PORT', '80')
    try {
      await expect(import('../../playwright.real.config')).rejects.toThrow(/inválida/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
