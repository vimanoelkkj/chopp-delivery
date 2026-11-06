import { useEffect, useState } from 'react'
import { fetchPublishedSite, type PublishedSite } from './api'

export type PublishedSiteState =
  | { status: 'loading' | 'absent' | 'error' }
  | { status: 'ready'; site: PublishedSite }

export function usePublishedSite() {
  const [state, setState] = useState<PublishedSiteState>({ status: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    let active = true
    fetchPublishedSite(controller.signal)
      .then((site) => {
        if (active) setState(site ? { status: 'ready', site } : { status: 'absent' })
      })
      .catch(() => {
        if (active) setState({ status: 'error' })
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [])
  return state
}
