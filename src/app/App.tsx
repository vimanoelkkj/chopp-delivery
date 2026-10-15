import { lazy, Suspense, useEffect, useState } from 'react'
import { LandingPage } from '@/pages/landing/LandingPage'

/** Keep this literal gate here so the normal build eliminates the entire admin module.
 * The integration build is local-only. Mock data requires explicit dev/test opt-in.
 * API authentication is enforced by the backend regardless of this UI gate.
 */
const ADMIN_ENABLED =
  import.meta.env.MODE === 'admin-integration' ||
  (import.meta.env.DEV && import.meta.env.MODE === 'admin-mock') ||
  import.meta.env.MODE === 'e2e'

// O painel é carregado sob demanda: o código e o CSS dele não entram no pacote do site público.
const AdminApp = lazy(
  ADMIN_ENABLED
    ? () => import('@/features/admin/AdminApp')
    : () => import('@/features/admin/AdminDisabled'),
)

/** O Pages entrega index.html para /admin (fallback de SPA); só esta rota abre o painel. */
const isAdminRoute = () => /^\/admin\/?$/.test(window.location.pathname)

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

  if (isAdminRoute()) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    )
  }

  if (import.meta.env.DEV && isPreview && DevMotionPreview) {
    return (
      <Suspense fallback={null}>
        <DevMotionPreview />
      </Suspense>
    )
  }

  return <LandingPage />
}
