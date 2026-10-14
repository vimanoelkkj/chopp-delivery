import { lazy, Suspense } from 'react'
import { LandingPage } from '@/pages/landing/LandingPage'

// O painel é carregado sob demanda: o código e o CSS dele não entram no pacote do site público.
const AdminApp = lazy(() => import('@/features/admin/AdminApp'))

/** O Pages entrega index.html para /admin (fallback de SPA); só esta rota abre o painel. */
const isAdminRoute = () => /^\/admin\/?$/.test(window.location.pathname)

export function App() {
  if (isAdminRoute()) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    )
  }
  return <LandingPage />
}
