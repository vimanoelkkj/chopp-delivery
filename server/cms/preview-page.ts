import { PREVIEW_FRAME_PATH, previewHeaders } from '../../shared/preview-security'
import { requireAdmin } from '../auth/guard'
import { type AuthEnv, wrongMethod } from '../auth/http'

/** Never embeds editorial data; even the frame entry checks the real F2 session. */
export async function handlePreviewPage(
  request: Request,
  env: AuthEnv,
  next: () => Promise<Response>,
): Promise<Response> {
  const headers = previewHeaders(
    new URL(request.url).origin,
    new URL(request.url).pathname.replace(/\/$/, '') === PREVIEW_FRAME_PATH,
  )
  let response: Response
  if (!['GET', 'HEAD'].includes(request.method)) response = wrongMethod(request, 'GET, HEAD')
  else {
    const auth = await requireAdmin(request, env)
    if (auth.error) {
      const unavailable = auth.error.status !== 401
      response = new Response(
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Prévia editorial privada</title><main><h1>${unavailable ? 'Prévia indisponível' : 'Sessão necessária'}</h1><p>${unavailable ? 'Não foi possível verificar seu acesso.' : 'Entre no painel para abrir o rascunho.'}</p><a href="/admin">Entrar no painel</a></main></html>`,
        { status: auth.error.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    } else response = await next()
  }
  const result = new Response(request.method === 'HEAD' ? null : response.body, response)
  for (const [name, value] of Object.entries(headers)) result.headers.set(name, value)
  return result
}
