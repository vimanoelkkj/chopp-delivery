import { useEffect, useState } from 'react'
import { fetchExpandedCatalog, type StorefrontCatalog } from './expanded-api'

export type CatalogState =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; catalog: StorefrontCatalog }

export function useCatalog() {
  const [state, setState] = useState<CatalogState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    let active = true
    if (attempt > 0) setState({ status: 'loading' })
    fetchExpandedCatalog(controller.signal)
      .then((catalog) => {
        if (active) setState({ status: 'ready', catalog })
      })
      .catch(() => {
        if (active) setState({ status: 'error' })
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      clearTimeout(timeout)
    }
  }, [attempt])

  return { state, retry: () => setAttempt((value) => value + 1) }
}
