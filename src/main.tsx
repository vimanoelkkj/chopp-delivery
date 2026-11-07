import '@fontsource/big-shoulders-display/latin-800'
import '@fontsource/big-shoulders-display/latin-900'
import '@fontsource/hanken-grotesk/latin-400'
import '@fontsource/hanken-grotesk/latin-500'
import '@fontsource/hanken-grotesk/latin-600'
import '@fontsource/hanken-grotesk/latin-800'
import '@fontsource/hanken-grotesk/latin-900'
import '@fontsource/ibm-plex-mono/latin-400'
import '@fontsource/ibm-plex-mono/latin-500'
import './styles/tokens.css'
import './styles/themes.css'
import './styles/base.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'

// A primeira pintura de /admin e da vitrine vem de public/theme-init.js (carregado no <head>).
// Só o DEV mantém o override local ?adminTheme=dark; o import dinâmico sai do build, então o
// código do painel não entra no pacote público.
if (import.meta.env.DEV)
  void import('./features/admin/adminTheme').then(({ applyEarlyAdminTheme }) =>
    applyEarlyAdminTheme(document.documentElement, window.location, true),
  )

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root não encontrado')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
