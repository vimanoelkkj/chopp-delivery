import { execFileSync } from 'node:child_process'
import { Miniflare } from 'miniflare'
import { describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/auth/password'
import { TEST_PASSWORD, TEST_PEPPER } from './auth-fixture'

describe('runtime e entrada do bootstrap', () => {
  it('Node carrega o bootstrap e recusa pipes sem ler/gravar credenciais', () => {
    try {
      execFileSync(process.execPath, ['scripts/bootstrap-admin.mjs', '--local'], {
        stdio: 'pipe',
        windowsHide: true,
      })
      throw new Error('Bootstrap deveria exigir um terminal')
    } catch (error) {
      if (!(error instanceof Error) || !('stderr' in error)) throw error
      expect(String(error.stderr)).toContain('Use um terminal interativo')
      expect(String(error.stderr)).not.toContain('ERR_MODULE_NOT_FOUND')
      expect(String(error.stderr)).not.toContain(TEST_PASSWORD)
    }
  })

  it('workerd executa PBKDF2 100k e verifica MAC derivado no Node', async () => {
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: '2026-08-06',
      script: `
      export default { async fetch(request) {
        const {password, stored, pepper} = await request.json();
        const [, iterations, salt, signature] = stored.split('$');
        const bytes = value => Uint8Array.from(value.match(/../g), part => parseInt(part, 16));
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:Number(iterations)},key,256);
        const mac = await crypto.subtle.importKey('raw',bytes(pepper),{name:'HMAC',hash:'SHA-256'},false,['verify']);
        return Response.json({ valid: await crypto.subtle.verify('HMAC',mac,bytes(signature),bits) });
      }}
    `,
    })
    try {
      const stored = await hashPassword(TEST_PASSWORD, TEST_PEPPER)
      const result = await runtime.dispatchFetch('http://localhost/probe', {
        method: 'POST',
        body: JSON.stringify({ password: TEST_PASSWORD, stored, pepper: TEST_PEPPER }),
      })
      expect(await result.json()).toEqual({ valid: true })
    } finally {
      await runtime.dispose()
    }
  })
})
