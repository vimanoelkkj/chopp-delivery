import { createServer, type Plugin } from 'vite'
import { createMockCatalog } from '../src/features/admin/catalog/mockData.ts'
import { previewFixture } from '../tests/e2e-real/preview-fixture.ts'

/** Disposable visual preview. Every /api request terminates here; no backend proxy or writes. */
export function themePreviewApi(): Plugin {
  const catalog = createMockCatalog()
  const document = previewFixture()
  return {
    name: 'local-read-only-theme-preview',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Allow', 'GET')
          res.end(JSON.stringify({ error: { code: 'READ_ONLY_PREVIEW' } }))
          return
        }
        const path = req.url?.split('?')[0]
        let body: unknown
        if (path === '/auth/me')
          body = { authenticated: true, user: { id: 'theme-preview', username: 'preview' } }
        else if (path === '/admin/site')
          body = {
            schema: 2,
            draft: { revision: 'c2_11111111-1234-4123-8123-123456789012', document },
            published: null,
          }
        else if (path === '/admin/catalog/v2') body = catalog
        else if (path === '/catalog')
          body = {
            ...catalog,
            categories: catalog.categories.map((category) => ({
              ...category,
              items: category.items.filter((item) => item.visible),
            })),
          }
        else {
          res.statusCode = 404
          body = { error: { code: 'CMS_NOT_PUBLISHED' } }
        }
        res.end(JSON.stringify(body))
      })
    },
  }
}

// This script is an explicit local entry point, never imported by the application.
const server = await createServer({
  mode: 'admin-integration',
  envPrefix: [],
  define: { 'import.meta.env.VITE_WHATSAPP_NUMBER': JSON.stringify('') },
  plugins: [themePreviewApi()],
  server: { host: '127.0.0.1', port: 4321, strictPort: true },
})
await server.listen()
console.log('Read-only theme fixtures; no D1/R2, authentication backend or real commercial data.')
console.log('Dark: http://127.0.0.1:4321/admin?adminTheme=dark#pagina-inicial')
console.log('Light: http://127.0.0.1:4321/admin#pagina-inicial')
console.log('CMS preview: http://127.0.0.1:4321/admin/preview?adminTheme=dark')
