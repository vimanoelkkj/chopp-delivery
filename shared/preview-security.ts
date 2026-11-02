export const PREVIEW_PATH = '/admin/preview'
export const PREVIEW_FRAME_PATH = '/admin/preview/frame'

/** HTML shells only. Authentication and no-store remain the authorization boundary. */
export function previewHeaders(origin: string, frame: boolean): Record<string, string> {
  const frames = frame ? "'none'" : `${origin}${PREVIEW_FRAME_PATH}`
  return {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action ${frame ? "'none'" : "'self'"}; frame-src ${frames}; frame-ancestors ${frame ? "'self'" : "'none'"}`,
  }
}
