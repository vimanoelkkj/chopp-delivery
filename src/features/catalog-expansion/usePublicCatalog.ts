import { useCatalog } from '@/features/catalog/useCatalog'
import type { PublicCatalogV2 } from './types'

export type PublicCatalogState =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; catalog: PublicCatalogV2 }

/** Reuses the canonical transport, validation, timeout and retry policy. */
export function usePublicCatalog(): { state: PublicCatalogState; retry: () => void } {
  const { state, retry } = useCatalog()
  return {
    state: state.status === 'ready' ? { status: 'ready', catalog: state.catalog.expanded } : state,
    retry,
  }
}
