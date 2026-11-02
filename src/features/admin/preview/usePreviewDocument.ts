import { useEffect, useState } from 'react'
import { type PreviewDocument, readPreviewSnapshot } from './model'

export type PreviewState =
  | { status: 'loading' | 'error' | 'expired' | 'missing' }
  | { status: 'ready'; value: PreviewDocument }
/** Memory only. Read-only GET, bounded response, fail closed on refresh/revocation/errors. */
export function usePreviewDocument() {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  useEffect(() => {
    let disposed = false
    let active: AbortController | undefined
    const load = async () => {
      if (active || document.visibilityState === 'hidden') return
      const controller = new AbortController()
      active = controller
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const response = await fetch('/api/admin/site', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (response.status === 401 || response.status === 403) {
          if (!disposed && active === controller) setState({ status: 'expired' })
          return
        }
        if (!response.ok || !response.body) throw new Error('PREVIEW_UNAVAILABLE')
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let length = 0
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) break
            length += part.value.byteLength
            if (length > 150000) throw new Error('PREVIEW_TOO_LARGE')
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
        const value = readPreviewSnapshot(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        )
        if (!disposed && active === controller)
          setState((previous) =>
            value
              ? previous.status === 'ready' && previous.value.revision === value.revision
                ? previous
                : { status: 'ready', value }
              : { status: 'missing' },
          )
      } catch {
        if (!disposed && active === controller) setState({ status: 'error' })
      } finally {
        clearTimeout(timeout)
        if (active === controller) active = undefined
      }
    }
    const visible = () => {
      if (document.visibilityState === 'hidden') {
        active?.abort()
        active = undefined
        setState({ status: 'loading' })
      } else void load()
    }
    const refresh = () => {
      active?.abort()
      active = undefined
      setState({ status: 'loading' })
      void load()
    }
    window.addEventListener('cms-preview-refresh', refresh)
    void load()
    const timer = setInterval(() => {
      void load()
    }, 5000)
    const focus = () => {
      active?.abort()
      active = undefined
      void load()
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      active?.abort()
      clearInterval(timer)
      window.removeEventListener('cms-preview-refresh', refresh)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return {
    state,
    reload: () => {
      window.dispatchEvent(new Event('cms-preview-refresh'))
    },
  }
}
