/*
 * Primeira pintura: marca <html> com o tema final antes de o CSS pintar o primeiro quadro.
 * Arquivo estático do mesmo domínio (compatível com script-src 'self'); não há script inline.
 *
 * Espelha src/shared/lib/theme.ts e documentTheme.ts; theme-init.test.ts garante a equivalência.
 * - /admin (e /admin/preview): superfície `admin`, preferência `chopp.admin.theme`.
 * - /admin/preview/frame: prévia editorial, sempre `storefront` claro, nunca lê preferência.
 * - Demais rotas públicas: superfície `storefront`, preferência `chopp.storefront.theme`.
 * Sem preferência salva ou com valor inválido, o padrão é claro. Qualquer falha deixa o <html> intacto
 * e o React aplica o mesmo resultado na montagem.
 */
;(() => {
  try {
    const path = window.location.pathname
    if (/^\/__proto\//.test(path)) return
    const isAdmin = /^\/admin(\/|$)/.test(path)
    const isPreviewFrame = /^\/admin\/preview\/frame\/?$/.test(path)
    const surface = isAdmin && !isPreviewFrame ? 'admin' : 'storefront'
    const key = isPreviewFrame
      ? null
      : surface === 'admin'
        ? 'chopp.admin.theme'
        : 'chopp.storefront.theme'

    let preference = 'light'
    if (key) {
      try {
        const saved = window.localStorage.getItem(key)
        if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved
      } catch {
        // Armazenamento bloqueado: segue com o padrão claro.
      }
    }
    let mode = preference
    if (preference === 'system') {
      mode = 'light'
      try {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) mode = 'dark'
      } catch {
        // Sem matchMedia: claro.
      }
    }

    const root = document.documentElement
    root.dataset.theme = surface === 'admin' ? 'admin' : 'pastel'
    root.dataset.themeSurface = surface
    root.dataset.colorMode = mode
  } catch {
    // Nunca bloqueia a página.
  }
})()
