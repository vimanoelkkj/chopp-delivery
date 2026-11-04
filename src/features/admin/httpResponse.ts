/** Intermediary login pages are not responses from the administrative API. */
export function requireApiJson(response: Response): void {
  if (
    response.redirected ||
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400) ||
    response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    throw new Error('ADMIN_RESPONSE_UNAVAILABLE')
}

/** Only the existing F2 error envelope can trigger session-expiry handling. */
export function requireF2SessionError(status: number, body: unknown): void {
  if (status !== 401 && status !== 403) return
  const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  if (code !== (status === 401 ? 'UNAUTHENTICATED' : 'INVALID_ORIGIN'))
    throw new Error('ADMIN_RESPONSE_UNAVAILABLE')
}
