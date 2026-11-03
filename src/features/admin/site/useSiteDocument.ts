import { useCallback, useEffect, useRef, useState } from 'react'
import { readSiteSnapshot, type SiteRead } from './siteModel'

/**
 * Estados da leitura. `none` e `v1` não são erro: são estados reais do CMS e vêm dentro de `ready`.
 * - `expired`: sessão inválida (401); a tela devolve ao login, como a prévia.
 * - `forbidden`: sessão válida sem permissão (403).
 * - `unavailable`: o CMS respondeu 503 (esquema v2 ainda não disponível ou D1 fora do ar).
 * - `error`: falha de rede, resposta inválida ou grande demais.
 */
export type SiteState =
  | { status: 'loading' | 'expired' | 'forbidden' | 'unavailable' | 'error' }
  | { status: 'ready'; read: SiteRead }

const LIMIT_BYTES = 150000
const TIMEOUT_MS = 10000

async function readBounded(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('SITE_EMPTY')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > LIMIT_BYTES) throw new Error('SITE_TOO_LARGE')
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

/**
 * Leitura única de `GET /api/admin/site`, somente leitura: nenhuma outra requisição, nenhum método
 * de escrita. Recarrega só pelo botão (`reload`); não há polling.
 */
export function useSiteDocument(onExpired: () => void) {
  const [state, setState] = useState<SiteState>({ status: 'loading' })
  const active = useRef<AbortController | null>(null)
  const expiredRef = useRef(onExpired)
  expiredRef.current = onExpired

  const load = useCallback(async () => {
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/admin/site', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (active.current !== controller) return
      if (response.status === 401) {
        setState({ status: 'expired' })
        expiredRef.current()
        return
      }
      if (response.status === 403) return setState({ status: 'forbidden' })
      if (response.status === 503) return setState({ status: 'unavailable' })
      if (!response.ok) throw new Error('SITE_UNAVAILABLE')
      const read = readSiteSnapshot(await readBounded(response))
      if (active.current === controller) setState({ status: 'ready', read })
    } catch {
      if (active.current === controller) setState({ status: 'error' })
    } finally {
      clearTimeout(timeout)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => active.current?.abort()
  }, [load])

  return { state, reload: load }
}
