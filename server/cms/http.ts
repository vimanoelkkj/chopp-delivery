import { CMS_REQUEST_BYTES } from './validation'

export const CMS_READ_MS = 5000
export async function readCmsBody(
  request: Request,
): Promise<
  | { value: unknown; error?: never }
  | { error: 'INVALID_BODY' | 'BODY_TOO_LARGE' | 'READ_TIMEOUT'; value?: never }
> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json' ||
    !request.body
  )
    return { error: 'INVALID_BODY' }
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('READ_TIMEOUT'))
      void reader.cancel().catch(() => {})
    }, CMS_READ_MS)
  })
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      size += value.byteLength
      if (size > CMS_REQUEST_BYTES) {
        void reader.cancel().catch(() => {})
        return { error: 'BODY_TOO_LARGE' }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message === 'READ_TIMEOUT'
          ? 'READ_TIMEOUT'
          : 'INVALID_BODY',
    }
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
