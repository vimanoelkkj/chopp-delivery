import { useEffect, useState } from 'react'
import { fetchExpandedCatalog } from '@/features/catalog/expanded-api'
import type { PublicCatalogV2 } from './types'

export type PublicCatalogState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; catalog: PublicCatalogV2 }

export function usePublicCatalog() {
  const [state, setState] = useState<PublicCatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    let active = true

    if (attempt > 0) {
      setState({ status: 'loading' })
    }

    fetchExpandedCatalog(controller.signal)
      .then((data) => {
        if (active) {
          setState({ status: 'ready', catalog: data.expanded })
        }
      })
      .catch((err) => {
        if (active) {
          setState({
            status: 'error',
            error: err instanceof Error ? err : new Error('Catálogo indisponível no momento.'),
          })
        }
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      active = false
      controller.abort()
      clearTimeout(timeout)
    }
  }, [attempt])

  return { state, retry: () => setAttempt((v) => v + 1) }
}
