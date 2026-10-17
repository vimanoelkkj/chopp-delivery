import { MEDIA_LIMITS } from './media-contract'

export async function readMediaBytes(
  stream: ReadableStream<Uint8Array>,
  limit: number = MEDIA_LIMITS.inputBytes,
  milliseconds: number = MEDIA_LIMITS.readMs,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('MEDIA_TIMEOUT'))
      void reader.cancel().catch(() => {})
    }, milliseconds)
  })
  try {
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      length += value.byteLength
      if (length > limit) {
        void reader.cancel().catch(() => {})
        throw new Error('MEDIA_BYTES')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return bytes
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}

/** Container checks only; successful decoding/reencoding is a separate required step. */
export function inspectImage(bytes: Uint8Array, mime: string, derivative = false) {
  const invalid = (): never => {
    throw new Error('MEDIA_INVALID')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length))
  let width = 0,
    height = 0,
    format = ''
  if (bytes.length >= 33 && text(0, 8) === '\x89PNG\r\n\x1a\n') {
    format = 'image/png'
    let at = 8,
      ended = false,
      data = false
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at),
        kind = text(at + 4, 4),
        end = at + 12 + length
      if (end > bytes.length || !/^[A-Za-z]{4}$/.test(kind)) invalid()
      if (at === 8) {
        if (kind !== 'IHDR' || length !== 13) invalid()
        width = view.getUint32(at + 8)
        height = view.getUint32(at + 12)
      } else if (kind === 'IHDR') invalid()
      let crc = 0xffffffff
      for (let i = at + 4; i < end - 4; i++) {
        crc ^= bytes[i]
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
      if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(end - 4)) invalid()
      if (['acTL', 'fcTL', 'fdAT'].includes(kind)) invalid()
      if (kind === 'IDAT') data = true
      at = end
      if (kind === 'IEND') {
        if (length !== 0 || at !== bytes.length) invalid()
        ended = true
        break
      }
    }
    if (!ended || !data) invalid()
  } else if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    format = 'image/webp'
    if (view.getUint32(4, true) + 8 !== bytes.length) invalid()
    let at = 12,
      images = 0,
      flags = 0,
      canvasWidth = 0,
      canvasHeight = 0,
      alphaSize = 0,
      rawAlpha = false,
      bitstream = ''
    const seen = new Set<string>()
    while (at + 8 <= bytes.length) {
      const kind = text(at, 4),
        size = view.getUint32(at + 4, true),
        start = at + 8
      const end = start + size + (size % 2)
      if (
        end > bytes.length ||
        (size % 2 && bytes[end - 1] !== 0) ||
        ['ANIM', 'ANMF'].includes(kind)
      )
        invalid()
      if (at === 12 && !['VP8X', 'VP8 ', 'VP8L'].includes(kind)) invalid()
      if (derivative && !['VP8X', 'VP8 ', 'VP8L', 'ALPH'].includes(kind)) invalid()
      if (kind === 'VP8X') {
        // Extended header is unique and first; it never replaces frame dimensions.
        if (at !== 12 || size !== 10) invalid()
        flags = bytes[start]
        if (
          flags & 0xc3 ||
          bytes[start + 1] ||
          bytes[start + 2] ||
          bytes[start + 3] ||
          (derivative && flags & 0x2c)
        )
          invalid()
        canvasWidth = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16)
        canvasHeight = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16)
        seen.add(kind)
      } else if (['ICCP', 'EXIF', 'XMP ', 'ALPH'].includes(kind)) {
        if (!seen.has('VP8X') || seen.has(kind) || size === 0) invalid()
        if (kind === 'ICCP' && (images || seen.has('ALPH') || !(flags & 0x20))) invalid()
        if (kind === 'EXIF' && !(flags & 0x08)) invalid()
        if (kind === 'XMP ' && !(flags & 0x04)) invalid()
        if (kind === 'ALPH') {
          if (
            images ||
            !(flags & 0x10) ||
            size < 2 ||
            bytes[start] & 0xc0 ||
            (bytes[start] & 3) > 1 ||
            ((bytes[start] >> 4) & 3) > 1
          )
            invalid()
          alphaSize = size
          rawAlpha = (bytes[start] & 3) === 0
        }
        seen.add(kind)
      } else if (!['VP8 ', 'VP8L'].includes(kind) && !seen.has('VP8X')) {
        invalid()
      }
      if (kind === 'VP8 ') {
        if (images || size < 10 || bytes[start] & 1 || text(start + 3, 3) !== '\x9d\x01\x2a')
          invalid()
        width = view.getUint16(start + 6, true) & 0x3fff
        height = view.getUint16(start + 8, true) & 0x3fff
        bitstream = kind
        images++
      }
      if (kind === 'VP8L') {
        if (images || seen.has('ALPH') || size < 5 || bytes[start] !== 0x2f) invalid()
        const bits = view.getUint32(start + 1, true)
        if (bits >>> 29) invalid()
        width = (bits & 0x3fff) + 1
        height = ((bits >>> 14) & 0x3fff) + 1
        bitstream = kind
        images++
      }
      at = end
    }
    if (at !== bytes.length || images !== 1) invalid()
    if (seen.has('VP8X')) {
      if (width !== canvasWidth || height !== canvasHeight) invalid()
      for (const [kind, mask] of [
        ['ICCP', 0x20],
        ['EXIF', 0x08],
        ['XMP ', 0x04],
      ] as const) {
        if (Boolean(flags & mask) !== seen.has(kind)) invalid()
      }
      // VP8L carries its own alpha stream; ALPH belongs only to lossy VP8.
      if (bitstream === 'VP8 ' && Boolean(flags & 0x10) !== seen.has('ALPH')) invalid()
      if (rawAlpha && alphaSize !== 1 + width * height) invalid()
    }
  } else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    format = 'image/jpeg'
    let at = 2,
      ended = false,
      scans = 0,
      frameSeen = false
    while (at < bytes.length) {
      if (bytes[at++] !== 255) invalid()
      while (bytes[at] === 255) at++
      const marker = bytes[at++]
      if (marker === 217) {
        if (at !== bytes.length) invalid()
        ended = true
        break
      }
      if (!marker || marker === 216 || (marker >= 208 && marker <= 215) || at + 2 > bytes.length)
        invalid()
      if (marker === 1) continue
      const size = view.getUint16(at)
      if (size < 2 || at + size > bytes.length) invalid()
      if (marker === 226 && text(at + 2, 4) === 'MPF\x00') invalid()
      const frameMarker = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
      if (frameMarker) {
        // Track SOF presence independently of dimensions; zero-sized and duplicate frames fail.
        if (frameSeen || scans || ![0xc0, 0xc1, 0xc2].includes(marker) || size < 11) invalid()
        frameSeen = true
        const components = bytes[at + 7],
          precision = bytes[at + 2]
        if (
          !components ||
          size !== 8 + 3 * components ||
          (marker === 0xc2 && components > 4) ||
          (marker === 0xc0 ? precision !== 8 : ![8, 12].includes(precision))
        )
          invalid()
        height = view.getUint16(at + 3)
        width = view.getUint16(at + 5)
        if (!width || !height) invalid()
        const ids = new Set<number>()
        for (let component = at + 8; component < at + size; component += 3) {
          const id = bytes[component],
            sampling = bytes[component + 1]
          if (
            ids.has(id) ||
            sampling >> 4 < 1 ||
            sampling >> 4 > 4 ||
            (sampling & 15) < 1 ||
            (sampling & 15) > 4 ||
            bytes[component + 2] > 3
          )
            invalid()
          ids.add(id)
        }
      }
      at += size
      if (marker !== 218) continue
      if (!frameSeen) invalid()
      scans++
      while (at < bytes.length) {
        if (bytes[at++] !== 255) continue
        const start = at - 1
        while (bytes[at] === 255) at++
        if (bytes[at] === 0 || (bytes[at] >= 208 && bytes[at] <= 215)) {
          at++
          continue
        }
        at = start
        break
      }
    }
    if (!ended || !scans || !frameSeen) invalid()
  } else invalid()
  if (
    mime !== format ||
    (derivative && format !== 'image/webp') ||
    width < 1 ||
    height < 1 ||
    width > MEDIA_LIMITS.dimension ||
    height > MEDIA_LIMITS.dimension ||
    width * height > MEDIA_LIMITS.pixels
  )
    invalid()
  return { width, height, format }
}

export async function mediaHash(bytes: Uint8Array<ArrayBuffer>) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
