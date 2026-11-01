import type {
  CmsConversionMapping,
  CmsDocument,
  CmsDocumentV2,
  CmsModuleV2,
  CmsWarning,
} from '../../shared/cms'
import { validateCmsDocument } from './validation-v1'
import { parseCmsDocument } from './validation-v2'

export function convertCmsV1ToV2(input: CmsDocument): {
  document: CmsDocumentV2
  mapping: CmsConversionMapping[]
  losses: string[]
  warnings: CmsWarning[]
} {
  const parsed = validateCmsDocument(input, 'draft')
  if (!parsed.value) throw new Error('CMS_CONVERSION_INVALID')
  const v1 = parsed.value,
    mapping: CmsConversionMapping[] = [],
    warnings: CmsWarning[] = []
  const modules = v1.modules.map((m) => {
    const { region: _region, ...base } = m
    const next =
      m.template === 'barrels'
        ? {
            ...base,
            template: 'carousel',
            content: {
              heading: m.content.heading,
              lead: m.content.body,
              media: m.content.media,
              entries: [],
            },
          }
        : base
    mapping.push({
      from: { id: m.id, template: m.template },
      to: { id: next.id, template: next.template as CmsModuleV2['template'] },
    })
    return next as CmsModuleV2
  })
  const byTemplate = (template: CmsModuleV2['template']) =>
    modules.filter((m) => m.template === template)
  const carousel = byTemplate('carousel')[0]
  if (!carousel) warnings.push('COMPOSITION_WITHOUT_CAROUSEL')
  else {
    if (!carousel.visible) warnings.push('CAROUSEL_HIDDEN')
    warnings.push('CAROUSEL_EMPTY')
  }
  const document: CmsDocumentV2 = {
    schemaVersion: 2,
    commercial: v1.commercial,
    modules: [
      ...byTemplate('hero'),
      ...byTemplate('carousel'),
      ...byTemplate('ticker'),
      ...byTemplate('catalog'),
      ...modules.filter((m) => ['how', 'about', 'highlight', 'faq'].includes(m.template)),
      ...byTemplate('contact'),
    ],
  }
  if (!parseCmsDocument(document, 'draft').value) throw new Error('CMS_CONVERSION_INVALID')
  return { document, mapping, losses: [], warnings }
}
