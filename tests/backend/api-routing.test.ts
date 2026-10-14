import { describe, expect, it } from 'vitest'
import { apiNotFound } from '../../functions/api/[[path]]'

describe('fallback público de /api/', () => {
  it.each(['GET', 'POST', 'OPTIONS'])('responde 404 JSON para %s', async (method) => {
    const response = apiNotFound({ method })
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado.' },
    })
  })

  it('HEAD mantém os headers do 404 e não retorna corpo', async () => {
    const get = apiNotFound({ method: 'GET' })
    const head = apiNotFound({ method: 'HEAD' })
    expect(head.status).toBe(get.status)
    expect([...head.headers]).toEqual([...get.headers])
    expect(await head.text()).toBe('')
  })
})
