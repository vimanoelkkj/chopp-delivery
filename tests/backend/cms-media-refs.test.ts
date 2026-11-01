import { expect, it } from 'vitest'
import {
  type CmsMediaRecord,
  cmsMediaIds,
  MEDIA_PROFILES,
  publicationMediaErrors,
} from '../../server/cms/media-contract'
import { media, refs, v2 } from './cms-v2-fixture'

it('collects carousel-level and entry-only media, deduplicated and sorted including hidden modules', () => {
  const doc: any = v2()
  doc.modules[1].visible = false
  doc.modules[1].content.media = media(2)
  doc.modules[1].content.entries = [
    { itemId: 'dronken', media: media(1) },
    { itemId: 'brahma', media: media(2) },
  ]
  const expected = [media(1).id, media(2).id].sort()
  expect(refs(doc)).toEqual(expected)
  expect(cmsMediaIds(doc)).toEqual(expected)
})
for (const at of ['carousel', 'entry'])
  it(`publication contract fails closed for ${at}-only unavailable media`, () => {
    const doc: any = v2()
    if (at === 'carousel') doc.modules[1].content.media = media()
    else doc.modules[1].content.entries[0].media = media()
    expect(publicationMediaErrors(doc, new Map())).toEqual([media().id])
  })

for (const at of ['carousel', 'entry'])
  it(`accepts valid metadata and rejects corrupted derivatives for ${at}-only references`, () => {
    const doc: any = v2(),
      id = media().id
    if (at === 'carousel') doc.modules[1].content.media = media()
    else doc.modules[1].content.entries[0].media = media()
    const record: CmsMediaRecord = {
      id,
      state: 'ready',
      derivatives: Object.fromEntries(
        Object.entries(MEDIA_PROFILES).map(([profile, bounds]) => [
          profile,
          {
            ...bounds,
            objectKey: `cms/derived/${id}/${'a'.repeat(64)}/${profile}.webp`,
            sha256: 'a'.repeat(64),
            contentType: 'image/webp',
            bytes: 100,
          },
        ]),
      ) as CmsMediaRecord['derivatives'],
    }
    expect(publicationMediaErrors(doc, new Map([[id, record]]))).toEqual([])
    record.derivatives!.section.sha256 = 'invalid'
    expect(publicationMediaErrors(doc, new Map([[id, record]]))).toEqual([id])
  })
