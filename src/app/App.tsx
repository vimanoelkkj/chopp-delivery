import { lazy, Suspense, useEffect, useState } from 'react'
import { LandingPage } from '@/pages/landing/LandingPage'

// Em produção, import.meta.env.DEV é substituído estaticamente por `false`,
// permitindo que o Rollup elimine completamente o módulo e seu CSS via dead-code elimination.
const DevMotionPreview = import.meta.env.DEV
  ? lazy(() =>
      import('@/pages/preview/MotionPreviewPage').then((m) => ({
        default: m.MotionPreviewPage,
      })),
    )
  : null

function checkIsPreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const search = new URLSearchParams(window.location.search)
  return search.has('preview') || window.location.hash.startsWith('#preview')
}

export function App() {
  const [isPreview, setIsPreview] = useState(checkIsPreview)

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const onLocationChange = () => {
      setIsPreview(checkIsPreview())
    }
    window.addEventListener('popstate', onLocationChange)
    window.addEventListener('hashchange', onLocationChange)
    return () => {
      window.removeEventListener('popstate', onLocationChange)
      window.removeEventListener('hashchange', onLocationChange)
    }
  }, [])

  if (import.meta.env.DEV && isPreview && DevMotionPreview) {
    return (
      <Suspense fallback={null}>
        <DevMotionPreview />
      </Suspense>
    )
  }

  return <LandingPage />
}
