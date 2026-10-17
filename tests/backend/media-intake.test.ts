import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { inspectImage, readMediaBytes } from '../../server/cms/media-bytes'
import { handleLocalMedia, type LocalMediaEnv } from '../../server/cms/media-library'
import { applyTestMigration, TEST_ORIGIN } from './auth-fixture'
import { cmsFixture } from './cms-fixture'

describe('media intake before decoding', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('rejects forged %s', (mime) => {
    expect(() => inspectImage(new Uint8Array([255, 216, 255, 217]), mime)).toThrow()
  })
  it('limits actual bytes and cancels the stream', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(6))
      },
      cancel() {
        cancelled = true
      },
    })
    await expect(readMediaBytes(stream, 5, 100)).rejects.toThrow('MEDIA_BYTES')
    expect(cancelled).toBe(true)
  })
  it('times out stalled bodies and cancels', async () => {
    let cancelled = false
    await expect(
      readMediaBytes(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        5,
        15,
      ),
    ).rejects.toThrow('MEDIA_TIMEOUT')
    expect(cancelled).toBe(true)
  })
})

const chunk = (kind: string, data: Uint8Array) => {
  const header = Buffer.alloc(8)
  header.write(kind)
  header.writeUInt32LE(data.length, 4)
  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)])
}
const riff = (...chunks: Uint8Array[]) => {
  const header = Buffer.from('RIFF0000WEBP')
  header.writeUInt32LE(4 + chunks.reduce((n, part) => n + part.length, 0), 4)
  return new Uint8Array(Buffer.concat([header, ...chunks]))
}
const vp8x = (width = 1, height = 1, flags = 0) => {
  const data = Buffer.alloc(10)
  data[0] = flags
  data.writeUIntLE(width - 1, 4, 3)
  data.writeUIntLE(height - 1, 7, 3)
  return chunk('VP8X', data)
}
// Container counterexamples deliberately need no valid compressed pixels: intake must reject first.
const vp8 = (width = 1, height = 1) => {
  const data = Buffer.from([0x10, 0, 0, 0x9d, 1, 0x2a, 0, 0, 0, 0])
  data.writeUInt16LE(width, 6)
  data.writeUInt16LE(height, 8)
  return chunk('VP8 ', data)
}
const vp8l = (width = 1, height = 1, alpha = false) => {
  const data = Buffer.alloc(5)
  data[0] = 0x2f
  data.writeUInt32LE((width - 1) | ((height - 1) << 14) | (alpha ? 1 << 28 : 0), 1)
  return chunk('VP8L', data)
}
const alpha = chunk('ALPH', new Uint8Array([0, 128]))
const unknown = chunk('ZZZZ', new Uint8Array([1]))
const badWebp = [
  ['VP8 dimension bypass', riff(vp8(6001, 1), vp8x())],
  ['VP8 pixel bomb bypass', riff(vp8(4000, 3001), vp8x())],
  ['VP8L dimension bypass', riff(vp8l(6001, 1), vp8x())],
  ['VP8L pixel bomb bypass', riff(vp8l(4000, 3001), vp8x())],
  ['residual VP8X', riff(vp8(), vp8x())],
  ['duplicate VP8X', riff(vp8x(), vp8x(), vp8())],
  ['mixed bitstreams', riff(vp8x(), vp8(), vp8l())],
  ['duplicate bitstream', riff(vp8(), vp8())],
  ['ALPH with VP8L', riff(vp8x(1, 1, 0x10), alpha, vp8l(1, 1, true))],
  ['ALPH after frame', riff(vp8x(1, 1, 0x10), vp8(), alpha)],
  ['duplicate ALPH', riff(vp8x(1, 1, 0x10), alpha, alpha, vp8())],
  ['ALPH without VP8X', riff(alpha, vp8())],
  ['undeclared alpha', riff(vp8x(), alpha, vp8())],
  ['missing alpha', riff(vp8x(1, 1, 0x10), vp8())],
  ['ICCP after frame', riff(vp8x(1, 1, 0x20), vp8(), chunk('ICCP', new Uint8Array([1])))],
  ['metadata without VP8X', riff(vp8(), chunk('EXIF', new Uint8Array([1])))],
  ['undeclared EXIF', riff(vp8x(), vp8(), chunk('EXIF', new Uint8Array([1])))],
  ['missing EXIF', riff(vp8x(1, 1, 0x08), vp8())],
  [
    'duplicate EXIF',
    riff(
      vp8x(1, 1, 0x08),
      vp8(),
      chunk('EXIF', new Uint8Array([1])),
      chunk('EXIF', new Uint8Array([1])),
    ),
  ],
  ['canvas conflict', riff(vp8x(2, 1), vp8())],
  ['reserved VP8X flags', riff(vp8x(1, 1, 0x80), vp8())],
  ['animation flag', riff(vp8x(1, 1, 0x02), vp8())],
] as const

const sof = (width: number, height: number, marker = 0xc0) => {
  const data = Buffer.from([255, marker, 0, 11, 8, 0, 0, 0, 0, 1, 1, 0x11, 0])
  data.writeUInt16BE(height, 5)
  data.writeUInt16BE(width, 7)
  return data
}
const jpeg = (...frames: Uint8Array[]) =>
  new Uint8Array(
    Buffer.concat([
      Buffer.from([255, 216]),
      ...frames,
      Buffer.from([255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217]),
    ]),
  )
const badJpeg = [
  ['zero width then SOF', jpeg(sof(0, 1), sof(1, 1))],
  ['zero height then SOF', jpeg(sof(1, 0), sof(1, 1))],
  ['zero dimensions then SOF', jpeg(sof(0, 0), sof(1, 1))],
  ['duplicate SOF', jpeg(sof(1, 1), sof(1, 1))],
  ['conflicting SOF type', jpeg(sof(1, 1), sof(1, 1, 0xc2))],
  ['zero width', jpeg(sof(0, 1))],
  ['zero height', jpeg(sof(1, 0))],
  [
    'SOF length inconsistent with components',
    jpeg(new Uint8Array([255, 192, 0, 8, 8, 0, 1, 0, 1, 1])),
  ],
] as const

describe('post-audit P2-1 and P3-2 structural regressions', () => {
  it.each(badWebp)('rejects WebP %s', (_name, bytes) => {
    expect(() => inspectImage(bytes, 'image/webp')).toThrow('MEDIA_INVALID')
  })
  it.each(badJpeg)('rejects JPEG %s', (_name, bytes) => {
    expect(() => inspectImage(bytes, 'image/jpeg')).toThrow('MEDIA_INVALID')
  })
  it.each([
    ['unknown', riff(vp8x(), vp8(), unknown)],
    ['EXIF', riff(vp8x(1, 1, 0x08), vp8(), chunk('EXIF', new Uint8Array([1])))],
    ['residual VP8X', riff(vp8(), vp8x())],
  ] as const)('rejects unexpected derivative chunk %s', (_name, bytes) => {
    expect(() => inspectImage(bytes, 'image/webp', true)).toThrow('MEDIA_INVALID')
  })
  let legitimate: [string, Uint8Array, string][]
  const realResidual = () =>
    legitimate
      .filter(([name]) => ['simple VP8', 'simple VP8L'].includes(name))
      .map(
        ([name, bytes]) =>
          [`${name} residual VP8X`, riff(bytes.subarray(12), vp8x(32, 24))] as const,
      )
  beforeAll(async () => {
    const rgb = { create: { width: 32, height: 24, channels: 3 as const, background: '#803020' } }
    const rgba = {
      create: {
        width: 32,
        height: 24,
        channels: 4 as const,
        background: { r: 128, g: 48, b: 32, alpha: 0.5 },
      },
    }
    legitimate = [
      ['simple VP8', new Uint8Array(await sharp(rgb).webp().toBuffer()), 'image/webp'],
      [
        'simple VP8L',
        new Uint8Array(await sharp(rgb).webp({ lossless: true }).toBuffer()),
        'image/webp',
      ],
      ['extended alpha VP8', new Uint8Array(await sharp(rgba).webp().toBuffer()), 'image/webp'],
      [
        'simple alpha VP8L',
        new Uint8Array(await sharp(rgba).webp({ lossless: true }).toBuffer()),
        'image/webp',
      ],
      [
        'extended metadata VP8',
        new Uint8Array(await sharp(rgb).withMetadata().webp().toBuffer()),
        'image/webp',
      ],
      [
        'extended metadata VP8L',
        new Uint8Array(await sharp(rgba).withMetadata().webp({ lossless: true }).toBuffer()),
        'image/webp',
      ],
      ['baseline JPEG', new Uint8Array(await sharp(rgb).jpeg().toBuffer()), 'image/jpeg'],
      [
        'progressive JPEG',
        new Uint8Array(await sharp(rgb).jpeg({ progressive: true }).toBuffer()),
        'image/jpeg',
      ],
      [
        'grayscale JPEG',
        new Uint8Array(await sharp(rgb).toColourspace('b-w').jpeg().toBuffer()),
        'image/jpeg',
      ],
      [
        'CMYK JPEG',
        new Uint8Array(await sharp(rgb).toColourspace('cmyk').jpeg().toBuffer()),
        'image/jpeg',
      ],
    ]
  })
  it('accepts real simple/extended WebP and baseline/progressive/grayscale/CMYK JPEG', async () => {
    for (const [name, bytes, mime] of legitimate) {
      const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
      expect(decoded.info.width, name).toBe(32)
      expect(inspectImage(bytes, mime), name).toMatchObject({ width: 32, height: 24, format: mime })
    }
  })
  it('rejects VP8X appended to real decodable simple lossy and lossless WebP', () => {
    expect(realResidual()).toHaveLength(2)
    for (const [name, bytes] of realResidual()) {
      expect(() => inspectImage(bytes, 'image/webp'), name).toThrow('MEDIA_INVALID')
    }
  })
  it('keeps legal extended lossless and unknown input chunks while rejecting them on derivatives', () => {
    const bytes = riff(vp8x(), vp8l(), unknown)
    expect(inspectImage(bytes, 'image/webp')).toMatchObject({ width: 1, height: 1 })
    expect(() => inspectImage(bytes, 'image/webp', true)).toThrow('MEDIA_INVALID')
  })
  it('rejects every malformed input before CMS_MEDIA_PROCESSOR and records no R2 effect', async () => {
    const f = await cmsFixture()
    let processorCalls = 0,
      storageCalls = 0
    try {
      await applyTestMigration(f.db, '0007_cms_media_local.sql')
      const env: LocalMediaEnv = {
        ...f.env,
        CMS_MEDIA_LOCAL: 'disposable-v1',
        CMS_MEDIA_PROCESSOR: {
          fetch: async () => {
            processorCalls++
            throw Error('must not decode')
          },
        },
        CMS_MEDIA_BUCKET: {
          put: async () => {
            storageCalls++
            return null
          },
          get: async () => {
            storageCalls++
            return null
          },
          list: async () => {
            storageCalls++
            return { objects: [], truncated: false }
          },
          delete: async () => {
            storageCalls++
          },
        },
      }
      for (const [cases, mime] of [
        [[...badWebp, ...realResidual()], 'image/webp'],
        [badJpeg, 'image/jpeg'],
      ] as const) {
        for (const [name, bytes] of cases) {
          const operation = crypto.randomUUID()
          const response = await handleLocalMedia(
            new Request(`${TEST_ORIGIN}/api/admin/media`, {
              method: 'POST',
              body: bytes,
              headers: {
                Cookie: f.cookie,
                Origin: TEST_ORIGIN,
                'Content-Type': mime,
                'X-Operation-Id': operation,
                'If-None-Match': '*',
              },
            }),
            env,
          )
          expect(response.status, name).toBe(400)
          expect(
            (
              await f.db
                .prepare('SELECT state FROM cms_media WHERE media_id=?')
                .bind(`media_${operation}`)
                .first()
            )?.state,
            name,
          ).toBe('rejected')
          expect(
            (
              await f.db
                .prepare('SELECT status FROM cms_media_jobs WHERE operation_id=?')
                .bind(operation)
                .first()
            )?.status,
            name,
          ).toBe('failed')
        }
      }
      expect(processorCalls).toBe(0)
      expect(storageCalls).toBe(0)
    } finally {
      await f.runtime.dispose()
    }
  })
})
