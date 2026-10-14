/** Fallback apenas de /api/: Functions mais específicas têm prioridade no Pages. */
export function apiNotFound(request: { method: string }): Response {
  const response = Response.json(
    { error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado.' } },
    {
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    },
  )
  return request.method === 'HEAD' ? new Response(null, response) : response
}

export const onRequest: PagesFunction = ({ request }) => apiNotFound(request)
