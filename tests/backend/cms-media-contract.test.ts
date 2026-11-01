import { expect, it } from 'vitest'
import {
  type CmsMediaRecord,
  cmsMediaIds,
  publicationMediaErrors,
} from '../../server/cms/media-contract'
import type { CmsDocument } from '../../shared/cms'

const id = 'media_12345678-1234-4123-8123-123456789abc'
const sha256 = 'a'.repeat(64)
const doc: CmsDocument = {
  schemaVersion: 1,
  commercial: { fulfillmentMode: 'delivery', whatsappNumber: null },
  modules: [
    {
      id: 'hero',
      template: 'hero',
      region: 'start',
      visible: true,
      navigation: 'none',
      content: { heading: '', summary: '', media: { id, alt: '' } },
    },
    {
      id: 'module_12345678-1234-4123-8123-123456789abc',
      template: 'about',
      region: 'details',
      visible: false,
      navigation: 'none',
      content: { heading: '', body: '', media: { id, alt: '' } },
    },
  ],
}
const record = (): CmsMediaRecord => ({
  id,
  state: 'ready',
  derivatives: {
    hero: {
      objectKey: `cms/derived/${id}/${sha256}/hero.webp`,
      sha256,
      contentType: 'image/webp',
      width: 1920,
      height: 1080,
      bytes: 15000,
    },
    section: {
      objectKey: `cms/derived/${id}/${sha256}/section.webp`,
      sha256,
      contentType: 'image/webp',
      width: 1200,
      height: 900,
      bytes: 10000,
    },
  },
})

it('deduplica e retém referências de módulos ocultos para versões imutáveis', () => {
  expect(cmsMediaIds(doc)).toEqual([id])
  expect(publicationMediaErrors(doc, new Map([[id, record()]]))).toEqual([])
  expect(publicationMediaErrors(doc, new Map())).toEqual([id])
})
it.each(['quarantined', 'processing', 'rejected', 'deleting', 'deleted'] as const)(
  'não publica mídia %s',
  (state) => {
    expect(publicationMediaErrors(doc, new Map([[id, { ...record(), state }]]))).toEqual([id])
  },
)
it('rejeita derivados ausentes, URL, hash divergente, tamanho e dimensões inválidas', () => {
  const missing = record()
  missing.derivatives = null
  expect(publicationMediaErrors(doc, new Map([[id, missing]]))).toEqual([id])
  for (const patch of [
    { objectKey: 'https://evil.test' },
    { sha256: 'x' },
    { width: 1921 },
    { height: 0 },
    { bytes: 0 },
    { bytes: 3 * 1024 * 1024 },
    { width: 1.1 },
  ]) {
    const media = record()
    if (!media.derivatives) throw new Error('fixture')
    Object.assign(media.derivatives.hero, patch)
    expect(publicationMediaErrors(doc, new Map([[id, media]]))).toEqual([id])
  }
})
