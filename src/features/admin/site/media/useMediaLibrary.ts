import { useCallback, useEffect, useRef, useState } from 'react'
import { listMedia, type MediaCapacity, type MediaFailure, type MediaItem } from './mediaApi'
import { MEDIA_PAGE_SIZE } from './mediaModel'

export type Library = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: MediaItem[]
  nextCursor: string | null
  capacity: MediaCapacity | null
  failure: MediaFailure | null
  loadingMore: boolean
  moreFailed: boolean
  /** Recarregando a primeira página (a lista anterior continua visível). */
  refreshing: boolean
}

const EMPTY: Library = {
  status: 'idle',
  items: [],
  nextCursor: null,
  capacity: null,
  failure: null,
  loadingMore: false,
  moreFailed: false,
  refreshing: false,
}

/**
 * Lista paginada da biblioteca. Só lê (`GET /api/admin/media`); nada roda ao montar, quem chama
 * decide quando carregar. Respostas atrasadas de uma carga antiga nunca sobrescrevem a atual.
 */
export function useMediaLibrary({ onExpired }: { onExpired: () => void }) {
  const [state, setState] = useState<Library>(EMPTY)
  const latest = useRef(state)
  latest.current = state
  const generation = useRef(0)
  const callbacks = useRef({ onExpired })
  callbacks.current = { onExpired }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /** Primeira página (substitui a lista). Mantém o que já havia na tela enquanto recarrega. */
  const load = useCallback(async () => {
    const mine = ++generation.current
    setState((current) => ({
      ...current,
      status: current.items.length > 0 ? 'ready' : 'loading',
      failure: null,
      loadingMore: false,
      moreFailed: false,
      refreshing: true,
    }))
    const outcome = await listMedia({ limit: MEDIA_PAGE_SIZE })
    if (!mounted.current || mine !== generation.current) return
    if (!outcome.ok) {
      if (outcome.failure.kind === 'expired') {
        setState(EMPTY)
        return callbacks.current.onExpired()
      }
      return setState({ ...EMPTY, status: 'error', failure: outcome.failure })
    }
    setState({
      ...EMPTY,
      status: 'ready',
      items: outcome.value.media,
      nextCursor: outcome.value.nextCursor,
      capacity: outcome.value.capacity,
    })
  }, [])

  /** Próxima página, anexada à lista (sem repetir IDs). */
  const more = useCallback(async () => {
    const { nextCursor, loadingMore, status } = latest.current
    if (status !== 'ready' || !nextCursor || loadingMore) return
    const mine = generation.current
    setState((current) => ({ ...current, loadingMore: true, moreFailed: false }))
    const outcome = await listMedia({ limit: MEDIA_PAGE_SIZE, cursor: nextCursor })
    if (!mounted.current || mine !== generation.current) return
    if (!outcome.ok) {
      if (outcome.failure.kind === 'expired') {
        setState(EMPTY)
        return callbacks.current.onExpired()
      }
      return setState((current) => ({ ...current, loadingMore: false, moreFailed: true }))
    }
    const page = outcome.value
    setState((current) => {
      const known = new Set(current.items.map((item) => item.id))
      return {
        ...current,
        items: [...current.items, ...page.media.filter((item) => !known.has(item.id))],
        nextCursor: page.nextCursor,
        capacity: page.capacity,
        loadingMore: false,
      }
    })
  }, [])

  return { library: state, load, more }
}
