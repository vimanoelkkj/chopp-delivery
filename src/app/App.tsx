import { lazy, Suspense } from 'react'
import { LandingPage } from '@/pages/landing/LandingPage'

/**
 * O painel só abre sobre o catálogo MOCKADO (F3B) no `vite dev` e no build de E2E
 * (`vite build --mode e2e`). No build publicável (`npm run build`) o gate é falso em tempo de build:
 * /admin mostra só AdminDisabled e nenhum código do painel, do mock ou de cenários entra em `dist`
 * (confira com `npm run verify:dist`). A expressão fica AQUI, literal, de propósito: um `const`
 * importado de outro módulo não é dobrado pelo bundler e o painel voltaria ao bundle.
 *
 * Reativar com o backend real exige mudança explícita de código (ver "Reativar /admin" em
 * docs/admin-panel-handoff.md), com testes contra a API real. Esconder a rota NÃO é autenticação:
 * a segurança das APIs é do backend.
 */
const ADMIN_MOCK_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'e2e'

// O painel é carregado sob demanda: o código e o CSS dele não entram no pacote do site público.
const AdminApp = lazy(
  ADMIN_MOCK_ENABLED
    ? () => import('@/features/admin/AdminApp')
    : () => import('@/features/admin/AdminDisabled'),
)

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
