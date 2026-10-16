// Local laboratory only: native sharp is NOT a deployable Workers dependency.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { Miniflare } from 'miniflare'
import sharp from 'sharp'

const LIMIT = {
  bytes: 5 * 1024 * 1024,
  dimension: 6000,
  pixels: 12_000_000,
  output: 2 * 1024 * 1024,
  readMs: 5000,
}
const profiles = { hero: [1920, 1080], section: [1200, 900] }
export async function readLimitedBytes(stream, limit = LIMIT.bytes, deadlineMs = LIMIT.readMs) {
  const reader = stream.getReader()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('READ_TIMEOUT'))
      void reader.cancel().catch(() => {})
    }, deadlineMs)
  })
  try {
    let size = 0
    const chunks = []
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline])
      if (done) break
      size += value.byteLength
      if (size > limit) {
        void reader.cancel().catch(() => {})
        throw new Error('INPUT_BYTES')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } finally {
    clearTimeout(timer)
    reader.releaseLock()
  }
}
const stream = (bytes) => new Blob([bytes]).stream()
// Walk segments/scans: EOI-looking bytes inside APP payloads are not markers.
function checkJpegEnd(bytes) {
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('JPEG_MARKER')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9) {
      if (offset !== bytes.length) throw new Error('JPEG_TRAILING')
      return
    }
    if (marker === 0x01) continue
    if (
      !marker ||
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      offset + 2 > bytes.length
    )
      throw new Error('JPEG_MARKER')
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) throw new Error('TRUNCATED_JPEG')
    offset += length
    if (marker !== 0xda) continue
    while (offset < bytes.length) {
      if (bytes[offset++] !== 0xff) continue
      const start = offset - 1
      while (bytes[offset] === 0xff) offset++
      const next = bytes[offset]
      if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
        offset++
        continue
      }
      offset = start
      break
    }
  }
  throw new Error('TRUNCATED_JPEG')
}
function actualFormat(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset)
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (offset + 12 + length > bytes.length) throw new Error('TRUNCATED_PNG')
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('ANIMATION')
      offset += 12 + length
      if (type === 'IEND') {
        if (length !== 0 || offset !== bytes.length) throw new Error('PNG_TRAILING')
        return 'png'
      }
    }
    throw new Error('TRUNCATED_PNG')
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
    checkJpegEnd(bytes)
    return 'jpeg'
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('TRUNCATED_WEBP')
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString('ascii', offset, offset + 4)
      const length = bytes.readUInt32LE(offset + 4)
      const end = offset + 8 + length
      if (end > bytes.length) throw new Error('TRUNCATED_WEBP')
      if (['ANIM', 'ANMF'].includes(type) || (type === 'VP8X' && bytes[offset + 8] & 2))
        throw new Error('ANIMATION')
      offset = end + (length % 2)
    }
    if (offset !== bytes.length) throw new Error('TRUNCATED_WEBP')
    return 'webp'
  }
  throw new Error('FORMAT')
}

export async function processLocalImage(input, claimedMime) {
  const bytes = await readLimitedBytes(input)
  const format = actualFormat(bytes)
  if (claimedMime !== `image/${format}`) throw new Error('MIME_MISMATCH')
  const options = { failOn: 'warning', limitInputPixels: LIMIT.pixels, sequentialRead: true }
  const metadata = await sharp(bytes, options).metadata()
  if (
    metadata.format !== format ||
    (metadata.pages ?? 1) !== 1 ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > LIMIT.dimension ||
    metadata.height > LIMIT.dimension ||
    metadata.width * metadata.height > LIMIT.pixels
  )
    throw new Error('DIMENSIONS_OR_ANIMATION')
  // Decode ALL source pixels before resize: metadata() alone does not prove a valid image.
  await sharp(bytes, options).timeout({ seconds: 5 }).raw().toBuffer()
  const derivatives = {}
  for (const [profile, [width, height]] of Object.entries(profiles)) {
    const data = await sharp(bytes, options)
      .timeout({ seconds: 5 })
      .rotate()
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    if (data.length > LIMIT.output) throw new Error('OUTPUT_BYTES')
    const info = await sharp(data).metadata()
    assert.equal(info.format, 'webp')
    assert.ok(info.width <= width && info.height <= height)
    for (const key of ['exif', 'icc', 'iptc', 'xmp', 'orientation'])
      assert.equal(info[key], undefined)
    derivatives[profile] = {
      data,
      width: info.width,
      height: info.height,
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    }
  }
  return derivatives
}

export async function runMediaProof() {
  const started = performance.now()
  const cases = []
  const check = async (name, run) => {
    await run()
    cases.push(name)
  }
  const base = { create: { width: 2400, height: 1600, channels: 3, background: '#803020' } }
  const png = await sharp(base).png().toBuffer()
  const jpeg = await sharp(base).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const webp = await sharp(base).webp().toBuffer()
  let hero
  for (const [format, bytes] of [
    ['png', png],
    ['jpeg', jpeg],
    ['webp', webp],
  ]) {
    await check(`decode-reencode-${format}`, async () => {
      const output = await processLocalImage(stream(bytes), `image/${format}`)
      assert.equal(Object.keys(output).length, 2)
      if (format === 'png') hero = output.hero
    })
    await check(`truncated-${format}`, () =>
      assert.rejects(
        processLocalImage(
          stream(bytes.subarray(0, Math.floor(bytes.length / 2))),
          `image/${format}`,
        ),
      ),
    )
  }
  await check('metadata-fixture-has-exif', async () =>
    assert.ok((await sharp(jpeg).metadata()).exif),
  )
  await check('jpeg-trailing-fake-eoi', () =>
    assert.rejects(
      processLocalImage(
        stream(Buffer.concat([jpeg, Buffer.from('payload'), Buffer.from([255, 217])])),
        'image/jpeg',
      ),
      /JPEG_TRAILING/,
    ),
  )
  await check('jpeg-concatenated', () =>
    assert.rejects(
      processLocalImage(stream(Buffer.concat([jpeg, jpeg])), 'image/jpeg'),
      /JPEG_TRAILING/,
    ),
  )
  await check('jpeg-app-embedded-eoi', async () => {
    const app = Buffer.from([255, 239, 0, 6, 255, 217, 1, 2])
    await processLocalImage(
      stream(Buffer.concat([jpeg.subarray(0, 2), app, jpeg.subarray(2)])),
      'image/jpeg',
    )
  })
  await check('jpeg-progressive-multiple-scans', async () => {
    await processLocalImage(
      stream(await sharp(base).jpeg({ progressive: true }).toBuffer()),
      'image/jpeg',
    )
  })
  await check('mime-spoof', () =>
    assert.rejects(processLocalImage(stream(png), 'image/jpeg'), /MIME_MISMATCH/),
  )
  await check('fake-signature', () =>
    assert.rejects(
      processLocalImage(stream(Buffer.from([255, 216, 255, 0, 255, 217])), 'image/jpeg'),
    ),
  )
  await check('svg', () =>
    assert.rejects(
      processLocalImage(
        stream(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
        'image/png',
      ),
      /FORMAT/,
    ),
  )
  await check('gif', () =>
    assert.rejects(processLocalImage(stream(Buffer.from('GIF89a')), 'image/gif'), /FORMAT/),
  )
  const animation = await sharp(
    Buffer.concat([Buffer.alloc(16 * 16 * 3, 0), Buffer.alloc(16 * 16 * 3, 255)]),
    { raw: { width: 16, height: 32, pageHeight: 16, channels: 3 } },
  )
    .webp({ loop: 0, delay: [100, 100] })
    .toBuffer()
  await check('animated-webp-fixture', async () =>
    assert.equal((await sharp(animation, { animated: true }).metadata()).pages, 2),
  )
  await check('animated-webp', () =>
    assert.rejects(processLocalImage(stream(animation), 'image/webp'), /ANIMATION/),
  )
  // An APNG control chunk is enough to demand rejection, even before decoder validity checks.
  const apng = Buffer.concat([
    png.subarray(0, 33),
    Buffer.from('000000086163544c000000020000000000000000', 'hex'),
    png.subarray(33),
  ])
  await check('apng-control-chunk', () =>
    assert.rejects(processLocalImage(stream(apng), 'image/png'), /ANIMATION/),
  )
  await check('dimension-limit', async () => {
    const wide = await sharp({
      create: { width: 6001, height: 1, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer()
    await assert.rejects(processLocalImage(stream(wide), 'image/png'), /DIMENSIONS/)
  })
  await check('pixel-limit', async () => {
    const large = await sharp({
      create: { width: 4000, height: 3001, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer()
    await assert.rejects(processLocalImage(stream(large), 'image/png'), /pixel limit|DIMENSIONS/i)
  })
  await check('byte-limit-cancels', async () => {
    let cancelled = false
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(LIMIT.bytes + 1))
      },
      cancel() {
        cancelled = true
      },
    })
    await assert.rejects(readLimitedBytes(body), /INPUT_BYTES/)
    assert.ok(cancelled)
  })
  await check('chunked-limit', () =>
    assert.rejects(
      readLimitedBytes(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(3))
            c.enqueue(new Uint8Array(3))
            c.close()
          },
        }),
        5,
      ),
      /INPUT_BYTES/,
    ),
  )
  await check('exact-byte-boundary', async () =>
    assert.equal((await readLimitedBytes(stream(Buffer.alloc(5)), 5)).length, 5),
  )
  await check('stream-deadline-cancels', async () => {
    let cancelled = false
    await assert.rejects(
      readLimitedBytes(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        5,
        20,
      ),
      /READ_TIMEOUT/,
    )
    assert.ok(cancelled)
  })
  await check('decoder-corruption', async () => {
    const corrupt = Buffer.from(png)
    corrupt.fill(0, 50, Math.min(150, corrupt.length - 12))
    await assert.rejects(processLocalImage(stream(corrupt), 'image/png'))
  })
  const runtime = new Miniflare({
    workers: [
      {
        name: 'pages-simulation',
        modules: true,
        compatibilityDate: '2026-08-06',
        serviceBindings: { MEDIA: 'private-media-simulation' },
        script: 'export default { fetch(request, env) { return env.MEDIA.fetch(request) } }',
      },
      {
        name: 'private-media-simulation',
        modules: true,
        compatibilityDate: '2026-08-06',
        images: { binding: 'IMAGES' },
        script: `export default { async fetch(request, env) {
          const bytes = await request.arrayBuffer();
          if (new URL(request.url).pathname === '/info') return Response.json(await env.IMAGES.info(new Blob([bytes]).stream()));
          return (await env.IMAGES.input(new Blob([bytes]).stream()).transform({width: 1920, height: 1080}).output({format: 'image/webp'})).response();
        } }`,
      },
    ],
  })
  try {
    await check('workerd-service-binding-images-info', async () => {
      const response = await runtime.dispatchFetch('http://proof.invalid/info', {
        method: 'POST',
        body: png,
      })
      assert.equal(response.status, 200)
      const info = await response.json()
      assert.equal(info.format, 'image/png')
      assert.equal(info.width, 2400)
      assert.equal(info.height, 1600)
    })
    await check('workerd-service-binding-images-output', async () => {
      const response = await runtime.dispatchFetch('http://proof.invalid/transform', {
        method: 'POST',
        body: png,
      })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'image/webp')
      const info = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
      assert.equal(info.format, 'webp')
      // Offline binding defaults to contain, preserving the source 3:2 aspect ratio.
      assert.equal(info.width, 1620)
      assert.equal(info.height, 1080)
    })
  } finally {
    await runtime.dispose()
  }
  return {
    scope: 'LOCAL_NODE_AND_MINIFLARE_OFFLINE_ONLY',
    remoteExecuted: false,
    node: process.version,
    sharp: sharp.versions.sharp,
    vips: sharp.versions.vips,
    checks: cases.length,
    cases,
    elapsedMs: Math.round(performance.now() - started),
    processMaxRssKiB: process.resourceUsage().maxRSS,
    hero: hero && {
      width: hero.width,
      height: hero.height,
      bytes: hero.bytes,
      sha256: hero.sha256,
    },
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runMediaProof(), null, 2))
}
